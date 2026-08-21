import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { PACKAGE_ROOT } from "./constants.mjs";
import { discoverAssets } from "./catalog.mjs";
import { validateAssetDeltaClosure } from "./delta.mjs";
import { loadConfiguredModel, modelEndpoint, normalizeUsage, parseJsonContent, projectAdvisorEvidence, publicModel } from "./advisor.mjs";
import { digest, option, persistedJson, readYaml, safeId, unique, walkFiles, writeJson, writeYaml } from "./utils.mjs";
import { comparisonAssessmentForProposal } from "./comparison.mjs";
import { reviewInputDigest } from "./proposal-digest.mjs";
import { resolveWorkspaceModelsFile } from "./workspace.mjs";

export { reviewInputDigest } from "./proposal-digest.mjs";

export const REVIEW_ALGORITHM_VERSION = "deterministic-delta-comparison-gates-semantic-review-synthesis/v3";
export const REVIEW_VERDICTS = ["READY_FOR_HUMAN_APPROVAL", "REVISE", "SPLIT", "REJECT", "NEED_MORE_EVIDENCE"];

const reviewSchema = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "schemas/proposal-review-v1.schema.json"), "utf8"));
const validateReviewSchema = new Ajv2020({ allErrors: true, strict: true }).compile(reviewSchema);
const semanticReviewSchema = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "schemas/proposal-semantic-review-v1.schema.json"), "utf8"));
const validateSemanticReviewSchema = new Ajv2020({ allErrors: true, strict: true }).compile(semanticReviewSchema);

export async function reviewProposal(home, proposalId, args) {
  const runRoot = path.join(home, "evolution-runs", safeId(proposalId));
  const proposalFile = path.join(runRoot, "proposal.yaml");
  if (!fs.existsSync(proposalFile)) throw new Error(`Proposal ${proposalId} was not found.`);
  const proposal = readYaml(proposalFile);
  const graph = readJsonRequired(path.join(runRoot, "evidence-graph.json"), "Evidence Graph");
  const reasoning = readJsonRequired(path.join(runRoot, "reasoning-result.json"), "reasoning result");
  const policyFile = latestPack(path.join(home, "policies/advisor"), "AdvisorPolicyPack");
  if (!policyFile) throw new Error("No published AdvisorPolicyPack is installed.");
  const policy = readYaml(policyFile);
  const proposalDigest = reviewInputDigest(proposal);
  const deterministic = deterministicAssessment(home, proposal, graph, reasoning);
  const semantic = await runSemanticReview({ args, home, proposal, proposalDigest, graph, reasoning, policy, deterministic, runRoot });
  const report = synthesizeReport({ proposal, proposalDigest, graph, reasoning, policy, deterministic, semantic });
  const schemaValidation = validateReport(report);
  if (!schemaValidation.valid) throw new Error(`Proposal Review Report failed schema validation: ${schemaValidation.errors.map((item) => `${item.path} ${item.message}`).join("; ")}`);
  const reportFile = path.join(runRoot, "review-report.yaml");
  writeYaml(reportFile, report);
  writeJson(path.join(runRoot, "review-report.json"), report);
  proposal.review = {
    reviewId: report.reviewId,
    reportDigest: digest(report),
    proposalDigest: report.proposalDigest,
    verdict: report.verdict,
    status: report.status,
    reviewedAt: report.reviewedAt,
    reportPath: reportFile
  };
  proposal.nextAction = report.nextAction;
  writeYaml(proposalFile, proposal);
  return { ...report, reportPath: reportFile, reportDigest: proposal.review.reportDigest };
}

export function inspectProposalReview(home, proposalId) {
  const file = path.join(home, "evolution-runs", safeId(proposalId), "review-report.yaml");
  if (!fs.existsSync(file)) throw new Error(`Proposal Review Report ${proposalId} was not found. Run proposal review first.`);
  const report = readYaml(file);
  return { ...report, reportPath: file, reportDigest: digest(report) };
}

export function validateProposalReview(value, file = "<memory>") {
  const document = structuredClone(value);
  delete document.reportPath;
  delete document.reportDigest;
  const valid = Boolean(validateReviewSchema(document));
  return {
    schema: "evopilot-harness-proposal-review-validation/v1",
    status: valid ? "VALIDATED" : "FAILED",
    valid,
    file,
    errors: valid ? [] : (validateReviewSchema.errors ?? []).map((error) => ({
      path: error.instancePath || "/",
      keyword: error.keyword,
      message: error.message,
      params: error.params
    }))
  };
}

async function runSemanticReview({ args, home, proposal, proposalDigest, graph, reasoning, policy, deterministic, runRoot }) {
  const contract = policy.spec.reviewContract;
  const started = Date.now();
  const requestId = `proposal-review-${proposal.proposalId}-${started.toString(36)}`;
  const complete = (status, extra = {}) => persistSemanticResult(runRoot, {
    schema: "evopilot-harness-semantic-review-result/v1",
    status,
    requestId,
    startedAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    ...extra
  });
  if (!contract) return complete("UNAVAILABLE", { failureType: "REVIEW_CONTRACT_UNAVAILABLE", reason: "AdvisorPolicyPack does not define a proposal Review Contract." });
  const modelsFile = resolveWorkspaceModelsFile(home, option(args, "models-file", process.env.EVOPILOT_HARNESS_LLM_MODELS_FILE));
  const model = loadConfiguredModel(modelsFile, option(args, "model", process.env.EVOPILOT_HARNESS_LLM_PROFILE_ID));
  if (!model) return complete("UNAVAILABLE", { failureType: "MODEL_NOT_CONFIGURED", reason: `No usable Zhipu GLM profile is configured in the manually maintained file ${modelsFile}.`, modelsFile });
  const projection = projectAdvisorEvidence(graph, reasoning, policy);
  const catalog = catalogContext(home, proposal);
  const sources = sourceContext(graph);
  const prompt = {
    task: "Independently review this Harness Proposal and decide whether it is ready for a human approval decision.",
    proposal: proposalForReview(proposal),
    proposalDigest,
    deterministicReasoning: reasoning,
    deterministicGates: deterministic.gates,
    controlledComparison: deterministic.comparisonAssessment,
    originalAdvisor: proposal.advisor,
    evidenceGraph: projection.nodes,
    evidenceProjection: projection.summary,
    sources,
    existingCatalog: catalog,
    outputContract: { ...contract, outputShape: semanticOutputShape() },
    rules: [
      "Assess the Proposal independently; do not repeat the original Advisor recommendation without checking it.",
      "Distinguish owning or engineering a product from merely depending on, integrating, operating, or using that product.",
      "For a corpus, assess group coherence and every source membership; use SPLIT when one reusable boundary does not fit all members.",
      "Assess new-versus-evolve relationships against existing Catalog assets and identify duplicate, conflicting, or overly broad definitions.",
      "Assess whether the Profile or Bundle is specific, professional, executable, constrained, evidence-backed, and evaluable.",
      "Cite only supplied evidenceId values for source-derived membership, boundary, Advisor, and multi-source coherence conclusions. Catalog overlap, Proposal structure, definition quality, evaluation sufficiency, and non-source findings may use an empty evidenceIds array. Never invent evidence.",
      "Do not approve, publish, execute source code, mutate configuration, or override deterministic safety gates."
    ]
  };
  const requestBody = reviewRequest(model, policy, prompt);
  const attempts = [];
  let activeRequest = requestBody;
  const maxRepairs = Math.min(1, Math.max(0, Number(contract.repair?.maxAttempts ?? 0)));
  for (let index = 0; index <= maxRepairs; index += 1) {
    const attempt = await semanticAttempt({ model, requestBody: activeRequest, timeoutMs: Number(option(args, "review-timeout-ms", option(args, "advisor-timeout-ms", 180_000))), graph, contract, sources, attempt: index + 1 });
    attempts.push(attempt.record);
    if (attempt.status === "SUCCEEDED") return complete("SUCCEEDED", {
      model: publicModel(model),
      policy: { id: policy.metadata.id, version: policy.metadata.version, digest: digest(policy) },
      promptDigest: digest(activeRequest),
      responseDigest: attempt.responseDigest,
      assessment: attempt.assessment,
      validation: attempt.validation,
      usage: aggregateUsage(attempts),
      attempts,
      attemptCount: attempts.length,
      repairAttempted: attempts.length > 1,
      evidenceProjection: projection.summary,
      authority: policy.spec.authority
    });
    if (index >= maxRepairs || !["INVALID_RESPONSE_JSON", "CONTRACT_REJECTED"].includes(attempt.failureType)) return complete(attempt.status, {
      failureType: attempt.failureType,
      reason: attempt.reason,
      httpStatus: attempt.httpStatus,
      responseDigest: attempt.responseDigest,
      validation: attempt.validation,
      model: publicModel(model),
      usage: aggregateUsage(attempts),
      attempts,
      attemptCount: attempts.length,
      repairAttempted: attempts.length > 1,
      evidenceProjection: projection.summary,
      retryable: attempt.retryable
    });
    activeRequest = reviewRepairRequest(model, policy, contract, graph, sources, attempt);
  }
}

async function semanticAttempt({ model, requestBody, timeoutMs, graph, contract, sources, attempt }) {
  const started = Date.now();
  const base = (status, extra = {}) => ({ status, attempt, startedAt: new Date(started).toISOString(), completedAt: new Date().toISOString(), durationMs: Date.now() - started, promptDigest: digest(requestBody), ...extra });
  let response;
  try {
    response = await fetch(modelEndpoint(model.url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${model.apiKey}` },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const record = base("FAILED", { failureType: error?.name === "TimeoutError" ? "TRANSPORT_TIMEOUT" : "TRANSPORT_ERROR", reason: error instanceof Error ? error.message : String(error), retryable: true });
    return { ...record, record };
  }
  const raw = await response.text();
  const responseDigest = digest(raw);
  if (!response.ok) {
    const record = base("FAILED", { failureType: "HTTP_ERROR", reason: `GLM review request failed with HTTP ${response.status}.`, httpStatus: response.status, responseDigest, retryable: response.status === 429 || response.status >= 500 });
    return { ...record, raw, record };
  }
  let envelope;
  let assessment;
  try {
    envelope = JSON.parse(raw);
    assessment = normalizeSemanticAssessment(parseJsonContent(envelope?.choices?.[0]?.message?.content));
  } catch (error) {
    const record = base("FAILED", { failureType: "INVALID_RESPONSE_JSON", reason: `GLM review response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`, responseDigest, usage: normalizeUsage(envelope?.usage), retryable: false });
    return { ...record, raw, record };
  }
  const validation = validateSemanticAssessment(assessment, graph, contract, sources);
  if (validation.status !== "VALIDATED") {
    const record = base("REJECTED", { failureType: "CONTRACT_REJECTED", reason: "GLM review response violated the evidence-bound Proposal Review Contract.", responseDigest, validation, usage: normalizeUsage(envelope.usage), retryable: false });
    return { ...record, raw, assessment, record };
  }
  const record = base("SUCCEEDED", { responseDigest, validation, usage: normalizeUsage(envelope.usage) });
  return { ...record, raw, assessment, record };
}

function validateSemanticAssessment(value, graph, contract, sources) {
  const missing = (contract.requiredFields ?? []).filter((field) => value?.[field] == null);
  const allowedVerdict = (contract.allowedVerdicts ?? REVIEW_VERDICTS).includes(value?.verdict);
  const knownEvidenceIds = new Set(graph.nodes.map((node) => node.evidenceId));
  const citedIds = collectEvidenceIds(value);
  const unknownEvidenceIds = citedIds.filter((id) => !knownEvidenceIds.has(id));
  const memberships = Array.isArray(value?.projectMembership) ? value.projectMembership : [];
  const sourceIds = sources.map((item) => item.sourceId);
  const sourceById = new Map(sources.map((item) => [item.sourceId, item]));
  const returnedSourceIds = memberships.map((item) => item?.sourceId).filter(Boolean);
  const unknownSourceIds = returnedSourceIds.filter((id) => !sourceIds.includes(id));
  const missingSourceIds = sourceIds.filter((id) => !returnedSourceIds.includes(id));
  const findings = Array.isArray(value?.findings) ? value.findings : [];
  const citationRules = contract.citationRules ?? {
    requiredPaths: ["projectMembership", "boundaryAssessment", "advisorAssessment"],
    requireGroupCoherenceForMultipleSources: true
  };
  const membershipCitationFailures = memberships.filter((item) => {
    const source = sourceById.get(item?.sourceId);
    return !source || !Array.isArray(item?.evidenceIds) || item.evidenceIds.length === 0 || item.evidenceIds.some((id) => !source.evidenceIds.includes(id));
  }).map((item) => item?.sourceId ?? "missing-source-id");
  const requiredCitationFailures = (citationRules.requiredPaths ?? []).filter((field) => {
    if (field === "projectMembership") return membershipCitationFailures.length > 0;
    return !Array.isArray(value?.[field]?.evidenceIds) || value[field].evidenceIds.length === 0;
  });
  const groupCitationRequired = Boolean(citationRules.requireGroupCoherenceForMultipleSources) && sources.length > 1 && value?.groupCoherence?.status !== "NOT_APPLICABLE";
  const groupCitationValid = !groupCitationRequired || (Array.isArray(value?.groupCoherence?.evidenceIds) && value.groupCoherence.evidenceIds.length > 0);
  const semanticShapeValid = Boolean(validateSemanticReviewSchema(value));
  const semanticShapeErrors = semanticShapeValid ? [] : (validateSemanticReviewSchema.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`);
  const checks = [
    { id: "semantic-review-schema", status: semanticShapeValid ? "PASS" : "FAIL", evidence: semanticShapeErrors },
    { id: "required-fields", status: missing.length ? "FAIL" : "PASS", evidence: missing },
    { id: "allowed-verdict", status: allowedVerdict ? "PASS" : "FAIL", evidence: [String(value?.verdict)] },
    { id: "evidence-citations", status: citedIds.length > 0 && unknownEvidenceIds.length === 0 ? "PASS" : "FAIL", evidence: unknownEvidenceIds.length ? unknownEvidenceIds : citedIds },
    { id: "source-membership-closure", status: unknownSourceIds.length === 0 && missingSourceIds.length === 0 ? "PASS" : "FAIL", evidence: unique([...unknownSourceIds, ...missingSourceIds]) },
    { id: "required-source-citations", status: requiredCitationFailures.length === 0 && groupCitationValid ? "PASS" : "FAIL", evidence: unique([...requiredCitationFailures, ...membershipCitationFailures, ...(groupCitationValid ? [] : ["groupCoherence"])]) },
    { id: "findings", status: findings.length > 0 && findings.every((item) => item?.dimension && item?.conclusion && Array.isArray(item?.evidenceIds)) ? "PASS" : "FAIL", evidence: findings.map((item) => item?.id ?? "missing-id") }
  ];
  return { status: checks.every((item) => item.status === "PASS") ? "VALIDATED" : "FAILED", checks };
}

function synthesizeReport({ proposal, proposalDigest, graph, reasoning, policy, deterministic, semantic }) {
  const reviewedAt = new Date().toISOString();
  if (semantic.status !== "SUCCEEDED") {
    const finding = {
      id: "semantic-review-unavailable",
      severity: "blocking",
      dimension: "reviewer",
      conclusion: "The independent semantic review did not complete, so the Proposal cannot advance to human approval.",
      reasons: [semantic.reason ?? semantic.failureType ?? "Semantic reviewer unavailable."],
      evidenceIds: [],
      suggestedActions: ["Repair the configured reviewer and run proposal review again."]
    };
    return baseReport({ proposal, proposalDigest, graph, reasoning, policy, reviewedAt, status: "BLOCKED", verdict: "NEED_MORE_EVIDENCE", summary: finding.conclusion, findings: [...deterministic.findings, finding], reasons: finding.reasons, evidenceIds: deterministic.evidenceIds, deterministic, semantic, groupCoherence: deterministic.groupCoherence, projectMembership: deterministic.projectMembership, boundaryAssessment: emptyAssessment("NOT_REVIEWED", "Semantic review did not complete."), existingAssetOverlap: deterministic.existingAssetOverlap, definitionQuality: deterministic.definitionQuality, evaluationSufficiency: deterministic.evaluationSufficiency, advisorAssessment: deterministic.advisorAssessment, suggestedActions: finding.suggestedActions, remainingBlockers: unique([...deterministic.blockers, "semantic-proposal-review-required"]), nextAction: "repair-reviewer-and-rerun" });
  }
  const assessment = semantic.assessment;
  let verdict = assessment.verdict;
  const hardFailures = deterministic.gates.filter((gate) => gate.blocking && gate.status === "FAIL");
  if (hardFailures.length && verdict === "READY_FOR_HUMAN_APPROVAL") verdict = hardFailures.some((gate) => gate.id === "evidence-integrity") ? "NEED_MORE_EVIDENCE" : "REVISE";
  if (assessment.groupCoherence?.status === "INCOHERENT" && verdict === "READY_FOR_HUMAN_APPROVAL") verdict = "SPLIT";
  if (reasoning.decision === "NEED_MORE_EVIDENCE") verdict = "NEED_MORE_EVIDENCE";
  const status = verdict === "READY_FOR_HUMAN_APPROVAL" ? "REVIEWED" : "ACTION_REQUIRED";
  const nextAction = reasoning.decision === "NO_CHANGE" && verdict === "READY_FOR_HUMAN_APPROVAL" ? "record-no-change" : ({ READY_FOR_HUMAN_APPROVAL: "proposal-approve", REVISE: "revise-proposal", SPLIT: "split-proposal", REJECT: "reject-proposal", NEED_MORE_EVIDENCE: "collect-more-evidence" })[verdict];
  const remainingBlockers = unique([
    ...(proposal.blockers ?? []),
    ...deterministic.blockers,
    ...(verdict === "READY_FOR_HUMAN_APPROVAL" ? [] : [`proposal-review-verdict:${verdict.toLowerCase()}`])
  ]);
  return baseReport({ proposal, proposalDigest, graph, reasoning, policy, reviewedAt, status, verdict, summary: assessment.summary, findings: [...deterministic.findings, ...assessment.findings], reasons: assessment.reasons, evidenceIds: unique([...deterministic.evidenceIds, ...collectEvidenceIds(assessment)]), deterministic, semantic, groupCoherence: assessment.groupCoherence, projectMembership: assessment.projectMembership, boundaryAssessment: assessment.boundaryAssessment, existingAssetOverlap: assessment.existingAssetOverlap, definitionQuality: assessment.definitionQuality, evaluationSufficiency: assessment.evaluationSufficiency, advisorAssessment: assessment.advisorAssessment, suggestedActions: assessment.suggestedActions, remainingBlockers, nextAction });
}

function baseReport({ proposal, proposalDigest, graph, reasoning, policy, reviewedAt, status, verdict, summary, findings, reasons, evidenceIds, deterministic, semantic, groupCoherence, projectMembership, boundaryAssessment, existingAssetOverlap, definitionQuality, evaluationSufficiency, advisorAssessment, suggestedActions, remainingBlockers, nextAction }) {
  return {
    schema: "evopilot-harness-proposal-review/v1",
    reviewId: `${proposal.proposalId}-review`,
    proposalId: proposal.proposalId,
    proposalDigest,
    evidenceGraphDigest: graph.graphDigest,
    reasoningDigest: proposal.reasoningDigest,
    reviewedAt,
    status,
    verdict,
    summary,
    findings,
    reasons: asStrings(reasons),
    evidenceIds: unique(evidenceIds),
    deterministicGates: deterministic.gates,
    groupCoherence,
    projectMembership,
    boundaryAssessment,
    existingAssetOverlap,
    definitionQuality,
    evaluationSufficiency,
    advisorAssessment,
    assetDeltaAssessment: deterministic.assetDeltaAssessment,
    impactAssessment: deterministic.impactAssessment,
    comparisonAssessment: deterministic.comparisonAssessment,
    suggestedActions: asStrings(suggestedActions),
    remainingBlockers,
    reviewer: withoutUndefined({
      status: semantic.status,
      requestId: semantic.requestId,
      model: semantic.model,
      policy: semantic.policy ?? { id: policy.metadata.id, version: policy.metadata.version, digest: digest(policy) },
      usage: semantic.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      attempts: semantic.attempts ?? [],
      validation: semantic.validation,
      evidenceProjection: semantic.evidenceProjection,
      resultPath: semantic.resultPath,
      authority: { mayReview: true, mayApprove: false, mayPublish: false, mayExecute: false, mayMutateModelConfig: false }
    }),
    algorithm: { version: REVIEW_ALGORITHM_VERSION, deterministicDecision: reasoning.decision, semanticVerdict: semantic.assessment?.verdict ?? null },
    humanDecisionRequired: true,
    nextAction
  };
}

function deterministicAssessment(home, proposal, graph, reasoning) {
  const mutatingDecision = ["EVOLVE_EXISTING", "COMPOSE_NEW_BUNDLE", "PROPOSE_NEW_PROFILE"].includes(proposal.decision);
  const proposalValid = mutatingDecision
    ? Array.isArray(proposal.validations) && proposal.validations.length > 0 && proposal.validations.every((item) => item.valid)
    : Array.isArray(proposal.proposedAssets) && proposal.proposedAssets.length === 0;
  const reasoningDigest = digest(persistedJson(reasoning));
  const evidenceValid = proposal.evidenceGraphDigest === graph.graphDigest && proposal.reasoningDigest === reasoningDigest;
  const advisorValid = !proposal.advisor?.required || proposal.advisor?.status === "SUCCEEDED";
  const proposedAssets = proposal.proposedAssets ?? [];
  const records = discoverAssets([path.join(home, "catalogs/organization/assets"), path.join(home, "catalogs/builtin/assets")]);
  const definitionChecks = proposedAssets.flatMap((asset) => definitionChecksFor(asset));
  const definitionValid = definitionChecks.every((item) => item.status === "PASS");
  const deltaClosure = validateAssetDeltaClosure(proposal.assetDeltaProposal, proposal.evaluationPack, { proposedAssets, records, evidenceGraph: graph, reasoning });
  const comparisonAssessment = comparisonAssessmentForProposal(home, proposal);
  const impacts = proposal.assetDeltaProposal?.spec?.deltas?.map((item) => item.impact) ?? [];
  const gates = [
    gate("proposal-schema", proposalValid, true, proposal.validations?.flatMap((item) => item.errors ?? []) ?? []),
    gate("evidence-integrity", evidenceValid, true, [proposal.evidenceGraphDigest, graph.graphDigest, proposal.reasoningDigest, reasoningDigest]),
    gate("required-advisor", advisorValid, true, [proposal.advisor?.status ?? "MISSING"]),
    gate("definition-contract", definitionValid, true, definitionChecks.filter((item) => item.status === "FAIL").map((item) => item.id)),
    gate("evaluation-pack-present", proposal.evaluationPack?.apiVersion === "harness.evopilot.io/v3" && Boolean(proposal.evaluationPack?.spec?.cases?.length), true, [proposal.evaluationPack?.apiVersion ?? "MISSING", proposal.evaluationPack?.spec?.status ?? "MISSING"]),
    gate("asset-delta-closure", deltaClosure.status === "VALIDATED", true, deltaClosure.blockers),
    gate("decision-publication-boundary", mutatingDecision ? proposal.assetDeltaProposal?.spec?.publicationAllowed === true : proposal.assetDeltaProposal?.spec?.publicationAllowed === false, true, [String(proposal.decision), String(proposal.assetDeltaProposal?.spec?.publicationAllowed)]),
    gate("controlled-comparison", !comparisonAssessment.blocking, comparisonAssessment.status !== "NOT_PROVIDED", [comparisonAssessment.status, comparisonAssessment.recommendation ?? "NOT_PROVIDED", ...(comparisonAssessment.reasons ?? [])])
  ];
  const overlap = overlapContext(proposal, records);
  const projectMembership = sourceContext(graph).map((source) => ({ sourceId: source.sourceId, sourceType: source.sourceType, sourceRef: source.sourceRef, status: "UNCERTAIN", rationale: "Awaiting independent semantic membership review.", evidenceIds: source.evidenceIds }));
  const findings = gates.filter((item) => item.status === "FAIL").map((item) => ({ id: `gate-${item.id}`, severity: item.blocking ? "blocking" : "warning", dimension: "deterministic-gate", conclusion: `${item.id} failed.`, reasons: item.evidence.map(String), evidenceIds: [], suggestedActions: [`Resolve ${item.id} and run proposal review again.`] }));
  return {
    gates,
    blockers: unique([...(proposal.blockers ?? []), ...gates.filter((item) => item.blocking && item.status === "FAIL").map((item) => `review-gate:${item.id}`)]),
    findings,
    evidenceIds: unique(reasoning.evidenceIds ?? []),
    groupCoherence: { status: projectMembership.length > 1 ? "NOT_REVIEWED" : "NOT_APPLICABLE", rationale: "Deterministic gates do not make semantic group-coherence decisions.", evidenceIds: unique(projectMembership.flatMap((item) => item.evidenceIds)) },
    projectMembership,
    existingAssetOverlap: overlap,
    definitionQuality: { status: definitionValid ? "PASS" : "FAIL", score: definitionChecks.length ? definitionChecks.filter((item) => item.status === "PASS").length / definitionChecks.length : 0, rationale: "Deterministic structural completeness before semantic quality review.", checks: definitionChecks, evidenceIds: [] },
    evaluationSufficiency: { status: proposal.evaluationPack?.spec?.status ?? "MISSING", rationale: "EvaluationPack v3 positive and negative cases remain a separate human-reviewed gate.", evidenceIds: [] },
    advisorAssessment: { status: advisorValid ? "AVAILABLE" : "UNAVAILABLE", rationale: proposal.advisor?.reason ?? `Original Advisor status is ${proposal.advisor?.status ?? "MISSING"}.`, evidenceIds: proposal.advisor?.recommendation?.evidenceIds ?? [] },
    assetDeltaAssessment: {
      status: deltaClosure.status,
      decision: proposal.assetDeltaProposal?.spec?.decision ?? "MISSING",
      deltaCount: proposal.assetDeltaProposal?.spec?.deltas?.length ?? 0,
      publicationAllowed: proposal.assetDeltaProposal?.spec?.publicationAllowed === true,
      checks: deltaClosure.checks.map((item) => ({ ...item, blocking: true }))
    },
    impactAssessment: {
      status: impacts.length ? impacts.every((item) => item.status === "READY") ? "READY" : "BLOCKED" : "NOT_APPLICABLE",
      readyCount: impacts.filter((item) => item.status === "READY").length,
      blockedCount: impacts.filter((item) => item.status !== "READY").length,
      compatibility: unique(impacts.map((item) => item.compatibility?.status)),
      blastRadius: unique(impacts.map((item) => item.blastRadius?.level)),
      rollback: unique(impacts.map((item) => item.rollback?.status))
    },
    comparisonAssessment
  };
}

function definitionChecksFor(asset) {
  const checks = [];
  const add = (id, condition) => checks.push({ id: `${asset.metadata?.id ?? "asset"}:${id}`, status: condition ? "PASS" : "FAIL", evidence: [] });
  add("specific-description", String(asset.metadata?.description ?? "").length >= 40);
  if (asset.kind === "HarnessProfile") {
    add("classification", Boolean(asset.spec?.classification?.domain && asset.spec?.classification?.role && asset.spec?.classification?.taskClass));
    add("positive-boundary", (asset.spec?.boundary?.inScope?.length ?? 0) >= 2 && (asset.spec?.match?.positiveConcepts?.length ?? 0) >= 1);
    add("negative-boundary", (asset.spec?.boundary?.outOfScope?.length ?? 0) >= 2);
    add("component-composition", (asset.spec?.components?.length ?? 0) >= 1);
    add("evidence-contract", (asset.spec?.acceptance?.requiredEvidence?.length ?? 0) >= 2);
    add("blocking-validators", (asset.spec?.acceptance?.blockingValidators?.length ?? 0) >= 2);
  } else if (asset.kind === "HarnessBundle") {
    add("pinned-profile", Boolean(asset.spec?.profile?.id && asset.spec?.profile?.version && asset.spec?.profile?.digest));
    add("resolved-components", (asset.spec?.resolvedComponents?.length ?? 0) >= 1 && asset.spec.resolvedComponents.every((item) => item.digest));
    add("execution-plan", (asset.spec?.executionPlan?.length ?? 0) >= 1);
    add("validators", (asset.spec?.validators?.length ?? 0) >= 1);
  }
  return checks;
}

function sourceContext(graph) {
  return (graph.sources ?? []).map((source, index) => {
    const sourceRef = source.input === "inline" ? `${source.type}:inline` : String(source.input);
    const evidenceIds = graph.nodes.filter((node) => source.input === "inline" ? node.sourceType === source.type : String(node.sourceRef ?? "").startsWith(String(source.input))).map((node) => node.evidenceId);
    return { sourceId: `source-${String(index + 1).padStart(3, "0")}`, sourceType: source.type, sourceRef, sourceDigest: digest(sourceRef), evidenceIds };
  });
}

function catalogContext(home, proposal) {
  const records = discoverAssets([path.join(home, "catalogs/organization/assets"), path.join(home, "catalogs/builtin/assets")]);
  return overlapContext(proposal, records);
}

function overlapContext(proposal, records) {
  const proposed = proposal.proposedAssets ?? [];
  const candidates = [];
  for (const asset of proposed) {
    for (const record of records) {
      if (record.asset.kind !== asset.kind) continue;
      const sameId = record.asset.metadata.id === asset.metadata.id;
      const sameDomain = record.asset.spec?.classification?.domain && record.asset.spec.classification.domain === asset.spec?.classification?.domain;
      const sameRole = record.asset.spec?.classification?.role && record.asset.spec.classification.role === asset.spec?.classification?.role;
      if (!sameId && !sameDomain && !sameRole) continue;
      candidates.push({ kind: record.asset.kind, id: record.asset.metadata.id, version: record.asset.metadata.version, digest: record.digest, sameId, sameDomain: Boolean(sameDomain), sameRole: Boolean(sameRole) });
    }
  }
  const status = candidates.some((item) => item.sameId) ? "EVOLUTION_CANDIDATE" : candidates.length ? "RELATED" : "NONE";
  return { status, rationale: candidates.length ? "Catalog contains assets with an id, domain, or role relationship that requires semantic review." : "No direct id, domain, or role overlap was found by deterministic retrieval.", candidates, evidenceIds: [] };
}

function proposalForReview(proposal) {
  return { proposalId: proposal.proposalId, status: proposal.status, decision: proposal.decision, proposedAssets: proposal.proposedAssets, validations: proposal.validations, assetDeltaProposal: proposal.assetDeltaProposal, deltaClosure: proposal.deltaClosure, evaluationPack: proposal.evaluationPack, blockers: proposal.blockers };
}

function reviewRequest(model, policy, prompt) {
  return { model: model.modelName, temperature: 0, max_tokens: Number(policy.spec.reviewContract?.maxOutputTokens ?? 8192), response_format: { type: "json_object" }, messages: [{ role: "system", content: policy.spec.reviewSystemPrompt ?? policy.spec.systemPrompt }, { role: "user", content: JSON.stringify(prompt) }] };
}

function semanticOutputShape() {
  return {
    verdict: "READY_FOR_HUMAN_APPROVAL|REVISE|SPLIT|REJECT|NEED_MORE_EVIDENCE",
    summary: "string",
    findings: [{ id: "string", severity: "info|warning|blocking", dimension: "string", conclusion: "string", reasons: ["string"], evidenceIds: [], suggestedActions: ["string"] }],
    reasons: ["string"],
    groupCoherence: { status: "COHERENT|INCOHERENT|UNCERTAIN|NOT_APPLICABLE", rationale: "string", evidenceIds: ["evidence-0001"] },
    projectMembership: [{ sourceId: "source-001", sourceType: "string", sourceRef: "exact supplied sourceRef", status: "IN_SCOPE|OUT_OF_SCOPE|UNCERTAIN", rationale: "string", evidenceIds: ["evidence-0001"] }],
    boundaryAssessment: { status: "PASS|FAIL|UNCERTAIN", rationale: "string", evidenceIds: ["evidence-0001"] },
    existingAssetOverlap: { status: "NONE|RELATED|EVOLUTION_CANDIDATE|DUPLICATE|CONFLICT", rationale: "string", candidates: [], evidenceIds: [] },
    definitionQuality: { status: "PASS|FAIL|UNCERTAIN", score: 0.0, rationale: "string", checks: [{ id: "string", status: "PASS|FAIL|UNCERTAIN", detail: "optional string" }], evidenceIds: [] },
    evaluationSufficiency: { status: "PASS|FAIL|UNCERTAIN", rationale: "string", evidenceIds: [] },
    advisorAssessment: { status: "CONSISTENT|CONFLICTED|INSUFFICIENT", rationale: "string", evidenceIds: ["evidence-0001"] },
    suggestedActions: ["string"]
  };
}

function normalizeSemanticAssessment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const normalized = structuredClone(value);
  if (Array.isArray(normalized.definitionQuality?.checks)) {
    normalized.definitionQuality.checks = normalized.definitionQuality.checks.map((item, index) => {
      if (item && typeof item === "object" && !Array.isArray(item)) return item;
      const detail = String(item ?? "").trim() || `Reported quality check ${index + 1}`;
      return { id: safeId(detail) || `reported-check-${index + 1}`, status: "REPORTED", detail };
    });
  }
  return normalized;
}

function reviewRepairRequest(model, policy, contract, graph, sources, previous) {
  return reviewRequest(model, policy, {
    task: "Repair the previous Proposal Review output so it exactly satisfies the existing Review Contract.",
    outputContract: { ...contract, outputShape: semanticOutputShape() },
    allowedEvidenceIds: graph.nodes.map((node) => node.evidenceId),
    requiredSourceIds: sources.map((source) => source.sourceId),
    failedValidation: previous.validation ?? { failureType: previous.failureType },
    previousOutput: previous.assessment ?? String(previous.raw ?? "").slice(0, 12000),
    rules: ["Return one JSON object only.", "Repair structure and citations only.", "Do not approve, publish, execute, or mutate configuration."]
  });
}

function collectEvidenceIds(value) {
  const result = [];
  const visit = (item, key) => {
    if (key === "evidenceIds" && Array.isArray(item)) result.push(...item.filter((id) => typeof id === "string"));
    else if (Array.isArray(item)) item.forEach((child) => visit(child));
    else if (item && typeof item === "object") Object.entries(item).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(value);
  return unique(result);
}

function validateReport(report) {
  return validateProposalReview(report);
}

function gate(id, passed, blocking, evidence) {
  return { id, status: passed ? "PASS" : "FAIL", blocking, evidence: (evidence ?? []).map((item) => typeof item === "string" ? item : JSON.stringify(item)) };
}

function emptyAssessment(status, rationale) {
  return { status, rationale, evidenceIds: [] };
}

function asStrings(value) {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item));
  return value == null ? [] : [String(value)];
}

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function aggregateUsage(attempts) {
  return attempts.reduce((total, attempt) => ({ inputTokens: total.inputTokens + Number(attempt.usage?.inputTokens ?? 0), outputTokens: total.outputTokens + Number(attempt.usage?.outputTokens ?? 0), totalTokens: total.totalTokens + Number(attempt.usage?.totalTokens ?? 0) }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
}

function persistSemanticResult(runRoot, result) {
  const resultPath = path.join(runRoot, "semantic-review-result.json");
  const persisted = { ...result, resultPath };
  writeJson(resultPath, persisted);
  return persisted;
}

function readJsonRequired(file, label) {
  if (!fs.existsSync(file)) throw new Error(`Proposal is missing its ${label}: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function latestPack(root, kind) {
  return walkFiles(root, (file) => /\.ya?ml$/i.test(file)).map((file) => {
    try { return { file, document: readYaml(file) }; } catch { return null; }
  }).filter((item) => item?.document?.kind === kind && ["published", "approved"].includes(item.document.metadata?.lifecycle)).sort((a, b) => String(b.document.metadata.version).localeCompare(String(a.document.metadata.version), undefined, { numeric: true }))[0]?.file;
}
