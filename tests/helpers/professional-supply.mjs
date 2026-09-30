import fs from "node:fs";
import path from "node:path";
import { readYaml, writeYaml } from "../../src/v3/utils.mjs";
import { publishCatalog } from "../../src/v3/catalog.mjs";
import { initializeWorkspace } from "../../src/v3/workspace.mjs";

// Explicit test-owned Organization supply. Never writes the Built-in Catalog
// and never participates in ordinary Workspace initialization.
export function installProfessionalFixture(home) {
  const root = path.resolve(import.meta.dirname, "../..");
  const assets = path.join(home, "catalogs/organization/assets");
  fs.cpSync(path.join(root, "assets/v3"), assets, { recursive: true });
  fs.mkdirSync(path.join(home, "ontology"), { recursive: true });
  fs.copyFileSync(path.join(root, "ontology/builtin/software-engineering.yaml"), path.join(home, "ontology/reviewed-professional-fixture.yaml"));
  const result = publishCatalog({ roots: [assets], out: path.join(home, "catalogs/organization"), catalogId: "organization" });
  if (result.status !== "PUBLISHED") throw new Error("Professional test supply is invalid.");
}

export function initializeProfessionalFixture(home, options) {
  const result = initializeWorkspace(home, options);
  installProfessionalFixture(home);
  return result;
}

export function initializeLegacyProfessionalFixture(home) {
  initializeProfessionalFixture(home);
  const file = path.join(home, "ontology/reviewed-professional-fixture.yaml");
  const document = readYaml(file);
  // Explicit fixture declaration: a client may reference the broad cache
  // Catalog while retaining its own independently authored role boundary.
  document.spec.concepts.find(item => item.id === "redis-client").parents.push("distributed-cache");
  writeYaml(file, document);
}
