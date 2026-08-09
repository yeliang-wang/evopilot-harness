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

test("publishes and validates a Harness Registry without duplicating Catalog entries", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-registry-"));
  const catalogRoot = path.join(tmp, "published");
  const registryPath = path.join(tmp, "harness-registry.yaml");
  const catalog = runJson(["catalog", "publish", "--source", path.join(root, "harnesses"), "--out", catalogRoot, "--json"]);
  const registry = runJson([
    "registry",
    "publish",
    "--catalog", catalogRoot,
    "--registry", registryPath,
    "--priority", "250",
    "--json"
  ]);
  assert.equal(registry.status, "PUBLISHED");
  assert.equal(registry.catalogDigest, catalog.catalogDigest);
  assert.ok(fs.existsSync(registryPath));
  const registryYaml = fs.readFileSync(registryPath, "utf8");
  assert.match(registryYaml, /schema: evopilot-harness-registry\/v1/);
  assert.match(registryYaml, /root: \.\/published/);
  assert.match(registryYaml, /priority: 250/);
  assert.doesNotMatch(registryYaml, /\nentries:/);

  const validation = runJson(["registry", "validate", "--registry", registryPath, "--json"]);
  assert.equal(validation.status, "VALIDATED");
  assert.equal(validation.catalogCount, 1);
  assert.equal(validation.enabledCount, 1);
  assert.equal(validation.catalogs[0].status, "VALIDATED");
});

test("rejects Harness Registry files that duplicate Catalog entries", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-registry-bad-"));
  const catalogRoot = path.join(tmp, "published");
  const registryPath = path.join(tmp, "harness-registry.yaml");
  runJson(["catalog", "publish", "--source", path.join(root, "harnesses"), "--out", catalogRoot, "--json"]);
  fs.writeFileSync(registryPath, [
    "schema: evopilot-harness-registry/v1",
    "catalogs:",
    "  - id: bad-catalog",
    "    enabled: true",
    "    priority: 10",
    "    root: ./published",
    "    entries:",
    "      - name: should-not-be-here",
    ""
  ].join("\n"));
  const run = spawnSync(process.execPath, [cli, "registry", "validate", "--registry", registryPath, "--json"], { encoding: "utf8" });
  assert.equal(run.status, 2, run.stderr || run.stdout);
  const validation = JSON.parse(run.stdout);
  assert.equal(validation.status, "FAILED");
  assert.ok(validation.blockers.some((blocker) => blocker.includes("no-entries")));
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

test("strict Harness validation enforces Template Quality Standard v1", () => {
  const result = runJson(["harness", "validate", "--source", path.join(root, "harnesses"), "--strict", "--json"]);
  assert.equal(result.status, "VALIDATED");
  assert.equal(result.strict, true);
  assert.ok(result.quality.every((item) => item.score >= 0.8));
  assert.ok(result.checks.some((check) => check.id.includes(":productBoundary") && check.status === "PASS"));
  assert.ok(result.checks.some((check) => check.id.includes(":matchPolicy") && check.status === "PASS"));
  assert.ok(result.checks.some((check) => check.id.includes(":executionModel") && check.status === "PASS"));
});

test("detect classifies a Redis client library as a new narrow Harness target", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-detect-"));
  const project = path.join(tmp, "redisclient");
  fs.mkdirSync(path.join(project, "src", "main", "java", "com", "example"), { recursive: true });
  fs.writeFileSync(path.join(project, "pom.xml"), [
    "<project>",
    "  <dependencies>",
    "    <dependency><groupId>org.springframework.data</groupId><artifactId>spring-data-redis</artifactId><version>1.0.1</version></dependency>",
    "    <dependency><groupId>redis.clients</groupId><artifactId>jedis</artifactId><version>2.0.0</version></dependency>",
    "  </dependencies>",
    "</project>"
  ].join("\n"));
  fs.writeFileSync(path.join(project, "src", "main", "java", "com", "example", "RedisClientService.java"), [
    "package com.example;",
    "import org.springframework.data.redis.core.RedisTemplate;",
    "import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;",
    "import org.springframework.data.redis.serializer.RedisSerializer;",
    "public class RedisClientService {",
    "  private RedisTemplate<String, String> redisTemplate;",
    "  public RedisSerializer<String> serializer;",
    "  public JedisConnectionFactory connectionFactory;",
    "}"
  ].join("\n"));

  const result = runJson([
    "detect",
    "--source", path.join(root, "harnesses"),
    "--source-project", project,
    "--goal", "Create or evolve a reusable domain Harness from this project.",
    "--json"
  ]);

  assert.equal(result.status, "READY");
  assert.equal(result.sourceProfile.primaryRole, "redis-client-library");
  assert.equal(result.sourceProfile.recommendedHarness.id, "redis-client-harness");
  assert.equal(result.autoMatch.decision, "CREATE_NEW_WITH_PARENT_REFERENCE");
  assert.equal(result.autoMatch.targetHarnessId, "redis-client-harness");
  assert.ok(result.autoMatch.parentCandidates.some((candidate) => candidate.id === "distributed-cache-harness"));
  assert.ok(!result.autoMatch.candidates.slice(0, 2).some((candidate) => candidate.harnessId === "api-gateway-harness"));
});

test("evolve reuses detect profile and generates a strict-valid Redis client draft", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-redis-evolve-"));
  const dataRoot = path.join(tmp, "data");
  const project = path.join(tmp, "redisclient");
  fs.mkdirSync(path.join(project, "src", "main", "java", "com", "example"), { recursive: true });
  fs.writeFileSync(path.join(project, "pom.xml"), [
    "<project>",
    "  <dependencies>",
    "    <dependency><groupId>org.springframework.data</groupId><artifactId>spring-data-redis</artifactId><version>1.0.1</version></dependency>",
    "    <dependency><groupId>redis.clients</groupId><artifactId>jedis</artifactId><version>2.0.0</version></dependency>",
    "  </dependencies>",
    "</project>"
  ].join("\n"));
  fs.writeFileSync(path.join(project, "src", "main", "java", "com", "example", "RedisClientService.java"), [
    "package com.example;",
    "import org.springframework.data.redis.core.RedisTemplate;",
    "import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;",
    "public class RedisClientService { RedisTemplate<String, String> template; JedisConnectionFactory factory; }"
  ].join("\n"));

  const result = runJson([
    "evolve",
    "--source", path.join(root, "harnesses"),
    "--data-root", dataRoot,
    "--source-project", project,
    "--goal", "Create or evolve a reusable domain Harness from this project.",
    "--json"
  ]);

  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.sourceProfile.primaryRole, "redis-client-library");
  assert.equal(result.autoMatch.targetHarnessId, "redis-client-harness");
  assert.equal(result.draft.harnessId, "redis-client-harness");
  assert.equal(result.validation.status, "VALIDATED");
  assert.ok(result.validation.checks.some((check) => check.id === "quality:redis-client-harness@0.1.0:score" && check.status === "PASS"));
});

test("optional LLM Advisor without provider config does not block deterministic evolution", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-llm-optional-"));
  const project = path.join(tmp, "project");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "README.md"), "Self-developed distributed cache with Redis compatible protocol, ttl, eviction, replica failover, and slot migration.");
  const result = runJson([
    "evolve",
    "--source", path.join(root, "harnesses"),
    "--data-root", path.join(tmp, "data"),
    "--source-project", project,
    "--goal", "Evolve a distributed cache Harness from this source project.",
    "--llm-advisor", "optional",
    "--json"
  ], { env: withoutAdvisorEnv() });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.llmAdvisor.status, "SKIPPED");
  assert.equal(result.nextAction, "review-approve-harness");
});

test("required LLM Advisor without provider config blocks before review", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-llm-required-"));
  const project = path.join(tmp, "project");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "README.md"), "Self-developed distributed cache with Redis compatible protocol, ttl, eviction, replica failover, and slot migration.");
  const run = spawnSync(process.execPath, [
    cli,
    "evolve",
    "--source", path.join(root, "harnesses"),
    "--data-root", path.join(tmp, "data"),
    "--source-project", project,
    "--goal", "Evolve a distributed cache Harness from this source project.",
    "--llm-advisor", "required",
    "--json"
  ], { encoding: "utf8", env: withoutAdvisorEnv() });
  assert.equal(run.status, 2, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.llmAdvisor.status, "FAILED");
  assert.equal(result.nextAction, "repair-llm-advisor-config");
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

test("Harness Hub snapshot exposes Catalog, lifecycle commands, source types, and evolution runs", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-hub-"));
  const catalogRoot = path.join(tmp, "published");
  const registryPath = path.join(tmp, "harness-registry.yaml");
  const snapshotFile = path.join(tmp, "snapshot.json");
  runJson(["catalog", "publish", "--source", path.join(root, "harnesses"), "--out", catalogRoot, "--json"]);
  runJson(["registry", "publish", "--catalog", catalogRoot, "--registry", registryPath, "--json"]);
  const result = runJson([
    "hub",
    "snapshot",
    "--catalog", catalogRoot,
    "--registry", registryPath,
    "--source", path.join(root, "harnesses"),
    "--data-root", path.join(tmp, "data"),
    "--out", snapshotFile,
    "--json"
  ]);

  assert.equal(result.schema, "evopilot-harness-hub-snapshot/v1");
  assert.equal(result.status, "READY");
  assert.equal(result.registry.status, "VALIDATED");
  assert.ok(result.registry.catalogs.some((catalog) => catalog.id === "evopilot-public-harness-catalog"));
  assert.ok(result.catalog.entryCount >= 2);
  assert.ok(result.harnesses.some((harness) => harness.id === "database-product-harness" && harness.commands.evolve.includes("evopilot-harness evolve")));
  assert.ok(result.sourceTypes.some((source) => source.id === "production-log"));
  assert.ok(result.lifecycleCommands.some((command) => command.id === "publish"));
  assert.ok(fs.existsSync(snapshotFile));
  assert.equal(JSON.parse(fs.readFileSync(snapshotFile, "utf8")).schema, "evopilot-harness-hub-snapshot/v1");
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

function withoutAdvisorEnv() {
  const env = { ...process.env };
  for (const key of [
    "EVOPILOT_HARNESS_LLM_API_KEY",
    "EVOPILOT_HARNESS_LLM_BASE_URL",
    "EVOPILOT_HARNESS_LLM_MODEL_NAME",
    "EVOPILOT_LLM_API_KEY",
    "EVOPILOT_LLM_BASE_URL",
    "EVOPILOT_LLM_MODEL_NAME"
  ]) delete env[key];
  return env;
}
