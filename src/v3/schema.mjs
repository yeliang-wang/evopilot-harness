import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { PACKAGE_ROOT } from "./constants.mjs";
import { readYaml, walkFiles } from "./utils.mjs";

const SCHEMAS = {
  HarnessComponent: "harness-asset-v3.schema.json",
  HarnessProfile: "harness-asset-v3.schema.json",
  HarnessBundle: "harness-asset-v3.schema.json",
  OntologyPack: "ontology-pack-v1.schema.json",
  MatchPolicyPack: "match-policy-pack-v1.schema.json",
  AdvisorPolicyPack: "advisor-policy-pack-v1.schema.json",
  EvaluationPack: "evaluation-pack-v1.schema.json"
};

const validatorCache = new Map();

export function validateDocument(document, file = "<memory>") {
  const schemaName = SCHEMAS[document?.kind];
  if (!schemaName) return { status: "FAILED", valid: false, file, kind: document?.kind ?? null, errors: [{ path: "/kind", message: "unsupported v3 document kind" }] };
  let validate = validatorCache.get(schemaName);
  if (!validate) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "schemas", schemaName), "utf8")));
    validatorCache.set(schemaName, validate);
  }
  const valid = Boolean(validate(document));
  return {
    status: valid ? "VALIDATED" : "FAILED",
    valid,
    file,
    kind: document.kind,
    id: document?.metadata?.id ?? null,
    version: document?.metadata?.version ?? null,
    errors: valid ? [] : (validate.errors ?? []).map((error) => ({
      path: error.instancePath || "/",
      keyword: error.keyword,
      message: error.message,
      params: error.params
    }))
  };
}

export function validateFile(file) {
  try {
    return validateDocument(readYaml(file), file);
  } catch (error) {
    return { status: "FAILED", valid: false, file, kind: null, errors: [{ path: "/", message: error instanceof Error ? error.message : String(error) }] };
  }
}

export function validateTree(root) {
  const files = walkFiles(root, (file) => /(?:asset|ontology|policy)\.ya?ml$/i.test(path.basename(file)) || file.endsWith(".yaml"));
  const documents = files.map(validateFile);
  return {
    schema: "evopilot-harness-schema-validation/v3",
    status: documents.length > 0 && documents.every((item) => item.valid) ? "VALIDATED" : "FAILED",
    root: path.resolve(root),
    documentCount: documents.length,
    passedCount: documents.filter((item) => item.valid).length,
    failedCount: documents.filter((item) => !item.valid).length,
    documents
  };
}
