import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJson } from "./utils.mjs";
import { PACKAGE_ROOT } from "./constants.mjs";

export const MODEL_READINESS_SCHEMA = "evopilot-harness-model-readiness/v1";
const RECEIPT_SCHEMA = "evopilot-harness-model-verification-receipt/v1";

export function inspectModelReadiness(home, modelsFile, selectedId) {
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
  const configurationBytes = fs.readFileSync(resolvedModels);
  const configurationDigest = digestBytes(configurationBytes);
  const profile = configuredProfile(configurationBytes, selectedId);
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
    && receipt.connectionVerified === true
    && sameIdentity(receipt.model, profile.model);
  return result(verified ? "CONFIGURED_AND_VERIFIED" : "CONFIGURED_UNVERIFIED", workspace, resolvedModels, receiptFile, {
    configured: true,
    credentialConfigured: true,
    connectionVerified: verified,
    initializationStatus: verified ? "READY" : "ACTION_REQUIRED",
    configurationDigest,
    model: profile.model,
    ...(verified ? { verification: publicReceipt(receipt) } : {}),
    nextAction: verified ? "use-workspace-model-configuration" : "run-llm-v3-initialize"
  });
}

function configuredProfile(configurationBytes, selectedId) {
  if (selectedId === "") return null;
  let document;
  try { document = JSON.parse(configurationBytes); } catch { return null; }
  const candidates = Array.isArray(document?.models) ? document.models : [];
  const eligible = (item) => item?.vendor && (item.id ?? item.modelName) && item.url;
  const profile = selectedId == null
    ? candidates.find(eligible)
    : candidates.find((item) => item?.id === selectedId && eligible(item));
  if (!profile) return null;
  const apiKeyEnv = profile.apiKey ? undefined : profile.apiKeyEnv;
  return {
    apiKeyEnv,
    credentialConfigured: Boolean(profile.apiKey || (apiKeyEnv && process.env[apiKeyEnv])),
    model: { id: profile.id, name: profile.name, provider: profile.vendor, model: profile.modelName ?? profile.id, url: profile.url, apiKeyEnv: profile.apiKey ? undefined : apiKeyEnv }
  };
}

// A changed or unreadable configuration cannot inherit an in-flight check.
export function modelVerificationDrift(home, modelsFile, selectedId, expectedDigest) {
  try {
    const current = inspectModelReadiness(home, modelsFile, selectedId);
    if (typeof expectedDigest === "string" && current.configurationDigest === expectedDigest
      && current.configured && current.credentialConfigured) return null;
  } catch { /* removed, replaced, or unreadable configuration fails closed */ }
  const workspace = path.resolve(home);
  return result("CONFIGURATION_CHANGED", workspace, path.resolve(modelsFile), path.join(workspace, "model-readiness.json"), {
    connectionVerified: false,
    initializationStatus: "ACTION_REQUIRED",
    nextAction: "inspect-model-configuration-and-run-llm-v3-initialize"
  });
}

export function recordModelVerification(home, modelsFile, doctor, selectedId, expectedDigest) {
  const bound = arguments.length >= 5;
  if (bound) {
    const drift = modelVerificationDrift(home, modelsFile, selectedId, expectedDigest);
    if (drift) return drift;
  }
  const workspace = path.resolve(home);
  const resolvedModels = path.resolve(modelsFile);
  let configurationBytes;
  try {
    if (inside(path.resolve(PACKAGE_ROOT), canonicalTarget(resolvedModels))) throw new Error("Model configuration must remain outside the evopilot-harness Release.");
    if (!fs.existsSync(resolvedModels) || !fs.statSync(resolvedModels).isFile()) throw new Error(`Model configuration does not exist: ${resolvedModels}`);
    configurationBytes = fs.readFileSync(resolvedModels);
  } catch (error) {
    if (bound) return modelVerificationDrift(home, modelsFile, selectedId, undefined);
    throw error;
  }
  if (doctor?.status !== "READY" || doctor.connectionVerified !== true) throw new Error("A successful live model doctor result is required.");
  const configurationDigest = digestBytes(configurationBytes);
  if (bound && configurationDigest !== expectedDigest) return modelVerificationDrift(home, modelsFile, selectedId, undefined);
  const profile = configuredProfile(configurationBytes, selectedId);
  if (!profile?.credentialConfigured || !sameIdentity(doctor.model, profile.model)) throw new Error("Model doctor identity must match the selected configured profile.");
  fs.mkdirSync(workspace, { recursive: true });
  const receiptFile = path.join(workspace, "model-readiness.json");
  const receipt = {
    schema: RECEIPT_SCHEMA,
    modelsFile: resolvedModels,
    configurationDigest,
    model: profile.model,
    connectionVerified: true,
    doctorResponseDigest: doctor.responseDigest,
    verifiedAt: doctor.completedAt
  };
  if (bound) {
    const drift = modelVerificationDrift(home, modelsFile, selectedId, expectedDigest);
    if (drift) return drift;
  }
  writeJson(receiptFile, receipt);
  fs.chmodSync(receiptFile, 0o600);
  if (bound) {
    const drift = modelVerificationDrift(home, modelsFile, selectedId, expectedDigest);
    if (drift) return drift;
  }
  const readiness = inspectModelReadiness(workspace, resolvedModels, selectedId);
  if (bound && readiness.configurationDigest !== expectedDigest) return modelVerificationDrift(home, modelsFile, selectedId, undefined);
  return readiness;
}

// A failed live recheck must not leave the earlier successful receipt active.
// Only invalidate the configuration actually checked, preserving unrelated or
// newly changed bindings and the old receipt metadata for diagnosis.
export function invalidateModelVerification(home, modelsFile, configurationDigest, checkedModel) {
  const receiptFile = path.join(path.resolve(home), "model-readiness.json");
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8")); } catch { return; }
  if (receipt?.schema !== RECEIPT_SCHEMA || receipt.modelsFile !== path.resolve(modelsFile)
    || receipt.configurationDigest !== configurationDigest || receipt.connectionVerified !== true
    || !sameIdentity(receipt.model, checkedModel)) return;
  writeJson(receiptFile, {...receipt, connectionVerified: false, invalidatedAt: new Date().toISOString()});
  fs.chmodSync(receiptFile, 0o600);
}

function sameIdentity(actual, expected) {
  const valid = (model) => model && typeof model === "object" && !Array.isArray(model)
    && (model.id == null || (typeof model.id === "string" && model.id.length > 0))
    && ["provider", "model", "url"].every((key) => typeof model[key] === "string" && model[key].length > 0);
  return Boolean(valid(actual) && valid(expected)
    && ["id", "provider", "model", "url"].every((key) => actual[key] === expected[key]));
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
