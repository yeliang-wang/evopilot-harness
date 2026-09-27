import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const hash = {type: "string", pattern: "^sha256:[a-f0-9]{64}$"};
const id = {type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$"};
const object = (properties, required = Object.keys(properties)) => ({type: "object", additionalProperties: false, required, properties});
const array = (items, maxItems = 4096) => ({type: "array", maxItems, items});
const nullableHash = {anyOf: [hash, {type: "null"}]};
const decision = object({decision: {const: "AUTHORIZED"}, actor: {type: "string", minLength: 1, maxLength: 256}, authorizationDigest: hash});
const scope = object({tenantId: id, workspaceId: id, projectId: id});
const entry = object({kind: id, id, version: {anyOf: [{type: "string", pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$"}, {type: "null"}]},
  schema: {type: "string", minLength: 1}, category: {enum: ["ASSET", "DEPENDENCY"]}, objectDigest: hash, fileDigest: hash,
  bytes: {type: "integer", minimum: 1, maximum: 16777216}, path: {type: "string", pattern: "^semantic-catalog/materials/[a-f0-9]{64}\\.json$"},
  scope, visibility: {enum: ["PUBLIC", "DOMAIN", "PRIVATE"]}, provenance: {type: "object"},
  publication: {type: ["object", "null"]}, parent: {anyOf: [{type: "null"}, object({artifactSetDigest: hash, jsonPointer: {const: "/spec/projectOntologySkill"}})]},
  dependencies: {...array(hash, 16384), uniqueItems: true}},
  ["kind", "id", "version", "schema", "objectDigest", "fileDigest", "bytes", "path", "scope", "visibility", "provenance", "parent", "dependencies"]);
const contracts = {
  "semantic-catalog-pointer": object({schema: {const: "evopilot-harness-semantic-catalog-pointer/v1"}, catalogId: id,
    generationPath: {type: "string", pattern: "^semantic-catalog/generations/[a-f0-9]{64}\\.json$"}, generationDigest: hash,
    previousPointerDigest: nullableHash, receiptDigest: hash, pointerDigest: hash}),
  "semantic-catalog": object({schema: {const: "evopilot-harness-semantic-catalog/v1"}, catalogId: id,
    entries: array(entry), revokedDigests: {...array(hash), uniqueItems: true}, generationDigest: hash,
    sets: array(object({scope, refs: {type: "object"}}))}, ["schema", "catalogId", "entries", "revokedDigests", "generationDigest"]),
  "semantic-catalog-receipt": object({schema: {const: "evopilot-harness-semantic-catalog-receipt/v1"}, catalogId: id,
    generationDigest: hash, expectedHead: nullableHash, action: {enum: ["PUBLISH", "ROLLBACK", "REVOKE"]}, requestDigest: hash,
    authorization: decision, receiptDigest: hash, transitionDigest: hash},
    ["schema", "catalogId", "generationDigest", "expectedHead", "action", "requestDigest", "authorization", "receiptDigest"]),
  "semantic-catalog-lock": object({schema: {const: "evopilot-harness-semantic-catalog-lock/v1"}, catalogId: id,
    nonce: {type: "string", pattern: "^[a-f0-9-]{36}$"}, pid: {type: "integer", minimum: 1}, hostDigest: hash, rootDigest: hash,
    receiptDigest: hash, requestDigest: hash, expectedHead: nullableHash, lockDigest: hash}),
  "semantic-catalog-recovery": object({schema: {const: "evopilot-harness-semantic-catalog-recovery/v1"}, catalogId: id,
    lockDigest: hash, expectedHead: nullableHash, recoveryRequestDigest: hash, publicationRequestDigest: hash,
    publicationOutcome: {enum: ["PREFLIGHT", "COMMITTED", "NOT_COMMITTED"]}, authorization: decision, recoveryDigest: hash},
    ["schema", "catalogId", "lockDigest", "expectedHead", "recoveryRequestDigest", "publicationOutcome", "authorization", "recoveryDigest"])
};
for (const [name, shape] of Object.entries(contracts)) {
  const file = path.join(root, "schemas", `${name}-v1.schema.json`);
  const value = JSON.stringify({$schema: "https://json-schema.org/draft/2020-12/schema", $id: `https://evopilot.dev/schemas/${name}-v1.schema.json`, ...shape}, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(file, "utf8") !== value) throw new Error(`Generated schema drift: ${name}`);
  } else fs.writeFileSync(file, value);
}
console.log(`Semantic Catalog wire schemas ${process.argv.includes("--check") ? "validated" : "generated"}: ${Object.keys(contracts).length}`);
