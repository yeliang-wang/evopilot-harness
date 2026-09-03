#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex")}`;
}

export function fileDigest(file) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

export function candidateAcceptanceBindingRunbookDigest(binding) {
  if (binding?.schema !== "evopilot-candidate-acceptance-binding/v1") throw new Error("Candidate Acceptance Binding schema mismatch");
  return digest({
    schema: binding.schema,
    id: binding.id,
    target: binding.target,
    targetManifest: binding.targetManifest,
    candidate: binding.candidate,
    artifacts: (binding.artifacts ?? []).filter((artifact) => artifact?.role !== "RUNBOOK_SET"),
    continuationPolicy: binding.continuationPolicy,
    history: binding.history,
    authority: binding.authority
  });
}

export function readJson(relative, root = SKILL_ROOT) {
  return JSON.parse(fs.readFileSync(path.resolve(root, relative), "utf8"));
}

export function validateStableCore(core) {
  const errors = [];
  if (core?.schema !== "evopilot-agent-host-simulator-core/v1") errors.push("stable Core schema mismatch");
  for (const key of ["states", "transitions", "terminalStates", "verdicts", "authorityInvariants", "fixtureInvariants", "extensionOrder"]) {
    if (!Array.isArray(core?.[key]) || core[key].length === 0) errors.push(`stable Core ${key} must be non-empty`);
  }
  const states = new Set(core?.states ?? []);
  for (const transition of core?.transitions ?? []) {
    if (!Array.isArray(transition) || transition.length !== 2 || !states.has(transition[0]) || !states.has(transition[1])) {
      errors.push(`invalid stable Core transition ${JSON.stringify(transition)}`);
    }
  }
  for (const verdict of ["PASS", "FAIL", "BLOCKED", "NOT_RUN"]) {
    if (!core?.verdicts?.includes(verdict)) errors.push(`stable Core missing verdict ${verdict}`);
  }
  const rendered = JSON.stringify(core);
  for (const [label, pattern] of [
    ["Host-private identity", /WorkBuddy|com\.workbuddy|macOS/i],
    ["Target-private identity", /\bRC\d+\b|targetRevision|acceptanceCount/i],
    ["Source portfolio", /GitHub|sourcePortfolio|discoveryQuery/i],
    ["Harness SemVer routing", /productVersion|expertVersion/i],
    ["control-service signature", /Computer Use|SkyComputerUseService/i]
  ]) {
    if (pattern.test(rendered)) errors.push(`stable Core contains ${label}`);
  }
  return errors;
}

export function validateHostAdapter(adapter, skillRoot = SKILL_ROOT) {
  const errors = [];
  if (adapter?.schema !== "evopilot-agent-host-adapter/v2") errors.push("Host Adapter schema mismatch");
  for (const key of ["id", "hostId", "visibleIdentity", "operationMode", "capabilities", "drivers", "failureBoundary", "protectedState", "authority"]) {
    if (adapter?.[key] === undefined || adapter[key] === null) errors.push(`Host Adapter missing ${key}`);
  }
  if (!Array.isArray(adapter?.capabilities) || adapter.capabilities.length === 0) errors.push("Host Adapter capabilities must be non-empty");
  if (!Array.isArray(adapter?.drivers)) errors.push("Host Adapter drivers must be an array");
  for (const driver of adapter?.drivers ?? []) {
    if (typeof driver !== "string" || !fs.existsSync(path.resolve(skillRoot, driver))) errors.push(`Host Adapter driver missing: ${driver}`);
  }
  if (adapter?.authority?.mayAuthorHarnessSemantics !== false) errors.push("Host Adapter mayAuthorHarnessSemantics must be false");
  for (const key of ["mayApprove", "mayPublish", "mayRelease"]) {
    if (adapter?.authority?.[key] !== false) errors.push(`Host Adapter ${key} must be false`);
  }
  if (adapter?.operationMode === "DESIGNATED_HUMAN") {
    if (adapter.drivers?.length !== 0) errors.push("designated-human Host Adapter must not declare UI drivers");
    if (adapter?.authority?.mayTransportVisibleUi !== false) errors.push("designated-human Host Adapter mayTransportVisibleUi must be false");
    if (adapter?.authority?.mayPrepareRunbook !== true || adapter?.authority?.mayReviewExportedEvidence !== false || adapter?.authority?.mayReceiveFinalRangeDeclaration !== true) errors.push("designated-human Host Adapter must allow only runbook issuance and final range declaration roles");
    if (
      adapter?.transport?.policyVersion !== "human-operated-workbuddy/v1" ||
      adapter?.transport?.completionPolicyVersion !== "designated-human-range-completion/v1" ||
      adapter?.transport?.codexUiControlAllowed !== false ||
      adapter?.transport?.codexObservationAllowed !== false ||
      adapter?.transport?.humanEvidenceExportRequired !== false ||
      adapter?.transport?.perCaseReportRequired !== false ||
      adapter?.transport?.automatedQualificationRequired !== false ||
      adapter?.transport?.automatedTransportReceiptRequired !== false
    ) errors.push("designated-human WorkBuddy policy is incomplete");
  } else if (adapter?.operationMode === "REVIEWED_AUTOMATION") {
    if (!adapter.drivers?.length) errors.push("automated Host Adapter drivers must be non-empty");
  } else {
    errors.push("Host Adapter operationMode is unsupported");
  }
  return errors;
}

export function validateCompatibilityAdapter(adapter) {
  const errors = [];
  if (adapter?.schema !== "evopilot-harness-simulator-compatibility-adapter/v1") errors.push("Compatibility Adapter schema mismatch");
  for (const key of ["id", "priority", "protocol", "requiredCapabilities", "lifecycleStages", "authority"]) {
    if (adapter?.[key] === undefined || adapter[key] === null) errors.push(`Compatibility Adapter missing ${key}`);
  }
  for (const key of ["agentProtocolVersion", "engineApiVersion", "mcpProtocolVersions"]) {
    if (adapter?.protocol?.[key] === undefined) errors.push(`Compatibility Adapter protocol missing ${key}`);
  }
  if (!Array.isArray(adapter?.requiredCapabilities) || adapter.requiredCapabilities.length === 0) {
    errors.push("Compatibility Adapter requiredCapabilities must be non-empty");
  } else {
    for (const requirement of adapter.requiredCapabilities) {
      if (!requirement || typeof requirement.path !== "string" || !("equals" in requirement)) errors.push("Compatibility Adapter capability binding is invalid");
    }
  }
  if (adapter?.authority?.selectionOnly !== true) errors.push("Compatibility Adapter selectionOnly must be true");
  for (const key of ["mayMutateHarness", "mayApprove", "mayPublish"]) {
    if (adapter?.authority?.[key] !== false) errors.push(`Compatibility Adapter ${key} must be false`);
  }
  return errors;
}

export function getPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => current && typeof current === "object" ? current[key] : undefined, value);
}

function allRequirements(adapter, byId, seen = new Set()) {
  if (seen.has(adapter.id)) throw new Error(`Compatibility Adapter inheritance cycle at ${adapter.id}`);
  seen.add(adapter.id);
  const parent = adapter.extends ? byId.get(adapter.extends) : null;
  if (adapter.extends && !parent) throw new Error(`Compatibility Adapter parent missing: ${adapter.extends}`);
  return [...(parent ? allRequirements(parent, byId, seen) : []), ...adapter.requiredCapabilities];
}

function protocolMatches(capabilities, adapter) {
  const compatibility = capabilities?.compatibility ?? {};
  if (compatibility.agentProtocolVersion !== adapter.protocol.agentProtocolVersion) return false;
  if (compatibility.engineApiVersion !== adapter.protocol.engineApiVersion) return false;
  const supported = capabilities?.mcp?.supportedProtocolVersions;
  return Array.isArray(supported) && adapter.protocol.mcpProtocolVersions.some((value) => supported.includes(value));
}

export function selectCompatibilityAdapter(capabilities, adapters, requiredAdapterId = null) {
  const byId = new Map(adapters.map((adapter) => [adapter.id, adapter]));
  for (const adapter of adapters) {
    const errors = validateCompatibilityAdapter(adapter);
    if (errors.length) return { status: "BLOCKED", reason: "INVALID_ADAPTER", errors };
  }
  const ordered = [...adapters].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  const matches = [];
  for (const adapter of ordered) {
    if (!protocolMatches(capabilities, adapter)) continue;
    let requirements;
    try {
      requirements = allRequirements(adapter, byId);
    } catch (error) {
      return { status: "BLOCKED", reason: "INVALID_ADAPTER_INHERITANCE", errors: [String(error.message)] };
    }
    if (requirements.every((requirement) => Object.is(getPath(capabilities, requirement.path), requirement.equals))) matches.push(adapter);
  }
  const selected = requiredAdapterId ? matches.find((adapter) => adapter.id === requiredAdapterId) : matches[0];
  if (!selected) {
    return {
      status: "BLOCKED",
      reason: requiredAdapterId ? "REQUIRED_ADAPTER_CAPABILITIES_UNSATISFIED" : "NO_COMPATIBLE_ADAPTER",
      requiredAdapterId,
      matchedAdapterIds: matches.map((adapter) => adapter.id)
    };
  }
  return {
    status: "PASS",
    adapterId: selected.id,
    protocol: selected.protocol,
    capabilityBindingDigest: digest(capabilities),
    authority: "COMPATIBILITY_SELECTION_ONLY_NO_MUTATION_APPROVAL_OR_PUBLICATION_AUTHORITY"
  };
}

export function validateLifecycleFixture(core, fixture) {
  const errors = [];
  if (fixture?.schema !== "evopilot-agent-host-simulator-lifecycle-fixture/v1") errors.push("lifecycle fixture schema mismatch");
  if (fixture?.claimsFreshRealHostEvidence !== false) errors.push("offline fixture must not claim fresh real-Host evidence");
  const allowed = new Set((core.transitions ?? []).map((transition) => transition.join("->")));
  const states = fixture?.states ?? [];
  for (let index = 1; index < states.length; index += 1) {
    if (!allowed.has(`${states[index - 1]}->${states[index]}`)) errors.push(`lifecycle fixture transition is not allowed: ${states[index - 1]}->${states[index]}`);
  }
  for (const gate of fixture?.humanGates ?? []) {
    if (states[gate.stateIndex] !== "HUMAN_GATE") errors.push(`human gate index ${gate.stateIndex} does not identify HUMAN_GATE`);
    if (gate.exactCurrentObjectRequired !== true) errors.push("human gate must bind the exact current object");
    if (gate.navigationLanguageAccepted !== false) errors.push("navigation language must not satisfy a human gate");
  }
  if (!core?.terminalStates?.includes(states.at(-1))) errors.push("lifecycle fixture does not reach a stable terminal state");
  if (!core?.verdicts?.includes(fixture?.terminalVerdict)) errors.push("lifecycle fixture terminal verdict is invalid");
  return errors;
}

export function validateTargetManifest(manifest, targetFile = null, target = null) {
  const errors = [];
  const isCurrent = manifest?.schema === "evopilot-real-host-acceptance-manifest/v3";
  const isCandidateNeutralV2 = manifest?.schema === "evopilot-real-host-acceptance-manifest/v2";
  if (!isCurrent && !isCandidateNeutralV2) errors.push("Target Acceptance Manifest schema mismatch");
  for (const key of ["id", "target", "requiredExtensions", "coverage", "hostExecutionPolicy", "executionOrder", "prohibitedEffects", "authority"]) {
    if (manifest?.[key] === undefined || manifest[key] === null) errors.push(`Target Acceptance Manifest missing ${key}`);
  }
  if (isCurrent && Object.hasOwn(manifest ?? {}, "candidate")) errors.push("Target Acceptance Manifest must not embed Candidate identity");
  if (isCandidateNeutralV2) {
    const candidate = manifest?.candidate;
    if (
      candidate?.bindingMode !== "EXTERNAL_CANDIDATE_BINDING" ||
      candidate?.requiredSchema !== "evopilot-candidate-acceptance-binding/v1" ||
      candidate?.requiredTargetRevision !== manifest?.target?.revision ||
      candidate?.sourceCheckoutUsed !== false ||
      Object.hasOwn(candidate ?? {}, "requiredCandidateId") ||
      Object.hasOwn(candidate ?? {}, "requiredCandidateDigest")
    ) errors.push("legacy Target Acceptance Manifest must remain Candidate-neutral");
  }
  if (typeof manifest?.target?.id !== "string" || !Number.isInteger(manifest?.target?.revision) || manifest?.target?.status !== "APPROVED") errors.push("Target identity or status binding is invalid");
  for (const key of ["fileDigest", "authorizationDigest", "roadmapDigest"]) {
    if (!/^sha256:[a-f0-9]{64}$/.test(manifest?.target?.[key] ?? "")) errors.push(`Target ${key} is invalid`);
  }
  if (manifest?.coverage?.mode !== "ALL_TARGET_ACCEPTANCE_IDS") errors.push("Target acceptance coverage mode must be complete");
  if (!Number.isInteger(manifest?.coverage?.acceptanceCount) || manifest.coverage.acceptanceCount < 1) errors.push("Target acceptance count must be positive");
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest?.coverage?.sortedAcceptanceIdsDigest ?? "")) errors.push("Target acceptance id digest is invalid");
  if (!Array.isArray(manifest?.coverage?.realCaseIds) || manifest.coverage.realCaseIds.length !== manifest?.coverage?.realCaseCount) errors.push("Target real-case count mismatch");
  const policy = manifest?.hostExecutionPolicy;
  if (policy?.policyVersion !== "human-operated-workbuddy/v1" || policy?.completionPolicyVersion !== "designated-human-range-completion/v1" || policy?.workBuddyOperator !== "DESIGNATED_HUMAN" || policy?.codexRole !== "RUNBOOK_ISSUANCE_AND_FINAL_DECLARATION_ONLY") errors.push("WorkBuddy execution policy identity mismatch");
  for (const key of ["workBuddyUiControlAllowed", "workBuddyObservationAllowed", "workBuddyExecutionArtifactsRequired", "perCaseReportRequired", "automatedWorkBuddyQualificationRequired", "automatedWorkBuddyTransportReceiptRequired"]) {
    if (policy?.[key] !== false) errors.push(`WorkBuddy execution policy ${key} must be false`);
  }
  const realCaseIds = Array.isArray(manifest?.coverage?.realCaseIds) ? manifest.coverage.realCaseIds : [];
  const expectedDeclaration = realCaseIds.length ? `${realCaseIds[0]}～${realCaseIds.at(-1)} 已完成` : null;
  if (policy?.finalDeclaration !== expectedDeclaration) errors.push("WorkBuddy final range declaration mismatch");
  if (canonical(policy?.acceptedRangeSeparators ?? []) !== canonical(["～", "~"])) errors.push("WorkBuddy accepted range separators mismatch");
  if (policy?.beforeDeclaration !== "PENDING" || policy?.afterDeclaration !== "PASSED") errors.push("WorkBuddy declaration transition mismatch");
  if (policy?.independentHostAutomationAllowed !== true) errors.push("independent Host automation must remain allowed");
  if (!Array.isArray(policy?.workBuddyCaseIds) || !policy.workBuddyCaseIds.every((id) => manifest?.coverage?.realCaseIds?.includes(id))) errors.push("WorkBuddy case binding mismatch");
  const compactPortfolio = manifest?.coverage?.realCasePortfolioPolicy === "compact-real-case-portfolio/v1";
  const expectedDiscoveryOnlyCases = compactPortfolio ? [] : ["RC16"];
  if (canonical(policy?.discoveryOnlyCaseIds ?? []) !== canonical(expectedDiscoveryOnlyCases)) errors.push("discovery-only case binding mismatch");
  if (compactPortfolio) {
    if (canonical(realCaseIds) !== canonical(["RC01", "RC02", "RC03", "RC04", "RC05"])) errors.push("compact real-case portfolio must be exactly RC01-RC05");
    if (!Number.isInteger(manifest?.coverage?.machineVariantCount) || manifest.coverage.machineVariantCount < 1 || !Array.isArray(manifest?.coverage?.machineVariantIds) || manifest.coverage.machineVariantIds.length !== manifest.coverage.machineVariantCount) errors.push("compact machine-variant matrix mismatch");
    if (canonical(policy?.workBuddyCaseIds ?? []) !== canonical(realCaseIds)) errors.push("compact WorkBuddy case binding mismatch");
  }
  const mutationAuthorityKey = isCandidateNeutralV2 ? "authorizesCodexHostMutation" : "authorizesHostMutation";
  for (const key of [mutationAuthorityKey, "authorizesHumanDecision", "authorizesPublication", "authorizesRelease"]) {
    if (manifest?.authority?.[key] !== false) errors.push(`Target Acceptance Manifest ${key} must be false`);
  }
  if ((targetFile === null) !== (target === null)) errors.push("Target file and parsed Target must be supplied together");
  if (targetFile && target) {
    if (manifest?.target?.id !== target?.id || manifest?.target?.revision !== target?.revision || manifest?.target?.status !== target?.status) errors.push("Target identity or status binding mismatch");
    if (manifest?.target?.fileDigest !== fileDigest(targetFile)) errors.push("Target file digest mismatch");
    if (manifest?.target?.authorizationDigest !== target?.approvals?.target?.authorizationDigest) errors.push("Target authorization digest mismatch");
    if (manifest?.target?.roadmapDigest !== target?.roadmapBindings?.[0]?.roadmapDigest) errors.push("Target Roadmap digest mismatch");
    const acceptanceIds = (target?.acceptance ?? []).map((item) => item.id);
    if (manifest?.coverage?.acceptanceCount !== acceptanceIds.length) errors.push("Target acceptance count mismatch");
    if (manifest?.coverage?.sortedAcceptanceIdsDigest !== digest([...acceptanceIds].sort())) errors.push("Target acceptance id digest mismatch");
    const targetRealCaseIds = (target?.realCaseCoverage ?? []).map((item) => item.id);
    if (manifest?.coverage?.realCaseCount !== targetRealCaseIds.length || canonical(manifest?.coverage?.realCaseIds ?? []) !== canonical(targetRealCaseIds)) errors.push("Target real-case ids mismatch");
    const targetWorkBuddyCases = (target?.realCaseCoverage ?? []).filter((item) => (item.hosts ?? []).some((host) => /WorkBuddy/i.test(host))).map((item) => item.id);
    if (canonical(policy?.workBuddyCaseIds ?? []) !== canonical(targetWorkBuddyCases)) errors.push("WorkBuddy case binding mismatch");
    if (compactPortfolio) {
      const targetMachineVariantIds = (target?.realCaseCoverage ?? []).flatMap((item) => (item.machineVariants ?? []).map((variant) => variant.id));
      if (manifest?.coverage?.machineVariantCount !== targetMachineVariantIds.length || canonical(manifest?.coverage?.machineVariantIds ?? []) !== canonical(targetMachineVariantIds)) errors.push("Target machine-variant ids mismatch");
    }
  }
  return errors;
}

export function validateCandidateAcceptanceBinding(binding, targetManifest, targetManifestFile, artifactRoot = null) {
  const errors = [];
  if (binding?.schema !== "evopilot-candidate-acceptance-binding/v1") errors.push("Candidate Acceptance Binding schema mismatch");
  for (const key of ["id", "target", "targetManifest", "candidate", "artifacts", "continuationPolicy", "history", "authority"]) {
    if (binding?.[key] === undefined || binding[key] === null) errors.push(`Candidate Acceptance Binding missing ${key}`);
  }
  if (binding?.target?.id !== targetManifest?.target?.id || binding?.target?.revision !== targetManifest?.target?.revision) errors.push("Candidate binding Target mismatch");
  if (binding?.targetManifest?.id !== targetManifest?.id || !targetManifestFile || binding?.targetManifest?.fileDigest !== fileDigest(targetManifestFile)) errors.push("Candidate binding Target manifest mismatch");
  if (binding?.candidate?.label !== "PRE_RELEASE_CANDIDATE" || !/(?:^|-)candidate-[1-9]\d*$/.test(binding?.candidate?.id ?? "")) errors.push("Candidate identity is invalid");
  if (!/^sha256:[a-f0-9]{64}$/.test(binding?.candidate?.packageDigest ?? "") || !/^sha256:[a-f0-9]{64}$/.test(binding?.candidate?.manifestDigest ?? "")) errors.push("Candidate digest binding is incomplete");
  if (binding?.candidate?.sourceCheckoutUsed !== false) errors.push("Candidate runtime must not use a source checkout");
  if (!Array.isArray(binding?.artifacts) || binding.artifacts.length < 2) errors.push("Candidate binding must contain exact runbook and acceptance-plan artifacts");
  const roles = new Set();
  for (const artifact of binding?.artifacts ?? []) {
    if (!artifact || typeof artifact.role !== "string" || typeof artifact.path !== "string" || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? "")) {
      errors.push("Candidate binding artifact is invalid");
      continue;
    }
    if (roles.has(artifact.role)) errors.push(`Candidate binding artifact role is duplicated: ${artifact.role}`);
    roles.add(artifact.role);
    if (artifactRoot) {
      const resolved = path.resolve(artifactRoot, artifact.path);
      if (!fs.existsSync(resolved)) errors.push(`Candidate binding artifact is missing: ${artifact.path}`);
      else if (fileDigest(resolved) !== artifact.digest) errors.push(`Candidate binding artifact digest mismatch: ${artifact.path}`);
    }
  }
  for (const role of ["RUNBOOK_SET", "ACCEPTANCE_PLAN"]) if (!roles.has(role)) errors.push(`Candidate binding artifact role is required: ${role}`);
  const runbookArtifact = (binding?.artifacts ?? []).find((artifact) => artifact?.role === "RUNBOOK_SET");
  if (artifactRoot && runbookArtifact?.path) {
    const runbookFile = path.resolve(artifactRoot, runbookArtifact.path);
    if (fs.existsSync(runbookFile)) {
      let runbooks;
      try {
        runbooks = JSON.parse(fs.readFileSync(runbookFile, "utf8"));
      } catch {
        errors.push("Candidate binding runbook manifest is invalid JSON");
      }
      if (runbooks) {
        const expectedCases = targetManifest?.hostExecutionPolicy?.workBuddyCaseIds ?? [];
        if (runbooks.schema !== "evopilot-workbuddy-human-runbook-set/v1") errors.push("Candidate binding runbook manifest schema mismatch");
        if (runbooks.candidateBindingType !== "CANDIDATE_ACCEPTANCE_BINDING") errors.push("Runbook manifest must bind the Candidate Acceptance Binding");
        if (runbooks.candidateBindingId !== binding.id) errors.push("Runbook manifest Candidate Acceptance Binding id mismatch");
        if (runbooks.candidateBindingDigestScope !== "CANDIDATE_ACCEPTANCE_BINDING_WITHOUT_RUNBOOK_SET_ARTIFACT") errors.push("Runbook manifest Candidate Acceptance Binding digest scope mismatch");
        if (runbooks.candidateBindingDigest !== candidateAcceptanceBindingRunbookDigest(binding)) errors.push("Runbook manifest Candidate Acceptance Binding digest mismatch");
        if (runbooks.targetId !== binding?.target?.id || runbooks.targetRevision !== binding?.target?.revision || runbooks.targetAuthorizationDigest !== binding?.target?.authorizationDigest) errors.push("Runbook manifest Target binding mismatch");
        if (runbooks.candidate?.id !== binding?.candidate?.id || runbooks.candidate?.packageDigest !== binding?.candidate?.packageDigest || runbooks.candidate?.manifestDigest !== binding?.candidate?.manifestDigest) errors.push("Runbook manifest Candidate identity mismatch");
        if (canonical(runbooks.caseIds ?? []) !== canonical(expectedCases) || runbooks.runbookCount !== expectedCases.length) errors.push("Runbook manifest WorkBuddy case binding mismatch");
        if (!/^sha256:[a-f0-9]{64}$/.test(runbooks.runbooksDigest ?? "")) errors.push("Runbook manifest runbooks digest is invalid");
      }
    }
  }
  if (binding?.continuationPolicy?.mode !== "UNTIL_FAILURE_OR_HUMAN_GATE" || binding?.continuationPolicy?.requiresRepeatedNavigationApproval !== false) errors.push("Candidate continuation policy is invalid");
  if (binding?.history?.appendOnly !== true) errors.push("Candidate binding history must be append-only");
  for (const key of ["authorizesInstallation", "authorizesAcceptance", "authorizesWorkBuddyOperation", "authorizesRepair", "authorizesPublication", "authorizesRelease"]) {
    if (binding?.authority?.[key] !== false) errors.push(`Candidate Acceptance Binding ${key} must be false`);
  }
  return errors;
}

export function loadDefaultContracts() {
  const core = readJson("core/stable-core.json");
  const hostAdapter = readJson("profiles/workbuddy/adapter.json");
  const adapters = [
    readJson("compatibility/adapters/agent-operations-v3-base.json"),
    readJson("compatibility/adapters/agent-operations-v3-source-first.json")
  ];
  const targetManifests = fs.readdirSync(path.resolve(SKILL_ROOT, "acceptance/manifests"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(`acceptance/manifests/${name}`))
    .sort((left, right) => left.target.revision - right.target.revision);
  const targetManifest = targetManifests.at(-1);
  return { core, hostAdapter, adapters, targetManifests, targetManifest };
}

export function validateDefaultContracts() {
  const values = loadDefaultContracts();
  const v440 = readJson("compatibility/fixtures/v4.4.0-capabilities.json");
  const v450 = readJson("compatibility/fixtures/v4.5.0-source-first-capabilities.json");
  const lifecycle = readJson("compatibility/fixtures/v4.4.0-lifecycle-golden.json");
  const errors = [
    ...validateStableCore(values.core),
    ...validateHostAdapter(values.hostAdapter),
    ...values.adapters.flatMap(validateCompatibilityAdapter),
    ...validateLifecycleFixture(values.core, lifecycle),
    ...values.targetManifests.flatMap((manifest) => validateTargetManifest(manifest))
  ];
  const v440Selection = selectCompatibilityAdapter(v440, values.adapters, "agent-operations-v3-base");
  const v450Selection = selectCompatibilityAdapter(v450, values.adapters, "agent-operations-v3-source-first");
  if (v440Selection.status !== "PASS") errors.push(`historical base fixture did not select base adapter: ${v440Selection.reason}`);
  if (v450Selection.status !== "PASS") errors.push(`source-first fixture did not select source-first adapter: ${v450Selection.reason}`);
  return { ...values, v440Selection, v450Selection, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateDefaultContracts();
  process.stdout.write(`${JSON.stringify({
    schema: "evopilot-agent-host-simulator-modular-validation/v1",
    status: result.errors.length ? "FAILED" : "PASSED",
    errors: result.errors,
    coreContractVersion: result.core.contractVersion,
    hostAdapterId: result.hostAdapter.id,
    v440AdapterId: result.v440Selection.adapterId ?? null,
    v450AdapterId: result.v450Selection.adapterId ?? null,
    targetId: result.targetManifest.target.id,
    acceptanceCount: result.targetManifest.coverage.acceptanceCount,
    realCaseCount: result.targetManifest.coverage.realCaseCount,
    authority: "VALIDATION_ONLY_NO_IMPLEMENTATION_ACCEPTANCE_OR_RELEASE_AUTHORITY"
  }, null, 2)}\n`);
  process.exit(result.errors.length ? 1 : 0);
}
