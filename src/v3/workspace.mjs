import fs from "node:fs";
import path from "node:path";
import { CATALOG_SCHEMA, PACKAGE_ROOT, REGISTRY_SCHEMA, WORKSPACE_SCHEMA } from "./constants.mjs";
import { publishCatalog } from "./catalog.mjs";
import { copyTree, digest, readYaml, writeYaml } from "./utils.mjs";

const DIRECTORIES = [
  "catalogs/builtin",
  "catalogs/organization/assets/components",
  "catalogs/organization/assets/profiles",
  "catalogs/organization/assets/bundles",
  "catalogs/organization/proposals",
  "ontology",
  "policies/matcher",
  "policies/advisor",
  "policies/comparison",
  "policies/completeness",
  "evidence",
  "evaluations",
  "feedback/packages",
  "feedback/rejected",
  "feedback/reports",
  "comparisons/packages",
  "comparisons/rejected",
  "comparisons/reports",
  "comparisons/rescores",
  "comparisons/calibration/case-sets",
  "comparisons/calibration/reports",
  "learning/adapters",
  "learning/research/packages",
  "learning/research/rejected",
  "learning/contributions/packages",
  "learning/contributions/rejected",
  "learning/curriculum/entries",
  "learning/curriculum/snapshots",
  "learning/runs",
  "learning/completeness/reports",
  "learning/completeness/rescores",
  "learning/domain-role/proposals",
  "evolution-runs",
  "cache/github",
  "migrations",
  "keys"
];

export function initializeWorkspace(home, { force = false } = {}) {
  const resolved = path.resolve(home);
  fs.mkdirSync(resolved, { recursive: true });
  for (const directory of DIRECTORIES) fs.mkdirSync(path.join(resolved, directory), { recursive: true });
  const configFile = path.join(resolved, "config.yaml");
  if (!fs.existsSync(configFile) || force) {
    writeYaml(configFile, {
      schema: WORKSPACE_SCHEMA,
      engine: { mode: "read-only", packageRoot: PACKAGE_ROOT },
      catalogs: { builtin: "./catalogs/builtin", organization: "./catalogs/organization" },
      ontology: "./ontology",
      policies: { matcher: "./policies/matcher", advisor: "./policies/advisor", comparison: "./policies/comparison", completeness: "./policies/completeness" },
      models: { mode: "manual-read-only", file: path.join(resolved, "models.json") }
    });
  }
  const modelMigration = prepareWorkspaceModelConfiguration(resolved);
  syncBuiltin(home, force);
  const registryFile = path.join(resolved, "harness-registry.yaml");
  if (!fs.existsSync(registryFile) || force) {
    writeYaml(registryFile, {
      schema: REGISTRY_SCHEMA,
      generatedBy: "evopilot-harness@3",
      catalogs: [
        { id: "organization", enabled: true, priority: 200, root: "./catalogs/organization" },
        { id: "builtin", enabled: true, priority: 100, root: "./catalogs/builtin" }
      ]
    });
  }
  return workspaceStatus(resolved, { modelMigration });
}

function prepareWorkspaceModelConfiguration(home) {
  const configFile = path.join(home, "config.yaml");
  const config = readYaml(configFile);
  const configured = config.models?.file;
  const legacyPackageRoot = config.engine?.packageRoot;
  const legacyDefault = typeof legacyPackageRoot === "string" ? path.join(legacyPackageRoot, "models.json") : null;
  let migrated = false;
  if (typeof configured === "string" && legacyDefault && path.resolve(configured) === path.resolve(legacyDefault) && !fs.existsSync(configured)) {
    config.models.file = path.join(home, "models.json");
    writeYaml(configFile, config);
    migrated = true;
  }
  const template = path.join(home, "models.example.json");
  if (!fs.existsSync(template)) fs.copyFileSync(path.join(PACKAGE_ROOT, "models.example.json"), template);
  return { migrated, legacyDefault: migrated ? legacyDefault : undefined };
}

export function resolveWorkspaceModelsFile(home, explicit) {
  if (typeof explicit === "string" && explicit.trim()) return path.resolve(explicit.trim());
  const resolved = path.resolve(home);
  try {
    const configured = readYaml(path.join(resolved, "config.yaml"))?.models?.file;
    if (typeof configured === "string" && configured.trim()) {
      return path.resolve(resolved, configured.trim());
    }
  } catch { /* an uninitialized Workspace uses the documented external default */ }
  return path.join(resolved, "models.json");
}

export function syncBuiltin(home, force = false) {
  const builtinRoot = path.join(path.resolve(home), "catalogs/builtin");
  const assetsRoot = path.join(builtinRoot, "assets");
  if (force && fs.existsSync(assetsRoot)) fs.rmSync(assetsRoot, { recursive: true, force: true });
  copyTree(path.join(PACKAGE_ROOT, "assets/v3"), assetsRoot);
  copyTree(path.join(PACKAGE_ROOT, "ontology/builtin"), path.join(home, "ontology/builtin"));
  copyTree(path.join(PACKAGE_ROOT, "policies/matcher"), path.join(home, "policies/matcher"));
  syncVersionedPacks(path.join(PACKAGE_ROOT, "policies/advisor"), path.join(home, "policies/advisor"), force);
  syncVersionedPacks(path.join(PACKAGE_ROOT, "policies/comparison"), path.join(home, "policies/comparison"), force);
  syncVersionedPacks(path.join(PACKAGE_ROOT, "policies/completeness"), path.join(home, "policies/completeness"), force);
  const catalogFile = path.join(builtinRoot, "catalog.yaml");
  writeYaml(catalogFile, {
    schema: CATALOG_SCHEMA,
    id: "builtin",
    lifecycle: "published",
    source: "engine-bootstrap",
    sourceDigest: digest({ assets: digestDirectory(assetsRoot) })
  });
  const publication = publishCatalog({ roots: [assetsRoot], out: builtinRoot, catalogId: "builtin", generatedAt: "2026-08-10T00:00:00.000Z" });
  if (publication.status !== "PUBLISHED") throw new Error(`Built-in Catalog publication failed: ${JSON.stringify(publication.validation?.failures ?? publication)}`);
}

function syncVersionedPacks(source, target, force) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const sourceFile = path.join(source, entry.name);
    const document = readYaml(sourceFile);
    const targetFile = path.join(target, `${document.metadata.id}@${document.metadata.version}.yaml`);
    if (force || !fs.existsSync(targetFile)) fs.copyFileSync(sourceFile, targetFile);
  }
}

export function workspaceStatus(home, { modelMigration } = {}) {
  const resolved = path.resolve(home);
  const requiredFiles = ["config.yaml", "harness-registry.yaml"];
  const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(resolved, file)));
  let config = null;
  try { config = readYaml(path.join(resolved, "config.yaml")); } catch { /* reported below */ }
  const modelsFile = resolveWorkspaceModelsFile(resolved);
  const modelsTemplate = path.join(resolved, "models.example.json");
  return {
    schema: "evopilot-harness-workspace-status/v3",
    status: missing.length === 0 && config?.schema === WORKSPACE_SCHEMA ? "READY" : "NOT_INITIALIZED",
    home: resolved,
    engine: { packageRoot: PACKAGE_ROOT, mode: "read-only", mutationAllowed: false, filesystemWritable: canWrite(PACKAGE_ROOT) },
    workspace: { writable: canWrite(resolved), missing },
    models: {
      mode: "manual-read-only",
      file: modelsFile,
      configured: fs.existsSync(modelsFile),
      template: modelsTemplate,
      templateAvailable: fs.existsSync(modelsTemplate),
      migratedLegacyDefault: Boolean(modelMigration?.migrated),
      nextAction: fs.existsSync(modelsFile) ? "inspect-model-configuration" : "copy-template-and-add-api-key"
    },
    paths: {
      config: path.join(resolved, "config.yaml"),
      registry: path.join(resolved, "harness-registry.yaml"),
      builtinCatalog: path.join(resolved, "catalogs/builtin"),
      organizationCatalog: path.join(resolved, "catalogs/organization"),
      feedback: path.join(resolved, "feedback"),
      comparisons: path.join(resolved, "comparisons")
      ,learning: path.join(resolved, "learning")
    }
  };
}

export function requireWorkspace(home) {
  const status = workspaceStatus(home);
  if (status.status !== "READY") throw new Error(`Harness workspace is not initialized at ${status.home}. Run workspace init.`);
  return status;
}

function canWrite(target) {
  try {
    fs.accessSync(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function digestDirectory(root) {
  const values = [];
  if (!fs.existsSync(root)) return values;
  for (const directory of fs.readdirSync(root).sort()) values.push(directory);
  return values;
}
