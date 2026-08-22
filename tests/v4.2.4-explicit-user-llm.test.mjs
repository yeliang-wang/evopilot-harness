import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { diagnoseModel } from "../src/v3/advisor.mjs";
import { inspectModelReadiness, recordModelVerification } from "../src/v3/model-readiness.mjs";
import { initializeWorkspace } from "../src/v3/workspace.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("release and fresh Workspace contain no provider-specific default model", () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "models.example.json"), "utf8")), { models: [] });
  const source = fs.readFileSync(path.join(root, "src", "index.mjs"), "utf8");
  assert.doesNotMatch(source, /DEFAULT_GLM|builtinGlmProfile|open\.bigmodel\.cn/);
  const home = temporaryHome();
  initializeWorkspace(home);
  assert.equal(fs.existsSync(path.join(home, "models.json")), false);
});

test("readiness distinguishes missing profile, credential, verification, and drift", async (t) => {
  const home = temporaryHome();
  initializeWorkspace(home);
  const modelsFile = path.join(home, "models.json");
  assert.equal(inspectModelReadiness(home, modelsFile).status, "NOT_CONFIGURED");
  const service = await modelService(t);
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ id: "operator-model", vendor: "openai-compatible", modelName: "operator-model", url: service.url, apiKeyEnv: "EVOPILOT_TEST_LLM_KEY" }] }));
  fs.chmodSync(modelsFile, 0o600);
  assert.equal(inspectModelReadiness(home, modelsFile).status, "CREDENTIAL_REQUIRED");
  process.env.EVOPILOT_TEST_LLM_KEY = "test-only-secret";
  t.after(() => delete process.env.EVOPILOT_TEST_LLM_KEY);
  assert.equal(inspectModelReadiness(home, modelsFile).status, "CONFIGURED_UNVERIFIED");
  const doctor = await diagnoseModel(modelsFile, "operator-model", 5000);
  assert.equal(doctor.status, "READY");
  const ready = recordModelVerification(home, modelsFile, doctor);
  assert.equal(ready.status, "CONFIGURED_AND_VERIFIED");
  assert.doesNotMatch(fs.readFileSync(path.join(home, "model-readiness.json"), "utf8"), /test-only-secret/);
  fs.appendFileSync(modelsFile, "\n");
  assert.equal(inspectModelReadiness(home, modelsFile).status, "CONFIGURED_UNVERIFIED");
});

test("Workspace initialization preserves human-maintained model configuration byte-for-byte", () => {
  const home = temporaryHome();
  fs.mkdirSync(home, { recursive: true });
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, '{"models":[{"id":"mine","vendor":"custom","url":"http://localhost","apiKey":"local"}]}\n');
  const before = digestFile(modelsFile);
  initializeWorkspace(home);
  initializeWorkspace(home, { force: true });
  assert.equal(digestFile(modelsFile), before);
});

function temporaryHome() { return fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v424-")); }
function digestFile(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

async function modelService(t) {
  const server = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ status: "ok" }) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}/v4` };
}
