import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { preAdjudicateSource, validatePreAdjudicationProfile } from "../scripts/lib/github-pre-adjudication.mjs";
import { digest } from "../src/v3/utils.mjs";
import { initializeWorkspace } from "../src/v3/workspace.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("Target-bound Source Portfolio validation preserves selected local Source bytes", () => {
  const home = temporary("portfolio");
  const source = path.join(home, "source.md");
  fs.writeFileSync(source, "static source evidence\n");
  const manifest = {
    schema: "evopilot-harness-e2e-source-portfolio/v1", status: "PROPOSED", authority: "acceptance-source-selection-only", projectMutation: false, sourceMutation: false, targetVersion: "4.5.0",
    sources: [{ id: "SRC-ONE", type: "LOCAL_FILE", locator: source, readOnly: true }],
    caseBindings: Array.from({ length: 15 }, (_, index) => ({ caseId: `RC${String(index + 1).padStart(2, "0")}`, sourceIds: ["SRC-ONE"] }))
  };
  const manifestFile = write(home, "portfolio.json", manifest);
  const before = fs.readFileSync(source);
  const result = JSON.parse(execFileSync(process.execPath, [path.join(root, "scripts/validate-e2e-source-portfolio.mjs"), "--manifest", manifestFile, "--case", "RC01"], { cwd: root, encoding: "utf8" }));
  assert.equal(result.status, "PASSED");
  assert.equal(result.sources[0].sourceId, "SRC-ONE");
  assert.equal(result.sources[0].sourceExecution, false);
  assert.deepEqual(fs.readFileSync(source), before);
});

test("GitHub Source Portfolio validation fails closed without a dedicated Workspace", () => {
  const home = temporary("portfolio-github-workspace");
  const manifest = {
    schema: "evopilot-harness-e2e-source-portfolio/v1", status: "PROPOSED", authority: "acceptance-source-selection-only", projectMutation: false, sourceMutation: false, targetVersion: "4.5.0",
    sources: [{ id: "SRC-GITHUB", type: "GITHUB_REPOSITORY", repository: "octocat/Hello-World", readOnly: true }],
    caseBindings: Array.from({ length: 15 }, (_, index) => ({ caseId: `RC${String(index + 1).padStart(2, "0")}`, sourceIds: ["SRC-GITHUB"] }))
  };
  const manifestFile = write(home, "portfolio.json", manifest);
  const result = spawnSync(process.execPath, [path.join(root, "scripts/validate-e2e-source-portfolio.mjs"), "--manifest", manifestFile, "--case", "RC01"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "BLOCKED");
  assert.equal(report.sources[0].blocker.code, "WORKSPACE_REQUIRED_FOR_GITHUB_SNAPSHOT");
});

test("fixed-wave contract binds exact Target and Source Portfolio while rejecting runner-added invariant outcomes", () => {
  const home = temporary("fixed-wave-contract");
  const target = {
    id: "target-test", revision: 11,
    acceptance: { cases: Array.from({ length: 15 }, (_, index) => ({ id: `RC${String(index + 1).padStart(2, "0")}`, scenario: `scenario-${index}`, startingState: `start-${index}`, terminalState: `terminal-${index}`, requiredEvidence: `evidence-${index}` })) }
  };
  const portfolio = {
    schema: "evopilot-harness-e2e-source-portfolio/v1",
    caseBindings: Array.from({ length: 15 }, (_, index) => ({ caseId: `RC${String(index + 1).padStart(2, "0")}`, sourceIds: ["SRC-ONE"] }))
  };
  const targetFile = write(home, "target.json", target);
  const portfolioFile = write(home, "portfolio.json", portfolio);
  const contract = {
    schema: "evopilot-harness-fixed-wave-acceptance-contract/v1", authority: "target-derived-acceptance-execution-only", runnerMayAddOutcomeConstraints: false,
    target: { id: target.id, revision: target.revision, fileDigest: sha(fs.readFileSync(targetFile)) },
    sourcePortfolio: { fileDigest: sha(fs.readFileSync(portfolioFile)) },
    cases: target.acceptance.cases.map((item) => ({ caseId: item.id, targetAcceptanceDigest: sha(JSON.stringify({ scenario: item.scenario, startingState: item.startingState, terminalState: item.terminalState, requiredEvidence: item.requiredEvidence })), sourceIds: ["SRC-ONE"], oracle: item.id === "RC06" ? { mode: "INVARIANTS_ONLY" } : { mode: "CASE_ORACLE" }, requiredAssertions: ["target-derived assertion"] }))
  };
  const contractFile = write(home, "contract.json", contract);
  const valid = JSON.parse(execFileSync(process.execPath, [path.join(root, "scripts/validate-fixed-wave-contract.mjs"), "--contract", contractFile, "--target", targetFile, "--portfolio", portfolioFile], { cwd: root, encoding: "utf8" }));
  assert.equal(valid.status, "PASSED");
  assert.deepEqual(valid.invariantOnlyCases, ["RC06"]);
  contract.cases.find((item) => item.caseId === "RC06").oracle.exactAggregate = "TAXONOMY_MATCHED";
  write(home, "contract.json", contract);
  const rejected = spawnSync(process.execPath, [path.join(root, "scripts/validate-fixed-wave-contract.mjs"), "--contract", contractFile, "--target", targetFile, "--portfolio", portfolioFile], { cwd: root, encoding: "utf8" });
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /FIXED_WAVE_INVARIANT_OVERCONSTRAINED/);
});

test("live GitHub discovery plan validates offline and refuses an unfrozen candidate before search", () => {
  const home = temporary("discovery-plan");
  initializeWorkspace(home);
  const planFile = write(home, "plan.json", discoveryPlan());
  const validation = JSON.parse(execFileSync(process.execPath, [path.join(root, "scripts/run-live-github-discovery.mjs"), "--plan", planFile, "--validate-plan-only"], { cwd: root, encoding: "utf8" }));
  assert.equal(validation.status, "PASSED");
  assert.equal(validation.queryIds.length, 6);
  const candidateFile = write(home, "candidate.json", { status: "BUILDING", candidateId: "candidate-test", candidateDigest: sha("candidate"), sourceCheckoutUsed: false, candidateOutputAvailableDuringDiscovery: false });
  const fixedFile = write(home, "fixed.json", { status: "PASSED", candidateDigest: sha("candidate"), cases: Array.from({ length: 15 }, (_, index) => ({ id: `RC${String(index + 1).padStart(2, "0")}`, status: "PASS" })) });
  const runbooksFile = write(home, "runbooks.json", workBuddyRunbookManifest(sha("binding")));
  const failed = spawnSync(process.execPath, [path.join(root, "scripts/run-live-github-discovery.mjs"), "--plan", planFile, "--candidate", candidateFile, "--fixed-wave-report", fixedFile, "--workbuddy-runbooks", runbooksFile, "--workspace", home, "--out", path.join(home, "must-not-exist.json")], { cwd: root, encoding: "utf8" });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /GITHUB_DISCOVERY_CANDIDATE_NOT_FROZEN|Candidate manifest must prove FROZEN/);
  assert.equal(fs.existsSync(path.join(home, "must-not-exist.json")), false);
});

test("compact Target revision 14 GitHub discovery plan accepts exactly five one-per-stratum repositories", () => {
  const home = temporary("discovery-plan-five");
  const plan = discoveryPlan();
  plan.targetRevision = 14;
  plan.workBuddyCaseIds = ["RC01", "RC02", "RC03", "RC04", "RC05"];
  plan.preconditions = { requiredMachineStageIds: ["MV01", "MV02", "MV03", "MV04"] };
  plan.queries = plan.queries.slice(0, 5).map((query) => ({ ...query, selectionCount: 1 }));
  plan.selection = { ...plan.selection, exactRepositoryCount: 5, selectionCountPerQuery: 1, minimumPrimaryLanguages: 3, maximumRepositoriesPerLanguage: 2 };
  const planFile = write(home, "plan.json", plan);
  const validation = JSON.parse(execFileSync(process.execPath, [path.join(root, "scripts/run-live-github-discovery.mjs"), "--plan", planFile, "--validate-plan-only"], { cwd: root, encoding: "utf8" }));
  assert.equal(validation.status, "PASSED");
  assert.equal(validation.queryIds.length, 5);
});

test("candidate-blind pre-adjudication validates the exact four-branch portfolio and keeps Candidate output unavailable", () => {
  const plan = discoveryPlan();
  plan.queries = plan.queries.slice(0, 5).map((query) => ({ ...query, selectionCount: 1 }));
  plan.selection = { ...plan.selection, exactRepositoryCount: 5, selectionCountPerQuery: 1 };
  plan.blindedOracle.requiredOutcomeDistribution = {
    TAXONOMY_MATCHED: 2,
    TAXONOMY_EXTENSION_SUGGESTED: 1,
    TAXONOMY_EVIDENCE_INSUFFICIENT: 1,
    TAXONOMY_AMBIGUOUS: 1
  };
  const planDigest = sha("plan");
  const taxonomyDigest = sha("taxonomy");
  const profile = {
    schema: "evopilot-harness-github-pre-adjudication-profile/v1",
    status: "FROZEN_CANDIDATE_BLIND",
    algorithm: "candidate-blind-static-taxonomy-pre-adjudication/v1",
    planDigest,
    taxonomyDigest,
    candidateOutputObserved: false,
    candidateInvocationCount: 0,
    queryAssignments: plan.queries.map((query, index) => ({ queryId: query.id, requiredBranch: ["TAXONOMY_MATCHED", "TAXONOMY_MATCHED", "TAXONOMY_EXTENSION_SUGGESTED", "TAXONOMY_EVIDENCE_INSUFFICIENT", "TAXONOMY_AMBIGUOUS"][index] })),
    authority: { candidateOutputMayAffectSelection: false }
  };
  const taxonomy = acceptanceTaxonomy();
  const validated = validatePreAdjudicationProfile({ profile, profileDigest: sha("profile"), plan, planDigest, taxonomy, taxonomyDigest });
  assert.equal(validated.assignments.size, 5);
  assert.deepEqual(validated.requiredDistribution, plan.blindedOracle.requiredOutcomeDistribution);
});

test("candidate-blind pre-adjudication distinguishes matched, extension, insufficient and ambiguous static evidence", () => {
  const taxonomyDigest = sha("taxonomy");
  assert.equal(preAdjudicateSource({ hypothesis: hypothesis("This is a step-by-step guide to learn by building from scratch.", "Tutorials and courses"), taxonomyDigest }).branch, "TAXONOMY_MATCHED");
  assert.equal(preAdjudicateSource({ hypothesis: hypothesis("A roster of specialized agents, each with personality, identity, mission and vibe.", "Agent roster"), taxonomyDigest }).branch, "TAXONOMY_EXTENSION_SUGGESTED");
  assert.equal(preAdjudicateSource({ hypothesis: hypothesis("Contribution policy", "", false), taxonomyDigest }).branch, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(preAdjudicateSource({ hypothesis: hypothesis("A collection of knowledge materials, explanations and tools gathered for people to find.", "Tutorials, manuals, lists and tools"), taxonomyDigest }).branch, "TAXONOMY_AMBIGUOUS");
});

test("RC16 start readiness accepts passed non-WorkBuddy evidence while every WorkBuddy leg remains pending", () => {
  const home = temporary("rc16-revision-12-readiness");
  initializeWorkspace(home);
  const candidateDigest = sha("candidate-12");
  const planFile = write(home, "plan.json", discoveryPlan());
  const candidateFile = write(home, "candidate.json", { status: "FROZEN", candidateId: "evopilot-harness-v4.5.0-candidate-12", candidateDigest, sourceCheckoutUsed: false, candidateOutputAvailableDuringDiscovery: false });
  const cases = Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`RC${String(index + 1).padStart(2, "0")}`, { machineEvidenceStatus: "PASS", workBuddyHumanOperationStatus: "PENDING_FINAL_RANGE_DECLARATION" }]));
  const fixedFile = write(home, "fixed.json", { status: "MACHINE_EVIDENCE_PASSED_TARGET_SEQUENCE_BLOCKED", candidate: { packageDigest: candidateDigest }, acceptance: { rc01ToRc15MachineEvidence: "PASSED" }, cases });
  const runbooksFile = write(home, "runbooks.json", workBuddyRunbookManifest(sha("binding")));
  const readiness = JSON.parse(execFileSync(process.execPath, [path.join(root, "scripts/run-live-github-discovery.mjs"), "--plan", planFile, "--candidate", candidateFile, "--fixed-wave-report", fixedFile, "--workbuddy-runbooks", runbooksFile, "--workspace", home, "--out", path.join(home, "unused.json"), "--validate-rc16-preconditions-only"], { cwd: root, encoding: "utf8" }));
  assert.equal(readiness.status, "PASSED");
  assert.equal(readiness.fixedWave.machineEvidencePassedCases, 15);
  assert.equal(readiness.workBuddyRunbooks.runbookCount, 17);
  assert.equal(readiness.workBuddyRunbooks.humanOperationStatus, "PENDING");
});

test("candidate-blind GitHub oracle accounts for all frozen Sources and requires exact human confirmation", () => {
  const home = temporary("oracle");
  const repositories = Array.from({ length: 12 }, (_, index) => ({ sourceId: `source-${index + 1}`, repository: `owner-${index + 1}/repo-${index + 1}`, resolvedCommit: "a".repeat(39) + (index % 10), sourceSnapshotDigest: sha(`snapshot-${index}`) }));
  const selection = { schema: "evopilot-harness-github-discovery-selection-manifest/v1", status: "FROZEN_AWAITING_ORACLE", selectionManifestDigest: sha("selection"), candidate: { candidateDigest: sha("candidate") }, repositories };
  const branches = ["TAXONOMY_MATCHED", "TAXONOMY_EXTENSION_SUGGESTED", "TAXONOMY_EVIDENCE_INSUFFICIENT", "TAXONOMY_AMBIGUOUS"];
  const decisions = {
    schema: "evopilot-harness-github-discovery-oracle-decisions/v1", selectionManifestDigest: selection.selectionManifestDigest, candidateOutputsVisible: false,
    repositories: repositories.map((repository, index) => ({ ...repository, expectedClassificationBranch: branches[index % branches.length], allowedHarnessTerminals: index === 0 ? ["NOT_HARNESS_ELIGIBLE"] : ["NEED_MORE_EVIDENCE"], evidenceLimitations: ["bounded acceptance source"], analysisProvenance: { deterministicEvidenceDigest: sha(`deterministic-${index}`), advisorOutputDigest: sha(`advisor-${index}`), candidateOutputObserved: false } }))
  };
  const selectionFile = write(home, "selection.json", selection);
  const decisionsFile = write(home, "decisions.json", decisions);
  const proposalFile = path.join(home, "oracle-proposal.json");
  const proposed = JSON.parse(execFileSync(process.execPath, [path.join(root, "scripts/freeze-github-discovery-oracle.mjs"), "--mode", "propose", "--selection", selectionFile, "--decisions", decisionsFile, "--out", proposalFile], { cwd: root, encoding: "utf8" }));
  assert.equal(proposed.status, "REVIEW_REQUIRED");
  const confirmedFile = path.join(home, "oracle-confirmed.json");
  const confirmed = JSON.parse(execFileSync(process.execPath, [path.join(root, "scripts/freeze-github-discovery-oracle.mjs"), "--mode", "confirm", "--oracle", proposalFile, "--confirmed-by", "acceptance-reviewer", "--confirmation", proposed.confirmation, "--out", confirmedFile], { cwd: root, encoding: "utf8" }));
  assert.equal(confirmed.status, "HUMAN_CONFIRMED");
  assert.equal(confirmed.oracleDigest, proposed.oracleDigest);
});

function discoveryPlan() {
  return {
    schema: "evopilot-harness-live-github-discovery-plan/v1", authority: "acceptance-source-discovery-only", targetVersion: "4.5.0",
    provider: { apiVersion: "2022-11-28", requestParameters: { sort: "stars", order: "desc", perPage: 100, maximumPagesPerQuery: 3 } },
    freshness: { maximumMinutesFromFirstSearchResponseToSelectionFreeze: 60 },
    queries: Array.from({ length: 6 }, (_, index) => ({ id: `GHQ0${index + 1}-TEST`, stratum: `stratum-${index + 1}`, query: `test-${index + 1} is:public`, selectionCount: 2 })),
    searchCapture: {}, selection: { exactRepositoryCount: 12, selectionCountPerQuery: 2, replacementAfterSelectionFreeze: false, candidateOutputAvailableDuringSelection: false }, freeze: {}, blindedOracle: {}, execution: {}, prohibitedEffects: ["no candidate authority"]
  };
}
function workBuddyRunbookManifest(candidateBindingDigest) {
  return {
    schema: "evopilot-workbuddy-human-runbook-set/v1", targetRevision: 12, candidateBindingDigest, candidateBindingType: "ACCEPTANCE_REBINDING",
    executionPolicy: "human-operated-workbuddy/v1", completionPolicy: "designated-human-range-completion/v1", runbookCount: 17,
    caseIds: [...Array.from({ length: 15 }, (_, index) => `RC${String(index + 1).padStart(2, "0")}`), "RC17", "RC18"], runbooksDigest: sha("runbooks")
  };
}
function acceptanceTaxonomy() {
  return {
    apiVersion: "harness.evopilot.io/v1", kind: "Taxonomy", spec: {
      domains: ["software-engineering-learning", "software-resource-discovery", "ai-assisted-software-engineering"].map((id) => ({ id, assignable: true })),
      products: ["tutorial-reference-collection", "curated-software-directory", "agent-instruction-library"].map((id) => ({ id, assignable: true }))
    }
  };
}
function hypothesis(purpose, inventory, normal = true) {
  return {
    sourceSnapshotDigest: sha(`${purpose}:${inventory}`),
    hypothesisDigest: sha(`hypothesis:${purpose}:${inventory}`),
    sourceSnapshot: { fileCount: 2, characterCount: purpose.length + inventory.length },
    citations: [
      { family: normal ? "content-purpose" : "low-trust-content", trust: normal ? "NORMAL" : "LOW", excerpt: purpose },
      ...(inventory ? [{ family: "content-inventory", trust: "NORMAL", excerpt: inventory }] : [])
    ]
  };
}
function temporary(label) { return fs.mkdtempSync(path.join(os.tmpdir(), `evopilot-v45-${label}-`)); }
function write(home, name, value) { const file = path.join(home, name); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); return file; }
function sha(value) { return `sha256:${crypto.createHash("sha256").update(Buffer.isBuffer(value) ? value : String(value)).digest("hex")}`; }
