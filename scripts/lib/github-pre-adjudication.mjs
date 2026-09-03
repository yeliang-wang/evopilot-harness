import { digest } from "../../src/v3/utils.mjs";

export const PRE_ADJUDICATION_PROFILE_SCHEMA = "evopilot-harness-github-pre-adjudication-profile/v1";
export const PRE_ADJUDICATION_ALGORITHM = "candidate-blind-static-taxonomy-pre-adjudication/v1";
export const CLASSIFICATION_BRANCHES = Object.freeze([
  "TAXONOMY_MATCHED",
  "TAXONOMY_EXTENSION_SUGGESTED",
  "TAXONOMY_EVIDENCE_INSUFFICIENT",
  "TAXONOMY_AMBIGUOUS"
]);

const EXPECTED_TAXONOMY_NODES = Object.freeze({
  domains: ["software-engineering-learning", "software-resource-discovery", "ai-assisted-software-engineering"],
  products: ["tutorial-reference-collection", "curated-software-directory", "agent-instruction-library"]
});

export function validatePreAdjudicationProfile({ profile, profileDigest, plan, planDigest, taxonomy, taxonomyDigest }) {
  if (profile?.schema !== PRE_ADJUDICATION_PROFILE_SCHEMA) throw failure("GITHUB_PRE_ADJUDICATION_PROFILE_INVALID", "Pre-adjudication profile schema is invalid.");
  if (profile?.status !== "FROZEN_CANDIDATE_BLIND" || profile?.algorithm !== PRE_ADJUDICATION_ALGORITHM) throw failure("GITHUB_PRE_ADJUDICATION_PROFILE_INVALID", "Pre-adjudication profile must be frozen and use the supported candidate-blind algorithm.");
  if (profile?.planDigest !== planDigest || profile?.taxonomyDigest !== taxonomyDigest) throw failure("GITHUB_PRE_ADJUDICATION_BINDING_MISMATCH", "Pre-adjudication profile does not bind the exact discovery plan and acceptance Taxonomy.");
  if (profile?.candidateOutputObserved !== false || profile?.candidateInvocationCount !== 0 || profile?.authority?.candidateOutputMayAffectSelection !== false) throw failure("GITHUB_PRE_ADJUDICATION_CANDIDATE_ISOLATION_INVALID", "Pre-adjudication must be isolated from Candidate output.");
  const assignments = Array.isArray(profile?.queryAssignments) ? profile.queryAssignments : [];
  const queryIds = plan.queries.map((item) => item.id);
  if (assignments.length !== queryIds.length || new Set(assignments.map((item) => item.queryId)).size !== queryIds.length || assignments.some((item) => !queryIds.includes(item.queryId) || !CLASSIFICATION_BRANCHES.includes(item.requiredBranch))) throw failure("GITHUB_PRE_ADJUDICATION_QUERY_ASSIGNMENTS_INVALID", "Pre-adjudication must assign exactly one supported branch to every discovery query.");
  const assignedDistribution = distribution(assignments.map((item) => item.requiredBranch));
  const requiredDistribution = normalizeDistribution(plan?.blindedOracle?.requiredOutcomeDistribution);
  if (JSON.stringify(assignedDistribution) !== JSON.stringify(requiredDistribution)) throw failure("GITHUB_PRE_ADJUDICATION_DISTRIBUTION_MISMATCH", "Pre-adjudication query assignments do not satisfy the Target-bound outcome distribution.");
  validateAcceptanceTaxonomy(taxonomy);
  return {
    profileDigest,
    taxonomyDigest,
    assignments: new Map(assignments.map((item) => [item.queryId, item.requiredBranch])),
    requiredDistribution
  };
}

export function preAdjudicateSource({ hypothesis, taxonomyDigest }) {
  const semanticCitations = hypothesis?.citations?.filter((item) => item.trust === "NORMAL" && ["content-purpose", "content-inventory"].includes(item.family)) ?? [];
  const purposeText = semanticCitations.filter((item) => item.family === "content-purpose").map((item) => item.excerpt).join("\n").toLowerCase();
  const inventoryText = semanticCitations.filter((item) => item.family === "content-inventory").map((item) => item.excerpt).join("\n").toLowerCase();
  const semanticText = `${purposeText}\n${inventoryText}`;
  const evidence = {
    normalPurposeCitationCount: semanticCitations.filter((item) => item.family === "content-purpose").length,
    normalInventoryCitationCount: semanticCitations.filter((item) => item.family === "content-inventory").length,
    sourceFileCount: hypothesis?.sourceSnapshot?.fileCount ?? 0,
    sourceCharacterCount: hypothesis?.sourceSnapshot?.characterCount ?? 0,
    sourceSnapshotDigest: hypothesis?.sourceSnapshotDigest ?? null,
    hypothesisDigest: hypothesis?.hypothesisDigest ?? null
  };
  if (semanticCitations.length === 0 || !purposeText.trim() || !inventoryText.trim()) return result("TAXONOMY_EVIDENCE_INSUFFICIENT", "No complete normal-trust purpose and inventory evidence pair is available in the bounded static snapshot.", evidence, taxonomyDigest, []);

  const personaMarkers = markers(semanticText, ["personality", "roster", "specialized expert", "specialist", "identity", "mission", "vibe", "emoji"]);
  const agentMarkers = markers(semanticText, ["agent", "agents", "claude code", "codex", "cursor", "agentic coding"]);
  if (personaMarkers.length >= 3 && agentMarkers.length >= 1) return result("TAXONOMY_EXTENSION_SUGGESTED", "The Source is a role/persona-oriented Agent roster; the controlled Taxonomy explicitly excludes such a roster from its engineering-instruction node.", evidence, taxonomyDigest, [...personaMarkers, ...agentMarkers]);

  const learningPurpose = markers(purposeText, ["step-by-step", "guide", "guides", "learn", "learning", "tutorial", "tutorials", "from scratch", "knowledge", "materials", "explanations", "reference"]);
  const learningInventory = markers(inventoryText, ["tutorial", "tutorials", "manual", "manuals", "howto", "howtos", "books", "courses", "learning"]);
  const discoveryPurpose = markers(purposeText, ["collection", "curated", "directory", "list", "lists", "resources", "tools", "gathered", "find"]);
  const discoveryInventory = markers(inventoryText, ["contents", "list", "lists", "tools", "frameworks", "libraries", "resources", "services", "platforms"]);
  const instructionPurpose = markers(purposeText, ["engineering workflow", "engineering workflows", "coding agent", "coding agents", "reusable skill", "reusable skills", "quality gate", "quality gates"]);
  const instructionInventory = markers(inventoryText, ["skills", "workflows", "instructions", "quality gates"]);
  const scores = {
    "software-engineering-learning/tutorial-reference-collection": learningPurpose.length * 2 + learningInventory.length,
    "software-resource-discovery/curated-software-directory": discoveryPurpose.length * 2 + discoveryInventory.length,
    "ai-assisted-software-engineering/agent-instruction-library": instructionPurpose.length * 2 + instructionInventory.length
  };
  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const supported = ranked.filter(([, score]) => score >= 3);
  const allMarkers = [...learningPurpose, ...learningInventory, ...discoveryPurpose, ...discoveryInventory, ...instructionPurpose, ...instructionInventory];
  if (supported.length === 0) return result("TAXONOMY_EXTENSION_SUGGESTED", "The Source is coherent, but the controlled Taxonomy has no sufficiently supported Domain/Product pair.", { ...evidence, scores }, taxonomyDigest, allMarkers);
  if (supported.length > 1 && supported[1][1] >= Math.max(3, supported[0][1] * 0.6)) return result("TAXONOMY_AMBIGUOUS", "Multiple controlled Domain/Product pairs remain materially supported by the same bounded static evidence.", { ...evidence, scores, supportedPairs: supported.map(([pair]) => pair) }, taxonomyDigest, allMarkers);
  const [pair, score] = supported[0];
  const [domain, product] = pair.split("/");
  return result("TAXONOMY_MATCHED", "One controlled Domain/Product pair has sufficient evidence and a policy-safe margin over alternatives.", { ...evidence, scores, selectedPair: { domain, product, score } }, taxonomyDigest, allMarkers);
}

export function distribution(branches) {
  return Object.fromEntries(CLASSIFICATION_BRANCHES.map((branch) => [branch, branches.filter((item) => item === branch).length]));
}

function result(branch, reason, evidence, taxonomyDigest, matchedMarkers) {
  const core = {
    schema: "evopilot-harness-github-pre-adjudication-result/v1",
    algorithm: PRE_ADJUDICATION_ALGORITHM,
    branch,
    reason,
    evidence,
    matchedMarkers: [...new Set(matchedMarkers)].sort(),
    taxonomyDigest,
    candidateOutputObserved: false,
    candidateInvocationCount: 0,
    sourceExecution: false,
    authority: "ACCEPTANCE_SELECTION_EVIDENCE_ONLY"
  };
  core.preAdjudicationDigest = digest(core);
  return core;
}

function validateAcceptanceTaxonomy(taxonomy) {
  if (taxonomy?.apiVersion !== "harness.evopilot.io/v1" || taxonomy?.kind !== "Taxonomy") throw failure("GITHUB_PRE_ADJUDICATION_TAXONOMY_INVALID", "Acceptance Taxonomy schema is invalid.");
  for (const [axis, expected] of Object.entries(EXPECTED_TAXONOMY_NODES)) {
    const actual = new Set((taxonomy?.spec?.[axis] ?? []).filter((item) => item.assignable === true).map((item) => item.id));
    if (expected.some((id) => !actual.has(id))) throw failure("GITHUB_PRE_ADJUDICATION_TAXONOMY_INVALID", `Acceptance Taxonomy is missing required ${axis} nodes.`);
  }
}

function normalizeDistribution(value) {
  const normalized = Object.fromEntries(CLASSIFICATION_BRANCHES.map((branch) => [branch, Number(value?.[branch] ?? 0)]));
  if (Object.values(normalized).some((count) => !Number.isInteger(count) || count < 0)) throw failure("GITHUB_PRE_ADJUDICATION_DISTRIBUTION_INVALID", "Target-bound outcome distribution is invalid.");
  return normalized;
}

function markers(text, candidates) {
  return candidates.filter((candidate) => text.includes(candidate));
}

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
