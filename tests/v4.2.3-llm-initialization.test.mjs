import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { agentBootstrap } from "../src/v4/bootstrap.mjs";
import { executeV3Operation } from "../src/v3/cli.mjs";
import { inspectModelReadiness, invalidateModelVerification } from "../src/v3/model-readiness.mjs";
import { initializeWorkspace } from "../src/v3/workspace.mjs";

test("LLM readiness is separate from product installation and starts actionable", () => {
  const home = temporaryHome();
  const bootstrap = agentBootstrap(["--host", "workbuddy", "--workspace", home]);
  assert.equal(bootstrap.status, "READY");
  assert.equal(bootstrap.llmInitialization.status, "NOT_CONFIGURED");
  assert.equal(bootstrap.llmInitialization.initializationStatus, "ACTION_REQUIRED");
  assert.equal(bootstrap.nextAction, "load-packaged-adapter-prepare-workspace-and-complete-llm-initialization");
  assert.equal(fs.readdirSync(home).length, 0, "read-only bootstrap must not initialize the Workspace");
});

test("model initialization records only a secret-free binding and defaults across Sessions", async (t) => {
  const service = await modelService(t);
  const home = temporaryHome();
  initializeWorkspace(home);
  const modelsFile = path.join(home, "models.json");
  const secret = "acceptance-secret-never-persisted";
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ id: "glm-verified", name: "Verified GLM", vendor: "zhipu", apiKey: secret, url: service.url }] }));
  fs.chmodSync(modelsFile, 0o600);
  const before = digestFile(modelsFile);

  const initialized = await executeV3Operation({ positionals: ["llm", "v3-initialize"], options: { workspace: home, "timeout-ms": 5000 } });
  assert.equal(initialized.exitCode, 0);
  assert.equal(initialized.result.status, "CONFIGURED_AND_VERIFIED");
  assert.equal(initialized.result.initializationStatus, "READY");
  assert.equal(initialized.result.connectionVerified, true);
  assert.equal(digestFile(modelsFile), before, "initialization must not rewrite models.json");
  assert.equal(fs.statSync(path.join(home, "model-readiness.json")).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(initialized.result), new RegExp(secret));
  assert.doesNotMatch(fs.readFileSync(path.join(home, "model-readiness.json"), "utf8"), new RegExp(secret));

  const later = inspectModelReadiness(home, modelsFile);
  assert.equal(later.status, "CONFIGURED_AND_VERIFIED");
  assert.equal(later.verification.model.id, "glm-verified");
  assert.doesNotMatch(JSON.stringify(later), new RegExp(secret));

  fs.writeFileSync(modelsFile, fs.readFileSync(modelsFile, "utf8").replace("Verified GLM", "Changed GLM"));
  const drifted = inspectModelReadiness(home, modelsFile);
  assert.equal(drifted.status, "CONFIGURED_UNVERIFIED");
  assert.equal(drifted.nextAction, "run-llm-v3-initialize");
});

test("missing or unusable configuration fails closed without creating a receipt", async () => {
  const home = temporaryHome();
  initializeWorkspace(home);
  const result = await executeV3Operation({ positionals: ["llm", "v3-initialize"], options: { workspace: home } });
  assert.equal(result.exitCode, 2);
  assert.equal(result.result.status, "NOT_CONFIGURED");
  assert.equal(result.result.initializationStatus, "ACTION_REQUIRED");
  assert.equal(fs.existsSync(path.join(home, "model-readiness.json")), false);
  assert.equal(fs.existsSync(path.join(home, "models.json")), false);
  assert.equal(fs.existsSync(path.join(home, "models.example.json")), true);
});

test("shared readiness implementation stays host-neutral", () => {
  const source = fs.readFileSync(new URL("../src/v3/model-readiness.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /WorkBuddy|CodeBuddy|\.workbuddy/i);
});

test("model initialization rejects configuration inside the immutable Release", () => {
  const home = temporaryHome();
  initializeWorkspace(home);
  const result = inspectModelReadiness(home, new URL("../models.example.json", import.meta.url).pathname);
  assert.equal(result.status, "INVALID_CONFIGURATION_BOUNDARY");
  assert.equal(result.nextAction, "move-model-configuration-outside-release");
});

function temporaryHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-llm-init-"));
}

function digestFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function modelService(t) {
  const server = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ status: "ok" }) } }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}/v4` };
}

for (const failure of ["authentication", "transport"]) {
  test(`failed reinitialization invalidates earlier readiness: ${failure}`, async (t) => {
    let fail = false;
    const requests = [];
    const server = http.createServer((request, response) => {
      requests.push(request.url);
      request.resume();
      request.on("end", () => {
        if (fail && failure === "transport") return request.socket.destroy();
        response.writeHead(fail ? 401 : 200, {"content-type": "application/json"});
        response.end(fail ? JSON.stringify({error: "fixture denied"}) : JSON.stringify({choices: [{message: {content: '{"status":"ok"}'}}]}));
      });
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const home = temporaryHome(); initializeWorkspace(home);
    const modelsFile = path.join(home, "models.json");
    fs.writeFileSync(modelsFile, JSON.stringify({models: [{id: "fixture-model", vendor: "zhipu", apiKey: "fixture-private-key", url: `http://127.0.0.1:${server.address().port}/v4`}]}));
    const before = digestFile(modelsFile);
    const invoke = () => executeV3Operation({positionals: ["llm", "v3-initialize"], options: {workspace: home, "timeout-ms": 1000}});
    const first = await invoke(); assert.equal(first.result.connectionVerified, true);
    fail = true;
    const denied = await invoke();
    assert.equal(denied.exitCode, 2);
    assert.equal(denied.result.connectionVerified, false);
    assert.equal(denied.result.status, "CONFIGURED_UNVERIFIED");
    assert.equal(inspectModelReadiness(home, modelsFile).connectionVerified, false);
    assert.equal(digestFile(modelsFile), before);
    assert.doesNotMatch(JSON.stringify(denied.result), /fixture-private-key/);
    assert.doesNotMatch(fs.readFileSync(path.join(home, "model-readiness.json"), "utf8"), /fixture-private-key/);
    assert.equal(requests.length, 2, "must not retry or fall back after a failed check");
    fail = false;
    const repaired = await invoke(); assert.equal(repaired.result.connectionVerified, true);
    assert.equal(inspectModelReadiness(home, modelsFile).status, "CONFIGURED_AND_VERIFIED");
  });
}


test("readiness invalidation preserves unrelated bindings and creates no absent receipt", () => {
  const home = temporaryHome();
  const modelsFile = path.join(home, "models.json");
  invalidateModelVerification(home, modelsFile, "sha256:old");
  assert.deepEqual(fs.readdirSync(home), []);
  const receiptFile = path.join(home, "model-readiness.json");
  const receipt = {schema: "evopilot-harness-model-verification-receipt/v1", modelsFile, configurationDigest: "sha256:new", connectionVerified: true};
  fs.writeFileSync(receiptFile, JSON.stringify(receipt));
  const before = fs.readFileSync(receiptFile);
  invalidateModelVerification(home, modelsFile, "sha256:old");
  assert.deepEqual(fs.readFileSync(receiptFile), before);
  invalidateModelVerification(home, path.join(home, "different-models.json"), "sha256:new");
  assert.deepEqual(fs.readFileSync(receiptFile), before);
});
