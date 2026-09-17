#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const packageRoot = requiredPath("package-root");
const packageArtifact = requiredPath("package-artifact");
const targetFile = requiredPath("target");
const candidateBindingFile = requiredPath("candidate-binding");
const sourcePortfolioFile = requiredPath("source-portfolio");
const preflightFile = requiredPath("preflight");
const fullCheckFile = requiredPath("full-check");
const outFile = requiredPath("out");
if (fs.existsSync(outFile)) throw new Error(`append-only output already exists: ${outFile}`);

const packageJson = readJson(path.join(packageRoot, "package.json"));
const target = readJson(targetFile);
const binding = readJson(candidateBindingFile);
const portfolio = readJson(sourcePortfolioFile);
const preflight = readJson(preflightFile);
const fullCheck = readJson(fullCheckFile);
assert.equal(packageJson.name, "@evopilot/harness");
assert.equal(packageJson.version, "4.8.0");
assert.equal(binding.candidate.sourceCheckoutUsed, false);
assert.equal(binding.candidate.packageDigest, fileDigest(packageArtifact));
assert.equal(binding.target.id, target.id);
assert.equal(binding.target.revision, target.revision);
assert.equal(preflight.status, "PASS");
assert.equal(fullCheck.status, "PASS");
assert.equal(portfolio.sourceMutation, false);
assert.equal(portfolio.projectMutation, false);
assert.equal(portfolio.candidateOutputUsed, false);

const semantic = await importFromPackage("src/v4/semantics/semantic-interoperability.mjs");
const professional = await importFromPackage("src/v4/semantics/professional-packs.mjs");
const projectOntology = await importFromPackage("src/v4/semantics/project-ontology.mjs");
const grounding = await importFromPackage("src/v4/semantics/ontology-grounding.mjs");
const engine = await importFromPackage("src/v4/engine-adapter.mjs");
const schema = await importFromPackage("src/v3/schema.mjs");
const utils = await importFromPackage("src/v3/utils.mjs");

const variants = new Map((target.realCaseCoverage ?? []).flatMap((realCase) =>
  (realCase.machineVariants ?? []).map((variant) => [variant.id, {...variant, realCaseId: realCase.id}])
));
assert.deepEqual([...variants.keys()], ["MV01", "MV02", "MV03", "MV04", "MV05", "MV06", "MV07", "MV08", "MV09", "MV10"]);

const fixture = buildFixture();
const executors = {MV01, MV02, MV03, MV04, MV05, MV06, MV07, MV08, MV09, MV10};
const records = [];
for (const [id, definition] of variants) {
  const checks = [];
  const check = (assertionId, condition) => {
    assert.ok(condition, `${id}:${assertionId}`);
    checks.push({id: assertionId, status: "PASS"});
  };
  await executors[id](check, fixture);
  const record = {
    schema: "evopilot-harness-machine-variant-report/v1",
    variantId: id,
    realCaseId: definition.realCaseId,
    status: "PASSED",
    scenario: definition.scenario,
    coversAcceptanceIds: definition.coversAcceptanceIds,
    target: exactTargetBinding(),
    candidate: exactCandidateBinding(),
    source: {portfolioDigest: fileDigest(sourcePortfolioFile), mutation: false, execution: false},
    environment: {host: "independent-node-process", platform: process.platform, architecture: process.arch, node: process.version, packageRoot, sourceCheckoutUsed: false},
    model: {id: "deterministic-no-llm", provider: "NONE", tokenTotals: {input: 0, output: 0, total: 0}},
    toolchain: {runner: "scripts/run-v4.8-candidate-acceptance.mjs", runnerDigest: fileDigest(import.meta.filename), engineApiVersion: "harness.evopilot.io/v3"},
    evaluation: {id: "v4.8-machine-assertion-matrix", version: "1.0.0", scorer: "strict-all-assertions-pass", assertionCount: checks.length},
    budgets: fixture.profile.spec.limits,
    assertions: checks,
    prohibitedEffectsObserved: [],
    authority: "EVIDENCE_ONLY_NO_HUMAN_DECISION_REPAIR_PUBLICATION_ACTIVATION_OR_RELEASE_AUTHORITY"
  };
  record.recordDigest = digest(record);
  records.push(record);
}

const result = {
  schema: "evopilot-harness-machine-acceptance-closure/v1",
  status: "PASSED",
  target: exactTargetBinding(),
  candidate: exactCandidateBinding(),
  bindings: {
    candidateBindingDigest: fileDigest(candidateBindingFile),
    sourcePortfolioDigest: fileDigest(sourcePortfolioFile),
    preflightDigest: fileDigest(preflightFile),
    fullCheckDigest: fileDigest(fullCheckFile)
  },
  coverage: {
    currentAcceptanceCount: target.acceptance.length,
    currentAcceptanceIds: target.acceptance.map((item) => item.id),
    inheritedAcceptanceCount: target.inheritedAcceptance.length,
    inheritedAcceptanceIdsDigest: digest(target.inheritedAcceptance.map((item) => item.id).sort()),
    machineVariantCount: records.length,
    machineVariantIds: records.map((item) => item.variantId),
    noRegression: "PASSED"
  },
  records,
  workBuddy: {status: "PENDING_DESIGNATED_HUMAN", caseIds: ["RC01", "RC02", "RC03", "RC04", "RC05"], finalDeclaration: "RC01～RC05 已完成", artifactsRequired: false, perCaseReportRequired: false},
  releaseAuthorized: false,
  crossProductConvergenceE2E: "DEFERRED_TO_EVOPILOT_RUNTIME_6.3.0",
  authority: "MACHINE_EVIDENCE_ONLY_NO_WORKBUDDY_HUMAN_DECISION_REPAIR_PUBLICATION_OR_RELEASE_AUTHORITY"
};
result.closureDigest = digest(result);
fs.mkdirSync(path.dirname(outFile), {recursive: true});
fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`, {flag: "wx"});
process.stdout.write(`${JSON.stringify({status: result.status, candidateId: result.candidate.id, currentAcceptanceCount: result.coverage.currentAcceptanceCount, inheritedAcceptanceCount: result.coverage.inheritedAcceptanceCount, machineVariantCount: result.coverage.machineVariantCount, closureDigest: result.closureDigest, workBuddyStatus: result.workBuddy.status}, null, 2)}\n`);

function MV01(check, state) {
  const projections = projectionSet(state);
  const report = semantic.verifySemanticRoundTrip({snapshot: state.snapshot, projectionSet: projections, index: state.index, incremental: state.incremental, full: state.full});
  check("all-five-formats-applicable", projections.projections.length === 5 && projections.projections.every((item) => item.status === "APPLICABLE"));
  check("multilingual-and-mapping-provenance", projections.multilingualTerms[0].language === "zh" && projections.externalMappings[0].active === false && projections.externalMappings[0].provenance.catalog === "external-fixture");
  check("round-trip-preserves-canonical-semantics", report.status === "PASSED" && report.canonicalSemanticsPreserved === true);
  check("projection-schema-valid", schema.validateDocument(projections).status === "VALIDATED" && schema.validateDocument(report).status === "VALIDATED");
}

function MV02(check, state) {
  for (const mode of semantic.REASONING_MODES) {
    const value = profile(mode);
    check(`profile-${mode.toLowerCase()}-bounded`, value.authority.unboundedReasoningAllowed === false && value.spec.limits.maxIterations === 16);
  }
  const unsupported = semantic.createInteroperabilityProjectionSet({snapshot: state.snapshot, profile: state.profile, index: state.index, unsupportedSemantics: ["OWL:unbounded-cardinality"]});
  const unsupportedReport = semantic.verifySemanticRoundTrip({snapshot: state.snapshot, projectionSet: unsupported, index: state.index, incremental: state.incremental, full: state.full});
  check("unsupported-semantics-fails-closed", unsupportedReport.status === "FAILED" && unsupportedReport.unsupportedFormats[0].format === "OWL");
  expectCode(() => semantic.createInteroperabilityProjectionSet({snapshot: state.snapshot, profile: state.profile, index: state.index, externalMappings: [{externalId: "urn:hostile", canonicalConceptId: "missing", evidenceDigest: digest("hostile") }]}), "EXTERNAL_MAPPING_CONCEPT_UNKNOWN", check, "hostile-mapping-rejected");
  const external = profile("EXTERNAL_REASONER");
  expectCode(() => semantic.computeSemanticState({index: state.index, profile: external, externalReasonerResult: externalResult(external, digest("stale"))}), "EXTERNAL_REASONER_INPUT_MISMATCH", check, "external-reasoner-input-drift-rejected");
  check("external-reasoner-non-authoritative", external.authority.externalReasonerMayApprove === false && external.authority.externalReasonerMayPublish === false && external.authority.externalReasonerMayMutate === false);
}

function MV03(check, state) {
  const affected = semantic.calculateAffectedSubgraph({index: state.index, profile: state.profile, changedConceptIds: ["finance:account"], cacheDigest: state.cache.digest});
  const incremental = semantic.computeSemanticState({index: state.index, profile: state.profile, mode: "INCREMENTAL", affectedSubgraph: affected});
  const full = semantic.computeSemanticState({index: state.index, profile: state.profile, mode: "FULL"});
  const comparison = semantic.compareSemanticComputations({incremental, full});
  check("affected-subgraph-proof-paths", affected.affectedConceptIds.length === 3 && affected.proofPaths.every((item) => item.path.at(-1) === item.conceptId));
  check("selective-reasoning-telemetry", incremental.telemetry.evaluatedConceptCount === affected.affectedConceptIds.length && incremental.telemetry.evaluatedConceptCount < state.index.statistics.nodeCount);
  check("full-recompute-equivalence", comparison.status === "PASSED" && comparison.equivalentAuthoritativeOutcome === true);
  const restarted = JSON.parse(JSON.stringify({index: state.index, affected, incremental, full}));
  check("restart-readback-digest-stable", semantic.validateSemanticInteroperabilityDocument(restarted.index) === restarted.index && semantic.compareSemanticComputations({incremental: restarted.incremental, full: restarted.full}).status === "PASSED");
}

function MV04(check, state) {
  expectCode(() => semantic.calculateAffectedSubgraph({index: state.index, profile: state.profile, changedConceptIds: ["finance:account"], cacheDigest: digest("stale")}), "SEMANTIC_CACHE_DIGEST_MISMATCH", check, "stale-cache-rejected");
  const tampered = structuredClone(state.index);
  tampered.nodes[0].label = "tampered";
  expectCode(() => semantic.validateSemanticInteroperabilityDocument(tampered), "SEMANTIC_INDEX_INVALID", check, "corrupted-index-rejected");
  expectCode(() => semantic.computeSemanticState({index: state.index, profile: state.profile, execution: {concurrency: state.profile.spec.limits.maxConcurrentTasks + 1}}), "REASONING_CONCURRENCY_BUDGET_EXCEEDED", check, "concurrency-budget-enforced");
  expectCode(() => semantic.computeSemanticState({index: state.index, profile: state.profile, execution: {elapsedMs: state.profile.spec.limits.maxWallTimeMs + 1}}), "REASONING_WALL_TIME_BUDGET_EXCEEDED", check, "wall-time-budget-enforced");
  check("telemetry-complete-and-redacted", state.full.telemetry.secretsRedacted && state.full.telemetry.cacheDigest === state.cache.digest && state.full.telemetry.budgets.maxNodes === state.profile.spec.limits.maxNodes);
  check("failures-cannot-advance-lifecycle", state.full.authority.mayApprove === false && state.full.authority.mayPublish === false && state.full.authority.mayMutate === false);
}

function MV05(check) {
  const pack = federatedPack("finance-domain", "1.0.0", digest("finance-domain"));
  const result = semantic.discoverFederatedPacks({roots: [
    federatedRoot("domain-root", "DOMAIN", "domain-reviewed", "GRANTED", true, [pack]),
    federatedRoot("community-root", "PUBLIC", "community-reviewed", "GRANTED", true, [federatedPack("community-tools", "2.0.0", digest("community-tools"))])
  ]});
  check("federated-results-preserve-root", result.discoveredPacks.every((item) => item.sourceCatalog === item.sourceRoot && item.sourceCatalogDigest && item.permission === "GRANTED"));
  check("federated-results-preserve-pack", result.discoveredPacks.every((item) => item.id && item.version && item.digest && item.provenance.owner && item.visibility && item.trustContext));
  check("federation-is-read-only", result.authority.readOnly && result.authority.rootsRemainIndependent && !result.authority.sharedMutation && !result.authority.automaticTrust);
  check("federation-schema-valid", schema.validateDocument(result).status === "VALIDATED");
}

function MV06(check) {
  const pack = federatedPack("private-pack", "1.0.0", digest("private-pack"));
  const before = JSON.stringify(pack);
  const result = semantic.discoverFederatedPacks({roots: [
    federatedRoot("private-root", "PRIVATE", "private", "DENIED", true, [pack]),
    federatedRoot("offline-root", "DOMAIN", "offline", "GRANTED", false, [pack])
  ]});
  check("denied-root-isolated", result.roots.find((item) => item.id === "private-root").status === "PERMISSION_DENIED" && result.discoveredPacks.length === 0);
  check("unavailable-root-explicit", result.roots.find((item) => item.id === "offline-root").status === "UNAVAILABLE");
  expectCode(() => semantic.discoverFederatedPacks({roots: [federatedRoot("one", "DOMAIN", "one", "GRANTED", true, [pack]), federatedRoot("two", "DOMAIN", "two", "GRANTED", true, [{...pack, digest: digest("conflict")}])]}), "FEDERATED_PACK_CONFLICT", check, "conflicting-identity-rejected");
  check("federation-zero-mutation", JSON.stringify(pack) === before);
}

function MV07(check, state) {
  const {closure, published} = terminalClosure(state);
  check("terminal-manifest-complete", closure.dependencyLocks.length === 1 && closure.evaluations.length === 1 && closure.rollbackLinks.length === 1 && closure.graphIndex.digest === closure.semanticIndex.digest);
  expectCode(() => semantic.publishTerminalSemanticClosure({closure, publication: {decision: "PENDING"}}), "TERMINAL_CLOSURE_PUBLICATION_AUTHORIZATION_REQUIRED", check, "publication-separate");
  check("publication-exact-and-read-only", published.status === "PUBLISHED" && published.authority.consumerReadOnly && !published.authority.grantsReleaseAuthority);
  const tampered = structuredClone(published);
  tampered.harnessAssets[0].version = "9.9.9";
  expectCode(() => semantic.validateSemanticInteroperabilityDocument(tampered), "TERMINAL_SEMANTIC_CLOSURE_INVALID", check, "published-closure-tamper-rejected");
}

function MV08(check, state) {
  const {published} = terminalClosure(state);
  const slice = semantic.sliceTerminalSemanticClosure({closure: published, conceptIds: ["finance:account", "finance:audit"], expectedClosureDigest: published.closureDigest});
  check("consumer-slice-offline-read-only", slice.authority.offline && slice.authority.readOnly && !slice.authority.liveHarnessDependency && !slice.authority.mayMutate);
  check("consumer-binds-exact-assets", slice.bindings.snapshotDigest === state.snapshot.snapshotDigest && slice.bindings.semanticIndexDigest === state.index.indexDigest && slice.bindings.harnessAssets.length === 3);
  expectCode(() => semantic.sliceTerminalSemanticClosure({closure: published, expectedClosureDigest: digest("stale")}), "TERMINAL_CLOSURE_STALE", check, "stale-consumer-binding-rejected");
  check("consumer-grants-no-authority", !slice.authority.mayApprove && !slice.authority.mayPublish && !slice.authority.mayRelease);
}

function MV09(check, state) {
  const operations = new Map(engine.engineCapabilities().map((item) => [item.id, item]));
  const required = ["semantic.reasoning-profile.inspect", "semantic.index.inspect", "semantic.affected-subgraph.inspect", "semantic.compute.inspect", "semantic.compute.compare", "semantic.federation.discover", "semantic.interoperability.inspect", "semantic.round-trip.inspect", "semantic.closure.inspect", "semantic.closure.publish", "semantic.closure.slice"];
  check("ordinary-operation-family-complete", required.every((id) => operations.has(id)));
  check("only-publication-mutates-authority", operations.get("semantic.closure.publish").publicationAuthorizationRequired === true && operations.get("semantic.closure.slice").mutating === false);
  const comparison = semantic.compareSemanticComputations({incremental: state.incremental, full: state.full});
  check("ordinary-inspection-path-finite", comparison.status === "PASSED" && state.affected.proofPaths.length > 0);
  check("safe-close-no-release-authority", terminalClosure(state).published.authority.grantsReleaseAuthority === false);
}

function MV10(check) {
  const prior = readJson(path.resolve(path.dirname(targetFile), "evopilot-harness-v4.7.0-governed-project-ontology-and-multi-pack-lifecycle.json"));
  check("all-247-inherited-bound", prior.acceptance.length === 22 && prior.inheritedAcceptance.length === 225 && target.inheritedAcceptance.length === 247);
  check("all-inherited-previously-validated", [...prior.acceptance, ...prior.inheritedAcceptance].every((item) => item.status === "PASSED" && item.evidenceRefs.length > 0));
  check("full-repository-check-passed", fullCheck.status === "PASS" && fullCheck.noRegression === true);
  const source = fs.readFileSync(path.join(packageRoot, "src/v4/semantics/semantic-interoperability.mjs"), "utf8");
  check("no-network-or-process-execution", !/node:(?:http|https|net|tls|dgram|child_process)|\b(?:execFileSync|execSync|spawn|spawnSync)\b/.test(source));
  check("no-general-knowledge-graph-or-runtime", !/knowledge graph server|cloud control plane|implementEvoPilotRuntime/i.test(source));
  check("exact-candidate-version", packageJson.version === "4.8.0" && packageJson.bin?.["evopilot-harness"] === "src/index.mjs");
}

function buildFixture() {
  const pack = professional.createProfessionalPack({
    kind: "DomainOntologyPack",
    metadata: {id: "finance-domain", version: "1.0.0", name: "Finance domain", namespace: "finance", root: "DOMAIN_TEAM", visibility: "DOMAIN", owner: "finance-team", provenance: provenance("finance")},
    spec: {concepts: [
      concept("finance:account", "Account", "ENTITY", [{targetConceptId: "finance:audit", relationType: "REQUIRES", evidenceRefs: ["source://relation"]}]),
      concept("finance:audit", "Audit", "CAPABILITY", [{targetConceptId: "finance:report", relationType: "PRODUCES", evidenceRefs: ["source://relation"]}]),
      concept("finance:report", "Report", "DATA_ASSET"),
      concept("finance:unrelated", "Unrelated", "ENTITY")
    ]}
  });
  let proposal = projectOntology.createProjectOntologyProposal({project: projectBinding(), packs: [pack], targetRoot: "DOMAIN_TEAM", createdBy: "author", now: "2026-09-17T00:00:00.000Z"});
  for (const [action, actor] of [["APPLY", "author"], ["REQUEST_REVIEW", "author"], ["APPROVE", "approver"]]) proposal = projectOntology.transitionProjectOntologyProposal({proposal, action, actor, expectedProposalDigest: proposal.proposalDigest, now: "2026-09-17T00:00:00.000Z"});
  const snapshot = projectOntology.resolveProjectOntologySnapshot({proposal, expectedProposalDigest: proposal.proposalDigest, foundationDigest: grounding.resolveOntologyFoundation().foundationDigest, now: "2026-09-17T00:00:00.000Z"});
  const selectedProfile = profile("OWL_RL");
  const cache = {id: "semantic-cache", digest: digest("cache-v1"), policyDigest: digest("cache-policy-v1"), entryCount: 4};
  const assets = [
    asset("Source", "finance-source"), asset("Ontology", "finance-ontology"), asset("HarnessProfile", "finance-profile"),
    asset("HarnessComponent", "finance-component"), asset("Evaluation", "finance-evaluation"), asset("HarnessBundle", "finance-bundle")
  ];
  const index = semantic.buildSemanticIndex({snapshot, assets, algorithm: bindingObject("semantic-index-algorithm", digest("algorithm")), policy: bindingObject("semantic-index-policy", digest("policy")), toolchain: bindingObject("node", digest(process.version)), cache});
  const affected = semantic.calculateAffectedSubgraph({index, profile: selectedProfile, changedConceptIds: ["finance:account"], cacheDigest: cache.digest});
  const full = semantic.computeSemanticState({index, profile: selectedProfile, mode: "FULL", execution: {concurrency: 2, elapsedMs: 10}});
  const incremental = semantic.computeSemanticState({index, profile: selectedProfile, mode: "INCREMENTAL", affectedSubgraph: affected, execution: {concurrency: 2, elapsedMs: 5}});
  return {pack, snapshot, profile: selectedProfile, cache, assets, index, affected, full, incremental};
}

function profile(mode) {
  const input = {id: `${mode.toLowerCase().replaceAll("_", "-")}-profile`, version: "1.0.0", mode, limits: {maxNodes: 10_000, maxEdges: 50_000, maxIterations: 16, maxWallTimeMs: 5_000, maxConcurrentTasks: 4, maxCacheEntries: 20_000}};
  if (mode === "EXTERNAL_REASONER") input.externalReasoner = {id: "qualified-reasoner", version: "1.2.3", digest: digest("reasoner"), qualificationDigest: digest("qualification"), supportedRules: ["owl:equivalentClass"]};
  return semantic.createOntologyReasoningProfile(input);
}
function projectionSet(state) { return semantic.createInteroperabilityProjectionSet({snapshot: state.snapshot, profile: state.profile, index: state.index, externalMappings: [{externalId: "https://example.org/Account", canonicalConceptId: "finance:account", relation: "EXACT_MATCH", provenance: {catalog: "external-fixture"}, evidenceDigest: digest("mapping")}], multilingualTerms: [{conceptId: "finance:account", language: "zh", term: "账户", provenance: {source: "reviewed-terms"}}]}); }
function terminalClosure(state) {
  const projections = projectionSet(state);
  const report = semantic.verifySemanticRoundTrip({snapshot: state.snapshot, projectionSet: projections, index: state.index, incremental: state.incremental, full: state.full});
  const closure = semantic.createTerminalSemanticClosure({snapshot: state.snapshot, profile: state.profile, index: state.index, projectionSet: projections, roundTripReport: report, harnessAssets: [asset("HarnessProfile", "finance-profile"), asset("HarnessComponent", "finance-component"), asset("HarnessBundle", "finance-bundle")], dependencyLocks: [bindingObject("dependency-lock", digest("dependency-lock"), "4.8.0")], evaluations: [asset("Evaluation", "terminal-evaluation")], rollbackLinks: [bindingObject("v4-7-rollback", digest("v4-7-rollback"), "4.7.0")], provenance: {producer: "evopilot-harness", sourceRefs: ["source://acceptance"], generatedByDigest: digest("v4.8-runner")}});
  const published = semantic.publishTerminalSemanticClosure({closure, publication: {decision: "AUTHORIZED", actor: "acceptance-publisher", authorizationDigest: digest("terminal-publication"), version: "4.8.0", at: "2026-09-17T00:00:00.000Z"}});
  return {projections, report, closure, published};
}
function externalResult(selectedProfile, inputDigest) { return {reasoner: selectedProfile.spec.externalReasoner, inputDigest, outputDigest: digest("reasoner-output"), proofDigest: digest("reasoner-proof"), status: "COMPLETED"}; }
function concept(conceptId, label, metaType, relationships = []) { return {conceptId, label, metaType, definition: `${label} definition.`, evidenceRefs: [`source://${conceptId}`], relationships}; }
function asset(kind, id) { return {kind, id, version: "4.8.0", digest: digest(`${kind}:${id}@4.8.0`)}; }
function bindingObject(id, value, version = "1.0.0") { return {id, version, digest: value}; }
function provenance(label) { return {author: "acceptance-author", reviewers: ["acceptance-reviewer"], approvers: ["acceptance-approver"], publishers: ["acceptance-publisher"], sourceRefs: [`source://${label}`]}; }
function projectBinding() { return {id: "project-alpha", workspaceId: "workspace-alpha", tenantId: "tenant-alpha", sourceSnapshotDigest: fileDigest(sourcePortfolioFile)}; }
function federatedPack(id, version, value) { return {id, version, digest: value, kind: "DomainOntologyPack", visibility: "DOMAIN", provenance: {owner: `${id}-owner`}}; }
function federatedRoot(id, visibility, trustContext, permission, available, packs) { return {id, catalogDigest: digest(`catalog:${id}`), trustContext, visibility, permission, available, packs}; }
function expectCode(operation, code, check, assertionId) { let actual = null; try { operation(); } catch (error) { actual = error.code; } check(assertionId, actual === code); }
function exactTargetBinding() { return {id: target.id, revision: target.revision, authorizationDigest: target.approvals.target.authorizationDigest, fileDigest: fileDigest(targetFile)}; }
function exactCandidateBinding() { return {id: binding.candidate.id, package: `${packageJson.name}@${packageJson.version}`, packageDigest: binding.candidate.packageDigest, manifestDigest: binding.candidate.manifestDigest, sourceCheckoutUsed: false}; }
async function importFromPackage(relative) { return import(`${pathToFileURL(path.join(packageRoot, relative)).href}?acceptance=${fileDigest(path.join(packageRoot, relative))}`); }
function requiredPath(name) { const flag = `--${name}`; const index = process.argv.indexOf(flag); if (index < 0 || !process.argv[index + 1]) throw new Error(`${flag} is required`); const value = path.resolve(process.argv[index + 1]); if (!fs.existsSync(value) && name !== "out") throw new Error(`${flag} does not exist: ${value}`); return value; }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function digest(value) { return `sha256:${crypto.createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex")}`; }
function fileDigest(file) { return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`; }
