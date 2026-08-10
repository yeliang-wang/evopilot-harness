import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import { API_VERSION, CATALOG_BLOCK, CATALOG_SCHEMA } from "./constants.mjs";
import { canonicalJson, digest, ensureRelative, readYaml, walkFiles, writeJson } from "./utils.mjs";
import { validateDocument } from "./schema.mjs";

export function discoverAssets(roots) {
  const seen = new Map();
  for (const root of roots.map((item) => path.resolve(item))) {
    for (const file of walkFiles(root, (candidate) => path.basename(candidate) === "asset.yaml")) {
      let asset;
      try { asset = readYaml(file); } catch { continue; }
      if (asset?.apiVersion !== API_VERSION || !["HarnessComponent", "HarnessProfile", "HarnessBundle"].includes(asset?.kind)) continue;
      const key = `${asset.kind}:${asset.metadata?.id}@${asset.metadata?.version}`;
      if (!seen.has(key)) seen.set(key, { file, root, asset, digest: digest(asset) });
    }
  }
  return [...seen.values()].sort((a, b) => assetKey(a.asset).localeCompare(assetKey(b.asset)));
}

export function validateAssets(roots, { verifyReferences = true } = {}) {
  const records = discoverAssets(roots);
  const checks = records.map((record) => validateDocument(record.asset, record.file));
  const referenceChecks = verifyReferences ? validateReferences(records) : [];
  const failures = [...checks.filter((item) => !item.valid), ...referenceChecks.filter((item) => item.status === "FAIL")];
  return {
    schema: "evopilot-harness-asset-validation/v3",
    status: records.length > 0 && failures.length === 0 ? "VALIDATED" : "FAILED",
    assetCount: records.length,
    kindCounts: countBy(records.map((record) => record.asset.kind)),
    checks,
    referenceChecks,
    failures
  };
}

export function publishCatalog({ roots, out, catalogId = "organization", generatedAt = new Date().toISOString() }) {
  const validation = validateAssets(roots);
  if (validation.status !== "VALIDATED") return { schema: "evopilot-harness-catalog-publish/v3", status: "FAILED", validation };
  const output = path.resolve(out);
  fs.mkdirSync(output, { recursive: true });
  const records = discoverAssets(roots);
  const entries = [];
  for (const record of records) {
    const destination = path.join(output, "assets", kindDirectory(record.asset.kind), record.asset.metadata.id, record.asset.metadata.version, "asset.yaml");
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (path.resolve(record.file) !== path.resolve(destination)) {
      fs.copyFileSync(record.file, destination);
      copyExports(record.file, destination);
    }
    const bundleProfile = record.asset.kind === "HarnessBundle" ? records.find((candidate) => candidate.asset.kind === "HarnessProfile" && candidate.asset.metadata.id === record.asset.spec.profile.id && candidate.asset.metadata.version === record.asset.spec.profile.version)?.asset : undefined;
    entries.push(JSON.parse(JSON.stringify({
      kind: record.asset.kind,
      id: record.asset.metadata.id,
      version: record.asset.metadata.version,
      lifecycle: record.asset.metadata.lifecycle,
      assetPath: `./${ensureRelative(output, destination).split(path.sep).join("/")}`,
      assetDigest: digest(record.asset),
      classification: record.asset.kind === "HarnessProfile" ? record.asset.spec.classification : bundleProfile?.spec.classification,
      exportAdapters: record.asset.kind === "HarnessBundle" ? (record.asset.spec.exports ?? []).map((item) => item.adapter) : undefined
    })));
  }
  const index = {
    schema: CATALOG_SCHEMA,
    catalogId,
    generatedAt,
    generatedBy: "evopilot-harness@3",
    assetApiVersion: API_VERSION,
    entryCount: entries.length,
    entries
  };
  index.catalogDigest = digest(catalogDigestInput(index));
  const markdown = renderCatalog(index);
  fs.writeFileSync(path.join(output, "CATALOG.md"), markdown, "utf8");
  writeJson(path.join(output, "catalog.lock.json"), { ...index, markdownDigest: digest(markdown) });
  return {
    schema: "evopilot-harness-catalog-publish/v3",
    status: "PUBLISHED",
    catalogId,
    catalogRoot: output,
    catalogDigest: index.catalogDigest,
    entryCount: entries.length,
    validation
  };
}

export function validateCatalog(root) {
  const catalogRoot = path.resolve(root);
  const file = path.join(catalogRoot, "CATALOG.md");
  const checks = [];
  if (!fs.existsSync(file)) return failedCatalog(catalogRoot, [{ id: "catalog-file", status: "FAIL", evidence: [`missing=${file}`] }]);
  const markdown = fs.readFileSync(file, "utf8");
  const index = extractIndex(markdown);
  checks.push({ id: "catalog-index", status: index ? "PASS" : "FAIL", evidence: [index ? `schema=${index.schema}` : "machine index missing"] });
  if (!index) return failedCatalog(catalogRoot, checks);
  checks.push({ id: "catalog-schema", status: index.schema === CATALOG_SCHEMA ? "PASS" : "FAIL", evidence: [`schema=${index.schema}`] });
  const entries = Array.isArray(index.entries) ? index.entries : [];
  const records = [];
  for (const entry of entries) {
    const assetFile = path.resolve(catalogRoot, entry.assetPath);
    if (!assetFile.startsWith(`${catalogRoot}${path.sep}`)) {
      checks.push({ id: `asset-path:${entry.id}`, status: "FAIL", evidence: ["path escapes catalog"] });
      continue;
    }
    if (!fs.existsSync(assetFile)) {
      checks.push({ id: `asset-file:${entry.id}`, status: "FAIL", evidence: [`missing=${assetFile}`] });
      continue;
    }
    const asset = readYaml(assetFile);
    const assetDigest = digest(asset);
    const schema = validateDocument(asset, assetFile);
    checks.push({ id: `asset-schema:${entry.kind}:${entry.id}@${entry.version}`, status: schema.valid ? "PASS" : "FAIL", evidence: schema.valid ? [] : schema.errors });
    checks.push({
      id: `asset-identity:${entry.kind}:${entry.id}@${entry.version}`,
      status: asset.kind === entry.kind && asset.metadata?.id === entry.id && asset.metadata?.version === entry.version && asset.metadata?.lifecycle === entry.lifecycle ? "PASS" : "FAIL",
      evidence: [`catalog=${entry.kind}:${entry.id}@${entry.version}/${entry.lifecycle}`, `asset=${asset.kind}:${asset.metadata?.id}@${asset.metadata?.version}/${asset.metadata?.lifecycle}`]
    });
    checks.push({ id: `asset-digest:${entry.kind}:${entry.id}@${entry.version}`, status: assetDigest === entry.assetDigest ? "PASS" : "FAIL", evidence: [`expected=${entry.assetDigest}`, `actual=${assetDigest}`] });
    records.push({ file: assetFile, root: catalogRoot, asset, digest: assetDigest });
  }
  checks.push(...validateReferences(records));
  const calculated = digest(catalogDigestInput(index));
  checks.push({ id: "catalog-digest", status: calculated === index.catalogDigest ? "PASS" : "FAIL", evidence: [`expected=${index.catalogDigest}`, `actual=${calculated}`] });
  return {
    schema: "evopilot-harness-catalog-validation/v3",
    status: checks.every((check) => check.status === "PASS") ? "VALIDATED" : "FAILED",
    catalogRoot,
    catalogId: index.catalogId,
    entryCount: entries.length,
    catalogDigest: index.catalogDigest,
    checks
  };
}

export function generateSigningKey(privateKeyFile, publicKeyFile) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  fs.mkdirSync(path.dirname(privateKeyFile), { recursive: true });
  fs.writeFileSync(privateKeyFile, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  fs.writeFileSync(publicKeyFile, publicKey.export({ format: "pem", type: "spki" }), "utf8");
  return { privateKeyFile, publicKeyFile };
}

export function signFile(file, privateKeyFile, signatureFile = `${file}.sig.json`) {
  const payload = fs.readFileSync(file);
  const signature = crypto.sign(null, payload, fs.readFileSync(privateKeyFile, "utf8")).toString("base64");
  const record = { schema: "evopilot-harness-signature/v1", algorithm: "Ed25519", payloadDigest: digest(payload), signature };
  writeJson(signatureFile, record);
  return { status: "SIGNED", file, signatureFile, payloadDigest: record.payloadDigest, algorithm: record.algorithm };
}

export function verifyFile(file, publicKeyFile, signatureFile = `${file}.sig.json`) {
  const payload = fs.readFileSync(file);
  const record = JSON.parse(fs.readFileSync(signatureFile, "utf8"));
  const digestMatches = digest(payload) === record.payloadDigest;
  const signatureValid = digestMatches && crypto.verify(null, payload, fs.readFileSync(publicKeyFile, "utf8"), Buffer.from(record.signature, "base64"));
  return { status: signatureValid ? "VERIFIED" : "FAILED", file, signatureFile, digestMatches, signatureValid, algorithm: record.algorithm };
}

function validateReferences(records) {
  const byKey = new Map(records.map((record) => [`${record.asset.kind}:${record.asset.metadata.id}@${record.asset.metadata.version}`, record]));
  const checks = [];
  for (const record of records.filter((item) => item.asset.kind === "HarnessProfile")) {
    for (const ref of record.asset.spec.components) {
      const key = `HarnessComponent:${ref.id}@${ref.version}`;
      checks.push({ id: `profile-component:${record.asset.metadata.id}:${ref.id}`, status: byKey.has(key) ? "PASS" : "FAIL", evidence: [key] });
    }
  }
  for (const record of records.filter((item) => item.asset.kind === "HarnessBundle")) {
    const profile = record.asset.spec.profile;
    const profileKey = `HarnessProfile:${profile.id}@${profile.version}`;
    const resolvedProfile = byKey.get(profileKey);
    checks.push({
      id: `bundle-profile:${record.asset.metadata.id}`,
      status: resolvedProfile && resolvedProfile.digest === profile.digest ? "PASS" : "FAIL",
      evidence: [profileKey, `expected=${profile.digest ?? "missing"}`, `actual=${resolvedProfile?.digest ?? "missing"}`]
    });
    for (const ref of record.asset.spec.resolvedComponents) {
      const key = `HarnessComponent:${ref.id}@${ref.version}`;
      const component = byKey.get(key);
      checks.push({ id: `bundle-component:${record.asset.metadata.id}:${ref.id}`, status: component && component.digest === ref.digest ? "PASS" : "FAIL", evidence: [key, `expected=${ref.digest}`, `actual=${component?.digest ?? "missing"}`] });
    }
  }
  return checks;
}

function renderCatalog(index) {
  const rows = index.entries.map((entry) => `| ${entry.kind} | ${entry.id} | ${entry.version} | ${entry.lifecycle} | \`${entry.assetDigest}\` |`).join("\n");
  return `# Harness Catalog: ${index.catalogId}\n\nGenerated by evopilot-harness v3. The table is for people; the fenced YAML block is the machine index.\n\n| Kind | Asset | Version | Lifecycle | Digest |\n|---|---|---:|---|---|\n${rows}\n\n\`\`\`yaml ${CATALOG_BLOCK}\n${stringifyYaml(index, { lineWidth: 120 }).trim()}\n\`\`\`\n`;
}

function extractIndex(markdown) {
  const match = markdown.match(new RegExp("```yaml\\s+" + CATALOG_BLOCK + "\\n([\\s\\S]*?)\\n```"));
  if (!match) return null;
  try { return parseYaml(match[1]); } catch { return null; }
}

function copyExports(sourceAssetFile, destinationAssetFile) {
  const source = path.join(path.dirname(sourceAssetFile), "exports");
  const target = path.join(path.dirname(destinationAssetFile), "exports");
  if (fs.existsSync(source)) fs.cpSync(source, target, { recursive: true });
}

function kindDirectory(kind) {
  return ({ HarnessComponent: "components", HarnessProfile: "profiles", HarnessBundle: "bundles" })[kind];
}

function assetKey(asset) {
  return `${asset.kind}:${asset.metadata.id}@${asset.metadata.version}`;
}

function countBy(values) {
  return Object.fromEntries([...new Set(values)].map((value) => [value, values.filter((item) => item === value).length]));
}

function catalogDigestInput(index) {
  return {
    schema: index.schema,
    catalogId: index.catalogId,
    generatedBy: index.generatedBy,
    assetApiVersion: index.assetApiVersion,
    entryCount: index.entryCount,
    entries: index.entries
  };
}

function failedCatalog(catalogRoot, checks) {
  return { schema: "evopilot-harness-catalog-validation/v3", status: "FAILED", catalogRoot, entryCount: 0, checks };
}
