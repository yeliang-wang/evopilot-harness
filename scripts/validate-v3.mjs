import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { discoverAssets } from "../src/v3/catalog.mjs";
import { feedbackPackageDigest, feedbackPayloadDigest } from "../src/v3/feedback.mjs";
import { digest, writeYaml } from "../src/v3/utils.mjs";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "src/index.mjs");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-v3-check-"));
const checks = [];

try {
  run("workspace-init", ["workspace", "init", "--workspace", home, "--json"]);
  const builtinBefore = builtinAssetDigest();
  run("asset-validation", ["asset", "v3-validate", "--workspace", home, "--json"]);
  run("asset-tests", ["asset", "v3-test", "--workspace", home, "--json"]);
  run("builtin-catalog", ["catalog", "v3-validate", "--workspace", home, "--source", path.join(home, "catalogs/builtin"), "--json"]);
  run("registry", ["registry", "v3-validate", "--workspace", home, "--json"]);
  run("migration-dry-run", ["migrate", "v2-to-v3", "--workspace", home, "--source", path.join(root, "harnesses"), "--json"]);
  const feedback = feedbackFixture();
  const feedbackFile = path.join(home, "feedback-fixture.yaml");
  writeYaml(feedbackFile, feedback);
  run("feedback-validation", ["feedback", "validate", feedbackFile, "--workspace", home, "--now", "2026-08-13T08:00:00.000Z", "--json"]);
  run("feedback-processing", ["feedback", "process", feedbackFile, "--workspace", home, "--now", "2026-08-13T08:00:00.000Z", "--json"]);
  run("v3.4-contract-evaluation", ["eval", "v3-run", "--workspace", home, "--json"]);
  const noChangeProject = path.join(home, "v3.4-no-change-source");
  fs.mkdirSync(noChangeProject, { recursive: true });
  fs.writeFileSync(path.join(noChangeProject, "pom.xml"), "<project><artifactId>v34-no-change</artifactId></project>", "utf8");
  fs.writeFileSync(path.join(noChangeProject, "Main.java"), "Distributed cache Redis compatible key-value store build test validate release.", "utf8");
  const noChange = run("v3.4-no-change-proposal", ["produce", "--source-project", noChangeProject, "--workspace", home, "--advisor", "off", "--json"]);
  if (noChange.reasoning?.decision !== "NO_CHANGE") throw new Error(`v3.4-no-change-proposal expected NO_CHANGE, got ${noChange.reasoning?.decision}`);
  run("v3.4-proposal-closure", ["proposal", "validate", noChange.runId, "--workspace", home, "--json"]);
  if (builtinAssetDigest() !== builtinBefore) throw new Error("v3.4 acceptance mutated Built-in Catalog source assets.");
  run("hub-snapshot", ["hub", "v3-snapshot", "--workspace", home, "--out", path.join(home, "hub.json"), "--json"]);
  process.stdout.write(`${JSON.stringify({ schema: "evopilot-harness-v3-acceptance/v1", status: "PASSED", checkCount: checks.length, checks }, null, 2)}\n`);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

function feedbackFixture() {
  const records = discoverAssets([path.join(home, "catalogs/builtin/assets")]);
  const bundle = records.find((record) => record.asset.kind === "HarnessBundle" && record.asset.metadata.id === "distributed-cache-product");
  const profile = records.find((record) => record.asset.kind === "HarnessProfile" && record.asset.metadata.id === bundle.asset.spec.profile.id && record.asset.metadata.version === bundle.asset.spec.profile.version);
  const componentRefs = bundle.asset.spec.resolvedComponents.map((reference) => {
    const component = records.find((record) => record.asset.kind === "HarnessComponent" && record.asset.metadata.id === reference.id && record.asset.metadata.version === reference.version);
    return { id: component.asset.metadata.id, version: component.asset.metadata.version, digest: component.digest };
  });
  const document = {
    apiVersion: "feedback.evopilot.io/v1",
    kind: "HarnessExecutionFeedbackPackage",
    metadata: { packageId: "v3-acceptance-feedback", version: "1.0.0", generatedAt: "2026-08-13T07:00:00.000Z", expiresAt: "2026-09-13T07:00:00.000Z", producer: { name: "v3-acceptance", version: "1.0.0", instanceId: "disposable-workspace" }, packageDigest: digest("placeholder") },
    approval: { status: "APPROVED", approvedBy: "v3-acceptance", approvedAt: "2026-08-13T07:30:00.000Z", purpose: "Release contract acceptance" },
    redaction: { status: "REDACTED", policyVersion: "acceptance-v1", removedFieldCount: 0, payloadDigest: digest("placeholder") },
    harnessBinding: { bundleRef: { id: bundle.asset.metadata.id, version: bundle.asset.metadata.version, digest: bundle.digest }, profileRef: { id: profile.asset.metadata.id, version: profile.asset.metadata.version, digest: profile.digest }, componentRefs },
    executionContext: { taskClass: "release-acceptance", complexity: "LOW", environmentDigest: digest("disposable-workspace"), trajectoryRefs: [] },
    dimensions: { outcome: { status: "SUCCEEDED", score: 1 }, process: { status: "COMPLETED", stepCount: 1, failedStepCount: 0, retryCount: 0, durationMs: 1 }, safety: { status: "SAFE", violationCount: 0, incidentCount: 0 }, cost: { status: "RECORDED", inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCost: 0, currency: "USD" } },
    provenance: { sourceType: "reviewed-external-execution", sourceId: "disposable-workspace", requestIds: ["v3-acceptance"], model: { provider: "fixture", name: "fixture" }, evidenceRefs: ["fixture:evidence"] }
  };
  document.redaction.payloadDigest = feedbackPayloadDigest(document);
  document.metadata.packageDigest = feedbackPackageDigest(document);
  return document;
}

function run(id, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${id} failed:\n${result.stderr || result.stdout}`);
  const output = JSON.parse(result.stdout);
  checks.push({ id, status: output.status ?? "READY", schema: output.schema });
  return output;
}

function builtinAssetDigest() {
  return digest(discoverAssets([path.join(root, "assets/v3")]).map((record) => ({ key: `${record.asset.kind}:${record.asset.metadata.id}@${record.asset.metadata.version}`, digest: record.digest })));
}
