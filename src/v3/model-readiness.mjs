import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJson } from "./utils.mjs";
import { PACKAGE_ROOT } from "./constants.mjs";

export const MODEL_READINESS_SCHEMA = "evopilot-harness-model-readiness/v1";
const RECEIPT_SCHEMA = "evopilot-harness-model-verification-receipt/v1";

export function inspectModelReadiness(home, modelsFile) {
  const workspace = path.resolve(home);
  const resolvedModels = path.resolve(modelsFile ?? path.join(workspace, "models.json"));
  const receiptFile = path.join(workspace, "model-readiness.json");
  if (inside(path.resolve(PACKAGE_ROOT), canonicalTarget(resolvedModels))) return result("INVALID_CONFIGURATION_BOUNDARY", workspace, resolvedModels, receiptFile, {
    configured: false,
    connectionVerified: false,
    initializationStatus: "ACTION_REQUIRED",
    nextAction: "move-model-configuration-outside-release"
  });
  const configured = fs.existsSync(resolvedModels) && fs.statSync(resolvedModels).isFile();
  if (!configured) return result("NOT_CONFIGURED", workspace, resolvedModels, receiptFile, {
    configured: false,
    connectionVerified: false,
    initializationStatus: "ACTION_REQUIRED",
    nextAction: "configure-models-json-locally"
  });
  const configurationDigest = digestBytes(fs.readFileSync(resolvedModels));
  const profile = configuredProfile(resolvedModels);
  if (!profile) return result("NOT_CONFIGURED", workspace, resolvedModels, receiptFile, {
    configured: false,
    connectionVerified: false,
    initializationStatus: "ACTION_REQUIRED",
    configurationDigest,
    nextAction: "configure-model-profile-locally"
  });
  if (!profile.credentialConfigured) return result("CREDENTIAL_REQUIRED", workspace, resolvedModels, receiptFile, {
    configured: true,
    credentialConfigured: false,
    connectionVerified: false,
    initializationStatus: "ACTION_REQUIRED",
    configurationDigest,
    model: profile.model,
    nextAction: profile.apiKeyEnv ? `set-local-environment-variable:${profile.apiKeyEnv}` : "configure-model-credential-locally"
  });
  let receipt = null;
  try { receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8")); } catch { /* absent or invalid receipt is unverified */ }
  const verified = receipt?.schema === RECEIPT_SCHEMA
    && receipt.modelsFile === resolvedModels
    && receipt.configurationDigest === configurationDigest
    && receipt.connectionVerified === true;
  return result(verified ? "CONFIGURED_AND_VERIFIED" : "CONFIGURED_UNVERIFIED", workspace, resolvedModels, receiptFile, {
    configured: true,
    credentialConfigured: true,
    connectionVerified: verified,
    initializationStatus: verified ? "READY" : "ACTION_REQUIRED",
    configurationDigest,
    ...(verified ? { verification: publicReceipt(receipt) } : {}),
    nextAction: verified ? "use-workspace-model-configuration" : "run-llm-v3-initialize"
  });
}

function configuredProfile(modelsFile) {
  let document;
  try { document = JSON.parse(fs.readFileSync(modelsFile, "utf8")); } catch { return null; }
  const profile = (Array.isArray(document.models) ? document.models : []).find((item) => item?.vendor && (item.id ?? item.modelName) && item.url);
  if (!profile) return null;
  const apiKeyEnv = typeof profile.apiKeyEnv === "string" && profile.apiKeyEnv.trim() ? profile.apiKeyEnv.trim() : undefined;
  return {
    apiKeyEnv,
    credentialConfigured: Boolean(profile.apiKey || (apiKeyEnv && process.env[apiKeyEnv])),
    model: { id: profile.id, name: profile.name, provider: profile.vendor, model: profile.modelName ?? profile.id, url: profile.url, apiKeyEnv: profile.apiKey ? undefined : apiKeyEnv }
  };
}

export function recordModelVerification(home, modelsFile, doctor) {
  const workspace = path.resolve(home);
  const resolvedModels = path.resolve(modelsFile);
  if (inside(path.resolve(PACKAGE_ROOT), canonicalTarget(resolvedModels))) throw new Error("Model configuration must remain outside the evopilot-harness Release.");
  if (!fs.existsSync(resolvedModels) || !fs.statSync(resolvedModels).isFile()) throw new Error(`Model configuration does not exist: ${resolvedModels}`);
  if (doctor?.status !== "READY" || doctor.connectionVerified !== true) throw new Error("A successful live model doctor result is required.");
  fs.mkdirSync(workspace, { recursive: true });
  const receiptFile = path.join(workspace, "model-readiness.json");
  const receipt = {
    schema: RECEIPT_SCHEMA,
    modelsFile: resolvedModels,
    configurationDigest: digestBytes(fs.readFileSync(resolvedModels)),
    model: doctor.model,
    connectionVerified: true,
    doctorResponseDigest: doctor.responseDigest,
    verifiedAt: doctor.completedAt
  };
  writeJson(receiptFile, receipt);
  fs.chmodSync(receiptFile, 0o600);
  return inspectModelReadiness(workspace, resolvedModels);
}

function result(status, workspace, modelsFile, receiptFile, extra) {
  return { schema: MODEL_READINESS_SCHEMA, status, productInstallation: "INDEPENDENT", workspace, modelsFile, receiptFile, ...extra };
}

function publicReceipt(receipt) {
  return {
    configurationDigest: receipt.configurationDigest,
    model: receipt.model,
    doctorResponseDigest: receipt.doctorResponseDigest,
    verifiedAt: receipt.verifiedAt
  };
}

function digestBytes(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function canonicalTarget(target) {
  try { return fs.realpathSync(target); } catch { return path.resolve(target); }
}

function inside(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}
