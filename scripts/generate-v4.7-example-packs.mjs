import fs from "node:fs";
import path from "node:path";
import { stringify } from "yaml";
import { createProfessionalPack } from "../src/v4/semantics/professional-packs.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(root, "ontology", "examples");
const check = process.argv.includes("--check");

const examples = [
  create("DomainOntologyPack", "example-finance-domain", "example.finance", "Example Finance Domain", [
    concept("example.finance:account", "Account", "ENTITY", "An illustrative financial account; not universal business truth."),
    concept("example.finance:reconciliation", "Reconciliation", "WORKFLOW", "An illustrative reconciliation workflow.")
  ]),
  create("ProductOntologyPack", "example-crm-product", "example.crm", "Example CRM Product", [
    concept("example.crm:contact", "Contact", "ENTITY", "An illustrative CRM contact record."),
    concept("example.crm:pipeline", "Pipeline", "WORKFLOW", "An illustrative CRM opportunity pipeline.")
  ]),
  create("ProductOntologyPack", "example-erp-product", "example.erp", "Example ERP Product", [
    concept("example.erp:ledger", "Ledger", "DATA_ASSET", "An illustrative ERP ledger."),
    concept("example.erp:posting", "Posting", "ACTION", "An illustrative ERP posting action.")
  ]),
  create("DomainHarnessPack", "example-finance-harness-guidance", "example.finance.harness", "Example Finance Harness Guidance", [], {
    harnessGuidance: [{topic: "reconciliation", guidance: "Require explicit imbalance evidence, reviewer-visible alternatives, and rollback validation.", evidenceRefs: ["docs://example-only"]}]
  })
];

let failures = 0;
for (const pack of examples) {
  const file = path.join(outputRoot, `${pack.metadata.id}.yaml`);
  const expected = stringify(pack, {lineWidth: 120});
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== expected) {
      console.error(`v4.7 example Pack drift: ${path.relative(root, file)}`);
      failures += 1;
    }
  } else {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, expected);
  }
}

if (failures) process.exit(1);
console.log(`${check ? "Verified" : "Generated"} ${examples.length} v4.7 example Professional Packs.`);

function create(kind, id, namespace, name, concepts, extra = {}) {
  return createProfessionalPack({
    kind,
    metadata: {
      id,
      version: "1.0.0",
      name,
      namespace,
      root: "COMMUNITY",
      visibility: "PUBLIC",
      owner: "evopilot-harness-example-maintainers",
      provenance: {author: "evopilot-harness", reviewers: [], approvers: [], publishers: [], sourceRefs: ["docs://example-only"]},
      labels: {exampleOnly: "true", universalAuthority: "false"}
    },
    spec: {imports: [], concepts, equivalences: [], replacements: [], deprecations: [], rules: [], shapes: [], harnessGuidance: extra.harnessGuidance ?? []}
  });
}

function concept(conceptId, label, metaType, definition) {
  return {conceptId, label, metaType, definition, aliases: [], relationships: [], evidenceRefs: ["docs://example-only"]};
}
