import fs from "node:fs";
import path from "node:path";
import { API_VERSION } from "./constants.mjs";
import { discoverAssets, publishCatalog } from "./catalog.mjs";
import { bindEvaluationPack, buildAssetDeltaProposal, buildEvaluationPackV3, isMutatingDecision, normalizeProposalDecision, rebindAssetDeltaProposal, validateAssetDeltaClosure } from "./delta.mjs";
import { validateDocument } from "./schema.mjs";
import { bumpPatch, digest, persistedJson, readYaml, safeId, unique, writeJson, writeYaml } from "./utils.mjs";
import { inspectProposalReview, reviewInputDigest, validateProposalReview } from "./review.mjs";

export function createProposal({ home, runRoot, graph, reasoning, advisor }) {
  if (reasoning.decision === "NOT_HARNESS_ELIGIBLE") {
    const result = { schema: "evopilot-harness-proposal-result/v3", status: reasoning.decision, runId: graph.runId, proposedAssets: [], nextAction: reasoning.nextAction };
    writeJson(path.join(runRoot, "proposal-result.json"), result);
    return result;
  }
  const records = discoverAssets([path.join(home, "catalogs/organization/assets"), path.join(home, "catalogs/builtin/assets")]);
  const proposedAssets = [];
  if (reasoning.decision === "EVOLVE_EXISTING" && reasoning.targetProfile) {
    const base = records.find((record) => record.asset.kind === "HarnessProfile" && record.asset.metadata.id === reasoning.targetProfile.id && record.asset.metadata.version === reasoning.targetProfile.version);
    if (base) proposedAssets.push(evolvedProfile(base.asset, graph, reasoning));
    else proposedAssets.push(newProfile(graph, reasoning));
  } else if (reasoning.decision === "COMPOSE_NEW_BUNDLE") {
    proposedAssets.push(composedBundle(records, graph, reasoning));
  } else if (reasoning.decision === "PROPOSE_NEW_PROFILE") {
    proposedAssets.push(newProfile(graph, reasoning));
  }
  if (advisor.status === "SUCCEEDED" && advisor.responseDigest) {
    for (const asset of proposedAssets) asset.provenance.advisorRunDigest = advisor.responseDigest;
  }
  const validations = proposedAssets.map((asset) => validateDocument(asset));
  const evaluationPack = buildEvaluationPackV3({ graph, reasoning, records, proposedAssets });
  const assetDeltaProposal = buildAssetDeltaProposal({ graph, reasoning, records, proposedAssets, evaluationPack });
  const deltaClosure = validateAssetDeltaClosure(assetDeltaProposal, evaluationPack, { proposedAssets, records, evidenceGraph: graph, reasoning });
  const advisorBlocking = advisor.required && advisor.status !== "SUCCEEDED";
  const blockers = [
    ...(validations.some((item) => !item.valid) ? ["proposed-asset-schema-invalid"] : []),
    ...(deltaClosure.status !== "VALIDATED" ? deltaClosure.blockers : []),
    ...(advisorBlocking ? ["policy-required-advisor-review-missing"] : []),
    ...(isMutatingDecision(reasoning.decision) ? ["evaluation-review-required"] : [])
  ];
  const decision = normalizeProposalDecision(reasoning.decision);
  const status = advisorBlocking ? "BLOCKED" : decision === "NO_CHANGE" ? "NO_CHANGE" : decision === "NEED_MORE_EVIDENCE" ? "NEED_MORE_EVIDENCE" : deltaClosure.status === "VALIDATED" ? "REVIEW_REQUIRED" : "BLOCKED";
  const nextAction = advisorBlocking ? "repair-advisor-and-rerun" : decision === "NO_CHANGE" ? "review-no-change-conclusion" : decision === "NEED_MORE_EVIDENCE" ? "collect-more-evidence" : deltaClosure.status === "VALIDATED" ? "proposal-review" : "repair-asset-delta";
  const proposal = {
    schema: "evopilot-harness-profile-proposal/v1",
    proposalId: graph.runId,
    status,
    decision,
    createdAt: new Date().toISOString(),
    evidenceGraphDigest: graph.graphDigest,
    reasoningDigest: digest(persistedJson(reasoning)),
    advisor,
    humanApprovalRequired: true,
    proposedAssets,
    validations,
    evaluationPack,
    assetDeltaProposal,
    deltaClosure,
    blockers,
    nextAction
  };
  writeYaml(path.join(runRoot, "proposal.yaml"), proposal);
  writeYaml(path.join(runRoot, "evaluation-pack.yaml"), evaluationPack);
  writeYaml(path.join(runRoot, "asset-delta-proposal.yaml"), assetDeltaProposal);
  for (const asset of proposedAssets) writeYaml(path.join(runRoot, "drafts", kindDirectory(asset.kind), asset.metadata.id, "asset.yaml"), asset);
  return {
    schema: "evopilot-harness-proposal-result/v3",
    status,
    proposalId: proposal.proposalId,
    decision: proposal.decision,
    proposedAssets: proposedAssets.map(assetSummary),
    validations,
    assetDeltaProposal: deltaSummary(assetDeltaProposal),
    deltaClosure,
    advisor,
    blockers: proposal.blockers,
    evaluationStatus: evaluationPack.spec.status,
    proposalPath: path.join(runRoot, "proposal.yaml"),
    nextAction
  };
}

export function inspectProposal(home, proposalId) {
  const file = proposalFile(home, proposalId);
  if (!fs.existsSync(file)) throw new Error(`Proposal ${proposalId} was not found.`);
  return readYaml(file);
}

export function approveProposal(home, proposalId, { confirmedBy, confirmation, evaluationReviewed = false }) {
  if (!confirmedBy || !confirmation) throw new Error("Approval requires --confirmed-by and --confirmation.");
  const file = proposalFile(home, proposalId);
  const proposal = inspectProposal(home, proposalId);
  if (["NO_CHANGE", "NEED_MORE_EVIDENCE"].includes(proposal.decision)) {
    return { schema: "evopilot-harness-proposal-approval/v3", status: "BLOCKED", proposalId, blockers: [`decision-does-not-create-asset:${proposal.decision.toLowerCase()}`], nextAction: proposal.decision === "NO_CHANGE" ? "record-no-change" : "collect-more-evidence" };
  }
  let review;
  try { review = inspectProposalReview(home, proposalId); } catch {
    return { schema: "evopilot-harness-proposal-approval/v3", status: "BLOCKED", proposalId, blockers: ["proposal-review-required"], nextAction: "proposal-review" };
  }
  const reviewValidation = validateProposalReview(review, review.reportPath);
  const reviewBinding = reviewBindingBlockers(proposal, review, { requireCurrentProposal: true });
  if (!reviewValidation.valid || reviewBinding.length || review.status !== "REVIEWED" || review.verdict !== "READY_FOR_HUMAN_APPROVAL") {
    const blockers = [
      ...(!reviewValidation.valid ? ["proposal-review-invalid"] : []),
      ...reviewBinding,
      ...(review.status !== "REVIEWED" ? [`proposal-review-status:${String(review.status).toLowerCase()}`] : []),
      ...(review.verdict !== "READY_FOR_HUMAN_APPROVAL" ? [`proposal-review-verdict:${String(review.verdict).toLowerCase()}`] : [])
    ];
    return { schema: "evopilot-harness-proposal-approval/v3", status: "BLOCKED", proposalId, blockers: unique(blockers), review: { reviewId: review.reviewId, status: review.status, verdict: review.verdict, reportDigest: review.reportDigest }, nextAction: review.nextAction ?? "proposal-review" };
  }
  if (!evaluationReviewed) {
    return { schema: "evopilot-harness-proposal-approval/v3", status: "BLOCKED", proposalId, blockers: ["evaluation-review-required"], nextAction: "review-evaluation-cases" };
  }
  const blockers = [...(proposal.blockers ?? [])].filter((blocker) => blocker !== "evaluation-review-required");
  if (blockers.length) return { schema: "evopilot-harness-proposal-approval/v3", status: "BLOCKED", proposalId, blockers, nextAction: blockers.includes("policy-required-advisor-review-missing") ? "run-required-advisor" : "repair-proposal" };
  proposal.status = "APPROVED";
  proposal.approval = { confirmedBy, confirmation, evaluationReviewed: true, reviewId: review.reviewId, reviewReportDigest: review.reportDigest, approvedAt: new Date().toISOString() };
  proposal.evaluationPack.spec.cases = proposal.evaluationPack.spec.cases.map((item) => ({ ...item, reviewStatus: "approved" }));
  proposal.evaluationPack.spec.status = proposal.evaluationPack.spec.cases.length >= proposal.evaluationPack.spec.minimumReviewedCases ? "READY" : "INSUFFICIENT_EVAL_EVIDENCE";
  proposal.evaluationPack = bindEvaluationPack(proposal.evaluationPack, proposal.proposedAssets, "approved");
  const evaluationBlockers = evaluationReviewBlockers(proposal.evaluationPack);
  if (evaluationBlockers.length) {
    return { schema: "evopilot-harness-proposal-approval/v3", status: "BLOCKED", proposalId, blockers: evaluationBlockers, nextAction: "review-evaluation-cases" };
  }
  const records = proposalCatalogRecords(home);
  const evidenceContext = proposalEvidenceContext(home, proposalId);
  proposal.assetDeltaProposal = rebindAssetDeltaProposal(proposal.assetDeltaProposal, { proposedAssets: proposal.proposedAssets, evaluationPack: proposal.evaluationPack, records, lifecycle: "approved" });
  proposal.deltaClosure = validateAssetDeltaClosure(proposal.assetDeltaProposal, proposal.evaluationPack, { proposedAssets: proposal.proposedAssets, records, ...evidenceContext });
  if (proposal.deltaClosure.status !== "VALIDATED") {
    return { schema: "evopilot-harness-proposal-approval/v3", status: "BLOCKED", proposalId, blockers: proposal.deltaClosure.blockers, nextAction: "repair-asset-delta" };
  }
  proposal.approval.approvedContentDigest = approvedContentDigest(proposal);
  writeYaml(file, proposal);
  writeYaml(path.join(path.dirname(file), "evaluation-pack.yaml"), proposal.evaluationPack);
  writeYaml(path.join(path.dirname(file), "asset-delta-proposal.yaml"), proposal.assetDeltaProposal);
  return { schema: "evopilot-harness-proposal-approval/v3", status: "APPROVED", proposalId, approval: proposal.approval, evaluationStatus: proposal.evaluationPack.spec.status, nextAction: "proposal-publish" };
}

export function publishProposal(home, proposalId) {
  const file = proposalFile(home, proposalId);
  const proposal = inspectProposal(home, proposalId);
  if (["NO_CHANGE", "NEED_MORE_EVIDENCE"].includes(proposal.decision) || proposal.assetDeltaProposal?.spec?.publicationAllowed !== true) {
    return { schema: "evopilot-harness-proposal-publication/v3", status: "BLOCKED", proposalId, blockers: ["asset-delta-publication-not-allowed"], nextAction: proposal.decision === "NO_CHANGE" ? "record-no-change" : "collect-more-evidence" };
  }
  if (proposal.status !== "APPROVED") return { schema: "evopilot-harness-proposal-publication/v3", status: "BLOCKED", proposalId, blockers: ["proposal-not-approved"], nextAction: "proposal-approve" };
  let review;
  try { review = inspectProposalReview(home, proposalId); } catch {
    return { schema: "evopilot-harness-proposal-publication/v3", status: "BLOCKED", proposalId, blockers: ["proposal-review-required"], nextAction: "proposal-review" };
  }
  const reviewValidation = validateProposalReview(review, review.reportPath);
  const bindingBlockers = reviewBindingBlockers(proposal, review, { approval: proposal.approval });
  const approvedDigestValid = Boolean(proposal.approval?.approvedContentDigest) && proposal.approval.approvedContentDigest === approvedContentDigest(proposal);
  const evaluationBlockers = evaluationReviewBlockers(proposal.evaluationPack);
  const approvalBlockers = unique([
    ...(!reviewValidation.valid ? ["proposal-review-invalid"] : []),
    ...bindingBlockers,
    ...(!approvedDigestValid ? ["proposal-approval-content-stale"] : []),
    ...(proposal.approval?.evaluationReviewed === true ? [] : ["evaluation-review-required"]),
    ...evaluationBlockers,
    ...(review.status === "REVIEWED" ? [] : [`proposal-review-status:${String(review.status).toLowerCase()}`]),
    ...(review.verdict === "READY_FOR_HUMAN_APPROVAL" ? [] : [`proposal-review-verdict:${String(review.verdict).toLowerCase()}`])
  ]);
  if (approvalBlockers.length) return { schema: "evopilot-harness-proposal-publication/v3", status: "BLOCKED", proposalId, blockers: approvalBlockers, nextAction: "proposal-review-and-approve" };
  const records = proposalCatalogRecords(home);
  const evidenceContext = proposalEvidenceContext(home, proposalId);
  const closure = validateAssetDeltaClosure(proposal.assetDeltaProposal, proposal.evaluationPack, { proposedAssets: proposal.proposedAssets, records, ...evidenceContext });
  if (closure.status !== "VALIDATED") return { schema: "evopilot-harness-proposal-publication/v3", status: "BLOCKED", proposalId, blockers: closure.blockers, nextAction: "repair-asset-delta" };
  const publicationAssets = proposal.proposedAssets.map((source) => {
    const asset = structuredClone(source);
    asset.metadata.lifecycle = "published";
    const validation = validateDocument(asset);
    const destination = path.join(home, "catalogs/organization/assets", kindDirectory(asset.kind), asset.metadata.id, asset.metadata.version, "asset.yaml");
    return { asset, validation, destination };
  });
  const invalidAsset = publicationAssets.find((item) => !item.validation.valid);
  if (invalidAsset) return { schema: "evopilot-harness-proposal-publication/v3", status: "FAILED", proposalId, validation: invalidAsset.validation };
  const publishedEvaluation = bindEvaluationPack(proposal.evaluationPack, publicationAssets.map((item) => item.asset), "published");
  const evaluationDestination = path.join(home, "evaluations", `${publishedEvaluation.metadata.id}@${publishedEvaluation.metadata.version}.yaml`);
  const publishedDelta = rebindAssetDeltaProposal(proposal.assetDeltaProposal, { proposedAssets: publicationAssets.map((item) => item.asset), evaluationPack: publishedEvaluation, records, lifecycle: "published" });
  const deltaDestination = path.join(home, "catalogs/organization/proposals", `${publishedDelta.metadata.id}@${publishedDelta.metadata.version}.yaml`);
  const publicationDocuments = [validateDocument(publishedEvaluation), validateDocument(publishedDelta)];
  const invalidDocument = publicationDocuments.find((item) => !item.valid);
  if (invalidDocument) return { schema: "evopilot-harness-proposal-publication/v3", status: "FAILED", proposalId, validation: invalidDocument };
  const publishedClosure = validateAssetDeltaClosure(publishedDelta, publishedEvaluation, { proposedAssets: publicationAssets.map((item) => item.asset), records, ...evidenceContext });
  if (publishedClosure.status !== "VALIDATED") return { schema: "evopilot-harness-proposal-publication/v3", status: "BLOCKED", proposalId, blockers: publishedClosure.blockers, nextAction: "repair-published-asset-delta" };
  const conflicts = [
    ...publicationAssets.filter((item) => fs.existsSync(item.destination)).map((item) => `immutable-asset-exists:${item.asset.metadata.id}@${item.asset.metadata.version}`),
    ...(fs.existsSync(evaluationDestination) ? [`immutable-evaluation-exists:${publishedEvaluation.metadata.id}@${publishedEvaluation.metadata.version}`] : []),
    ...(fs.existsSync(deltaDestination) ? [`immutable-delta-proposal-exists:${publishedDelta.metadata.id}@${publishedDelta.metadata.version}`] : [])
  ];
  if (conflicts.length) return { schema: "evopilot-harness-proposal-publication/v3", status: "BLOCKED", proposalId, blockers: conflicts, nextAction: "choose-new-immutable-version" };
  materializeDependencies(home, proposal.proposedAssets);
  const published = publicationAssets.map(({ asset, destination }) => {
    writeYaml(destination, asset);
    return { ...assetSummary(asset), path: destination, digest: digest(asset) };
  });
  writeYaml(evaluationDestination, publishedEvaluation);
  writeYaml(deltaDestination, publishedDelta);
  proposal.status = "PUBLISHED";
  proposal.publication = { publishedAt: new Date().toISOString(), assets: published, evaluationPath: evaluationDestination, evaluationDigest: digest(publishedEvaluation), assetDeltaPath: deltaDestination, assetDeltaDigest: digest(publishedDelta) };
  writeYaml(file, proposal);
  const catalog = publishCatalog({ roots: [path.join(home, "catalogs/organization/assets")], out: path.join(home, "catalogs/organization"), catalogId: "organization" });
  return { schema: "evopilot-harness-proposal-publication/v3", status: catalog.status === "PUBLISHED" ? "PUBLISHED" : "FAILED", proposalId, assets: published, assetDelta: { path: deltaDestination, digest: digest(publishedDelta) }, evaluation: { path: evaluationDestination, digest: digest(publishedEvaluation) }, catalog, nextAction: "catalog-sign" };
}

function proposalCatalogRecords(home) {
  return discoverAssets([path.join(home, "catalogs/organization/assets"), path.join(home, "catalogs/builtin/assets")]);
}

function proposalEvidenceContext(home, proposalId) {
  const runRoot = path.join(home, "evolution-runs", safeId(proposalId));
  return {
    evidenceGraph: JSON.parse(fs.readFileSync(path.join(runRoot, "evidence-graph.json"), "utf8")),
    reasoning: JSON.parse(fs.readFileSync(path.join(runRoot, "reasoning-result.json"), "utf8"))
  };
}

function reviewBindingBlockers(proposal, review, { requireCurrentProposal = false, approval } = {}) {
  const blockers = [];
  if (!proposal.review) blockers.push("proposal-review-binding-missing");
  if (proposal.review?.reviewId !== review.reviewId) blockers.push("proposal-review-id-mismatch");
  if (proposal.review?.reportDigest !== review.reportDigest) blockers.push("proposal-review-report-digest-mismatch");
  if (proposal.review?.proposalDigest !== review.proposalDigest) blockers.push("proposal-review-proposal-digest-mismatch");
  if (requireCurrentProposal && review.proposalDigest !== reviewInputDigest(proposal)) blockers.push("proposal-review-stale");
  if (approval) {
    if (approval.reviewId !== review.reviewId) blockers.push("proposal-approval-review-id-mismatch");
    if (approval.reviewReportDigest !== review.reportDigest) blockers.push("proposal-approval-review-digest-mismatch");
  }
  return unique(blockers);
}

function evaluationReviewBlockers(evaluationPack) {
  const cases = evaluationPack?.spec?.cases ?? [];
  const reviewedCount = cases.filter((item) => item.reviewStatus === "approved").length;
  const polarities = new Set(cases.filter((item) => item.reviewStatus === "approved").map((item) => item.polarity));
  return unique([
    ...(evaluationPack?.spec?.status === "READY" ? [] : ["evaluation-pack-not-ready"]),
    ...(reviewedCount >= Number(evaluationPack?.spec?.minimumReviewedCases ?? Infinity) ? [] : ["evaluation-reviewed-cases-insufficient"]),
    ...(cases.length > 0 && reviewedCount === cases.length ? [] : ["evaluation-cases-not-fully-approved"]),
    ...((evaluationPack?.spec?.requiredPolarities ?? []).every((polarity) => polarities.has(polarity)) ? [] : ["evaluation-required-polarities-not-approved"])
  ]);
}

function approvedContentDigest(proposal) {
  const content = structuredClone(proposal);
  delete content.publication;
  if (content.approval) delete content.approval.approvedContentDigest;
  return digest(content);
}

function materializeDependencies(home, proposedAssets) {
  const organizationRoot = path.join(home, "catalogs/organization/assets");
  const builtinRecords = discoverAssets([path.join(home, "catalogs/builtin/assets")]);
  const required = [];
  for (const asset of proposedAssets) {
    if (asset.kind === "HarnessProfile") required.push(...asset.spec.components.map((ref) => ({ kind: "HarnessComponent", ...ref })));
    if (asset.kind === "HarnessBundle") {
      required.push({ kind: "HarnessProfile", ...asset.spec.profile });
      required.push(...asset.spec.resolvedComponents.map((ref) => ({ kind: "HarnessComponent", ...ref })));
    }
  }
  for (const reference of required) {
    const directory = kindDirectory(reference.kind);
    const destination = path.join(organizationRoot, directory, reference.id, reference.version, "asset.yaml");
    if (fs.existsSync(destination)) continue;
    const source = builtinRecords.find((record) => record.asset.kind === reference.kind && record.asset.metadata.id === reference.id && record.asset.metadata.version === reference.version);
    if (!source) throw new Error(`Dependency ${reference.kind}:${reference.id}@${reference.version} cannot be resolved from the built-in Catalog.`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source.file, destination);
    const sourceExports = path.join(path.dirname(source.file), "exports");
    if (fs.existsSync(sourceExports)) fs.cpSync(sourceExports, path.join(path.dirname(destination), "exports"), { recursive: true });
  }
}

function evolvedProfile(base, graph, reasoning) {
  const asset = structuredClone(base);
  const evidenceKinds = unique(graph.nodes.map((node) => node.kind));
  const evidencedConcepts = conceptFrequency(graph).map((item) => item.id);
  const permittedConcepts = evidencedConcepts.filter((concept) => !asset.spec.match.negativeConcepts.includes(concept));
  const addedConcepts = permittedConcepts.filter((concept) => !asset.spec.match.positiveConcepts.includes(concept));
  asset.metadata.version = bumpPatch(base.metadata.version);
  asset.metadata.lifecycle = "review";
  asset.metadata.description = `${base.metadata.description.replace(/\.$/, "")}. Proposed evolution adds evidence-backed matching and acceptance coverage.`;
  asset.metadata.labels = { ...(base.metadata.labels ?? {}), evolutionRun: graph.runId };
  asset.spec.match.positiveConcepts = unique([...asset.spec.match.positiveConcepts, ...permittedConcepts]);
  asset.spec.match.requiredEvidenceKinds = unique([...asset.spec.match.requiredEvidenceKinds, ...evidenceKinds]);
  asset.spec.acceptance.requiredEvidence = unique([...asset.spec.acceptance.requiredEvidence, ...evidenceArtifacts(evidenceKinds)]);
  asset.spec.acceptance.blockingValidators = unique([...asset.spec.acceptance.blockingValidators, "evidence-citation-closure"]);
  if (addedConcepts.length) {
    asset.spec.boundary.inScope = unique([...asset.spec.boundary.inScope, `Validate evidence-backed ${addedConcepts.join(", ")} capabilities within the existing ${asset.spec.classification.role} boundary.`]);
  }
  asset.provenance = {
    ...(base.provenance ?? {}),
    sourceDigests: unique([...(base.provenance?.sourceDigests ?? []), graph.graphDigest]),
    ontologyVersion: `${reasoning.ontology.id}@${reasoning.ontology.version}`,
    policyVersion: `${reasoning.policy.id}@${reasoning.policy.version}`
  };
  return asset;
}

function newProfile(graph, reasoning) {
  const fallbackConcept = conceptFrequency(graph).find((item) => item.id !== "executable-engineering")?.id ?? "unclassified-engineering";
  const intent = reasoning.proposedProfile ?? {
    id: safeId(`${fallbackConcept}-profile`),
    domain: safeId(fallbackConcept),
    role: safeId(fallbackConcept === "unclassified-engineering" ? fallbackConcept : `${fallbackConcept}-engineering`),
    taskClass: "engineering-task",
    positiveConcepts: unique([fallbackConcept, "executable-engineering"]),
    negativeConcepts: [],
    evidenceKinds: unique(graph.nodes.map((node) => node.kind))
  };
  const id = safeId(intent.id);
  const evidenceKinds = unique(intent.evidenceKinds?.length ? intent.evidenceKinds : graph.nodes.map((node) => node.kind));
  const requiredEvidence = evidenceArtifacts(evidenceKinds);
  const negativeBoundary = intent.negativeConcepts.length
    ? `Exclude projects whose primary role matches conflicting Ontology concepts: ${intent.negativeConcepts.join(", ")}.`
    : `Exclude projects outside the evidenced ${intent.domain} engineering boundary.`;
  return {
    apiVersion: API_VERSION,
    kind: "HarnessProfile",
    metadata: {
      id,
      version: "0.1.0",
      name: title(id),
      description: `Review-stage ${intent.role} Harness Profile for repeatable ${intent.taskClass} in the ${intent.domain} domain.`,
      lifecycle: "review",
      owner: "organization",
      labels: { proposal: graph.runId, domain: intent.domain, role: intent.role }
    },
    spec: {
      classification: { domain: intent.domain, role: intent.role, taskClass: intent.taskClass },
      boundary: {
        inScope: [
          `Validate repeatable ${intent.taskClass} workflows for the ${intent.role} role in the ${intent.domain} domain.`,
          `Discover project-specific build, test, release, and diagnostic commands from cited ${evidenceKinds.join(", ")} evidence.`,
          `Produce traceable evidence for ${requiredEvidence.join(", ")}.`
        ],
        outOfScope: [
          negativeBoundary,
          "Do not infer unsupported capabilities or production-readiness claims from uncited material.",
          "Do not execute project-provided commands without isolation and explicit operator approval."
        ]
      },
      match: {
        positiveConcepts: unique(intent.positiveConcepts),
        negativeConcepts: unique(intent.negativeConcepts),
        requiredEvidenceKinds: evidenceKinds.length ? evidenceKinds : ["operator-note"]
      },
      components: [{ id: "engineering-validation", version: "1.0.0", required: true }],
      acceptance: {
        requiredEvidence,
        blockingValidators: ["evidence-citation-closure", "domain-boundary-conflict", "approved-command-only", "validation-exit-code"]
      },
      evaluationPackRef: `${id}@0.1.0`
    },
    provenance: { sourceDigests: [graph.graphDigest], ontologyVersion: `${reasoning.ontology.id}@${reasoning.ontology.version}`, policyVersion: `${reasoning.policy.id}@${reasoning.policy.version}` }
  };
}

function composedBundle(records, graph, reasoning) {
  const profileRecords = reasoning.composeProfiles.map((ref) => records.find((record) => record.asset.kind === "HarnessProfile" && record.asset.metadata.id === ref.id && record.asset.metadata.version === ref.version)).filter(Boolean);
  const profiles = profileRecords.map((record) => record.asset);
  const componentRefs = unique(profiles.flatMap((profile) => profile.spec.components.map((ref) => `${ref.id}@${ref.version}`))).map((key) => {
    const [id, version] = key.split("@");
    const component = records.find((record) => record.asset.kind === "HarnessComponent" && record.asset.metadata.id === id && record.asset.metadata.version === version);
    return { id, version, digest: component?.digest ?? digest({ id, version }), required: true };
  });
  const id = safeId(profiles.map((profile) => profile.metadata.id).join("-and-") || `composed-${graph.runId}`);
  return {
    apiVersion: API_VERSION,
    kind: "HarnessBundle",
    metadata: { id, version: "0.1.0", name: title(id), description: "Review-stage composed Harness Bundle supported by evidence spanning multiple task profiles.", lifecycle: "review", owner: "organization", labels: { proposal: graph.runId } },
    spec: {
      profile: {
        id: profiles[0]?.metadata.id ?? "profile-review-required",
        version: profiles[0]?.metadata.version ?? "0.1.0",
        digest: profileRecords[0]?.digest ?? digest({ id: "profile-review-required", version: "0.1.0" })
      },
      resolvedComponents: componentRefs,
      executionPlan: unique(componentRefs.map((ref) => `resolve-${ref.id}`)),
      constraints: ["Resolve all referenced immutable components before execution.", "Human review is required for cross-profile composition."],
      evidence: ["source-snapshot", "composition-review", "validation-result"],
      validators: ["component-digest-verification", "composition-review"]
    },
    provenance: { sourceDigests: [graph.graphDigest], ontologyVersion: `${reasoning.ontology.id}@${reasoning.ontology.version}`, policyVersion: `${reasoning.policy.id}@${reasoning.policy.version}` }
  };
}

function conceptFrequency(graph) {
  const counts = new Map();
  for (const concept of graph.nodes.flatMap((node) => node.concepts ?? [])) counts.set(concept, (counts.get(concept) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

function evidenceArtifacts(evidenceKinds) {
  const artifactByKind = {
    "source-code": "source-snapshot",
    "build-manifest": "build-manifest-snapshot",
    "architecture-document": "architecture-boundary-review",
    "runtime-log": "redacted-runtime-evidence",
    attachment: "material-evidence-index",
    "operator-note": "reviewed-goal-statement",
    "github-repository": "immutable-source-revision",
    "historical-harness": "historical-harness-diff",
    "research-evidence": "research-citation-record"
  };
  return unique([
    ...evidenceKinds.map((kind) => artifactByKind[kind]).filter(Boolean),
    "approved-command-inventory",
    "validation-result"
  ]);
}

function proposalFile(home, proposalId) {
  return path.join(home, "evolution-runs", safeId(proposalId), "proposal.yaml");
}

function assetSummary(asset) {
  return { kind: asset.kind, id: asset.metadata.id, version: asset.metadata.version, lifecycle: asset.metadata.lifecycle, digest: digest(asset) };
}

function deltaSummary(proposal) {
  return {
    kind: proposal.kind,
    id: proposal.metadata.id,
    version: proposal.metadata.version,
    digest: digest(proposal),
    decision: proposal.spec.decision,
    status: proposal.spec.status,
    publicationAllowed: proposal.spec.publicationAllowed,
    deltaCount: proposal.spec.deltas.length,
    impactStatus: proposal.spec.deltas.length ? proposal.spec.deltas.every((item) => item.impact.status === "READY") ? "READY" : "BLOCKED" : "NOT_APPLICABLE",
    deltas: proposal.spec.deltas.map((item) => ({
      deltaId: item.deltaId,
      assetKind: item.assetKind,
      operation: item.operation,
      before: item.before.map((state) => `${state.kind}:${state.id}@${state.version}`),
      after: item.after ? `${item.after.kind}:${item.after.id}@${item.after.version}` : null,
      changeCount: item.changes.length,
      evidenceIds: item.evidenceIds,
      impact: item.impact
    }))
  };
}

function kindDirectory(kind) {
  return ({ HarnessComponent: "components", HarnessProfile: "profiles", HarnessBundle: "bundles" })[kind];
}

function title(value) {
  return String(value).split("-").map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
}
