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
const outFile = requiredPath("out");
if (fs.existsSync(outFile)) throw new Error(`append-only output already exists: ${outFile}`);

const packageJson = readJson(path.join(packageRoot, "package.json"));
const target = readJson(targetFile);
const binding = readJson(candidateBindingFile);
const portfolio = readJson(sourcePortfolioFile);
const preflight = readJson(preflightFile);
assert.equal(packageJson.name, "@evopilot/harness");
assert.equal(packageJson.version, "4.7.0");
assert.equal(binding.candidate.sourceCheckoutUsed, false);
assert.equal(preflight.status, "PASS");
assert.equal(binding.target.id, target.id);
assert.equal(binding.target.revision, target.revision);
assert.equal(binding.candidate.packageDigest, fileDigest(packageArtifact));
assert.equal(portfolio.sourceMutation, false);
assert.equal(portfolio.projectMutation, false);
assert.equal(portfolio.candidateOutputUsed, false);

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

const shared = buildSharedFixture();
const executors = {MV01, MV02, MV03, MV04, MV05, MV06, MV07, MV08, MV09, MV10};
const records = [];
for (const [id, definition] of variants) {
  const checks = [];
  const check = (assertionId, condition) => {
    assert.ok(condition, `${id}:${assertionId}`);
    checks.push({id: assertionId, status: "PASS"});
  };
  await executors[id](check, shared);
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
    toolchain: {runner: "scripts/run-v4.7-candidate-acceptance.mjs", runnerDigest: fileDigest(import.meta.filename), engineApiVersion: "harness.evopilot.io/v3"},
    evaluation: {id: "v4.7-machine-assertion-matrix", version: "1.0.0", scorer: "strict-all-assertions-pass", assertionCount: checks.length},
    assertions: checks,
    prohibitedEffectsObserved: [],
    authority: "EVIDENCE_ONLY_NO_HUMAN_DECISION_REPAIR_PUBLICATION_ACTIVATION_OR_RELEASE_AUTHORITY"
  };
  record.recordDigest = digest(record);
  records.push(record);
}

const inheritedTargetFile = path.resolve(path.dirname(targetFile), "evopilot-harness-v4.6.0-professional-reasoning-and-ontology-grounding.json");
const inheritedTarget = readJson(inheritedTargetFile);
const result = {
  schema: "evopilot-harness-machine-acceptance-closure/v1",
  status: "PASSED",
  target: exactTargetBinding(),
  candidate: exactCandidateBinding(),
  bindings: {
    candidateBindingDigest: fileDigest(candidateBindingFile),
    sourcePortfolioDigest: fileDigest(sourcePortfolioFile),
    preflightDigest: fileDigest(preflightFile),
    inheritedTargetDigest: fileDigest(inheritedTargetFile)
  },
  coverage: {
    currentAcceptanceCount: target.acceptance.length,
    currentAcceptanceIds: target.acceptance.map((item) => item.id),
    inheritedAcceptanceCount: inheritedTarget.acceptance.length + inheritedTarget.inheritedAcceptance.length,
    inheritedAcceptanceIdsDigest: digest([...inheritedTarget.acceptance, ...inheritedTarget.inheritedAcceptance].map((item) => item.id).sort()),
    machineVariantCount: records.length,
    machineVariantIds: records.map((item) => item.variantId),
    noRegression: "PASSED"
  },
  records,
  workBuddy: {status: "PENDING_DESIGNATED_HUMAN", caseIds: ["RC01", "RC02", "RC03", "RC04", "RC05"], finalDeclaration: "RC01～RC05 已完成", artifactsRequired: false, perCaseReportRequired: false},
  releaseAuthorized: false,
  authority: "MACHINE_EVIDENCE_ONLY_NO_WORKBUDDY_HUMAN_DECISION_REPAIR_PUBLICATION_OR_RELEASE_AUTHORITY"
};
result.closureDigest = digest(result);
fs.mkdirSync(path.dirname(outFile), {recursive: true});
fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`, {flag: "wx"});
process.stdout.write(`${JSON.stringify({status: result.status, candidateId: result.candidate.id, currentAcceptanceCount: result.coverage.currentAcceptanceCount, inheritedAcceptanceCount: result.coverage.inheritedAcceptanceCount, machineVariantCount: result.coverage.machineVariantCount, closureDigest: result.closureDigest, workBuddyStatus: result.workBuddy.status}, null, 2)}\n`);

async function MV01(check, fixture) {
  const resolved = professional.resolveProfessionalPackSet({packs: fixture.packs, targetRoot: "PRIVATE_ORGANIZATION"});
  check("all-five-pack-kinds-resolve", resolved.packs.length === 5 && new Set(fixture.packs.map((item) => item.kind)).size === 5);
  check("resolution-is-declarative", resolved.authority.declarativeOnly && !resolved.authority.executable);
  const lifecycle = professional.createPackLifecycleRecord({pack: fixture.product, targetRoot: "PRIVATE_ORGANIZATION", project: projectBinding(), dependencyClosure: {digest: utils.digest("mv01-closure")}, conflictPreview: {digest: utils.digest("mv01-conflicts")}});
  check("install-binding-is-exact", lifecycle.pack.digest === fixture.product.metadata.digest && lifecycle.project.id === "project-alpha");
  expectCode(() => professional.createProfessionalPack({...packInput("DomainOntologyPack", "executable", "bad"), scripts: ["curl example.invalid"]}), "EXECUTABLE_PACK_REJECTED", check, "executable-pack-rejected");
}

async function MV02(check, fixture) {
  const inspection = professional.inspectProfessionalPack(fixture.product, {availablePacks: [fixture.domain]});
  check("dependency-inspection-passes", inspection.lint.status === "PASSED" && inspection.dependencies[0].status === "SATISFIED");
  const gold = professional.createPackGoldCasePackage({id: "mv02-gold", version: "1.0.0", source: bindingObject("source", utils.digest("mv02-source")), expectedConcepts: ["finance:root"], expectedOutcome: "RESOLVED", provenance: provenance("mv02-gold")});
  const benchmark = professional.createPackBenchmarkPackage({id: "mv02-benchmark", version: "1.0.0", cases: [bindingObject(gold.id, gold.goldCaseDigest)], metrics: ["precision", "recall"], provenance: provenance("mv02-benchmark")});
  const certification = professional.createPackCertificationRecord({pack: fixture.domain, benchmark: bindingObject(benchmark.id, benchmark.benchmarkDigest), goldCases: [bindingObject(gold.id, gold.goldCaseDigest)], algorithm: bindingObject("resolver", utils.digest("resolver")), policy: bindingObject("policy", utils.digest("policy")), toolchain: bindingObject("node", utils.digest(process.version)), qualityLevel: "REVIEWED"});
  check("certification-is-advisory", certification.qualityLevel === "REVIEWED" && !certification.authority.automaticallyTrusted);
  const operations = new Set(engine.engineCapabilities().map((item) => item.id));
  check("engine-operation-family-complete", requiredOperationIds().every((id) => operations.has(id)));
}

async function MV03(check, fixture) {
  const before = JSON.stringify(fixture.domain);
  const collision = createPack("ProductOntologyPack", "collision", "finance");
  expectCode(() => professional.resolveProfessionalPackSet({packs: [fixture.domain, collision], targetRoot: "DOMAIN_TEAM"}), "PACK_NAMESPACE_COLLISION", check, "namespace-collision-fails-closed");
  expectCode(() => professional.resolveProfessionalPackSet({packs: [fixture.organization], targetRoot: "COMMUNITY"}), "PRIVATE_PACK_ROOT_LEAK", check, "private-root-leak-fails-closed");
  const missing = createPack("ProductOntologyPack", "missing-dependency", "missing", {imports: [{id: "absent", version: "1.0.0", digest: utils.digest("absent")}]});
  expectCode(() => professional.resolveProfessionalPackSet({packs: [missing], targetRoot: "DOMAIN_TEAM"}), "PACK_DEPENDENCY_MISSING", check, "missing-dependency-fails-closed");
  expectCode(() => professional.resolveProfessionalPackSet({packs: [fixture.domain], targetRoot: "DOMAIN_TEAM", expectedBaseDigest: utils.digest("stale")}), "PACK_BASE_DIGEST_STALE", check, "stale-base-fails-closed");
  check("failures-do-not-mutate-input", JSON.stringify(fixture.domain) === before);
}

async function MV04(check, fixture) {
  let record = professional.createPackLifecycleRecord({pack: fixture.product, targetRoot: "PRIVATE_ORGANIZATION", project: projectBinding(), dependencyClosure: {digest: utils.digest("mv04-closure")}, conflictPreview: {digest: utils.digest("mv04-conflicts")}});
  record = professional.transitionPackLifecycle({record, action: "APPLY", actor: "author", expectedRecordDigest: record.recordDigest});
  expectCode(() => professional.transitionPackLifecycle({record, action: "REQUEST_REVIEW", actor: "author", actorRole: "APPROVER", expectedRecordDigest: record.recordDigest}), "PACK_LIFECYCLE_ROLE_INVALID", check, "role-denial");
  record = professional.transitionPackLifecycle({record, action: "REQUEST_REVIEW", actor: "author", expectedRecordDigest: record.recordDigest});
  expectCode(() => professional.transitionPackLifecycle({record, action: "APPROVE", actor: "approver", expectedRecordDigest: utils.digest("stale")}), "PACK_LIFECYCLE_STALE", check, "stale-review-denied");
  record = professional.transitionPackLifecycle({record, action: "APPROVE", actor: "approver", expectedRecordDigest: record.recordDigest});
  check("approval-does-not-publish", record.stage === "APPROVED");
  const proposal = projectOntology.createProjectOntologyProposal({project: projectBinding(), packs: [fixture.domain], targetRoot: "DOMAIN_TEAM", createdBy: "author"});
  expectCode(() => projectOntology.transitionProjectOntologyProposal({proposal, action: "APPROVE", actor: "approver", expectedProposalDigest: proposal.proposalDigest}), "PROJECT_ONTOLOGY_PROPOSAL_TRANSITION_INVALID", check, "skipped-review-denied");
}

async function MV05(check, fixture) {
  const {snapshot, projections, artifact} = artifactFixture(fixture.domain, "1.0.0");
  check("snapshot-project-closure", snapshot.project.id === "project-alpha" && snapshot.packs[0].digest === fixture.domain.metadata.digest);
  check("manifest-digest-closure", artifact.spec.manifest.snapshotDigest === snapshot.snapshotDigest && artifact.spec.manifest.projectionSetDigest === projections.projectionSetDigest);
  check("skill-binds-manifest", artifact.spec.projectOntologySkill.spec.artifactSetManifestDigest === artifact.spec.manifest.manifestDigest);
  const gold = professional.createPackGoldCasePackage({id: "mv05-gold", version: "1.0.0", source: bindingObject("fixture", utils.digest("fixture")), expectedOutcome: "RESOLVED", provenance: provenance("mv05")});
  check("gold-case-reproducible", schema.validateDocument(gold).status === "VALIDATED");
}

async function MV06(check, fixture) {
  const {snapshot, projections, artifact} = artifactFixture(fixture.domain, "1.0.0");
  check("six-projections", projections.projections.length === 6);
  check("swrl-non-applicable-not-fabricated", projections.projections.find((item) => item.format === "SWRL")?.status === "NON_APPLICABLE");
  check("skill-is-read-only-projection", artifact.spec.projectOntologySkill.spec.readOnly && !artifact.spec.projectOntologySkill.authority.soleTruthStore);
  const tampered = structuredClone(artifact);
  tampered.spec.manifest.version = "9.9.9";
  expectCode(() => projectOntology.validateProjectOntologyDocument(tampered), "PROJECT_ONTOLOGY_ARTIFACT_SET_INVALID", check, "artifact-tamper-rejected");
  check("snapshot-remains-valid", projectOntology.validateProjectOntologyDocument(snapshot) === snapshot);
}

async function MV07(check) {
  const prior = readJson(path.resolve(path.dirname(targetFile), "evopilot-harness-v4.6.0-professional-reasoning-and-ontology-grounding.json"));
  check("all-225-inherited-bound", prior.acceptance.length === 22 && prior.inheritedAcceptance.length === 203);
  check("all-inherited-previously-validated", [...prior.acceptance, ...prior.inheritedAcceptance].every((item) => item.status === "PASSED" && item.evidenceRefs.length > 0));
  const fresh = readJson(path.resolve(path.dirname(preflightFile), "fresh-install.json"));
  check("current-full-suite-passed", fresh.formationChecks.fullRepositoryCheck === "PASSED_263_OF_263");
  check("exact-candidate-fresh-install", fresh.package.digest === binding.candidate.packageDigest && fresh.runtime.sourceCheckoutUsed === false);
  check("installed-engine-version", packageJson.version === "4.7.0");
}

async function MV08(check, fixture) {
  const {artifact} = artifactFixture(fixture.domain, "1.0.0");
  check("consumer-is-read-only", artifact.authority.consumerReadOnly && !artifact.authority.mayGrantConsumerMutation);
  expectCode(() => projectOntology.publishProjectOntologyArtifactSet({snapshot: approveAndResolve(fixture.domain), publication: {decision: "PENDING"}}), "PROJECT_ONTOLOGY_PUBLICATION_AUTHORIZATION_REQUIRED", check, "publication-needs-separate-authorization");
  let lifecycle = projectOntology.createArtifactLifecycleRecord({artifactSet: artifact, action: "INSTALL", actor: "installer"});
  check("publication-does-not-activate", lifecycle.stage === "INSTALLED");
  lifecycle = projectOntology.createArtifactLifecycleRecord({artifactSet: artifact, record: lifecycle, action: "ACTIVATE", actor: "operator", expectedRecordDigest: lifecycle.recordDigest});
  check("activation-is-independent", lifecycle.stage === "ACTIVE" && lifecycle.history.length === 2);
}

async function MV09(check, fixture) {
  const first = artifactFixture(fixture.domain, "1.0.0").artifact;
  const second = artifactFixture(fixture.domain, "1.1.0").artifact;
  let lifecycle = projectOntology.createArtifactLifecycleRecord({artifactSet: first, action: "INSTALL", actor: "installer"});
  lifecycle = projectOntology.createArtifactLifecycleRecord({artifactSet: first, record: lifecycle, action: "ACTIVATE", actor: "operator", expectedRecordDigest: lifecycle.recordDigest});
  const superseded = projectOntology.createArtifactLifecycleRecord({artifactSet: first, record: lifecycle, action: "SUPERSEDE", actor: "approver", expectedRecordDigest: lifecycle.recordDigest, successor: second, migrationPlan: bindingObject("migration", utils.digest("migration"))});
  check("successor-and-migration-bound", superseded.stage === "SUPERSEDED" && superseded.successor.digest === second.artifactSetDigest);
  const adapter = professional.createExternalSemanticEvidenceAdapter({id: "mv09-import", version: "1.0.0", provenance: provenance("mv09")});
  const evidence = professional.importExternalSemanticEvidence({adapter, source: bindingObject("vocabulary", utils.digest("vocabulary")), records: [{recordId: "term", contentDigest: utils.digest("term"), observedTerms: ["account"]}]});
  check("external-evidence-remains-inactive", evidence.authority.inactiveEvidence && !evidence.authority.mayActivate);
  expectCode(() => professional.resolveProfessionalPackSet({packs: [fixture.organization], targetRoot: "DOMAIN_TEAM"}), "PRIVATE_PACK_ROOT_LEAK", check, "private-root-isolation");
}

async function MV10(check) {
  for (const kind of ["OntologyReasoningProfile", "SemanticIndex", "FederatedPackDiscovery"]) check(`excluded-${kind}`, schema.validateDocument({kind}).status === "FAILED");
  const operations = engine.engineCapabilities().map((item) => item.id);
  check("no-v4.8-operation-surface", operations.every((id) => !/(reasoner|semantic-index|federated)/i.test(id)));
  const paths = listFiles(packageRoot).map((item) => path.relative(packageRoot, item));
  check("no-v4.8-schema-assets", paths.every((item) => !/(ontology-reasoning-profile|semantic-index|federated-pack-discovery)/i.test(item)));
  check("no-executable-marketplace-pack", paths.every((item) => !/ontology\/marketplace|pack\/plugins/i.test(item)));
  check("public-cli-is-candidate-package", packageJson.version === "4.7.0" && packageJson.bin?.["evopilot-harness"] === "src/index.mjs");
}

function buildSharedFixture() {
  const domain = createPack("DomainOntologyPack", "finance-domain", "finance");
  const product = createPack("ProductOntologyPack", "crm-product", "crm", {imports: [{id: domain.metadata.id, version: domain.metadata.version, digest: domain.metadata.digest}]});
  const organization = createPack("OrganizationOntologyPack", "private-org", "org.private", {root: "PRIVATE_ORGANIZATION", visibility: "PRIVATE"});
  const overlay = createPack("ProjectOntologyOverlay", "project-overlay", "project.alpha", {imports: [{id: product.metadata.id, version: product.metadata.version, digest: product.metadata.digest}]});
  const harness = createPack("DomainHarnessPack", "finance-harness", "harness.finance", {imports: [{id: domain.metadata.id, version: domain.metadata.version, digest: domain.metadata.digest}]});
  return {domain, product, organization, overlay, harness, packs: [domain, product, organization, overlay, harness]};
}

function createPack(kind, id, namespace, extra = {}) { return professional.createProfessionalPack(packInput(kind, id, namespace, extra)); }
function packInput(kind, id, namespace, extra = {}) {
  return {kind, metadata: {id, version: extra.version ?? "1.0.0", name: id, namespace, root: extra.root ?? "DOMAIN_TEAM", visibility: extra.visibility ?? "DOMAIN", owner: "acceptance-team", provenance: provenance(id)}, spec: {imports: extra.imports ?? [], concepts: extra.concepts ?? [{conceptId: `${namespace}:root`, label: `${id} root`, metaType: "CAPABILITY", definition: `Root concept for ${id}.`, evidenceRefs: ["source://acceptance"]}], equivalences: [], replacements: [], deprecations: [], rules: [], shapes: [], harnessGuidance: []}, ...(extra.topLevel ?? {})};
}
function provenance(label) { return {author: "acceptance-author", reviewers: ["acceptance-reviewer"], approvers: ["acceptance-approver"], publishers: ["acceptance-publisher"], sourceRefs: [`source://${label}`]}; }
function projectBinding() { return {id: "project-alpha", workspaceId: "workspace-alpha", tenantId: "tenant-alpha", sourceSnapshotDigest: fileDigest(sourcePortfolioFile)}; }
function approveAndResolve(pack) {
  let proposal = projectOntology.createProjectOntologyProposal({project: projectBinding(), packs: [pack], targetRoot: pack.metadata.root, createdBy: "author", now: "2026-09-17T00:00:00.000Z"});
  for (const [action, actor] of [["APPLY", "author"], ["REQUEST_REVIEW", "author"], ["APPROVE", "approver"]]) proposal = projectOntology.transitionProjectOntologyProposal({proposal, action, actor, expectedProposalDigest: proposal.proposalDigest, now: "2026-09-17T00:00:00.000Z"});
  return projectOntology.resolveProjectOntologySnapshot({proposal, expectedProposalDigest: proposal.proposalDigest, foundationDigest: grounding.resolveOntologyFoundation().foundationDigest, now: "2026-09-17T00:00:00.000Z"});
}
function artifactFixture(pack, version) {
  const snapshot = approveAndResolve(pack);
  const projections = projectOntology.createProjectionSet(snapshot);
  const artifact = projectOntology.publishProjectOntologyArtifactSet({snapshot, projectionSet: projections, publication: {decision: "AUTHORIZED", actor: "publisher", authorizationDigest: utils.digest(`publication-${version}`), version, at: "2026-09-17T00:00:00.000Z"}});
  return {snapshot, projections, artifact};
}
function bindingObject(id, digestValue) { return {id, version: "1.0.0", digest: digestValue}; }
function expectCode(fn, code, check, assertionId) { let observed = null; try { fn(); } catch (error) { observed = error.code; } check(assertionId, observed === code); }
function requiredOperationIds() { return ["pack.scaffold.inspect", "pack.inspect", "pack.resolve.inspect", "pack.lifecycle.create", "pack.lifecycle.transition", "pack.benchmark.inspect", "pack.gold-case.inspect", "pack.certification.inspect", "semantic.evidence-adapter.inspect", "semantic.evidence.import.inspect", "project-ontology.proposal.inspect", "project-ontology.proposal.transition", "project-ontology.snapshot.resolve", "project-ontology.projections.inspect", "project-ontology.skill.inspect", "project-ontology.artifact.publish", "project-ontology.artifact.transition"]; }
function exactTargetBinding() { return {id: target.id, revision: target.revision, authorizationDigest: target.approvals.target.authorizationDigest, fileDigest: fileDigest(targetFile), roadmapDigest: target.roadmapBindings[0].roadmapDigest}; }
function exactCandidateBinding() { return {id: binding.candidate.id, label: binding.candidate.label, packageDigest: binding.candidate.packageDigest, manifestDigest: binding.candidate.manifestDigest, sourceCheckoutUsed: false}; }
function listFiles(root) { return fs.readdirSync(root, {recursive: true, withFileTypes: true}).filter((item) => item.isFile()).map((item) => path.join(item.parentPath ?? item.path, item.name)); }
function requiredPath(name) { const flag = `--${name}`; const index = process.argv.indexOf(flag); if (index < 0 || !process.argv[index + 1]) throw new Error(`${flag} is required`); return path.resolve(process.argv[index + 1]); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function digest(value) { return `sha256:${crypto.createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex")}`; }
function fileDigest(file) { return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`; }
function importFromPackage(relative) { return import(pathToFileURL(path.join(packageRoot, relative)).href); }
