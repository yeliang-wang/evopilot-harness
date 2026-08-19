import { API_VERSION } from "./constants.mjs";
import { validateDocument } from "./schema.mjs";
import { digest, persistedJson, safeId, unique } from "./utils.mjs";

export const DELTA_ALGORITHM_VERSION = "asset-delta-reasoning/v1";
export const IMPACT_ALGORITHM_VERSION = "asset-impact-analysis/v1";
export const EVALUATION_ALGORITHM_VERSION = "portable-positive-negative-evaluation/v3";

const MUTATING_DECISIONS = new Set(["EVOLVE_EXISTING", "COMPOSE_NEW_BUNDLE", "PROPOSE_NEW_PROFILE"]);
const PROPOSAL_DECISIONS = new Set([...MUTATING_DECISIONS, "NO_CHANGE", "NEED_MORE_EVIDENCE"]);

export function isMutatingDecision(decision) {
  return MUTATING_DECISIONS.has(normalizeProposalDecision(decision));
}

export function normalizeProposalDecision(decision) {
  if (decision === "INSUFFICIENT_EVIDENCE" || decision === "REVIEW_REQUIRED") return "NEED_MORE_EVIDENCE";
  return PROPOSAL_DECISIONS.has(decision) ? decision : decision;
}

export function buildEvaluationPackV3({ graph, reasoning, records = [], proposedAssets = [] }) {
  const decision = normalizeProposalDecision(reasoning.decision);
  const baseline = baselineRecords(reasoning, records)[0];
  const target = proposedAssets[0] ? documentRef(proposedAssets[0]) : baseline ? documentRef(baseline.asset, baseline.digest) : unresolvedTarget(reasoning, graph);
  const evidenceRefs = citedEvidence(graph, reasoning);
  const sourceTypes = unique([
    ...(graph.sources ?? []).map((source) => source.type),
    ...graph.nodes.map((node) => node.sourceType ?? node.kind)
  ]);
  const validators = [
    { id: "asset-delta-contract", version: "1.0.0" },
    { id: "evidence-citation-closure", version: "1.0.0" },
    { id: "decision-boundary", version: "1.0.0" }
  ];
  const scorers = [{ id: "deterministic-assertion-scorer", version: "1.0.0" }];
  const positiveId = `${safeId(graph.runId)}-positive`;
  const negativeId = `${safeId(graph.runId)}-negative`;
  const commonContext = {
    sourceTypes: sourceTypes.length ? sourceTypes : ["unknown-evidence"],
    constraints: [
      "Read only the cited immutable evidence snapshot.",
      "Do not execute source-project commands or infer uncited capabilities."
    ]
  };
  const baselineRef = baseline ? documentRef(baseline.asset, baseline.digest) : null;
  return {
    apiVersion: API_VERSION,
    kind: "EvaluationPack",
    metadata: {
      id: `${target.id}-evaluation`,
      version: target.version,
      lifecycle: "review",
      description: "Portable positive and negative decision cases for an evidence-driven Harness asset delta."
    },
    spec: {
      targetRef: target,
      proposalRef: { id: graph.runId },
      minimumReviewedCases: 2,
      requiredPolarities: ["positive", "negative"],
      cases: [
        {
          id: positiveId,
          polarity: "positive",
          context: commonContext,
          inputDigest: graph.graphDigest,
          expectedDecision: decision,
          expectedOutcome: MUTATING_DECISIONS.has(decision) ? "A review-stage asset delta is produced without publication." : "The deterministic stop decision is preserved without asset mutation.",
          assertions: [
            { id: "decision-preserved", path: "/decision", operator: "EQUALS", expected: decision, severity: "blocking" },
            { id: "human-gate-required", path: "/humanApprovalRequired", operator: "EQUALS", expected: true, severity: "blocking" }
          ],
          validators,
          scorers,
          baselineRef,
          regressionBoundary: { allowedFailures: 0, failureSeverity: "blocking", mustPreserveDecision: true },
          evidenceRefs,
          reviewStatus: "unreviewed"
        },
        {
          id: negativeId,
          polarity: "negative",
          context: {
            ...commonContext,
            constraints: [
              ...commonContext.constraints,
              "Missing, conflicting, or boundary-negative evidence must not create or publish an asset version."
            ]
          },
          inputDigest: digest({ graphDigest: graph.graphDigest, case: "negative-boundary", evidenceIds: evidenceRefs.map((item) => item.evidenceId) }),
          expectedDecision: "NEED_MORE_EVIDENCE",
          expectedOutcome: "Publication remains blocked when evidence or boundary closure is absent.",
          assertions: [
            { id: "publication-blocked", path: "/assetDeltaProposal/spec/publicationAllowed", operator: "EQUALS", expected: false, severity: "blocking" },
            { id: "no-automatic-approval", path: "/approval", operator: "NOT_EQUALS", expected: "AUTOMATIC", severity: "blocking" }
          ],
          validators,
          scorers,
          baselineRef,
          regressionBoundary: { allowedFailures: 0, failureSeverity: "blocking", mustPreserveDecision: true },
          evidenceRefs,
          reviewStatus: "unreviewed"
        }
      ],
      validators,
      scorers,
      status: "INSUFFICIENT_EVAL_EVIDENCE"
    }
  };
}

export function buildAssetDeltaProposal({ graph, reasoning, records = [], proposedAssets = [], evaluationPack }) {
  const decision = normalizeProposalDecision(reasoning.decision);
  const evidenceIds = citedEvidence(graph, reasoning).map((item) => item.evidenceId);
  const baselines = baselineRecords(reasoning, records);
  const deltas = proposedAssets.map((asset, index) => {
    const beforeRecords = decision === "COMPOSE_NEW_BUNDLE"
      ? baselines
      : baselines.filter((record) => record.asset.kind === asset.kind && record.asset.metadata.id === asset.metadata.id);
    const operation = decision === "COMPOSE_NEW_BUNDLE" ? "COMPOSE" : beforeRecords.length ? "UPDATE" : "CREATE";
    return buildDelta({ asset, beforeRecords, operation, evidenceIds, evaluationPack, records, index });
  });
  if (MUTATING_DECISIONS.has(decision) && !proposedAssets.some((asset) => asset.kind === "EvaluationPack" && asset.metadata.id === evaluationPack.metadata.id && asset.metadata.version === evaluationPack.metadata.version)) {
    deltas.push(buildDelta({ asset: evaluationPack, beforeRecords: [], operation: "CREATE", evidenceIds, evaluationPack, records, index: deltas.length }));
  }
  if (decision === "NO_CHANGE" && baselines[0]) {
    deltas.push(buildDelta({ asset: baselines[0].asset, beforeRecords: [baselines[0]], operation: "NO_CHANGE", evidenceIds, evaluationPack, records, index: 0 }));
  }
  const publicationAllowed = MUTATING_DECISIONS.has(decision);
  const status = decision === "NO_CHANGE" ? "NO_CHANGE" : decision === "NEED_MORE_EVIDENCE" ? "NEED_MORE_EVIDENCE" : deltas.every((item) => item.impact.status === "READY") ? "READY_FOR_REVIEW" : "BLOCKED";
  return {
    apiVersion: API_VERSION,
    kind: "AssetDeltaProposal",
    metadata: {
      id: safeId(`${graph.runId}-asset-delta`),
      version: "1.0.0",
      lifecycle: "review",
      description: "Evidence-linked before and after Harness asset changes with deterministic impact and rollback analysis."
    },
    spec: {
      decision,
      evidence: { graphDigest: graph.graphDigest, reasoningDigest: digest(persistedJson(reasoning)), evidenceIds },
      deltas,
      evaluationPackRef: documentRef(evaluationPack),
      publicationAllowed,
      status
    }
  };
}

export function bindEvaluationPack(evaluationPack, proposedAssets = [], lifecycle) {
  const rebound = structuredClone(evaluationPack);
  if (lifecycle) rebound.metadata.lifecycle = lifecycle;
  if (proposedAssets[0]) rebound.spec.targetRef = documentRef(proposedAssets[0]);
  return rebound;
}

export function rebindAssetDeltaProposal(assetDeltaProposal, { proposedAssets = [], evaluationPack, records = [], lifecycle } = {}) {
  const rebound = structuredClone(assetDeltaProposal);
  if (lifecycle) rebound.metadata.lifecycle = lifecycle;
  const decision = normalizeProposalDecision(rebound.spec.decision);
  const evidenceIds = rebound.spec.evidence.evidenceIds;
  const originalDeltas = rebound.spec.deltas ?? [];
  const deltas = proposedAssets.map((asset, index) => {
    const original = originalDeltas.find((item) => item.after?.kind === asset.kind && item.after?.id === asset.metadata.id && item.after?.version === asset.metadata.version);
    const operation = original?.operation ?? (decision === "COMPOSE_NEW_BUNDLE" ? "COMPOSE" : "CREATE");
    return buildDelta({
      asset,
      beforeRecords: statesAsRecords(original?.before ?? []),
      operation,
      evidenceIds,
      evaluationPack,
      records,
      index
    });
  });
  if (MUTATING_DECISIONS.has(decision) && !proposedAssets.some((asset) => sameDocumentIdentity(asset, evaluationPack))) {
    const original = originalDeltas.find((item) => isAssociatedEvaluationDelta(item, evaluationPack));
    deltas.push(buildDelta({
      asset: evaluationPack,
      beforeRecords: statesAsRecords(original?.before ?? []),
      operation: original?.operation ?? "CREATE",
      evidenceIds,
      evaluationPack,
      records,
      index: deltas.length
    }));
  } else if (decision === "NO_CHANGE") {
    const original = originalDeltas.find((item) => item.operation === "NO_CHANGE");
    if (original?.after?.document) {
      deltas.push(buildDelta({
        asset: original.after.document,
        beforeRecords: statesAsRecords(original.before ?? []),
        operation: "NO_CHANGE",
        evidenceIds,
        evaluationPack,
        records,
        index: 0
      }));
    }
  }
  rebound.spec.deltas = deltas;
  rebound.spec.evaluationPackRef = documentRef(evaluationPack);
  rebound.spec.publicationAllowed = MUTATING_DECISIONS.has(decision);
  rebound.spec.status = decision === "NO_CHANGE"
    ? "NO_CHANGE"
    : decision === "NEED_MORE_EVIDENCE"
      ? "NEED_MORE_EVIDENCE"
      : deltas.every((item) => item.impact.status === "READY")
        ? "READY_FOR_REVIEW"
        : "BLOCKED";
  return rebound;
}

export function validateAssetDeltaClosure(assetDeltaProposal, evaluationPack, { proposedAssets, records = [], evidenceGraph, reasoning } = {}) {
  const deltaValidation = validateDocument(assetDeltaProposal);
  const evaluationValidation = validateDocument(evaluationPack);
  const decision = assetDeltaProposal?.spec?.decision;
  const deltas = assetDeltaProposal?.spec?.deltas ?? [];
  const cases = evaluationPack?.spec?.cases ?? [];
  const polarities = new Set(cases.map((item) => item.polarity));
  const mutating = MUTATING_DECISIONS.has(decision);
  const effectiveProposedAssets = proposedAssets ?? deltas.filter((item) => !isAssociatedEvaluationDelta(item, evaluationPack) && item.operation !== "NO_CHANGE").map((item) => item.after?.document).filter(Boolean);
  const states = deltas.flatMap((item) => [...(item.before ?? []), ...(item.after ? [item.after] : [])]);
  const stateValidations = states.map((state) => validateDocument(state.document));
  const stateDigestsValid = deltas.every((item) => [
    ...(item.before ?? []),
    ...(item.after ? [item.after] : [])
  ].every((state) => digest(state.document) === state.digest));
  const stateIdentityValid = deltas.every((item) => [
    ...(item.before ?? []),
    ...(item.after ? [item.after] : [])
  ].every((state) => state.kind === state.document?.kind && state.id === state.document?.metadata?.id && state.version === state.document?.metadata?.version));
  const operationSemanticsValid = deltas.every((item) => {
    if (item.operation === "CREATE") return item.before.length === 0 && Boolean(item.after);
    if (item.operation === "UPDATE") return item.before.length === 1 && Boolean(item.after) && item.before[0].kind === item.after.kind && item.before[0].id === item.after.id && item.before[0].version !== item.after.version;
    if (item.operation === "COMPOSE") return item.before.length >= 1 && item.after?.kind === "HarnessBundle";
    if (item.operation === "NO_CHANGE") return item.before.length === 1 && item.after?.digest === item.before[0].digest;
    return false;
  });
  const impactReady = deltas.every((item) => item.impact?.status === "READY");
  const evaluationRefValid = assetDeltaProposal?.spec?.evaluationPackRef?.digest === digest(evaluationPack);
  const proposedAssetRefs = effectiveProposedAssets.map((asset) => documentRef(asset));
  const proposedIncludesEvaluation = effectiveProposedAssets.some((asset) => sameDocumentIdentity(asset, evaluationPack));
  const deltaAssetRefs = deltas.filter((item) => (proposedIncludesEvaluation || !isAssociatedEvaluationDelta(item, evaluationPack)) && item.operation !== "NO_CHANGE").map((item) => documentRef(item.after.document));
  const proposedAssetsBound = sameReferenceSet(proposedAssetRefs, deltaAssetRefs);
  const evaluationDeltas = deltas.filter((item) => isAssociatedEvaluationDelta(item, evaluationPack));
  const evaluationDeltaBound = mutating
    ? evaluationDeltas.length === 1 && evaluationDeltas[0].after?.digest === digest(evaluationPack) && digest(evaluationDeltas[0].after.document) === digest(evaluationPack)
    : evaluationDeltas.length === 0;
  const evaluationTargetBound = !mutating || !effectiveProposedAssets[0] || sameReference(evaluationPack?.spec?.targetRef, documentRef(effectiveProposedAssets[0]));
  const baselineStates = deltas.flatMap((item) => item.before ?? []);
  const baselinesBound = baselineStates.length === 0 || (records.length > 0 && baselineStates.every((state) => records.some((record) => sameReference(state, assetState(record.asset, record.digest)))));
  const evidenceBinding = validateEvidenceBinding(assetDeltaProposal, evaluationPack, evidenceGraph, reasoning);
  const expected = rebindAssetDeltaProposal(assetDeltaProposal, { proposedAssets: effectiveProposedAssets, evaluationPack, records });
  const derivedFieldsValid = digest(assetDeltaProposal?.spec?.deltas ?? []) === digest(expected.spec.deltas)
    && assetDeltaProposal?.spec?.publicationAllowed === expected.spec.publicationAllowed
    && assetDeltaProposal?.spec?.status === expected.spec.status
    && digest(assetDeltaProposal?.spec?.evaluationPackRef) === digest(expected.spec.evaluationPackRef);
  const terminalSafe = mutating
    ? assetDeltaProposal?.spec?.publicationAllowed === true && deltas.length > 0
    : assetDeltaProposal?.spec?.publicationAllowed === false;
  const checks = [
    check("asset-delta-schema", deltaValidation.valid, deltaValidation.errors),
    check("evaluation-pack-v3-schema", evaluationValidation.valid, evaluationValidation.errors),
    check("embedded-document-schemas", stateValidations.every((item) => item.valid), stateValidations.filter((item) => !item.valid).flatMap((item) => item.errors.map((error) => `${item.kind ?? "unknown"}:${error.path}:${error.message}`))),
    check("evidence-context-binding", evidenceBinding.valid, evidenceBinding.errors),
    check("positive-negative-evaluation", polarities.has("positive") && polarities.has("negative"), [...polarities]),
    check("evaluation-reference-digest", evaluationRefValid, [assetDeltaProposal?.spec?.evaluationPackRef?.digest, digest(evaluationPack)]),
    check("evaluation-target-binding", evaluationTargetBound, [evaluationPack?.spec?.targetRef?.digest, effectiveProposedAssets[0] ? digest(effectiveProposedAssets[0]) : "not-applicable"]),
    check("evaluation-delta-binding", evaluationDeltaBound, evaluationDeltas.map((item) => item.deltaId)),
    check("proposed-assets-delta-binding", proposedAssetsBound, [...proposedAssetRefs, ...deltaAssetRefs].map((item) => `${item.kind}:${item.id}@${item.version}:${item.digest}`)),
    check("catalog-baseline-binding", baselinesBound, deltas.flatMap((item) => (item.before ?? []).map((state) => `${state.kind}:${state.id}@${state.version}:${state.digest}`))),
    check("exact-state-digests", stateDigestsValid, deltas.map((item) => item.deltaId)),
    check("exact-state-identity", stateIdentityValid, deltas.map((item) => item.deltaId)),
    check("delta-operation-semantics", operationSemanticsValid, deltas.map((item) => `${item.deltaId}:${item.operation}`)),
    check("deterministic-derived-fields", derivedFieldsValid, derivedFieldsValid ? [digest(expected.spec.deltas)] : [digest(assetDeltaProposal?.spec?.deltas ?? []), digest(expected.spec.deltas)]),
    check("deterministic-impact-closure", impactReady || !deltas.length, deltas.filter((item) => item.impact?.status !== "READY").map((item) => item.deltaId)),
    check("decision-publication-boundary", terminalSafe, [String(decision), String(assetDeltaProposal?.spec?.publicationAllowed)])
  ];
  return {
    schema: "evopilot-harness-asset-delta-closure/v1",
    status: checks.every((item) => item.status === "PASS") ? "VALIDATED" : "FAILED",
    checks,
    blockers: checks.filter((item) => item.status === "FAIL").map((item) => `asset-delta:${item.id}`)
  };
}

function validateEvidenceBinding(assetDeltaProposal, evaluationPack, evidenceGraph, reasoning) {
  if (!evidenceGraph || !reasoning) return { valid: false, errors: ["Evidence Graph and reasoning result are required for Delta closure."] };
  const graphInput = persistedJson(evidenceGraph);
  delete graphInput.graphDigest;
  const graphDigestValid = evidenceGraph.graphDigest === digest(graphInput);
  const reasoningDigest = digest(persistedJson(reasoning));
  const declared = assetDeltaProposal?.spec?.evidence ?? {};
  const nodes = new Map((evidenceGraph.nodes ?? []).map((node) => [node.evidenceId, node]));
  const reasoningEvidenceIds = new Set(unique([...(reasoning.evidenceIds ?? []), ...(reasoning.eligibility?.evidenceIds ?? [])]));
  const declaredEvidenceIds = declared.evidenceIds ?? [];
  const referencedIds = unique([
    ...declaredEvidenceIds,
    ...(assetDeltaProposal?.spec?.deltas ?? []).flatMap((item) => [
      ...(item.evidenceIds ?? []),
      ...(item.changes ?? []).flatMap((change) => change.evidenceIds ?? []),
      ...(item.impact?.expectedEffect?.claims ?? []).flatMap((claim) => claim.evidenceIds ?? [])
    ]),
    ...(evaluationPack?.spec?.cases ?? []).flatMap((item) => (item.evidenceRefs ?? []).map((reference) => reference.evidenceId))
  ]);
  const referenceDigestsValid = (evaluationPack?.spec?.cases ?? []).every((item) => (item.evidenceRefs ?? []).every((reference) => {
    const node = nodes.get(reference.evidenceId);
    return Boolean(node) && reference.digest === evidenceNodeDigest(node);
  }));
  const errors = [
    ...(!graphDigestValid ? [`Evidence Graph digest mismatch: ${evidenceGraph.graphDigest} != ${digest(graphInput)}`] : []),
    ...(declared.graphDigest !== evidenceGraph.graphDigest ? [`Delta graph digest mismatch: ${declared.graphDigest} != ${evidenceGraph.graphDigest}`] : []),
    ...(declared.reasoningDigest !== reasoningDigest ? [`Delta reasoning digest mismatch: ${declared.reasoningDigest} != ${reasoningDigest}`] : []),
    ...(declaredEvidenceIds.every((id) => nodes.has(id)) ? [] : ["Delta declares evidence ids absent from the Evidence Graph."]),
    ...(declaredEvidenceIds.every((id) => reasoningEvidenceIds.has(id)) ? [] : ["Delta declares evidence ids not cited by deterministic reasoning."]),
    ...(referencedIds.every((id) => declaredEvidenceIds.includes(id)) ? [] : ["Delta or Evaluation references evidence ids outside the declared Delta evidence set."]),
    ...(referenceDigestsValid ? [] : ["Evaluation evidence reference digest does not match the Evidence Graph node."])
  ];
  return { valid: errors.length === 0, errors };
}

function evidenceNodeDigest(node) {
  return node.excerptDigest ?? node.sourceDigest ?? digest(node.excerpt ?? node);
}

function statesAsRecords(states) {
  return states.map((state) => ({ asset: structuredClone(state.document), digest: state.digest }));
}

function sameReference(left, right) {
  return left?.kind === right?.kind && left?.id === right?.id && left?.version === right?.version && left?.digest === right?.digest;
}

function sameDocumentIdentity(left, right) {
  return left?.kind === right?.kind && left?.metadata?.id === right?.metadata?.id && left?.metadata?.version === right?.metadata?.version;
}

function isAssociatedEvaluationDelta(delta, evaluationPack) {
  return delta?.assetKind === "EvaluationPack"
    && delta?.after?.id === evaluationPack?.metadata?.id
    && delta?.after?.version === evaluationPack?.metadata?.version;
}

function sameReferenceSet(left, right) {
  if (left.length !== right.length) return false;
  const expected = left.map((item) => `${item.kind}:${item.id}@${item.version}:${item.digest}`).sort();
  const actual = right.map((item) => `${item.kind}:${item.id}@${item.version}:${item.digest}`).sort();
  return expected.every((item, index) => item === actual[index]);
}

function buildDelta({ asset, beforeRecords, operation, evidenceIds, evaluationPack, records, index }) {
  const before = beforeRecords.map((record) => assetState(record.asset, record.digest));
  const after = assetState(asset);
  const changes = operation === "NO_CHANGE"
    ? [{ path: "/", operation: "RETAIN", before: before[0].document, after: after.document, evidenceIds }]
    : operation === "CREATE"
      ? [{ path: "/", operation: "ADD", before: null, after: after.document, evidenceIds }]
      : operation === "COMPOSE"
        ? [{ path: "/spec", operation: "COMPOSE", before: before.map((item) => documentRef(item.document, item.digest)), after: after.document.spec, evidenceIds }]
        : documentChanges(before[0]?.document, after.document, evidenceIds);
  const impact = analyzeImpact({ asset, before, operation, changes, evidenceIds, evaluationPack, records });
  return {
    deltaId: safeId(`${asset.kind}-${asset.metadata.id}-${asset.metadata.version}-${index + 1}`),
    assetKind: asset.kind,
    operation,
    before,
    after,
    changes: changes.length ? changes : [{ path: "/", operation: "RETAIN", before: before[0]?.document ?? null, after: after.document, evidenceIds }],
    evidenceIds,
    impact
  };
}

function analyzeImpact({ asset, before, operation, changes, evidenceIds, evaluationPack, records }) {
  const affectedRefs = before.flatMap((state) => dependentRefs(records, state));
  const compatibility = compatibilityAssessment(asset, before, operation, changes);
  const evaluationCaseIds = (evaluationPack.spec.cases ?? []).map((item) => item.id);
  const polarities = new Set((evaluationPack.spec.cases ?? []).map((item) => item.polarity));
  const regressionCovered = polarities.has("positive") && polarities.has("negative");
  const status = compatibility.status !== "INCOMPATIBLE" && regressionCovered ? "READY" : "BLOCKED";
  return {
    algorithmVersion: IMPACT_ALGORITHM_VERSION,
    compatibility,
    dependencies: {
      status: affectedRefs.length ? "IMPACTED" : operation === "CREATE" ? "NOT_APPLICABLE" : "RESOLVED",
      affectedRefs,
      reasons: [affectedRefs.length ? "Published assets reference the prior immutable state and require explicit future rebinding." : "No published dependent asset requires mutation."]
    },
    blastRadius: {
      level: affectedRefs.length ? "DEPENDENTS" : operation === "NO_CHANGE" ? "NONE" : "LOCAL",
      affectedRefs,
      reasons: [affectedRefs.length ? "Impact is bounded to the listed immutable dependents; existing versions remain unchanged." : operation === "NO_CHANGE" ? "No asset state changes." : "The candidate is isolated to a new immutable version until explicit publication."]
    },
    expectedEffect: {
      status: operation === "NO_CHANGE" ? "NO_CHANGE" : evidenceIds.length ? "EVIDENCE_BACKED" : "UNKNOWN",
      claims: [{
        description: operation === "NO_CHANGE" ? "Current evidence does not justify an asset definition change." : `${changes.length} evidence-linked change${changes.length === 1 ? " is" : "s are"} expected to improve contract coverage without claiming causal outcome improvement.`,
        evidenceIds
      }]
    },
    regression: {
      status: regressionCovered ? "COVERED" : "BLOCKED",
      evaluationCaseIds,
      boundaries: ["All positive and negative blocking assertions must pass under their pinned validator and scorer versions."]
    },
    rollback: {
      status: operation === "NO_CHANGE" ? "NOT_REQUIRED" : "READY",
      strategy: operation === "CREATE" ? "Discard the unapproved candidate, or deprecate its immutable version after publication without rewriting prior Catalog history." : operation === "NO_CHANGE" ? "No state changed, so rollback is not required." : "Retain the prior immutable version and bind future consumers back to it through a separately reviewed publication.",
      targetRef: before[0] ? documentRef(before[0].document, before[0].digest) : null
    },
    status
  };
}

function compatibilityAssessment(asset, before, operation, changes) {
  if (operation === "CREATE" || operation === "COMPOSE") return { status: "NOT_APPLICABLE", reasons: ["A new immutable asset identity does not rewrite an existing version."] };
  if (operation === "NO_CHANGE") return { status: "COMPATIBLE", reasons: ["Before and after states are identical."] };
  if (!before[0] || before[0].kind !== asset.kind || before[0].id !== asset.metadata.id) return { status: "INCOMPATIBLE", reasons: ["The proposed update changes asset identity or kind."] };
  const removed = changes.filter((item) => item.operation === "REMOVE").map((item) => item.path);
  const pinnedChanged = changes.some((item) => /^\/spec\/(profile|resolvedComponents)/.test(item.path));
  if (removed.length || pinnedChanged) return { status: "REQUIRES_MIGRATION", reasons: [removed.length ? `Removed contract paths: ${removed.join(", ")}.` : "Pinned Bundle dependencies changed and require explicit consumer rebinding."] };
  return { status: "COMPATIBLE", reasons: ["The proposal adds or refines contract state in a new immutable version without removing existing fields."] };
}

function dependentRefs(records, state) {
  const refs = [];
  for (const record of records) {
    const asset = record.asset;
    if (asset.kind === "HarnessProfile" && state.kind === "HarnessComponent" && asset.spec.components.some((ref) => ref.id === state.id && ref.version === state.version)) refs.push(refString(asset));
    if (asset.kind === "HarnessBundle") {
      if (state.kind === "HarnessProfile" && asset.spec.profile.id === state.id && asset.spec.profile.version === state.version) refs.push(refString(asset));
      if (state.kind === "HarnessComponent" && asset.spec.resolvedComponents.some((ref) => ref.id === state.id && ref.version === state.version)) refs.push(refString(asset));
    }
  }
  return unique(refs);
}

function documentChanges(before, after, evidenceIds, pointer = "") {
  if (Object.is(before, after)) return [];
  if (!isContainer(before) || !isContainer(after) || Array.isArray(before) !== Array.isArray(after)) {
    return [{ path: pointer || "/", operation: before === undefined ? "ADD" : after === undefined ? "REMOVE" : "REPLACE", before: before ?? null, after: after ?? null, evidenceIds }];
  }
  const keys = unique([...Object.keys(before), ...Object.keys(after)]).sort();
  const changes = [];
  for (const key of keys) {
    const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
    changes.push(...documentChanges(before[key], after[key], evidenceIds, `${pointer}/${escaped}`));
    if (changes.length >= 64) break;
  }
  return changes.slice(0, 64);
}

function baselineRecords(reasoning, records) {
  const references = reasoning.decision === "COMPOSE_NEW_BUNDLE" ? reasoning.composeProfiles ?? [] : reasoning.targetProfile ? [reasoning.targetProfile] : [];
  return references.map((reference) => records.find((record) => record.asset.kind === "HarnessProfile" && record.asset.metadata.id === reference.id && record.asset.metadata.version === reference.version)).filter(Boolean);
}

function citedEvidence(graph, reasoning) {
  const requested = unique([...(reasoning.evidenceIds ?? []), ...(reasoning.eligibility?.evidenceIds ?? [])]);
  const selected = requested.length ? graph.nodes.filter((node) => requested.includes(node.evidenceId)) : graph.nodes.slice(0, 1);
  const refs = selected.map((node) => ({ evidenceId: node.evidenceId, digest: node.excerptDigest ?? node.sourceDigest ?? digest(node.excerpt ?? node) }));
  if (refs.length) return refs;
  return [{ evidenceId: "evidence-0000", digest: graph.graphDigest }];
}

function unresolvedTarget(reasoning, graph) {
  const target = reasoning.targetProfile ?? reasoning.proposedProfile;
  return { kind: "HarnessProfile", id: target?.id ?? "unresolved-profile", version: target?.version ?? "0.0.0", digest: graph.graphDigest };
}

function assetState(document, knownDigest) {
  const snapshot = structuredClone(document);
  return { kind: snapshot.kind, id: snapshot.metadata.id, version: snapshot.metadata.version, digest: knownDigest ?? digest(snapshot), document: snapshot };
}

function documentRef(document, knownDigest) {
  return { kind: document.kind, id: document.metadata.id, version: document.metadata.version, digest: knownDigest ?? digest(document) };
}

function refString(asset) {
  return `${asset.kind}:${asset.metadata.id}@${asset.metadata.version}`;
}

function check(id, condition, evidence) {
  return { id, status: condition ? "PASS" : "FAIL", evidence: Array.isArray(evidence) ? evidence : [evidence] };
}

function isContainer(value) {
  return value != null && typeof value === "object";
}
