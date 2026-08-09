import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "src/index.mjs");

test("publishes and validates a Harness Catalog", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-"));
  const result = runJson(["catalog", "publish", "--source", path.join(root, "harnesses"), "--out", tmp, "--json"]);
  assert.equal(result.status, "PUBLISHED");
  assert.ok(result.templateCount >= 2);
  const catalogPath = path.join(tmp, "CATALOG.md");
  assert.ok(fs.existsSync(catalogPath));
  const catalogMarkdown = fs.readFileSync(catalogPath, "utf8");
  assert.match(catalogMarkdown, /```yaml evopilot-harness-catalog/);
  assert.match(catalogMarkdown, /compatibleEvopilot: ">=3.0.0"/);
  assert.match(catalogMarkdown, /distributed-cache-harness/);

  const validation = runJson(["catalog", "validate", "--source", tmp, "--json"]);
  assert.equal(validation.status, "VALIDATED");
});

test("supports atomic Harness lifecycle commands", () => {
  const list = runJson(["harness", "list", "--source", path.join(root, "harnesses"), "--json"]);
  assert.equal(list.status, "READY");
  assert.ok(list.harnesses.some((harness) => harness.id === "database-product-harness"));

  const inspect = runJson(["harness", "inspect", "database-product-harness", "--source", path.join(root, "harnesses"), "--json"]);
  assert.equal(inspect.status, "FOUND");
  assert.equal(inspect.harness.id, "database-product-harness");
  assert.equal(inspect.template.harnessLayer ?? inspect.template.runtimePatterns?.harnessLayer, "domain");

  const validate = runJson(["harness", "validate", "database-product-harness", "--source", path.join(root, "harnesses"), "--json"]);
  assert.equal(validate.status, "VALIDATED");
  assert.equal(validate.harnessCount, 1);
});

test("one-click evolve auto-matches, approves, publishes, and keeps JSON parseable", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-evolve-"));
  const harnessSource = path.join(tmp, "harnesses");
  const published = path.join(tmp, "published");
  const dataRoot = path.join(tmp, "data");
  const project = path.join(tmp, "distributed-cache-project");
  fs.cpSync(path.join(root, "harnesses"), harnessSource, { recursive: true });
  fs.mkdirSync(path.join(project, "docs"), { recursive: true });
  fs.writeFileSync(path.join(project, "README.md"), [
    "# Distributed Cache",
    "",
    "Self-developed distributed cache with Redis compatible protocol, TTL, eviction, replica failover, slot migration, and hot key diagnostics."
  ].join("\n"));
  fs.writeFileSync(path.join(project, "docs", "architecture.md"), "Clustered key-value store with shards, replicas, failover, and benchmark evidence.");
  const productionLog = path.join(tmp, "production.log");
  fs.writeFileSync(productionLog, "authorization: Bearer live-token\napiKey=secret-key\nnode=n1 shard=s1 failover timeout\n");

  const result = runJson([
    "evolve",
    "--source", harnessSource,
    "--out", published,
    "--data-root", dataRoot,
    "--source-project", project,
    "--production-log", productionLog,
    "--goal", "Evolve a distributed cache Harness from this source project.",
    "--approve-and-publish",
    "--confirmed-by", "admin@example.com",
    "--confirmation", "Reviewed source coverage, draft diff, validation, and impact.",
    "--json"
  ]);

  assert.equal(result.status, "PUBLISHED");
  assert.equal(result.autoMatch.decision, "EVOLVE_EXISTING");
  assert.equal(result.autoMatch.targetHarnessId, "distributed-cache-harness");
  assert.equal(result.publication.harnessId, "distributed-cache-harness");
  assert.ok(result.sourceCoverage.sources.some((source) => source.type === "production-log" && source.redactionApplied));
  assert.ok(fs.existsSync(path.join(harnessSource, "distributed-cache-harness", "examples", "selected-harness-binding.yaml")));
  assert.ok(!fs.existsSync(path.join(harnessSource, "distributed-cache-harness", "examples", "default-project-profile.yaml")));

  const catalog = fs.readFileSync(path.join(published, "CATALOG.md"), "utf8");
  assert.match(catalog, /compatibleEvopilot: ">=3.0.0"/);
  assert.match(catalog, /distributed-cache-harness/);
  const validation = runJson(["catalog", "validate", "--source", published, "--json"]);
  assert.equal(validation.status, "VALIDATED");
});

function runJson(args) {
  const run = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stderr, "");
  try {
    return JSON.parse(run.stdout);
  } catch (error) {
    assert.fail(`Expected JSON output, got:\n${run.stdout}\n${error.message}`);
  }
}
