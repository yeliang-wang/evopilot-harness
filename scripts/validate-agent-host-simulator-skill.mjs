#!/usr/bin/env node

import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const skillRoot = path.join(root, ".agents/skills/evopilot-agent-host-production-simulator");
const required = [
  "SKILL.md", "agents/openai.yaml", "core/stable-core.json", "core/stable-core-contract.md",
  "profiles/host-adapter.schema.json", "profiles/profile-contract.md", "profiles/workbuddy.md", "profiles/workbuddy/adapter.json",
  "compatibility/adapter.schema.json", "compatibility/adapters/agent-operations-v3-base.json", "compatibility/adapters/agent-operations-v3-source-first.json",
  "compatibility/fixtures/v4.4.0-capabilities.json", "compatibility/fixtures/v4.5.0-source-first-capabilities.json", "compatibility/fixtures/v4.4.0-lifecycle-golden.json",
  "acceptance/manifest.schema.json", "acceptance/candidate-binding.schema.json", "acceptance/manifests/v4.5.0-target-revision-15.json",
  "references/simulation-contract.md", "references/evidence-contract.md", "references/failure-recovery.md", "references/security-and-redaction.md",
  "references/source-wave-contract.md", "references/acceptance-decision-replay.md", "references/candidate-acceptance-binding.md", "references/acceptance-fast-path.md",
  "scripts/modular_contracts.mjs", "scripts/test_modular_contracts.mjs", "scripts/generate_workbuddy_runbooks.mjs", "scripts/test_generate_workbuddy_runbooks.mjs", "scripts/project_classification_evidence.mjs",
  "scripts/acceptance_preflight.mjs", "scripts/acceptance_fast_path.mjs", "scripts/test_acceptance_fast_path.mjs",
  "scripts/sync_installed_skill.py", "scripts/test_sync_installed_skill.py"
];
const removedWorkBuddyAutomation = [
  "profiles/workbuddy/profile.md", "references/transport-autopilot.md", "scripts/macos_app_scoped_ui.swift",
  "scripts/transport_autopilot.py", "scripts/test_transport_autopilot.py", "scripts/workbuddy_attachment_driver.py",
  "scripts/test_workbuddy_attachment_driver.py", "acceptance/manifests/v4.5.0-target-revision-8.json",
  "acceptance/manifests/v4.5.0-target-revision-9.json", "acceptance/manifests/v4.5.0-target-revision-10.json"
];

for (const relative of required) assert.ok(fs.statSync(path.join(skillRoot, relative)).isFile(), `missing ${relative}`);
for (const relative of removedWorkBuddyAutomation) assert.ok(!fs.existsSync(path.join(skillRoot, relative)), `obsolete WorkBuddy automation remains: ${relative}`);

const entry = read("SKILL.md");
assert.match(entry, /^---\nname: evopilot-agent-host-production-simulator\n/m);
for (const link of ["core/stable-core-contract.md", "profiles/workbuddy.md", "acceptance/manifests/v4.5.0-target-revision-15.json", "references/simulation-contract.md", "references/evidence-contract.md", "references/source-wave-contract.md", "references/failure-recovery.md", "references/security-and-redaction.md", "references/acceptance-fast-path.md", "references/candidate-acceptance-binding.md"]) {
  assert.match(entry, new RegExp(escapeRegExp(link)), `SKILL.md must route to ${link}`);
}
for (const invariant of ["never Plan confirmation", "Never read, transcribe, paste, store, screenshot, or return API keys", "Do not perform GHCR publication, deployment, GitHub Release, npm publication", "Never report 100% pass", "never performs or observes visible actions", "A failed Source remains visible and blocking", "project_classification_evidence.mjs", "append-only", "repository Skill directory is authoritative", "runner, projection, Skill-drift or Host-transport failure is not a product failure"]) {
  assert.ok(entry.includes(invariant), `missing authority invariant: ${invariant}`);
}

const adapter = JSON.parse(read("profiles/workbuddy/adapter.json"));
assert.equal(adapter.operationMode, "DESIGNATED_HUMAN");
assert.equal(adapter.transport.policyVersion, "human-operated-workbuddy/v1");
assert.equal(adapter.transport.completionPolicyVersion, "designated-human-range-completion/v1");
assert.equal(adapter.transport.codexUiControlAllowed, false);
assert.equal(adapter.transport.codexObservationAllowed, false);
assert.equal(adapter.transport.humanEvidenceExportRequired, false);
assert.equal(adapter.transport.perCaseReportRequired, false);
assert.equal(adapter.transport.automatedQualificationRequired, false);
assert.equal(adapter.transport.automatedTransportReceiptRequired, false);
assert.deepEqual(adapter.drivers, []);
assert.equal(adapter.authority.mayTransportVisibleUi, false);
assert.equal(adapter.authority.mayPrepareRunbook, true);
assert.equal(adapter.authority.mayReviewExportedEvidence, false);
assert.equal(adapter.authority.mayReceiveFinalRangeDeclaration, true);

const workbuddy = read("profiles/workbuddy.md");
for (const invariant of ["human-operated-workbuddy/v1", "designated-human-range-completion/v1", "designated human", "Harness全生命周期数字专家", "Codex and its Skills must not use Computer Use", "RC01～RC05 已完成", "must not request, collect, retain or review WorkBuddy"]) assert.ok(workbuddy.includes(invariant), `WorkBuddy profile missing ${invariant}`);
const simulation = read("references/simulation-contract.md");
for (const invariant of ["WorkBuddy uses `DESIGNATED_HUMAN`", "performs no UI observation or action", "WorkBuddy never requires", "final range declaration", "independent Host may use `REVIEWED_AUTOMATION`"]) assert.ok(simulation.includes(invariant), `simulation contract missing ${invariant}`);
const evidence = read("references/evidence-contract.md");
for (const status of ["PASS", "FAIL", "BLOCKED", "NOT_RUN"]) assert.ok(evidence.includes(status));
for (const invariant of ["sourceCheckoutUsed", "designated-human-range-completion/v1", "do not create a WorkBuddy execution-evidence directory", "RC01～RC05 已完成", "Independent-Host evidence cannot replace"]) assert.ok(evidence.includes(invariant), `evidence contract missing ${invariant}`);
assert.ok(read("references/failure-recovery.md").includes("resolve_interrupted_operation"));
assert.ok(read("references/failure-recovery.md").includes("WorkBuddy has no Codex desktop-control or evidence-export dependency"));
assert.ok(read("references/security-and-redaction.md").includes("untrusted Evidence Sources"));
const sourceWave = read("references/source-wave-contract.md");
for (const invariant of ["SourceDescriptor/v1", "before starting any Target-declared live discovery wave", "Candidate classification or Harness output must be unavailable", "No post-freeze replacement, cherry-picking, implicit refetch or oracle rewrite"]) assert.ok(sourceWave.includes(invariant), `Source wave contract missing ${invariant}`);

const manifest = JSON.parse(read("acceptance/manifests/v4.5.0-target-revision-15.json"));
assert.equal(manifest.schema, "evopilot-real-host-acceptance-manifest/v3");
assert.equal(manifest.target.revision, 15);
assert.equal(manifest.coverage.acceptanceCount, 203);
assert.equal(manifest.coverage.realCaseCount, 5);
assert.equal(manifest.coverage.realCasePortfolioPolicy, "compact-real-case-portfolio/v1");
assert.equal(manifest.coverage.machineVariantCount, 5);
assert.equal(manifest.coverage.liveGitHubCohortSize, 1);
assert.equal(manifest.coverage.liveGitHubCompletionPolicy, "ONE_OF_ONE_MUST_PASS");
assert.equal(Object.hasOwn(manifest, "candidate"), false);
assert.equal(manifest.hostExecutionPolicy.workBuddyCaseIds.length, 5);
assert.deepEqual(manifest.hostExecutionPolicy.discoveryOnlyCaseIds, []);
assert.equal(manifest.hostExecutionPolicy.completionPolicyVersion, "designated-human-range-completion/v1");
assert.equal(manifest.hostExecutionPolicy.workBuddyObservationAllowed, false);
assert.equal(manifest.hostExecutionPolicy.workBuddyExecutionArtifactsRequired, false);
assert.equal(manifest.hostExecutionPolicy.perCaseReportRequired, false);
assert.equal(manifest.hostExecutionPolicy.finalDeclaration, "RC01～RC05 已完成");
assert.equal(manifest.authority.authorizesHostMutation, false);
assert.equal(manifest.authority.authorizesRelease, false);

childProcess.execFileSync(process.execPath, ["--check", path.join(skillRoot, "scripts/generate_workbuddy_runbooks.mjs")], { stdio: "pipe" });
const modularResult = JSON.parse(childProcess.execFileSync(process.execPath, [path.join(skillRoot, "scripts/modular_contracts.mjs")], { encoding: "utf8" }));
assert.equal(modularResult.status, "PASSED", modularResult.errors?.join("\n"));
const modularTests = childProcess.execFileSync(process.execPath, [path.join(skillRoot, "scripts/test_modular_contracts.mjs")], { encoding: "utf8" });
assert.ok(modularTests.includes("PASS"), "modular contract tests did not pass");
const runbookTests = childProcess.execFileSync(process.execPath, [path.join(skillRoot, "scripts/test_generate_workbuddy_runbooks.mjs")], { encoding: "utf8" });
assert.ok(runbookTests.includes("PASS"), "runbook generation tests did not pass");
const fastPathTests = childProcess.execFileSync(process.execPath, [path.join(skillRoot, "scripts/test_acceptance_fast_path.mjs")], { encoding: "utf8" });
assert.ok(fastPathTests.includes("PASS"), "acceptance fast-path tests did not pass");
const syncTests = childProcess.execFileSync("python3", [path.join(skillRoot, "scripts/test_sync_installed_skill.py")], { encoding: "utf8" });
assert.ok(syncTests.includes("PASS"), "installed Skill sync tests did not pass");

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert.ok(!packageJson.files.includes(".agents/skills/evopilot-agent-host-production-simulator"), "simulator must not enter the Harness runtime package");
process.stdout.write(`${JSON.stringify({
  schema: "evopilot-agent-host-production-simulator-skill-validation/v2", status: "PASSED", skillRoot,
  workBuddyOperationMode: adapter.operationMode, workBuddyPolicyVersion: adapter.transport.policyVersion,
  workBuddyCompletionPolicyVersion: adapter.transport.completionPolicyVersion,
  workBuddyUiControlAllowed: false, workBuddyObservationAllowed: false, workBuddyArtifactsRequired: false,
  independentHostAutomationAllowed: manifest.hostExecutionPolicy.independentHostAutomationAllowed,
  workBuddyCaseCount: manifest.hostExecutionPolicy.workBuddyCaseIds.length, packageRuntimeIncluded: false, checkedFiles: required.length,
  coreContractVersion: modularResult.coreContractVersion, compatibilityAdapters: [modularResult.v440AdapterId, modularResult.v450AdapterId],
  targetAcceptanceCount: modularResult.acceptanceCount, targetRealCaseCount: modularResult.realCaseCount
}, null, 2)}\n`);

function read(relative) { return fs.readFileSync(path.join(skillRoot, relative), "utf8"); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
