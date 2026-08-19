import fs from "node:fs";
import path from "node:path";
import { executeV3Operation } from "../v3/cli.mjs";
import { digest, persistedJson } from "../v3/utils.mjs";
import { assertExternalWorkspace, assertWorkspaceTreeConfined, resolveWorkspacePath } from "./constants.mjs";
import { assertNoSensitiveMaterial } from "./security/sensitive.mjs";

const COMMON_SOURCE_FIELDS = [
  "sourceProjects", "sourceRoot", "githubRepositories", "attachments", "productionLogs",
  "historicalHarnesses", "notes", "goal", "researchUrls", "allowInternetResearch",
  "githubRef", "includeModules", "limit", "advisor", "modelsFile", "model",
  "advisorTimeoutMs", "reviewTimeoutMs", "now"
];

const DEFINITIONS = {
  "workspace.prepare": definition(["workspace", "init"], [], "direct"),
  "workspace.inspect": definition(["workspace", "status"], [], "direct"),
  "llm.inspect": definition(["llm", "v3-models"], ["modelsFile", "model"], "direct"),
  "llm.diagnose": definition(["llm", "v3-doctor"], ["modelsFile", "model", "timeoutMs"], "direct"),
  "evidence.produce": definition(["produce"], COMMON_SOURCE_FIELDS, "planned"),
  "proposal.inspect": definition(["proposal", "inspect"], ["proposalId"], "direct", "proposalId"),
  "proposal.validate": definition(["proposal", "validate"], ["proposalId"], "direct", "proposalId"),
  "proposal.review": definition(["proposal", "review"], ["proposalId", "modelsFile", "model", "advisorTimeoutMs", "reviewTimeoutMs"], "session", "proposalId"),
  "proposal.review.inspect": definition(["proposal", "review-inspect"], ["proposalId"], "direct", "proposalId"),
  "proposal.approve": definition(["proposal", "approve"], ["proposalId", "confirmedBy", "confirmation", "evaluationReviewed"], "session", "proposalId"),
  "proposal.publish": definition(["proposal", "publish"], ["proposalId"], "session", "proposalId"),
  "asset.validate": definition(["asset", "v3-validate"], ["source"], "direct"),
  "asset.test": definition(["asset", "v3-test"], ["source"], "direct"),
  "asset.inspect": definition(["asset", "v3-inspect"], ["assetId", "kind", "source"], "direct", "assetId"),
  "asset.sign": definition(["asset", "v3-sign"], ["file", "privateKey", "signature"], "planned"),
  "asset.verify": definition(["asset", "v3-verify"], ["file", "publicKey", "signature"], "direct"),
  "catalog.publish": definition(["catalog", "v3-publish"], ["source", "out", "catalogId", "generatedAt"], "publication"),
  "catalog.validate": definition(["catalog", "v3-validate"], ["source"], "direct"),
  "catalog.diff": definition(["catalog", "v3-diff"], ["left", "right"], "direct"),
  "catalog.sign": definition(["catalog", "v3-sign"], ["source", "privateKey", "signature"], "planned"),
  "catalog.verify": definition(["catalog", "v3-verify"], ["source", "publicKey", "signature"], "direct"),
  "registry.validate": definition(["registry", "v3-validate"], ["registry"], "direct"),
  "registry.sign": definition(["registry", "v3-sign"], ["registry", "privateKey", "signature"], "planned"),
  "registry.verify": definition(["registry", "v3-verify"], ["registry", "publicKey", "signature"], "direct"),
  "ontology.inspect": definition(["ontology", "inspect"], ["file"], "direct"),
  "ontology.validate": definition(["ontology", "validate"], ["file"], "direct"),
  "ontology.diff": definition(["ontology", "diff"], ["left", "right"], "direct"),
  "ontology.publish": definition(["ontology", "publish"], ["file"], "publication"),
  "policy.inspect": definition(["policy", "inspect"], ["file"], "direct"),
  "policy.validate": definition(["policy", "validate"], ["file"], "direct"),
  "policy.diff": definition(["policy", "diff"], ["left", "right"], "direct"),
  "policy.publish": definition(["policy", "publish"], ["file"], "publication"),
  "feedback.inspect": definition(["feedback", "inspect"], ["file"], "direct", "file"),
  "feedback.validate": definition(["feedback", "validate"], ["file", "now"], "direct", "file"),
  "feedback.ingest": definition(["feedback", "ingest"], ["file", "now"], "planned", "file"),
  "feedback.process": definition(["feedback", "process"], ["file", "now"], "planned", "file"),
  "feedback.aggregate": definition(["feedback", "aggregate"], ["now"], "planned"),
  "feedback.report": definition(["feedback", "report"], ["reportId"], "direct", "reportId"),
  "migration.plan": definition(["migrate", "v2-to-v3"], ["source"], "direct"),
  "migration.apply": definition(["migrate", "v2-to-v3"], ["source"], "planned", null, { apply: true }),
  "migration.rollback": definition(["migrate", "rollback"], ["migrationId"], "planned", "migrationId"),
  "keys.generate": definition(["keys", "generate"], ["privateKey", "publicKey"], "planned"),
  "evaluation.run": definition(["eval", "v3-run"], [], "direct"),
  "hub.snapshot": definition(["hub", "v3-snapshot"], ["out"], "planned")
};

const OPTION_NAMES = {
  sourceProjects: "source-project",
  sourceRoot: "source-root",
  githubRepositories: "github-repo",
  attachments: "attachment",
  productionLogs: "production-log",
  historicalHarnesses: "historical-harness",
  notes: "note",
  researchUrls: "research-url",
  allowInternetResearch: "allow-internet-research",
  githubRef: "github-ref",
  includeModules: "include-modules",
  modelsFile: "models-file",
  advisorTimeoutMs: "advisor-timeout-ms",
  reviewTimeoutMs: "review-timeout-ms",
  timeoutMs: "timeout-ms",
  confirmedBy: "confirmed-by",
  evaluationReviewed: "evaluation-reviewed",
  privateKey: "private-key",
  publicKey: "public-key",
  catalogId: "catalog-id",
  generatedAt: "generated-at"
};

export function engineCapabilities() {
  return Object.entries(DEFINITIONS).map(([id, value]) => ({
    id,
    access: value.access,
    inputFields: value.fields,
    mutating: value.access !== "direct" || ["workspace.prepare"].includes(id),
    publicationAuthorizationRequired: value.access === "publication"
  }));
}

export function engineOperationDefinition(operation) {
  return DEFINITIONS[operation] ?? null;
}

export async function invokeEngineOperation({ home, operation, input = {}, authority = "direct", idempotencyKey }) {
  const workspace = assertExternalWorkspace(home);
  const spec = DEFINITIONS[operation];
  if (!spec) throw operationError("UNKNOWN_OPERATION", `Unknown Engine operation: ${operation}`, "list-engine-capabilities");
  if (spec.access === "planned" && authority !== "planned") {
    throw operationError("PLAN_REQUIRED", `${operation} must be bound to a confirmed Agent Operation Plan.`, "create-and-confirm-operation-plan");
  }
  if (spec.access === "session" && authority !== "session") {
    throw operationError("SESSION_GATE_REQUIRED", `${operation} must pass the Agent Operation Session human gate.`, "use-session-lifecycle-tool");
  }
  if (spec.access === "publication" && authority !== "publication") {
    throw operationError("PUBLICATION_AUTHORIZATION_REQUIRED", `${operation} must pass a separate digest-bound publication authorization.`, "authorize-plan-publication-operation");
  }
  validateEngineOperationRequest({ home: workspace, operation, input });
  const receipt = idempotencyKey ? readOperationReceipt(workspace, idempotencyKey) : null;
  if (receipt) {
    if (receipt.operation !== operation || receipt.inputDigest !== digest(input)) {
      throw operationError("IDEMPOTENCY_RECEIPT_MISMATCH", `The idempotency receipt for ${idempotencyKey} is bound to different input.`, "stop-and-inspect-operation-receipt");
    }
    return persistedJson(receipt.result);
  }
  const positionals = [...spec.positionals];
  if (spec.idField) positionals.push(String(input[spec.idField]));
  const options = { workspace, ...spec.fixedOptions };
  for (const field of spec.fields) {
    if (field === spec.idField || input[field] == null) continue;
    const optionName = OPTION_NAMES[field] ?? camelToKebab(field);
    options[optionName] = normalizeOption(input[field]);
  }
  const response = await executeV3Operation({ positionals, options });
  const result = {
    schema: "evopilot-harness-engine-operation-result/v1",
    operation,
    workspace,
    exitCode: response.exitCode,
    status: response.result?.status ?? (response.exitCode === 0 ? "COMPLETED" : "FAILED"),
    result: response.result,
    nextAction: response.result?.nextAction ?? (response.exitCode === 0 ? "continue" : "inspect-engine-result")
  };
  if (idempotencyKey) writeOperationReceipt(workspace, idempotencyKey, operation, input, result);
  return result;
}

export function inspectEngineOperationReceipt(home, idempotencyKey) {
  return readOperationReceipt(assertExternalWorkspace(home), idempotencyKey);
}

export function isReadOnlyOperation(operation) {
  return DEFINITIONS[operation]?.access === "direct" && operation !== "workspace.prepare";
}

export function validateEngineOperationRequest({ home, operation, input = {} }) {
  const workspace = assertExternalWorkspace(home);
  const spec = DEFINITIONS[operation];
  if (!spec) throw operationError("UNKNOWN_OPERATION", `Unknown Engine operation: ${operation}`, "list-engine-capabilities");
  validateInput(spec, input, operation);
  assertNoSensitiveMaterial(input, "input");
  if (spec.access !== "direct" || operation === "workspace.prepare") assertWorkspaceTreeConfined(workspace);
  for (const target of operationWriteTargets(workspace, operation, input)) assertWorkspaceWriteTarget(workspace, target.field, target.path);
  return { operation, workspace, status: "VALIDATED" };
}

function definition(positionals, fields, access, idField = null, fixedOptions = {}) {
  return { positionals, fields, access, idField, fixedOptions };
}

function readOperationReceipt(home, idempotencyKey) {
  const file = receiptFile(home, idempotencyKey);
  if (!fs.existsSync(file)) return null;
  const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
  if (receipt.schema !== "evopilot-harness-engine-operation-receipt/v1" || receipt.idempotencyKey !== idempotencyKey) {
    throw operationError("IDEMPOTENCY_RECEIPT_BINDING_FAILURE", `Operation receipt binding failed at ${file}.`, "stop-and-inspect-operation-receipt");
  }
  const expected = digest({ schema: receipt.schema, idempotencyKey: receipt.idempotencyKey, operation: receipt.operation, inputDigest: receipt.inputDigest, result: receipt.result });
  if (receipt.receiptDigest !== expected) throw operationError("IDEMPOTENCY_RECEIPT_INTEGRITY_FAILURE", `Operation receipt integrity failed at ${file}.`, "stop-and-inspect-operation-receipt");
  return receipt;
}

function writeOperationReceipt(home, idempotencyKey, operation, input, result) {
  const file = receiptFile(home, idempotencyKey);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const receipt = {
    schema: "evopilot-harness-engine-operation-receipt/v1",
    idempotencyKey,
    operation,
    inputDigest: digest(input),
    result: persistedJson(result)
  };
  receipt.receiptDigest = digest(receipt);
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

function receiptFile(home, idempotencyKey) {
  const key = String(idempotencyKey ?? "");
  if (!/^[a-f0-9]{64}$/.test(key)) throw operationError("INVALID_IDEMPOTENCY_KEY", "idempotencyKey must be a 64-character lowercase SHA-256 hex value.", "repair-operation-idempotency-key");
  return resolveWorkspacePath(home, "agent-operation-receipts", `${key}.json`);
}

function validateInput(spec, input, operation) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw operationError("INVALID_INPUT", `${operation} input must be an object.`, "repair-operation-input");
  }
  const unknown = Object.keys(input).filter((field) => !spec.fields.includes(field));
  if (unknown.length) throw operationError("UNKNOWN_INPUT_FIELDS", `${operation} does not accept: ${unknown.join(", ")}`, "repair-operation-input");
  if (spec.idField && !String(input[spec.idField] ?? "").trim()) {
    throw operationError("MISSING_ID", `${operation} requires ${spec.idField}.`, "repair-operation-input");
  }
  for (const [field, value] of Object.entries(input)) {
    if (/path|file|root|source|attachment|log|key|registry|out|left|right/i.test(field) && typeof value === "string" && value.includes("\0")) {
      throw operationError("INVALID_PATH", `${field} contains an invalid NUL character.`, "repair-operation-input");
    }
  }
}

function operationWriteTargets(home, operation, input) {
  if (operation === "asset.sign") return [{ field: "signature", path: input.signature ?? `${path.resolve(String(input.file))}.sig.json` }];
  if (operation === "catalog.publish") return [{ field: "out", path: input.out ?? path.join(home, "catalogs/organization") }];
  if (operation === "catalog.sign") {
    const catalogFile = path.join(path.resolve(String(input.source ?? path.join(home, "catalogs/organization"))), "CATALOG.md");
    return [{ field: "signature", path: input.signature ?? `${catalogFile}.sig.json` }];
  }
  if (operation === "registry.sign") {
    const registry = path.resolve(String(input.registry ?? path.join(home, "harness-registry.yaml")));
    return [{ field: "signature", path: input.signature ?? `${registry}.sig.json` }];
  }
  if (operation === "keys.generate") {
    return [
      { field: "privateKey", path: input.privateKey ?? path.join(home, "keys/catalog-signing-private.pem") },
      { field: "publicKey", path: input.publicKey ?? path.join(home, "keys/catalog-signing-public.pem") }
    ];
  }
  if (operation === "hub.snapshot") return [{ field: "out", path: input.out ?? path.join(home, "cache/hub-snapshot.json") }];
  return [];
}

function assertWorkspaceWriteTarget(home, field, candidate) {
  const workspace = fs.realpathSync(home);
  const target = path.resolve(String(candidate));
  let existing = target;
  const suffix = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  const canonicalTarget = path.resolve(fs.realpathSync(existing), ...suffix);
  if (!inside(workspace, canonicalTarget)) {
    throw operationError("WORKSPACE_WRITE_BOUNDARY_VIOLATION", `${field} traverses a link outside the external Agent Workspace.`, "choose-workspace-owned-output-path");
  }
}

function inside(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function normalizeOption(value) {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "boolean" || typeof value === "number") return value;
  return String(value);
}

function camelToKebab(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function operationError(code, message, nextAction) {
  const error = new Error(message);
  error.name = "AgentOperationError";
  error.code = code;
  error.nextAction = nextAction;
  return error;
}
