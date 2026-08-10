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
  const plan = planV2Migration(sourceRoot, home);
  if (plan.status !== "READY") return { ...plan, status: "FAILED" };
  const migrationId = `v2-to-v3-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const records = [];
  const component = readYaml(path.join(home, "catalogs/builtin/assets/components/engineering-validation/asset.yaml"));
  const componentDigest = digest(component);
  const templates = walkFiles(path.resolve(sourceRoot), (file) => path.basename(file) === "template.yaml").map((file) => ({ file, template: readYaml(file) })).filter((item) => /^evopilot-harness-template\/v[12]$/.test(String(item.template?.schema)));
  for (const { file, template } of templates) {
    for (const item of buildAssets(template, file, componentDigest)) {
      const directory = ({ HarnessProfile: "profiles", HarnessBundle: "bundles" })[item.asset.kind];
      const destination = path.join(home, "catalogs/organization/assets", directory, item.asset.metadata.id, item.asset.metadata.version, "asset.yaml");
      if (fs.existsSync(destination)) {
        records.push({ status: "SKIPPED_EXISTS", path: destination, digest: digest(readYaml(destination)) });
        continue;
      }
      writeYaml(destination, item.asset);
      const created = [destination];
      if (item.asset.kind === "HarnessBundle") {
        const exportFile = path.join(path.dirname(destination), "exports/evopilot/template.yaml");
        fs.mkdirSync(path.dirname(exportFile), { recursive: true });
        fs.copyFileSync(file, exportFile);
        created.push(exportFile);
      }
      records.push({ status: "CREATED", path: destination, created, digest: digest(item.asset) });
    }
  }
  const journal = {
    schema: "evopilot-harness-migration-journal/v1",
    migrationId,
    type: "v2-to-v3",
    sourceRoot: path.resolve(sourceRoot),
    createdAt: new Date().toISOString(),
    sourceMutated: false,
    records
  };
  const journalFile = path.join(home, "migrations", `${migrationId}.json`);
  writeJson(journalFile, journal);
  return { schema: "evopilot-harness-migration-result/v3", status: "MIGRATED", migrationId, journalFile, templateCount: templates.length, createdAssetCount: records.filter((item) => item.status === "CREATED").length, skippedAssetCount: records.filter((item) => item.status === "SKIPPED_EXISTS").length, sourceMutated: false, nextAction: "asset-v3-validate" };
}

export function rollbackMigration(home, migrationId) {
  const journalFile = path.join(home, "migrations", `${safeId(migrationId)}.json`);
  if (!fs.existsSync(journalFile)) throw new Error(`Migration journal ${migrationId} was not found.`);
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
  const removed = [];
  for (const record of [...journal.records].reverse()) {
    for (const file of [...(record.created ?? [])].reverse()) {
      if (!fs.existsSync(file)) continue;
      fs.rmSync(file, { force: true });
      removed.push(file);
      removeEmptyParents(path.dirname(file), path.join(home, "catalogs/organization/assets"));
    }
  }
  journal.rolledBackAt = new Date().toISOString();
  journal.rollbackRemoved = removed;
  writeJson(journalFile, journal);
  return { schema: "evopilot-harness-migration-rollback/v3", status: "ROLLED_BACK", migrationId, removedCount: removed.length, removed, sourceMutated: false };
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
