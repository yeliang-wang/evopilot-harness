import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectModels, loadConfiguredModel } from "../src/v3/advisor.mjs";
import { TestMcpClient, structured } from "./helpers/mcp-client.mjs";
import { agentBootstrap } from "../src/v4/bootstrap.mjs";
import { executeV3Operation } from "../src/v3/cli.mjs";
import { inspectModelReadiness, invalidateModelVerification, recordModelVerification } from "../src/v3/model-readiness.mjs";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { parseCli } from "../src/v3/utils.mjs";

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

test("initially missing direct or environment credentials preserve configuration and receipts without model requests", async (t) => {
  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests += 1; throw new Error("unexpected model request"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const envName = `HARNESS_MISSING_CREDENTIAL_${crypto.randomUUID().replaceAll("-", "_")}`;
  assert.equal(Object.hasOwn(process.env, envName), false);
  for (const credential of [{}, { apiKeyEnv: envName }]) {
    for (const preexisting of [false, true]) {
      const home = temporaryHome();
      initializeWorkspace(home);
      const modelsFile = path.join(home, "models.json");
      const receiptFile = path.join(home, "model-readiness.json");
      const profile = { id: "a", vendor: "fixture", url: "https://fixture.invalid/v1", ...credential };
      if (preexisting) {
        fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ ...profile, apiKey: "synthetic-fixture-key" }] }));
        const configured = inspectModelReadiness(home, modelsFile);
        recordModelVerification(home, modelsFile, { status: "READY", connectionVerified: true, model: configured.model, responseDigest: "fixture", completedAt: new Date().toISOString() });
      }
      fs.writeFileSync(modelsFile, JSON.stringify({ models: [profile] }));
      const configuration = fs.readFileSync(modelsFile);
      const receipt = preexisting ? fs.readFileSync(receiptFile) : null;
      const readiness = inspectModelReadiness(home, modelsFile);
      assert.equal(readiness.status, "CREDENTIAL_REQUIRED");
      const initialized = await executeV3Operation({ positionals: ["llm", "v3-initialize"], options: { workspace: home } });
      assert.equal(initialized.exitCode, 2);
      assert.deepEqual(initialized.result, JSON.parse(JSON.stringify(readiness)));
      assert.deepEqual(fs.readFileSync(modelsFile), configuration);
      if (preexisting) assert.deepEqual(fs.readFileSync(receiptFile), receipt);
      else assert.equal(fs.existsSync(receiptFile), false);
      assert.equal(requests, 0);
    }
  }
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

test("parsed bare and invalid model options cannot reuse verified default A", async (t) => {
  const service = await modelService(t);
  const home = temporaryHome();
  initializeWorkspace(home);
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [
    { id: "a", vendor: "fixture", apiKey: "private-a", url: service.url },
    { id: "b", vendor: "fixture", apiKey: "private-b", url: service.url }
  ] }));
  const invoke = (action, flags = []) => executeV3Operation(parseCli(["llm", action, "--workspace", home, ...flags]));
  assert.equal((await invoke("v3-initialize")).result.initializationStatus, "READY");
  const receiptFile = path.join(home, "model-readiness.json");
  const receipt = fs.readFileSync(receiptFile);
  assert.equal(parseCli(["llm", "v3-initialize", "--model"]).options.model, true);
  for (const action of ["v3-readiness", "v3-initialize"]) {
    for (const flags of [["--model"], ["--model", ""], ["--model", "   "], ["--model", "unknown"]]) {
      const rejected = await invoke(action, flags);
      assert.equal(rejected.exitCode, 2);
      assert.equal(rejected.result.connectionVerified, false);
      assert.equal(rejected.result.initializationStatus, "ACTION_REQUIRED");
      assert.ok(rejected.result.nextAction);
      assert.deepEqual(fs.readFileSync(receiptFile), receipt);
    }
  }
  assert.equal(service.requests.length, 1, "invalid selectors must make zero additional calls");
  const b = await invoke("v3-initialize", ["--model", "b"]);
  assert.equal(b.result.initializationStatus, "READY");
  assert.equal(b.result.model.id, "b");
  assert.deepEqual(service.requests.map(request => request.model), ["a", "b"]);
});

for (const change of ["credential", "invalid-json", "missing", "directory"]) {
  for (const preexisting of [false, true]) {
    test(`in-flight ${change} change preserves receipt (existing: ${preexisting})`, async (t) => {
      const home = temporaryHome();
      initializeWorkspace(home);
      const modelsFile = path.join(home, "models.json");
      const profile = { id: "a", vendor: "fixture", apiKey: "old-private-key", url: "https://fixture.invalid/v1" };
      fs.writeFileSync(modelsFile, JSON.stringify({ models: [profile] }));
      const initial = inspectModelReadiness(home, modelsFile);
      const doctor = { status: "READY", connectionVerified: true, model: initial.model, responseDigest: "fixture", completedAt: new Date().toISOString() };
      if (preexisting) recordModelVerification(home, modelsFile, doctor);
      const receiptFile = path.join(home, "model-readiness.json");
      const receipt = preexisting ? fs.readFileSync(receiptFile) : null;
      let releaseResponse;
      let requestStarted;
      const started = new Promise(resolve => { requestStarted = resolve; });
      const response = new Promise(resolve => { releaseResponse = resolve; });
      let calls = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        calls += 1;
        requestStarted();
        await response;
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"status":"ok"}' } }] }), {
          status: 200, headers: { "content-type": "application/json" }
        });
      };
      t.after(() => { globalThis.fetch = originalFetch; releaseResponse(); });
      const pending = executeV3Operation({ positionals: ["llm", "v3-initialize"], options: { workspace: home, "timeout-ms": 1000 } });
      await started;
      if (change === "credential") fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ ...profile, apiKey: "new-private-key" }] }));
      if (change === "invalid-json") fs.writeFileSync(modelsFile, "{");
      if (change === "missing" || change === "directory") fs.unlinkSync(modelsFile);
      if (change === "directory") fs.mkdirSync(modelsFile);
      releaseResponse();
      const rejected = await pending;
      assert.equal(rejected.exitCode, 2);
      assert.equal(rejected.result.status, "CONFIGURATION_CHANGED");
      assert.equal(rejected.result.connectionVerified, false);
      assert.equal(rejected.result.initializationStatus, "ACTION_REQUIRED");
      assert.equal(inspectModelReadiness(home, modelsFile).connectionVerified, false);
      assert.equal(calls, 1, "must not retry or select another profile");
      assert.doesNotMatch(JSON.stringify(rejected), /old-private-key|new-private-key/);
      // The persistence API must enforce the binding itself, before any write.
      assert.equal(recordModelVerification(home, modelsFile, doctor, undefined, initial.configurationDigest).status, "CONFIGURATION_CHANGED");
      if (preexisting) {
        assert.deepEqual(fs.readFileSync(receiptFile), receipt);
        assert.equal(fs.statSync(receiptFile).mode & 0o777, 0o600);
      } else assert.equal(fs.existsSync(receiptFile), false);
    });
  }
}

function temporaryHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-llm-init-"));
}

function digestFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function modelService(t, fail = () => false) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requests.push(JSON.parse(body));
      if (fail(JSON.parse(body))) {
        response.writeHead(401);
        response.end("fixture denied");
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ status: "ok" }) } }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}/v4`, requests };
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

test("explicit model selection never falls back through inspection, loading, CLI, or MCP", async (t) => {
  const home = temporaryHome();
  initializeWorkspace(home);
  const service = await modelService(t);
  const modelsFile = path.join(home, "models.json");
  const models = [
    { id: "first", vendor: "provider-one", apiKey: "synthetic-first-key", url: service.url },
    { id: "second", vendor: "provider-two", apiKey: "synthetic-second-key", url: service.url },
    { id: "unusable", vendor: "provider-two", url: service.url }
  ];
  fs.writeFileSync(modelsFile, JSON.stringify({ models }), { mode: 0o600 });
  const before = digestFile(modelsFile);
  assert.equal(inspectModels(modelsFile).selected.id, "first");
  assert.equal(loadConfiguredModel(modelsFile).id, "first");
  assert.equal(inspectModels(modelsFile, "second").selected.id, "second");
  assert.equal(loadConfiguredModel(modelsFile, "second").id, "second");
  assert.equal(loadConfiguredModel(modelsFile, "unusable"), null);
  for (const selectedId of ["does-not-exist", ""]) {
    assert.equal(inspectModels(modelsFile, selectedId).status, "NOT_CONFIGURED");
    assert.equal(loadConfiguredModel(modelsFile, selectedId), null);
    const result = await executeV3Operation({ positionals: ["llm", "v3-initialize"], options: { workspace: home, "models-file": modelsFile, model: selectedId, "timeout-ms": 5000 } });
    assert.equal(result.exitCode, 2);
    assert.equal(result.result.connectionVerified, false);
    assert.equal(fs.existsSync(path.join(home, "model-readiness.json")), false);
  }
  const client = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: path.resolve(import.meta.dirname, "..") });
  t.after(() => client.close());
  await client.initialize();
  const rejected = structured(await client.tool("initialize_model_configuration", { modelsFile, model: "does-not-exist", timeoutMs: 5000 }));
  assert.equal(rejected.connectionVerified, false);
  assert.equal(service.requests.length, 0, "unknown explicit selectors must make zero provider calls");
  const accepted = await executeV3Operation({ positionals: ["llm", "v3-initialize"], options: { workspace: home, "models-file": modelsFile, model: "second", "timeout-ms": 5000 } });
  assert.equal(accepted.result.status, "CONFIGURED_AND_VERIFIED");
  assert.equal(accepted.result.doctor.model.id, "second");
  assert.deepEqual(service.requests.map((request) => request.model), ["second"]);
  assert.equal(digestFile(modelsFile), before);
  assert.doesNotMatch(JSON.stringify([rejected, accepted]), /synthetic-(first|second)-key/);
});


test("stdio MCP omitted model initializes default A and its receipt survives a fresh process", async (t) => {
  const service = await modelService(t);
  const home = temporaryHome();
  initializeWorkspace(home);
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [
    { id: "a", modelName: "effective-a", vendor: "fixture", apiKey: "synthetic-a-key", url: service.url },
    { id: "b", modelName: "effective-b", vendor: "fixture", apiKey: "synthetic-b-key", url: service.url }
  ] }));
  const configuration = fs.readFileSync(modelsFile);
  const client = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: path.resolve(import.meta.dirname, "..") });
  t.after(() => client.close());
  await client.initialize();
  const initialize = async (options = {}) => structured(await client.tool("initialize_model_configuration", { modelsFile, timeoutMs: 5000, ...options }));
  const b = await initialize({ model: "b" });
  assert.equal(b.status, "CONFIGURED_AND_VERIFIED");
  assert.equal(b.verification.model.id, "b");
  assert.equal(inspectModelReadiness(home, modelsFile, "b").connectionVerified, true);
  const defaultBefore = inspectModelReadiness(home, modelsFile);
  assert.equal(defaultBefore.model.id, "a");
  assert.equal(defaultBefore.connectionVerified, false);

  const a = await initialize();
  assert.equal(a.status, "CONFIGURED_AND_VERIFIED");
  assert.equal(a.initializationStatus, "READY");
  assert.equal(a.verification.model.id, "a");
  assert.deepEqual(service.requests.map(request => request.model), ["effective-b", "effective-a"]);
  const receiptFile = path.join(home, "model-readiness.json");
  const receipt = fs.readFileSync(receiptFile);
  for (const model of ["", "   ", "unknown"]) {
    const rejected = await initialize({ model });
    assert.equal(rejected.connectionVerified, false);
    assert.equal(rejected.initializationStatus, "ACTION_REQUIRED");
    assert.deepEqual(fs.readFileSync(modelsFile), configuration);
    assert.deepEqual(fs.readFileSync(receiptFile), receipt);
  }
  for (const model of [true, false, null, 0, [], {}]) {
    for (const action of ["v3-readiness", "v3-initialize"]) {
      const rejected = await executeV3Operation({ positionals: ["llm", action], options: { workspace: home, "models-file": modelsFile, model } });
      assert.equal(rejected.exitCode, 2);
      assert.equal(rejected.result.connectionVerified, false);
    }
  }
  const later = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { executeV3Operation } from ${JSON.stringify(new URL("../src/v3/cli.mjs", import.meta.url).href)};
    const result = await executeV3Operation({ positionals: ["llm", "v3-readiness"], options: {
      workspace: ${JSON.stringify(home)}, "models-file": ${JSON.stringify(modelsFile)}, model: undefined
    } });
    process.stdout.write(JSON.stringify(result));
  `], { encoding: "utf8" }));
  assert.equal(later.exitCode, 0);
  assert.equal(later.result.status, "CONFIGURED_AND_VERIFIED");
  assert.equal(later.result.verification.model.id, "a");
  assert.equal(later.result.connectionVerified, true);
  assert.deepEqual(service.requests.map(request => request.model), ["effective-b", "effective-a"]);
  assert.deepEqual(fs.readFileSync(modelsFile), configuration);
  assert.deepEqual(fs.readFileSync(receiptFile), receipt);
});

test("selected readiness binds A/B identities and failed B preserves a verified A", async (t) => {
  let failB = false;
  const service = await modelService(t, (body) => failB && body.model === "effective-b");
  const home = temporaryHome();
  initializeWorkspace(home);
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [
    { id: "ineligible", vendor: "fixture" },
    { id: "a", modelName: "effective-a", vendor: "fixture-a", apiKey: "private-a", url: service.url },
    { id: "b", modelName: "effective-b", vendor: "fixture-b", apiKey: "private-b", url: service.url }
  ] }, null, 2) + "\n");
  const before = fs.readFileSync(modelsFile);
  const invoke = (action, model) => executeV3Operation({ positionals: ["llm", action], options: { workspace: home, ...(model === undefined ? {} : { model }), "timeout-ms": 1000 } });
  const b = await invoke("v3-initialize", "b");
  assert.equal(b.result.initializationStatus, "READY");
  assert.equal(b.result.verification.model.id, "b");
  assert.equal((await invoke("v3-readiness", "b")).result.connectionVerified, true);
  assert.equal((await invoke("v3-readiness")).result.connectionVerified, false);
  assert.equal(inspectModelReadiness(home, modelsFile).model.id, "a");
  failB = true;
  const failedB = await invoke("v3-initialize", "b");
  assert.equal(failedB.exitCode, 2);
  assert.equal(failedB.result.connectionVerified, false);
  assert.equal(failedB.result.model.id, "b");
  const receiptFile = path.join(home, "model-readiness.json");
  assert.equal(JSON.parse(fs.readFileSync(receiptFile)).connectionVerified, false);
  assert.equal((await invoke("v3-initialize")).result.initializationStatus, "READY");
  assert.equal((await invoke("v3-readiness", "a")).result.connectionVerified, true);
  const receiptA = fs.readFileSync(receiptFile);
  const unrelatedFailure = await invoke("v3-initialize", "b");
  assert.equal(unrelatedFailure.result.connectionVerified, false);
  assert.equal(unrelatedFailure.result.initializationStatus, "ACTION_REQUIRED");
  assert.deepEqual(fs.readFileSync(receiptFile), receiptA);
  assert.equal(inspectModelReadiness(home, modelsFile).connectionVerified, true);
  const calls = service.requests.length;
  for (const selector of ["", "unknown"]) {
    for (const action of ["v3-initialize", "v3-readiness"]) {
      const rejected = await invoke(action, selector);
      assert.equal(rejected.result.status, "NOT_CONFIGURED");
      assert.equal(rejected.result.connectionVerified, false);
    }
  }
  assert.equal(service.requests.length, calls);
  assert.deepEqual(fs.readFileSync(receiptFile), receiptA);
  assert.deepEqual(fs.readFileSync(modelsFile), before);
  assert.equal(fs.statSync(receiptFile).mode & 0o777, 0o600);
  assert.doesNotMatch(receiptA.toString(), /private-[ab]/);
  assert.deepEqual(service.requests.map((request) => request.model), ["effective-b", "effective-b", "effective-a", "effective-b"]);
});

test("receipt and doctor identities must be complete and match the selected profile", async (t) => {
  const service = await modelService(t);
  const home = temporaryHome();
  initializeWorkspace(home);
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ id: "a", vendor: "fixture", modelName: "effective-a", apiKey: "private-key", url: service.url }] }));
  const initialized = await executeV3Operation({ positionals: ["llm", "v3-initialize"], options: { workspace: home } });
  const receiptFile = path.join(home, "model-readiness.json");
  const original = JSON.parse(fs.readFileSync(receiptFile));
  const identities = [undefined, null, [], {}, "a"];
  for (const key of ["id", "provider", "model", "url"]) {
    const missing = { ...original.model }; delete missing[key];
    identities.push(missing, { ...original.model, [key]: "different" }, { ...original.model, [key]: {} });
  }
  for (const model of identities) {
    fs.writeFileSync(receiptFile, JSON.stringify({ ...original, model }));
    assert.equal(inspectModelReadiness(home, modelsFile).status, "CONFIGURED_UNVERIFIED");
    const before = fs.readFileSync(receiptFile);
    assert.throws(() => recordModelVerification(home, modelsFile, { ...initialized.result.doctor, model }), /identity/);
    assert.deepEqual(fs.readFileSync(receiptFile), before);
  }
  fs.writeFileSync(receiptFile, JSON.stringify(original));
  assert.equal(inspectModelReadiness(home, modelsFile).connectionVerified, true);
  assert.equal(service.requests.length, 1, "receipt checks must remain offline");
});

test("absent profile id uses modelName and credentials follow loader semantics", async (t) => {
  const service = await modelService(t);
  const home = temporaryHome();
  initializeWorkspace(home);
  const modelsFile = path.join(home, "models.json");
  const envName = "HARNESS_INITIALIZATION_FIXTURE_KEY";
  const previous = process.env[envName];
  process.env[envName] = "synthetic-env-secret";
  t.after(() => { if (previous === undefined) delete process.env[envName]; else process.env[envName] = previous; });
  const profile = { vendor: "fixture", modelName: "name-only", apiKeyEnv: envName, url: service.url };
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [profile] }));
  const initialized = await executeV3Operation({ positionals: ["llm", "v3-initialize"], options: { workspace: home } });
  assert.equal(initialized.result.initializationStatus, "READY");
  assert.equal(inspectModelReadiness(home, modelsFile).verification.model.model, "name-only");
  assert.equal(inspectModelReadiness(home, modelsFile, "name-only").status, "NOT_CONFIGURED");
  assert.doesNotMatch(fs.readFileSync(path.join(home, "model-readiness.json"), "utf8"), /synthetic-env-secret/);
  profile.apiKeyEnv = " " + envName + " ";
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [profile] }));
  assert.equal(loadConfiguredModel(modelsFile), null);
  assert.equal(inspectModelReadiness(home, modelsFile).status, "CREDENTIAL_REQUIRED");
  assert.equal(service.requests.length, 1);
});
