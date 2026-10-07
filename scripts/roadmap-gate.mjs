import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const contractPath = process.env.EVOPILOT_ROADMAP_CONTRACT
  ? path.resolve(process.env.EVOPILOT_ROADMAP_CONTRACT)
  : path.join(root, "governance/roadmap.yaml");
const args = process.argv.slice(2);
const json = args.includes("--json");
const intent = option("--intent");
const releaseVersion = option("--release-version");

let roadmap;
try {
  roadmap = JSON.parse(fs.readFileSync(contractPath, "utf8"));
} catch (error) {
  fail(`Roadmap contract is not valid JSON-compatible YAML: ${error.message}`);
}

const errors = validateRoadmap(roadmap);
const hostPolicy = roadmap.releaseHostCoveragePolicy;
const expectedHostPolicy = {"schema":"evopilot-release-host-scope/v1","versions":{"evopilot-harness":"4.8.1","evopilot-runtime":"6.3.0","evopilot-evolution-expert":"2.3.0"},"requiredHosts":["Codex"],"otherHostLiveAcceptanceRequired":false,"crossHostAcceptanceClaimAllowed":false,"generatedAdapterContractsRetained":true,"genericMcpAndHeadlessTransportTestsRetained":true,"exactCodexVersionAndQualificationRequired":true,"activeSoakSeconds":5400,"historicalPassTransferAllowed":false};
if (JSON.stringify(hostPolicy) !== JSON.stringify(expectedHostPolicy)) errors.push("exact Codex-only release Host policy required");
const expectedDurationException = {"schema":"evopilot-release-duration-exception/v1","versions":{"evopilot-harness":"4.8.1","evopilot-runtime":"6.3.0","evopilot-evolution-expert":"2.3.0"},"newActiveSoakRequired":false,"omittedDurationSeconds":5400,"omittedResult":"SKIPPED_BY_USER_NOT_PASS","existingEvidenceImmutable":true,"historicalPassTransferAllowed":false,"remainingFunctionalSecurityHostRegressionAndTerminalE2ERequired":true,"releaseAuthorizationGranted":false,"precedence":"For these exact releases only, this exception supersedes every requirement to execute a new 5400-second/90-minute soak, including inherited and series-terminal clauses. Original evidence remains bound to its original artifacts; no long-duration stability claim applies to untested successor bytes. All other required acceptance remains mandatory."};
if (JSON.stringify(roadmap.releaseDurationExceptionPolicy) !== JSON.stringify(expectedDurationException)) errors.push("exact user-directed release duration exception required; no other acceptance waiver");

if (errors.length > 0) emit({ schema: "evopilot-roadmap-gate-result/v1", project: roadmap?.project, classification: "INVALID", approvalRequired: true, errors, nextAction: "repair-roadmap-contract" }, 1);

if (releaseVersion) {
  const normalized = releaseVersion.replace(/^v/, "");
  const release = classifyRelease(normalized, roadmap);
  emit(baseResult(release.classification, {
    intent: `release ${normalized}`,
    matchedMilestones: release.matchedMilestones,
    reasons: release.reasons,
    approvalRequired: release.classification !== "ALIGNED",
    nextAction: release.classification === "ALIGNED" ? "continue-release-validation" : "revise-roadmap-before-release"
  }), release.classification === "ALIGNED" ? 0 : 2);
}

if (intent != null) {
  const result = classifyIntent(intent, roadmap);
  emit(baseResult(result.classification, result), result.classification === "ALIGNED" ? 0 : 2);
}

emit(baseResult("ALIGNED", {
  intent: "static-roadmap-contract-validation",
  matchedMilestones: [],
  matchedStandingWork: [],
  reasons: ["Roadmap schema, repository integration, and version declarations are valid."],
  approvalRequired: false,
  nextAction: "run-intent-gate-before-product-work"
}), 0);

function validateRoadmap(value) {
  const failures = [];
  required(value?.schema === "evopilot-series-roadmap/v1", "schema must be evopilot-series-roadmap/v1");
  required(value?.roadmapFamily === "evopilot-series-agentic-evolution", "roadmapFamily is invalid");
  required(typeof value?.contractVersion === "string", "contractVersion is required");
  required(value?.project === "evopilot-harness", "project must be evopilot-harness");
  required(Array.isArray(value?.ownership?.owns) && value.ownership.owns.length > 0, "ownership.owns is required");
  required(Array.isArray(value?.ownership?.mustNotOwn) && value.ownership.mustNotOwn.length > 0, "ownership.mustNotOwn is required");
  required(semver(value?.versionPolicy?.publishedBaseline), "publishedBaseline must be SemVer");
  required(semver(value?.versionPolicy?.currentWorkingVersion), "currentWorkingVersion must be SemVer");
  required(value?.versionPolicy?.publishedBaseline === "4.8.2" && value?.versionPolicy?.currentWorkingVersion === "4.8.3", "Harness Roadmap must preserve public 4.8.2 and bind current 4.8.3");
  required(Array.isArray(value?.milestones) && value.milestones.length > 0, "milestones are required");
  const ids = new Set();
  for (const milestone of value?.milestones ?? []) {
    required(typeof milestone.id === "string" && !ids.has(milestone.id), `milestone id must be unique: ${milestone.id}`);
    ids.add(milestone.id);
    required(["IN_PROGRESS", "PLANNED", "COMPLETE"].includes(milestone.status), `invalid milestone status: ${milestone.id}`);
    required(semver(milestone.targetVersion), `targetVersion must be SemVer: ${milestone.id}`);
    required(/^\d+\.\d+\.x$/.test(milestone.releaseLine), `releaseLine must be major.minor.x: ${milestone.id}`);
    required(Array.isArray(milestone.signals) && milestone.signals.length > 0, `signals are required: ${milestone.id}`);
    required(Array.isArray(milestone.acceptance) && milestone.acceptance.length > 0, `acceptance is required: ${milestone.id}`);
  }
  for (const [id, version] of [["evopilot-harness-4.6-professional-source-to-harness-reasoning", "4.6.0"], ["evopilot-harness-4.7-governed-professional-pack-ecosystem", "4.7.0"], ["evopilot-harness-4.8-scalable-semantic-interoperability", "4.8.0"]]) {
    const milestone = value?.milestones?.find((item) => item.id === id);
    required(milestone?.targetVersion === version && milestone?.status === "PLANNED", `${id} must remain the PLANNED ${version} milestone`);
  }
  const convergence = value?.seriesConvergenceParticipation;
  required(convergence?.schema === "evopilot-series-semantic-design-convergence-participation/v1", "series convergence participation schema is invalid");
  required(convergence?.convergenceContractRef === "evopilot-series-semantic-design-convergence", "series convergence participation must reference the central convergence contract");
  required(convergence?.owningRepository === "evopilot-harness" && convergence?.role === "IMMUTABLE_SEMANTIC_AND_HARNESS_ASSET_PRODUCER", "series convergence must preserve the Harness producer role");
  required(arrayEquals(convergence?.requiredVersionSequence, ["4.6.0", "4.7.0", "4.8.0", "4.8.1"]) && convergence?.terminalVersion === "4.8.1", "series convergence must preserve the Harness 4.6.0 to terminal 4.8.1 sequence");
  for (const requirement of ["one independently approved Evolution Target bound to the current evopilot-harness Roadmap digest", "all current and inherited acceptance", "real end-to-end coverage for that exact Harness version", "impact closure and NO_REGRESSION", "exact Candidate, package, published asset, dependency, and evidence digests"]) {
    required(convergence?.everyVersionRequires?.includes(requirement), `series convergence is missing per-version Harness requirement: ${requirement}`);
  }
  required(Array.isArray(convergence?.terminalContribution) && convergence.terminalContribution.length === 3, "series convergence must preserve the exact Harness terminal contribution");
  required(convergence?.terminalE2EGrantsHarnessApprovalPublicationOrReleaseAuthority === false && convergence?.individualHarnessReleaseAuthorityRemainsIndependent === true, "terminal convergence E2E must not grant or merge Harness authority");
  required(value?.seriesConvergenceParticipation?.convergenceContractRevision === 3, "Harness must reference central convergence revision 3");
  const supplyMilestone = value?.milestones?.find((item) => item.id === "evopilot-harness-4.8.1-semantic-catalog-supply-repair");
  required(supplyMilestone?.targetVersion === "4.8.1" && supplyMilestone?.status === "PLANNED" && supplyMilestone?.acceptance?.length === 12, "semantic supply repair milestone must retain seven supply obligations, Source protection, two lifecycle guidance repairs professional draft-boundary consistency and primary-source role support");
  required(supplyMilestone?.acceptance?.some((item) => item.startsWith("Source content boundary excludes protected Host, model and credential paths before")), "approved Source content boundary acceptance must remain declared");
  required(supplyMilestone?.acceptance?.some((item) => item.startsWith("A BLOCKER_PRESENTATION declares only REVIEW_REMEDIATION and PRESERVE_FOR_LATER.")), "read-only BLOCKER guidance acceptance must remain declared");
  required(supplyMilestone?.acceptance?.some((item) => item.startsWith("At semantic Proposal Review time, present the existing lifecycle stage and deterministic Evaluation sufficiency rationale")), "semantic Review Evaluation-stage acceptance must remain declared");
  required(supplyMilestone?.acceptance?.some((item) => item.startsWith("During EVOLVE_EXISTING draft generation, only the same Source-relative professional evidence view")), "professional draft-boundary acceptance must remain declared");
  required(supplyMilestone?.acceptance?.some((item) => item.startsWith("Primary Source lexical occurrences are candidate evidence")), "primary-source professional concept support acceptance must remain declared");
  required(value.sourceContentBoundaryPolicy?.identifier === "evopilot-harness-source-content-boundary/v1" && value.sourceContentBoundaryPolicy?.status === "APPROVED", "Source content boundary must bind the approved finite path policy");
  const supply = value?.semanticCatalogSupplyPolicy;
  required(supply?.schema === "evopilot-semantic-catalog-supply-policy/v1", "semantic Catalog supply invariant: schema");
  required(supply?.contract === "semantic-catalog-supply/v1", "semantic Catalog supply invariant: contract");
  required(supply?.producerVersion === "4.8.1", "semantic Catalog supply invariant: producerVersion");
  required(supply?.runtimeVersion === "6.3.0", "semantic Catalog supply invariant: runtimeVersion");
  required(supply?.expertVersion === "2.3.0", "semantic Catalog supply invariant: expertVersion");
  required(supply?.catalogMode === "ADDITIVE_SEPARATE_SEMANTIC_INDEX", "semantic Catalog supply invariant: catalogMode");
  required(supply?.registryContainsAssets === false, "semantic Catalog supply invariant: registryContainsAssets");
  required(supply?.legacyCatalogBytesPreserved === true, "semantic Catalog supply invariant: legacyCatalogBytesPreserved");
  required(supply?.existingSemanticAssetSchemasPreserved === true, "semantic Catalog supply invariant: existingSemanticAssetSchemasPreserved");
  required(supply?.standalonePublicationImpliesDiscovery === false, "semantic Catalog supply invariant: standalonePublicationImpliesDiscovery");
  required(supply?.completeClosureRequired === true, "semantic Catalog supply invariant: completeClosureRequired");
  required(supply?.independentPublicationRequired === true, "semantic Catalog supply invariant: independentPublicationRequired");
  required(supply?.consumerReadOnly === true, "semantic Catalog supply invariant: consumerReadOnly");
  required(supply?.atomicPublicationRequired === true, "semantic Catalog supply invariant: atomicPublicationRequired");
  required(supply?.mandatorySigning === false, "semantic Catalog supply invariant: mandatorySigning");
  required(supply?.unindexedFallbackAllowed === false, "semantic Catalog supply invariant: unindexedFallbackAllowed");
  required(supply?.automaticApprovalOrPassTransfer === false, "semantic Catalog supply invariant: automaticApprovalOrPassTransfer");
  required(supply?.perVersionE2ERequired === true, "semantic Catalog supply invariant: perVersionE2ERequired");
  required(supply?.terminalE2ERequired === true, "semantic Catalog supply invariant: terminalE2ERequired");
  const repair = value?.readinessProfileBindingRepairPolicy;
  for (const [key, expected] of Object.entries({
    schema: "evopilot-harness-readiness-profile-repair/v1", id: "harness-readiness-profile-483-20261007",
    targetVersion: "4.8.3", baselineVersion: "4.8.2", selectedProfileIdentityRequired: true,
    defaultSelectionSemanticsPreserved: true, unknownSelectorFallbackAllowed: false,
    manualConfigurationReadOnly: true, secretSafeReceiptsRequired: true,
    all313DefinitionsPreserved: true, historicalPassTransferAllowed: false,
    managedModeM0Granted: false, managedModeProductImplementationIncluded: false,
    publicOwnerContractsPreserved: true, newActiveSoakRequired: false,
    releaseAuthorization: "NOT_AUTHORIZED", separateExactCandidateReleaseDecisionRequired: true
  })) required(repair?.[key] === expected, `readiness profile repair invariant: ${key}`);
  required(arrayEquals(repair?.requiredCurrentHosts, ["Codex"]), "readiness profile repair invariant: current Codex-only Host scope");
  required(arrayEquals(repair?.nativeSourceWritablePaths, ["src/v3/model-readiness.mjs", "src/v3/cli.mjs", "tests/v4.2.3-llm-initialization.test.mjs"]), "readiness profile repair invariant: finite native source scope");
  for (const [pathKey, digestKey] of [["authorityRecord", "authorityRecordDigest"], ["defectEvidence", "defectEvidenceDigest"], ["baselinePublication", "baselinePublicationDigest"]]) {
    const relative = repair?.[pathKey];
    const safe = typeof relative === "string" && !path.isAbsolute(relative) && !relative.split(/[\\/]/).includes("..");
    const file = safe ? path.join(root, relative) : null;
    let actual = null;
    try { if (file) actual = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`; } catch { /* missing evidence is not a valid binding */ }
    required(actual !== null && actual === repair?.[digestKey], `readiness profile repair invariant: ${pathKey} digest`);
  }
  const repairMilestone = value?.milestones?.find(item => item.id === "evopilot-harness-4.8.3-model-readiness-profile-binding");
  required(repairMilestone?.targetVersion === "4.8.3" && repairMilestone?.acceptance?.length === 6, "readiness profile repair invariant: finite milestone");
  const packageVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const knownVersions = new Set([value?.versionPolicy?.publishedBaseline, value?.versionPolicy?.currentWorkingVersion, ...(value?.milestones ?? []).map((item) => item.targetVersion)]);
  const declaredReleaseVersion = (value?.milestones ?? []).some((item) => inReleaseLine(packageVersion, item.releaseLine));
  required(knownVersions.has(packageVersion) || declaredReleaseVersion, `package version ${packageVersion} is not declared by the Roadmap`);
  required(fs.existsSync(path.join(root, "docs/roadmap/ROADMAP.md")), "docs/roadmap/ROADMAP.md is missing");
  const roadmapDocument = fs.readFileSync(path.join(root, "docs/roadmap/ROADMAP.md"), "utf8");
  required(roadmapDocument.includes("## EvoPilot-Series Final Semantic Design Convergence Participation"), "human Roadmap is missing the final semantic design convergence participation");
  const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  required(agents.includes("Roadmap Gate"), "AGENTS.md must require the Roadmap Gate");
  const packageJson = fs.readFileSync(path.join(root, "package.json"), "utf8");
  required(packageJson.includes('"roadmap:check"'), "package.json must expose roadmap:check");
  required(packageJson.includes('"roadmap:gate"'), "package.json must expose roadmap:gate");
  required(packageJson.includes('"roadmap:release"'), "package.json must expose roadmap:release");
  return failures;

  function required(condition, message) {
    if (!condition) failures.push(message);
  }
}

function classifyIntent(rawIntent, value) {
  const normalized = normalize(rawIntent);
  if (!normalized) return decision("UNKNOWN", [], [], ["Intent is empty or not classifiable."], "NONE");
  const boundaryMatches = (value.boundaryRules ?? []).filter((rule) => matches(normalized, rule.signals));
  if (boundaryMatches.length > 0) return decision("BOUNDARY_CHANGE", [], [], boundaryMatches.map((rule) => `${rule.id}: ${rule.reason}`), "REPLACEMENT_ADR_REQUIRED");
  if (matches(normalized, value.deviationSignals ?? [])) return decision("DEVIATION", [], [], ["Intent explicitly changes the accepted Roadmap, milestone order, or product boundary."], "ROADMAP_REVISION_REQUIRED");
  const matchedMilestones = value.milestones.filter((milestone) => matches(normalized, milestone.signals)).map((milestone) => milestone.id);
  const matchedStandingItems = value.standingWork.filter((item) => matches(normalized, item.signals));
  const capabilityExpansion = matches(normalized, value.intentPolicy?.capabilityExpansionSignals ?? []);
  const alignedStandingItems = matchedStandingItems.filter((item) => !capabilityExpansion || item.allowsCapabilityExpansion === true);
  const matchedStandingWork = matchedStandingItems.map((item) => item.id);
  if (matchedMilestones.length > 0 || alignedStandingItems.length > 0) return decision("ALIGNED", matchedMilestones, alignedStandingItems.map((item) => item.id), ["Intent matches declared Roadmap work."], "NONE");
  if (matchedStandingWork.length > 0 && capabilityExpansion) return decision("UNPLANNED", [], matchedStandingWork, ["Standing-work wording cannot authorize a product capability expansion."], "USER_REVIEW_REQUIRED");
  return decision("UNPLANNED", [], [], ["Intent does not match a declared milestone or standing maintenance class."], "USER_REVIEW_REQUIRED");
}

function classifyRelease(version, value) {
  if (!semver(version)) return { classification: "UNKNOWN", matchedMilestones: [], reasons: [`Release version is not SemVer: ${version}`] };
  const exactBaseline = [value.versionPolicy.publishedBaseline, value.versionPolicy.currentWorkingVersion].includes(version);
  const matchedMilestones = value.milestones.filter((milestone) => version === milestone.targetVersion || inReleaseLine(version, milestone.releaseLine)).map((milestone) => milestone.id);
  if (exactBaseline || matchedMilestones.length > 0) return { classification: "ALIGNED", matchedMilestones, reasons: [`Release ${version} is declared by the Roadmap.`] };
  return { classification: "UNPLANNED", matchedMilestones: [], reasons: [`Release ${version} is outside every declared baseline and release line.`] };
}

function baseResult(classification, details) {
  return {
    schema: "evopilot-roadmap-gate-result/v1",
    roadmapFamily: roadmap.roadmapFamily,
    contractVersion: roadmap.contractVersion,
    roadmapDigest: `sha256:${crypto.createHash("sha256").update(fs.readFileSync(contractPath)).digest("hex")}`,
    project: roadmap.project,
    classification,
    ...details
  };
}

function decision(classification, matchedMilestones, matchedStandingWork, reasons, boundaryImpact) {
  return {
    classification,
    intent,
    matchedMilestones,
    matchedStandingWork,
    reasons,
    boundaryImpact,
    approvalRequired: classification !== "ALIGNED",
    nextAction: classification === "ALIGNED" ? "continue-with-scoped-implementation" : classification === "BOUNDARY_CHANGE" ? "stop-and-propose-replacement-adr-and-roadmap-revision" : "stop-and-request-user-review"
  };
}

function matches(text, signals) {
  return signals.some((signal) => text.includes(normalize(signal)));
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function semver(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(value ?? ""));
}

function arrayEquals(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function inReleaseLine(version, line) {
  const [major, minor] = version.split(".");
  return `${major}.${minor}.x` === line;
}

function option(name) {
  const equal = args.find((arg) => arg.startsWith(`${name}=`));
  if (equal) return equal.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && args.length > index + 1 && !args[index + 1].startsWith("--") ? args[index + 1] : undefined;
}

function emit(result, exitCode) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Roadmap Gate: ${result.classification}`);
    console.log(`Project: ${result.project}`);
    if (result.intent) console.log(`Intent: ${result.intent}`);
    for (const reason of result.reasons ?? result.errors ?? []) console.log(`- ${reason}`);
    console.log(`Next action: ${result.nextAction}`);
  }
  process.exit(exitCode);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
