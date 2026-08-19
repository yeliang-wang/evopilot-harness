import fs from "node:fs";
import path from "node:path";
import { API_VERSION } from "./constants.mjs";
import { digest, readYaml, safeId, unique, walkFiles, writeJson, writeYaml } from "./utils.mjs";
import { validateDocument } from "./schema.mjs";

export function planV2Migration(sourceRoot, home) {
  const templates = walkFiles(path.resolve(sourceRoot), (file) => path.basename(file) === "template.yaml").map((file) => ({ file, template: readYaml(file) })).filter((item) => /^evopilot-harness-template\/v[12]$/.test(String(item.template?.schema)));
  const component = readYaml(path.join(home, "catalogs/builtin/assets/components/engineering-validation/asset.yaml"));
  const componentDigest = digest(component);
  const assets = templates.flatMap(({ file, template }) => buildAssets(template, file, componentDigest));
  const validations = assets.map((item) => ({ ...item, validation: validateDocument(item.asset, item.sourceFile) }));
  return {
    schema: "evopilot-harness-migration-plan/v3",
    status: validations.every((item) => item.validation.valid) ? "READY" : "FAILED",
    sourceRoot: path.resolve(sourceRoot),
    templateCount: templates.length,
    assetCount: assets.length,
    assets: validations.map((item) => ({ sourceFile: item.sourceFile, exportFile: item.exportFile, kind: item.asset.kind, id: item.asset.metadata.id, version: item.asset.metadata.version, digest: digest(item.asset), validation: item.validation })),
    sourceMutated: false
  };
}

export function applyV2Migration(sourceRoot, home) {
  const workspace = fs.realpathSync(home);
  const assetRoot = migrationAssetRoot(workspace);
  const plan = planV2Migration(sourceRoot, workspace);
  if (plan.status !== "READY") return { ...plan, status: "FAILED" };
  const migrationId = safeId(`v2-to-v3-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const records = [];
  const component = readYaml(path.join(workspace, "catalogs/builtin/assets/components/engineering-validation/asset.yaml"));
  const componentDigest = digest(component);
  const templates = walkFiles(path.resolve(sourceRoot), (file) => path.basename(file) === "template.yaml").map((file) => ({ file, template: readYaml(file) })).filter((item) => /^evopilot-harness-template\/v[12]$/.test(String(item.template?.schema)));
  for (const { file, template } of templates) {
    const migrationAssets = buildAssets(template, file, componentDigest);
    for (const item of migrationAssets) item.asset.metadata.labels = { ...(item.asset.metadata.labels ?? {}), migrationId };
    const profile = migrationAssets.find((item) => item.asset.kind === "HarnessProfile")?.asset;
    const bundle = migrationAssets.find((item) => item.asset.kind === "HarnessBundle")?.asset;
    if (profile && bundle) bundle.spec.profile.digest = digest(profile);
    for (const item of migrationAssets) {
      const directory = ({ HarnessProfile: "profiles", HarnessBundle: "bundles" })[item.asset.kind];
      const destination = path.join(assetRoot, directory, item.asset.metadata.id, item.asset.metadata.version, "asset.yaml");
      assertMigrationDestination(assetRoot, destination);
      if (fs.existsSync(destination)) {
        records.push({ status: "SKIPPED_EXISTS", kind: item.asset.kind, id: item.asset.metadata.id, version: item.asset.metadata.version, path: destination, digest: digest(readYaml(destination)) });
        continue;
      }
      writeYaml(destination, item.asset);
      const created = [createdFile(destination, "asset")];
      if (item.asset.kind === "HarnessBundle") {
        const exportFile = path.join(path.dirname(destination), "exports/evopilot/template.yaml");
        assertMigrationDestination(assetRoot, exportFile);
        fs.mkdirSync(path.dirname(exportFile), { recursive: true });
        fs.copyFileSync(file, exportFile);
        created.push(createdFile(exportFile, "export"));
      }
      records.push({ status: "CREATED", kind: item.asset.kind, id: item.asset.metadata.id, version: item.asset.metadata.version, path: destination, created, digest: digest(item.asset) });
    }
  }
  const journal = {
    schema: "evopilot-harness-migration-journal/v1",
    migrationId,
    type: "v2-to-v3",
    workspaceRoot: workspace,
    sourceRoot: path.resolve(sourceRoot),
    createdAt: new Date().toISOString(),
    sourceMutated: false,
    records
  };
  journal.journalDigest = migrationJournalDigest(journal);
  const journalFile = path.join(workspace, "migrations", `${migrationId}.json`);
  writeJson(journalFile, journal);
  return { schema: "evopilot-harness-migration-result/v3", status: "MIGRATED", migrationId, journalFile, templateCount: templates.length, createdAssetCount: records.filter((item) => item.status === "CREATED").length, skippedAssetCount: records.filter((item) => item.status === "SKIPPED_EXISTS").length, sourceMutated: false, nextAction: "asset-v3-validate" };
}

export function rollbackMigration(home, migrationId) {
  const journalId = String(migrationId ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(journalId) || journalId.includes("..")) {
    throw new Error(`Migration journal id ${migrationId} is invalid.`);
  }
  const journalFile = path.join(home, "migrations", `${journalId}.json`);
  if (!fs.existsSync(journalFile)) throw new Error(`Migration journal ${migrationId} was not found.`);
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
  const workspace = fs.realpathSync(home);
  const rollbackRoot = migrationAssetRoot(workspace);
  validateMigrationJournal(journal, journalId, workspace);
  const deletionTargets = validateRollbackTargets(journal, journalId, rollbackRoot);
  const removed = [];
  for (const file of [...deletionTargets].reverse()) {
    fs.rmSync(file, { force: false });
    removed.push(file);
    removeEmptyParents(path.dirname(file), rollbackRoot);
  }
  journal.rolledBackAt = new Date().toISOString();
  journal.rollbackRemoved = removed;
  journal.journalDigest = migrationJournalDigest(journal);
  writeJson(journalFile, journal);
  return { schema: "evopilot-harness-migration-rollback/v3", status: "ROLLED_BACK", migrationId, removedCount: removed.length, removed, sourceMutated: false };
}

function validateMigrationJournal(journal, journalId, workspace) {
  if (!journal || typeof journal !== "object" || Array.isArray(journal)) throw new Error(`Migration journal ${journalId} is invalid.`);
  if (journal.schema !== "evopilot-harness-migration-journal/v1" || journal.migrationId !== journalId || journal.type !== "v2-to-v3") {
    throw new Error(`Migration journal ${journalId} binding is invalid.`);
  }
  if (journal.workspaceRoot !== workspace) throw new Error(`Migration journal ${journalId} belongs to a different Workspace.`);
  if (!Array.isArray(journal.records)) throw new Error(`Migration journal ${journalId} records are invalid.`);
  if (!journal.journalDigest || journal.journalDigest !== migrationJournalDigest(journal)) {
    throw new Error(`Migration journal ${journalId} integrity check failed.`);
  }
  for (const record of journal.records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(`Migration journal ${journalId} record is invalid.`);
    if (record.created != null && (!Array.isArray(record.created) || record.created.some((file) => !file || typeof file !== "object" || Array.isArray(file) || typeof file.path !== "string" || !/^sha256:[a-f0-9]{64}$/.test(String(file.digest)) || !["asset", "export"].includes(file.role)))) {
      throw new Error(`Migration journal ${journalId} created paths are invalid.`);
    }
  }
}

function migrationJournalDigest(journal) {
  const value = { ...journal };
  delete value.journalDigest;
  return digest(value);
}

function validateRollbackTargets(journal, journalId, rollbackRoot) {
  const targets = [];
  const seen = new Set();
  for (const record of journal.records.filter((item) => item.status === "CREATED")) {
    if (!(["HarnessProfile", "HarnessBundle"].includes(record.kind)) || !/^[a-z0-9][a-z0-9-]*$/.test(String(record.id)) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(record.version))) {
      throw new Error(`Migration journal ${journalId} asset identity is invalid.`);
    }
    const directory = record.kind === "HarnessProfile" ? "profiles" : "bundles";
    const expectedAsset = path.join(rollbackRoot, directory, record.id, record.version, "asset.yaml");
    const expectedExport = path.join(path.dirname(expectedAsset), "exports/evopilot/template.yaml");
    const expected = record.kind === "HarnessBundle" ? [{ path: expectedAsset, role: "asset" }, { path: expectedExport, role: "export" }] : [{ path: expectedAsset, role: "asset" }];
    if (canonicalTarget(record.path) !== canonicalTarget(expectedAsset) || !Array.isArray(record.created) || record.created.length !== expected.length) {
      throw new Error(`Migration journal ${journalId} created-file binding is invalid.`);
    }
    for (const item of expected) {
      const created = record.created.find((entry) => entry.role === item.role);
      if (!created || canonicalTarget(created.path) !== canonicalTarget(item.path)) throw new Error(`Migration journal ${journalId} created-file binding is invalid.`);
      const canonical = canonicalTarget(item.path);
      if (!inside(rollbackRoot, canonical) || seen.has(canonical) || !fs.existsSync(canonical) || fs.lstatSync(canonical).isSymbolicLink()) {
        throw new Error(`Migration journal ${journalId} cannot prove ownership of ${item.path}.`);
      }
      const currentDigest = digest(fs.readFileSync(canonical));
      if (currentDigest !== created.digest) throw new Error(`Migration journal ${journalId} created file changed after migration: ${item.path}`);
      seen.add(canonical);
      targets.push(canonical);
    }
    const asset = readYaml(expectedAsset);
    if (asset.kind !== record.kind || asset.metadata?.id !== record.id || asset.metadata?.version !== record.version || asset.metadata?.labels?.migrationId !== journalId || digest(asset) !== record.digest) {
      throw new Error(`Migration journal ${journalId} cannot prove migration ownership of ${expectedAsset}.`);
    }
  }
  return targets;
}

function migrationAssetRoot(workspace) {
  let current = workspace;
  for (const segment of ["catalogs", "organization", "assets"]) {
    current = path.join(current, segment);
    if (!fs.existsSync(current) || fs.lstatSync(current).isSymbolicLink()) throw new Error(`Migration asset root must be a real Workspace directory: ${current}`);
  }
  const canonical = fs.realpathSync(current);
  if (!inside(workspace, canonical)) throw new Error(`Migration asset root must remain inside the Workspace: ${canonical}`);
  return canonical;
}

function assertMigrationDestination(assetRoot, candidate) {
  const canonical = canonicalTarget(candidate);
  if (!inside(assetRoot, canonical)) throw new Error(`Migration destination must remain inside the Organization asset root: ${canonical}`);
  return canonical;
}

function canonicalTarget(candidate) {
  const target = path.resolve(String(candidate));
  let existing = target;
  const suffix = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(fs.realpathSync(existing), ...suffix);
}

function createdFile(file, role) {
  return { path: file, role, digest: digest(fs.readFileSync(file)) };
}

function inside(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function buildAssets(template, sourceFile, componentDigest) {
  const originalId = safeId(template.id ?? path.basename(path.dirname(sourceFile)));
  const id = originalId.endsWith("-harness") ? originalId.slice(0, -8) || originalId : originalId;
  const version = String(template.version ?? "0.1.0");
  const domain = safeId(template.runtimePatterns?.domain ?? template.harnessLayer ?? template.scope ?? id);
  const include = unique(template.matchPolicy?.positiveSignals ?? template.matchSignals?.include ?? [domain]);
  const exclude = unique(template.matchPolicy?.negativeSignals ?? template.matchSignals?.exclude ?? []);
  const requiredEvidence = unique(template.evidenceContract?.requiredArtifacts ?? template.capabilities?.flatMap((capability) => capability.requiredEvidence ?? []) ?? ["validation-result"]);
  const profile = {
    apiVersion: API_VERSION,
    kind: "HarnessProfile",
    metadata: { id, version, name: String(template.name ?? title(id)), description: normalizedDescription(template.description, id), lifecycle: "published", owner: "migrated-v2", labels: { migratedFrom: originalId } },
    spec: {
      classification: { domain, role: safeId(`${domain}-engineering`), taskClass: safeId(`${template.runtimePatterns?.harnessLayer ?? template.harnessLayer ?? "engineering"}-task`) },
      boundary: {
        inScope: unique([...(template.productBoundary?.inScope ?? []), ...(template.runtimePatterns?.domainExecution?.requiredActions ?? []).map((item) => item.action), `Engineering work supported by the ${originalId} v2 contract.`]).slice(0, 20),
        outOfScope: unique([...(template.productBoundary?.outOfScope ?? []), ...exclude, "Capabilities not supported by source evidence or declared validators."]).slice(0, 20)
      },
      match: { positiveConcepts: unique([domain, "executable-engineering", ...include.map((value) => safeConcept(value))]).slice(0, 30), negativeConcepts: unique(exclude.map((value) => safeConcept(value))).slice(0, 20), requiredEvidenceKinds: ["source-code", "build-manifest"] },
      components: [{ id: "engineering-validation", version: "1.0.0", required: true }],
      acceptance: { requiredEvidence: requiredEvidence.slice(0, 30), blockingValidators: ["approved-command-only", "validation-exit-code"] },
      evaluationPackRef: `${id}@${version}`
    },
    provenance: { sourceDigests: [digest(fs.readFileSync(sourceFile))], ontologyVersion: "software-engineering@1.0.0", policyVersion: "default-matcher@1.0.0" }
  };
  const bundle = {
    apiVersion: API_VERSION,
    kind: "HarnessBundle",
    metadata: { id, version, name: `${profile.metadata.name} Bundle`, description: `Immutable resolved execution package migrated from ${originalId}.`, lifecycle: "published", owner: "migrated-v2", labels: { migratedFrom: originalId } },
    spec: {
      profile: { id, version, digest: digest(profile) },
      resolvedComponents: [{ id: "engineering-validation", version: "1.0.0", digest: componentDigest, required: true }],
      executionPlan: ["discover-project-commands", "run-approved-validation"],
      constraints: ["Execute only administrator-approved commands in an isolated workspace.", "Preserve source and credential boundaries from the source Harness contract."],
      evidence: requiredEvidence.slice(0, 30),
      validators: ["approved-command-only", "validation-exit-code"],
      exports: [{ adapter: "evopilot", path: "exports/evopilot/template.yaml" }]
    },
    provenance: { ...profile.provenance }
  };
  return [{ asset: profile, sourceFile }, { asset: bundle, sourceFile, exportFile: sourceFile }];
}

function normalizedDescription(value, id) {
  const text = String(value ?? "").trim();
  return text.length >= 16 ? text : `Migrated Harness Profile for ${id} engineering tasks.`;
}

function safeConcept(value) {
  return safeId(value, "signal");
}

function title(value) {
  return String(value).split("-").map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
}

function removeEmptyParents(directory, boundary) {
  let current = directory;
  const resolvedBoundary = path.resolve(boundary);
  while (path.resolve(current).startsWith(`${resolvedBoundary}${path.sep}`)) {
    if (!fs.existsSync(current) || fs.readdirSync(current).length) break;
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}
