#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  candidateAcceptanceBindingRunbookDigest,
  digest,
  fileDigest,
  loadDefaultContracts,
  readJson,
  selectCompatibilityAdapter,
  validateCompatibilityAdapter,
  validateDefaultContracts,
  validateHostAdapter,
  validateStableCore,
  validateTargetManifest,
  validateCandidateAcceptanceBinding
} from "./modular_contracts.mjs";

const validated = validateDefaultContracts();
assert.deepEqual(validated.errors, []);
assert.equal(validated.v440Selection.status, "PASS");
assert.equal(validated.v440Selection.adapterId, "agent-operations-v3-base");
assert.equal(validated.v450Selection.status, "PASS");
assert.equal(validated.v450Selection.adapterId, "agent-operations-v3-source-first");

const incompleteSourceFirst = structuredClone(readJson("compatibility/fixtures/v4.5.0-source-first-capabilities.json"));
delete incompleteSourceFirst.classification.sourceDescriptorSchema;
assert.equal(
  selectCompatibilityAdapter(incompleteSourceFirst, validated.adapters, "agent-operations-v3-source-first").reason,
  "REQUIRED_ADAPTER_CAPABILITIES_UNSATISFIED"
);

const unknownProtocol = structuredClone(readJson("compatibility/fixtures/v4.4.0-capabilities.json"));
unknownProtocol.compatibility.agentProtocolVersion = "evopilot-harness-agent-operations/v999";
assert.equal(selectCompatibilityAdapter(unknownProtocol, validated.adapters).reason, "NO_COMPATIBLE_ADAPTER");

const hostWithoutOwnership = structuredClone(validated.hostAdapter);
delete hostWithoutOwnership.authority;
assert.ok(validateHostAdapter(hostWithoutOwnership).some((error) => error.includes("missing authority")));

const humanHostWithDriver = structuredClone(validated.hostAdapter);
humanHostWithDriver.drivers = ["scripts/modular_contracts.mjs"];
assert.ok(validateHostAdapter(humanHostWithDriver).some((error) => error.includes("must not declare UI drivers")));

const humanHostWithCodexControl = structuredClone(validated.hostAdapter);
humanHostWithCodexControl.transport.codexUiControlAllowed = true;
assert.ok(validateHostAdapter(humanHostWithCodexControl).some((error) => error.includes("policy is incomplete")));

const humanHostWithCodexObservation = structuredClone(validated.hostAdapter);
humanHostWithCodexObservation.transport.codexObservationAllowed = true;
assert.ok(validateHostAdapter(humanHostWithCodexObservation).some((error) => error.includes("policy is incomplete")));

const humanHostRequiringEvidence = structuredClone(validated.hostAdapter);
humanHostRequiringEvidence.transport.humanEvidenceExportRequired = true;
assert.ok(validateHostAdapter(humanHostRequiringEvidence).some((error) => error.includes("policy is incomplete")));

const adapterWithoutCapabilities = structuredClone(validated.adapters[0]);
delete adapterWithoutCapabilities.requiredCapabilities;
assert.ok(validateCompatibilityAdapter(adapterWithoutCapabilities).some((error) => error.includes("requiredCapabilities")));

const coreWithHostLeak = structuredClone(validated.core);
coreWithHostLeak.fixtureInvariants.push("WorkBuddy private selector");
assert.ok(validateStableCore(coreWithHostLeak).some((error) => error.includes("Host-private")));

const manifestWithoutDigest = structuredClone(validated.targetManifest);
delete manifestWithoutDigest.target.authorizationDigest;
assert.ok(validateTargetManifest(manifestWithoutDigest).some((error) => error.includes("authorization")));

const manifestWithAuthorityLeak = structuredClone(validated.targetManifest);
manifestWithAuthorityLeak.authority.authorizesRelease = true;
assert.ok(validateTargetManifest(manifestWithAuthorityLeak).some((error) => error.includes("authorizesRelease")));

const manifestWithWorkBuddyAutomation = structuredClone(validated.targetManifest);
manifestWithWorkBuddyAutomation.hostExecutionPolicy.workBuddyUiControlAllowed = true;
assert.ok(validateTargetManifest(manifestWithWorkBuddyAutomation).some((error) => error.includes("workBuddyUiControlAllowed")));

const manifestWithWorkBuddyObservation = structuredClone(validated.targetManifest);
manifestWithWorkBuddyObservation.hostExecutionPolicy.workBuddyObservationAllowed = true;
assert.ok(validateTargetManifest(manifestWithWorkBuddyObservation).some((error) => error.includes("workBuddyObservationAllowed")));

const manifestRequiringPerCaseReports = structuredClone(validated.targetManifest);
manifestRequiringPerCaseReports.hostExecutionPolicy.perCaseReportRequired = true;
assert.ok(validateTargetManifest(manifestRequiringPerCaseReports).some((error) => error.includes("perCaseReportRequired")));

const manifestWithWrongDeclaration = structuredClone(validated.targetManifest);
manifestWithWrongDeclaration.hostExecutionPolicy.finalDeclaration = "RC01 已完成";
assert.ok(validateTargetManifest(manifestWithWrongDeclaration).some((error) => error.includes("final range declaration")));

const manifestWithCandidate = structuredClone(validated.targetManifest);
manifestWithCandidate.candidate = { id: "candidate-10" };
assert.ok(validateTargetManifest(manifestWithCandidate).some((error) => error.includes("must not embed Candidate")));

const candidateNeutralV2 = structuredClone(validated.targetManifest);
candidateNeutralV2.schema = "evopilot-real-host-acceptance-manifest/v2";
candidateNeutralV2.candidate = {
  label: "PRE_RELEASE_CANDIDATE",
  bindingMode: "EXTERNAL_CANDIDATE_BINDING",
  requiredSchema: "evopilot-candidate-acceptance-binding/v1",
  requiredTargetRevision: candidateNeutralV2.target.revision,
  sourceCheckoutUsed: false
};
candidateNeutralV2.authority.authorizesCodexHostMutation = candidateNeutralV2.authority.authorizesHostMutation;
delete candidateNeutralV2.authority.authorizesHostMutation;
assert.deepEqual(validateTargetManifest(candidateNeutralV2), []);
const pinnedCandidateV2 = structuredClone(candidateNeutralV2);
pinnedCandidateV2.candidate.requiredCandidateId = "evopilot-harness-v4.5.0-candidate-12";
assert.ok(validateTargetManifest(pinnedCandidateV2).some((error) => error.includes("must remain Candidate-neutral")));

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-binding-test-"));
try {
  const target = {
    id: validated.targetManifest.target.id,
    revision: validated.targetManifest.target.revision,
    status: validated.targetManifest.target.status,
    approvals: { target: { authorizationDigest: validated.targetManifest.target.authorizationDigest } },
    roadmapBindings: [{ roadmapDigest: validated.targetManifest.target.roadmapDigest }],
    acceptance: Array.from({ length: 203 }, (_, index) => ({ id: `AC${String(index + 1).padStart(3, "0")}` })),
    realCaseCoverage: validated.targetManifest.coverage.realCaseIds.map((id, index) => {
      const offsets = [0, 2, 8, 10, 14, 18];
      return { id, hosts: ["WorkBuddy"], machineVariants: validated.targetManifest.coverage.machineVariantIds.slice(offsets[index], offsets[index + 1]).map((variantId) => ({ id: variantId })) };
    })
  };
  const targetFile = path.join(temporaryRoot, "target.json");
  fs.writeFileSync(targetFile, `${JSON.stringify(target, null, 2)}\n`);
  const manifest = structuredClone(validated.targetManifest);
  manifest.target.fileDigest = fileDigest(targetFile);
  manifest.coverage.sortedAcceptanceIdsDigest = digest(target.acceptance.map((item) => item.id).sort());
  assert.deepEqual(validateTargetManifest(manifest, targetFile, target), []);

  const targetManifestFile = path.join(temporaryRoot, "target-manifest.json");
  fs.writeFileSync(targetManifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(temporaryRoot, "acceptance-plan.json"), "{}\n");
  const binding = {
    schema: "evopilot-candidate-acceptance-binding/v1",
    id: "evopilot-harness-v4.5.0-candidate-13-acceptance-binding",
    target: { id: target.id, revision: target.revision, authorizationDigest: target.approvals.target.authorizationDigest },
    targetManifest: { id: manifest.id, fileDigest: fileDigest(targetManifestFile) },
    candidate: {
      label: "PRE_RELEASE_CANDIDATE",
      id: "evopilot-harness-v4.5.0-candidate-13",
      packageDigest: `sha256:${"1".repeat(64)}`,
      manifestDigest: `sha256:${"2".repeat(64)}`,
      sourceCheckoutUsed: false
    },
    artifacts: [
      { role: "RUNBOOK_SET", path: "runbooks.json", digest: `sha256:${"0".repeat(64)}` },
      { role: "ACCEPTANCE_PLAN", path: "acceptance-plan.json", digest: fileDigest(path.join(temporaryRoot, "acceptance-plan.json")) }
    ],
    continuationPolicy: { mode: "UNTIL_FAILURE_OR_HUMAN_GATE", requiresRepeatedNavigationApproval: false },
    history: { appendOnly: true, supersedesBindingId: "evopilot-harness-v4.5.0-candidate-12-acceptance-binding" },
    authority: {
      authorizesInstallation: false,
      authorizesAcceptance: false,
      authorizesWorkBuddyOperation: false,
      authorizesRepair: false,
      authorizesPublication: false,
      authorizesRelease: false
    }
  };
  const expectedWorkBuddyCases = manifest.hostExecutionPolicy.workBuddyCaseIds;
  const runbookManifest = {
    schema: "evopilot-workbuddy-human-runbook-set/v1",
    targetId: target.id,
    targetRevision: target.revision,
    targetAuthorizationDigest: target.approvals.target.authorizationDigest,
    candidateBindingId: binding.id,
    candidateBindingDigest: candidateAcceptanceBindingRunbookDigest(binding),
    candidateBindingDigestScope: "CANDIDATE_ACCEPTANCE_BINDING_WITHOUT_RUNBOOK_SET_ARTIFACT",
    candidateBindingType: "CANDIDATE_ACCEPTANCE_BINDING",
    candidate: {
      id: binding.candidate.id,
      packageDigest: binding.candidate.packageDigest,
      manifestDigest: binding.candidate.manifestDigest
    },
    runbookCount: expectedWorkBuddyCases.length,
    caseIds: expectedWorkBuddyCases,
    runbooksDigest: `sha256:${"3".repeat(64)}`
  };
  fs.writeFileSync(path.join(temporaryRoot, "runbooks.json"), `${JSON.stringify(runbookManifest, null, 2)}\n`);
  binding.artifacts[0].digest = fileDigest(path.join(temporaryRoot, "runbooks.json"));
  assert.deepEqual(validateCandidateAcceptanceBinding(binding, manifest, targetManifestFile, temporaryRoot), []);
  const candidateBindingFile = path.join(temporaryRoot, "candidate-binding.json");
  fs.writeFileSync(candidateBindingFile, `${JSON.stringify(binding, null, 2)}\n`);
  const preflight = spawnSync(process.execPath, [
    path.join(import.meta.dirname, "acceptance_preflight.mjs"),
    "--target", targetFile,
    "--target-manifest", targetManifestFile,
    "--candidate-binding", candidateBindingFile,
    "--artifact-root", temporaryRoot
  ], { encoding: "utf8" });
  assert.equal(preflight.status, 0, preflight.stderr || preflight.stdout);
  assert.equal(JSON.parse(preflight.stdout).status, "PASS");
  const staleBinding = structuredClone(binding);
  staleBinding.candidate.id = "candidate-14";
  staleBinding.artifacts[0].digest = `sha256:${"f".repeat(64)}`;
  assert.ok(validateCandidateAcceptanceBinding(staleBinding, manifest, targetManifestFile, temporaryRoot).some((error) => error.includes("artifact digest mismatch")));
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write("stable simulator modular contract tests: PASS\n");
