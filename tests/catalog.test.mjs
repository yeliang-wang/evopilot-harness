import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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
  assert.match(catalogMarkdown, /catalogVersion: 2/);
  assert.match(catalogMarkdown, /assetApiVersion: evopilot\.dev\/v2/);
  assert.match(catalogMarkdown, /assetKind: HarnessAsset/);
  assert.match(catalogMarkdown, /qualityReport:/);
  assert.match(catalogMarkdown, /assetPath: \.\/database-product-harness\/2\.3\.0\/asset\.yaml/);
  assert.match(catalogMarkdown, /assetDigest: sha256:/);
  assert.match(catalogMarkdown, /compatibleEvopilot: ">=3.0.0"/);
  assert.match(catalogMarkdown, /distributed-cache-harness/);
  assert.ok(fs.existsSync(path.join(tmp, "database-product-harness", "2.3.0", "asset.yaml")));

  const validation = runJson(["catalog", "validate", "--source", tmp, "--json"]);
  assert.equal(validation.status, "VALIDATED");
});

test("validates Harness Asset v2 envelopes for source packs and published packs", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-asset-"));
  runJson(["catalog", "publish", "--source", path.join(root, "harnesses"), "--out", tmp, "--json"]);

  const sourceAssets = runJson(["asset", "validate", "--source", path.join(root, "harnesses"), "--json"]);
  assert.equal(sourceAssets.schema, "evopilot-harness-asset-validation-result/v2");
  assert.equal(sourceAssets.status, "VALIDATED");
  assert.ok(sourceAssets.assetCount >= 2);
  assert.ok(sourceAssets.checks.some((check) => check.id.includes(":apiVersion") && check.status === "PASS"));

  const publishedAssets = runJson(["asset", "validate", "--source", tmp, "--json"]);
  assert.equal(publishedAssets.status, "VALIDATED");
  assert.ok(publishedAssets.checks.some((check) => check.id.includes(":provenance") && check.status === "PASS"));

  const inspect = runJson(["asset", "inspect", "database-product-harness", "--source", tmp, "--json"]);
  assert.equal(inspect.schema, "evopilot-harness-asset-inspect/v2");
  assert.equal(inspect.asset.apiVersion, "evopilot.dev/v2");
  assert.equal(inspect.asset.kind, "HarnessAsset");
  assert.equal(inspect.asset.metadata.id, "database-product-harness");
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
  assert.equal(result.schema, "evopilot-harness-detect-result/v2");
  assert.equal(result.sourceProfile.schema, "evopilot-harness-source-profile/v2");
  assert.equal(result.sourceProfile.scannerVersion, "unknown-source-scanner/v2");
  assert.equal(result.sourceProfile.primaryRole, "redis-client-library");
  assert.equal(result.sourceProfile.recommendedHarness.id, "redis-client-harness");
  assert.equal(result.autoMatch.schema, "evopilot-harness-auto-match/v2");
  assert.equal(result.autoMatch.algorithmVersion, "unknown-source-decision-aggregator/v2");
  assert.equal(result.autoMatch.decision, "CREATE_NEW_WITH_PARENT_REFERENCE");
  assert.equal(result.autoMatch.targetHarnessId, "redis-client-harness");
  assert.equal(result.autoMatch.candidateRetrieval.schema, "evopilot-harness-candidate-retrieval/v2");
  assert.equal(result.autoMatch.reviewGate.required, true);
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
  assert.equal(result.draft.template.schema, "evopilot-harness-template/v2");
  assert.equal(result.draft.asset.apiVersion, "evopilot.dev/v2");
  assert.equal(result.draft.asset.kind, "HarnessAsset");
  assert.equal(result.validation.status, "VALIDATED");
  assert.ok(result.validation.checks.some((check) => check.id === "quality:redis-client-harness@0.1.0:score" && check.status === "PASS"));
  assert.ok(result.validation.checks.some((check) => check.id === "asset:redis-client-harness@0.1.0:apiVersion" && check.status === "PASS"));
});

test("detect scans a GitHub repository source through the local git cache", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-github-detect-"));
  const sourceRepo = createRedisGitRepository(path.join(tmp, "redisclient-source"));
  const cacheRoot = path.join(tmp, "github-cache");
  const result = runJson([
    "detect",
    "--source", path.join(root, "harnesses"),
    "--github-repo", pathToFileURL(sourceRepo).href,
    "--github-ref", "main",
    "--github-cache-root", cacheRoot,
    "--goal", "Create or evolve a reusable domain Harness from this GitHub repository.",
    "--json"
  ]);

  assert.equal(result.status, "READY");
  assert.equal(result.sourceCoverage.sources[0].type, "github-repository");
  assert.equal(result.sourceCoverage.sources[0].knowledgeCategory, "source-architecture");
  assert.equal(result.sourceCoverage.sources[0].github.repository, "local/redisclient-source");
  assert.match(result.sourceCoverage.sources[0].github.resolvedCommit, /^[0-9a-f]{40}$/);
  assert.ok(fs.existsSync(result.sourceCoverage.sources[0].github.cachePath));
  assert.ok(result.sourceProfile.sourceTypes.includes("github-repository"));
  assert.ok(result.sourceProfile.projectRoots.some((projectRoot) => projectRoot.startsWith(cacheRoot)));
  assert.equal(result.sourceProfile.githubRepositories[0].ref, "main");
  assert.equal(result.sourceProfile.primaryRole, "redis-client-library");
  assert.equal(result.autoMatch.targetHarnessId, "redis-client-harness");
});

test("github repository source rejects credentials in URLs", () => {
  const run = spawnSync(process.execPath, [
    cli,
    "detect",
    "--github-repo", "https://secret-token@github.com/example/private-repo",
    "--goal", "Detect from a GitHub repository.",
    "--json"
  ], { encoding: "utf8", env: withoutAdvisorEnv() });

  assert.equal(run.status, 2, run.stderr || run.stdout);
  assert.match(run.stderr, /Do not include credentials in --github-repo/);
  assert.doesNotMatch(run.stderr, /secret-token/);
});

test("evolve from a GitHub repository source keeps definition quality as the target", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-github-evolve-"));
  const sourceRepo = createRedisGitRepository(path.join(tmp, "redisclient-source"));
  const result = runJson([
    "evolve",
    "--source", path.join(root, "harnesses"),
    "--data-root", path.join(tmp, "data"),
    "--github-repo", pathToFileURL(sourceRepo).href,
    "--github-ref", "main",
    "--github-cache-root", path.join(tmp, "github-cache"),
    "--goal", "Create or evolve a reusable domain Harness from this GitHub repository.",
    "--json"
  ]);

  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.sourceProfile.primaryRole, "redis-client-library");
  assert.equal(result.draft.harnessId, "redis-client-harness");
  assert.equal(result.draft.template.definitionQuality.schema, "evopilot-harness-definition-quality/v1");
  assert.equal(result.draft.template.definitionQuality.objective, "more accurate, professional, and fine-grained Harness definition");
  assert.ok(result.draft.template.definitionQuality.focusAreas.includes("match policy specificity"));
  assert.ok(result.draft.template.definitionQuality.nonGoals.includes("large-scale performance optimization"));
  assert.ok(result.draft.template.definitionQuality.nonGoals.includes("runtime performance tuning"));
  assert.ok(result.draft.diffFromBase.changedSections.includes("definitionQuality"));
  assert.equal(result.draft.template.sourceReferences[0].type, "github-repository");
  assert.match(result.draft.template.sourceReferences[0].github.resolvedCommit, /^[0-9a-f]{40}$/);
  assert.equal(result.validation.status, "VALIDATED");
});

test("default optional LLM Advisor without models config does not block deterministic evolution", () => {
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
    "--json"
  ], { env: withoutAdvisorEnv() });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.llmAdvisor.status, "SKIPPED");
  assert.equal(result.llmAdvisor.mode, "optional");
  assert.equal(result.llmAdvisor.llmProfileId, undefined);
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

test("LLM models command reads EvoPilot GLM in CodeBuddy-style models.json without printing API keys", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-llm-models-"));
  const modelsFile = path.join(tmp, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({
    models: [
      {
        id: "glm-5.1",
        name: "EvoPilot GLM",
        vendor: "zhipu",
        apiKey: "secret-evopilot-glm",
        url: "https://open.bigmodel.cn/api/coding/paas/v4",
        supportsToolCall: true,
        supportsReasoning: true
      }
    ]
  }, null, 2));

  const { result, stdout } = runJsonWithRaw(["llm", "models", "--llm-models-file", modelsFile, "--json"], { env: withoutAdvisorEnv() });
  assert.equal(result.schema, "evopilot-harness-llm-models/v1");
  assert.equal(result.status, "READY");
  assert.equal(result.selectedProfile.id, "glm-5.1");
  assert.equal(result.selectedProfile.vendor, "zhipu");
  assert.equal(result.selectedProfile.url, "https://open.bigmodel.cn/api/coding/paas/v4");
  assert.equal(result.selectedProfile.modelName, "glm-5.1");
  assert.equal(result.selectedProfile.apiKeyConfigured, true);
  assert.equal(result.models.length, 1);
  assert.doesNotMatch(stdout, /secret-evopilot-glm/);
});

test("required LLM Advisor uses CodeBuddy-style model profile and records token usage", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-llm-required-call-"));
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

  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ headers: request.headers, body });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        model: "glm-5.1",
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                sourceClassification: "redis-client-library",
                rationale: "The source wraps Spring Data Redis and Jedis client APIs.",
                domainFit: [{ harnessId: "redis-client-harness", fit: "strong", reason: "client library boundary" }],
                recommendation: {
                  action: "CREATE_NEW_WITH_PARENT_REFERENCE",
                  targetHarnessId: "redis-client-harness",
                  targetDomain: "redis-client",
                  confidence: 0.94,
                  reason: "The project is not a cache server implementation."
                },
                alternatives: [],
                reviewWarnings: ["Verify internal endpoint references before publishing."],
                sensitiveMaterialFindings: [],
                commandRecommendations: []
              })
            }
          }
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const modelsFile = path.join(tmp, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({
    models: [
      {
        id: "glm-5.1",
        name: "EvoPilot GLM",
        vendor: "zhipu",
        apiKey: "test-secret-key",
        url: `http://127.0.0.1:${port}/coding/paas/v4`,
        supportsToolCall: true,
        supportsReasoning: true
      }
    ]
  }, null, 2));

  const { result, stdout } = await runJsonWithRawAsync([
    "evolve",
    "--source", path.join(root, "harnesses"),
    "--data-root", path.join(tmp, "data"),
    "--source-project", project,
    "--goal", "Create or evolve a reusable domain Harness from this project.",
    "--llm-advisor", "required",
    "--apply-llm-advisor",
    "--llm-models-file", modelsFile,
    "--json"
  ], { env: withoutAdvisorEnv() });

  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.llmAdvisor.status, "SUCCEEDED");
  assert.equal(result.llmAdvisor.llmProfileId, "glm-5.1");
  assert.equal(result.llmAdvisor.provider, "zhipu");
  assert.equal(result.llmAdvisor.model, "glm-5.1");
  assert.equal(result.llmAdvisor.usage.totalTokens, 15);
  assert.equal(result.llmAdvisor.recommendation.targetHarnessId, "redis-client-harness");
  assert.equal(result.autoMatch.llmAdvisorApplied, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.authorization, "Bearer test-secret-key");
  assert.match(requests[0].body, /glm-5.1/);
  assert.doesNotMatch(stdout, /test-secret-key/);
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

test("corpus lifecycle scans, groups, dedupes, reviews, approves, and publishes batch drafts", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-corpus-"));
  const sourceRoot = path.join(tmp, "source-root");
  const harnessSource = path.join(tmp, "harnesses");
  const published = path.join(tmp, "published");
  const dataRoot = path.join(tmp, "data");
  fs.cpSync(path.join(root, "harnesses"), harnessSource, { recursive: true });
  createCorpusFixture(sourceRoot);

  const plan = runJson([
    "corpus", "plan",
    "--source-root", sourceRoot,
    "--source", harnessSource,
    "--out", published,
    "--data-root", dataRoot,
    "--include-modules",
    "--limit", "20",
    "--max-projects-per-group", "2",
    "--goal", "Batch evolve Harness definitions from this historical project corpus.",
    "--json"
  ]);

  assert.equal(plan.schema, "evopilot-harness-corpus-detail/v1");
  assert.equal(plan.status, "REVIEW_REQUIRED");
  assert.equal(plan.validation.status, "VALIDATED");
  assert.ok(plan.discovery.discoveredCount > plan.groups.length);
  assert.ok(plan.duplicateCount >= 1);
  assert.ok(plan.groups.some((group) => group.targetHarnessId === "redis-client-harness" && group.validation.status === "VALIDATED"));
  assert.ok(plan.groups.some((group) => group.targetHarnessId === "rpc-framework-harness" && group.duplicateProjects.length >= 1));
  assert.ok(plan.groups.some((group) => group.targetHarnessId === "generic-management-software-harness"));
  assert.ok(fs.existsSync(path.join(dataRoot, "corpora", plan.corpusId, "drafts", "redis-client-harness", "template.yaml")));

  const review = runJson(["corpus", "review", plan.corpusId, "--data-root", dataRoot, "--json"]);
  assert.equal(review.corpusId, plan.corpusId);
  assert.equal(review.status, "REVIEW_REQUIRED");

  const approved = runJson([
    "corpus", "approve", plan.corpusId,
    "--data-root", dataRoot,
    "--confirmed-by", "admin@example.com",
    "--confirmation", "Reviewed corpus grouping, dedupe decisions, generated drafts, validation, and publication impact.",
    "--json"
  ]);
  assert.equal(approved.status, "APPROVED");

  const publishedResult = runJson([
    "corpus", "publish", plan.corpusId,
    "--source", harnessSource,
    "--out", published,
    "--data-root", dataRoot,
    "--json"
  ]);
  assert.equal(publishedResult.status, "PUBLISHED");
  assert.ok(publishedResult.publication.groups.some((group) => group.harnessId === "redis-client-harness"));
  assert.ok(fs.existsSync(path.join(harnessSource, "redis-client-harness", "template.yaml")));
  assert.ok(fs.existsSync(path.join(harnessSource, "rpc-framework-harness", "template.yaml")));

  const validation = runJson(["catalog", "validate", "--source", published, "--json"]);
  assert.equal(validation.status, "VALIDATED");
});

test("one-command corpus evolve can approve and publish to a temporary catalog", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-corpus-one-"));
  const sourceRoot = path.join(tmp, "source-root");
  const harnessSource = path.join(tmp, "harnesses");
  const published = path.join(tmp, "published");
  fs.cpSync(path.join(root, "harnesses"), harnessSource, { recursive: true });
  createCorpusFixture(sourceRoot);

  const result = runJson([
    "evolve", "corpus",
    "--source-root", sourceRoot,
    "--source", harnessSource,
    "--out", published,
    "--data-root", path.join(tmp, "data"),
    "--include-modules",
    "--limit", "20",
    "--approve-and-publish",
    "--confirmed-by", "admin@example.com",
    "--confirmation", "Reviewed corpus grouping, generated draft packs, validation, and publication impact.",
    "--json"
  ]);

  assert.equal(result.schema, "evopilot-harness-corpus-evolve-result/v1");
  assert.equal(result.status, "PUBLISHED");
  assert.equal(result.validation.status, "VALIDATED");
  assert.ok(result.publication.groups.length >= 3);
  assert.ok(fs.existsSync(path.join(published, "CATALOG.md")));
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
  assert.equal(result.catalog.catalogVersion, 2);
  assert.ok(result.catalog.entries.some((entry) => entry.name === "database-product-harness" && entry.assetPath && entry.assetApiVersion === "evopilot.dev/v2" && entry.qualityStatus === "PASS"));
  assert.ok(result.harnesses.some((harness) => harness.id === "database-product-harness" && harness.commands.evolve.includes("evopilot-harness evolve")));
  assert.ok(result.sourceTypes.some((source) => source.id === "production-log"));
  assert.ok(result.lifecycleCommands.some((command) => command.id === "corpus-plan"));
  assert.ok(result.lifecycleCommands.some((command) => command.id === "llm-models"));
  assert.ok(result.lifecycleCommands.some((command) => command.id === "asset-validate"));
  assert.ok(result.lifecycleCommands.some((command) => command.id === "unknown-source-eval"));
  assert.ok(result.lifecycleCommands.some((command) => command.id === "llm-replay"));
  assert.ok(result.lifecycleCommands.some((command) => command.id === "publish"));
  assert.ok(fs.existsSync(snapshotFile));
  assert.equal(JSON.parse(fs.readFileSync(snapshotFile, "utf8")).schema, "evopilot-harness-hub-snapshot/v1");
});

test("unknown-source eval and LLM replay are release gates", () => {
  const evalReport = runJson(["eval", "run", "--json"]);
  assert.equal(evalReport.schema, "evopilot-harness-unknown-source-eval-report/v2");
  assert.equal(evalReport.status, "PASSED");
  assert.ok(evalReport.caseCount >= 3);
  assert.equal(evalReport.failedCount, 0);
  assert.equal(evalReport.matrix.EVOLVE_EXISTING, 1);
  assert.equal(evalReport.matrix.CREATE_NEW_WITH_PARENT_REFERENCE, 1);
  assert.equal(evalReport.matrix.CORPUS_GROUPED, 1);

  const replay = runJson(["llm", "replay", "--json"]);
  assert.equal(replay.schema, "evopilot-harness-llm-replay-report/v2");
  assert.equal(replay.status, "PASSED");
  assert.ok(replay.caseCount >= 1);
  assert.equal(replay.failedCount, 0);
});

function createCorpusFixture(sourceRoot) {
  const redisProject = path.join(sourceRoot, "redisclient");
  fs.mkdirSync(path.join(redisProject, "src", "main", "java", "com", "example"), { recursive: true });
  fs.writeFileSync(path.join(redisProject, "pom.xml"), [
    "<project><dependencies>",
    "<dependency><groupId>org.springframework.data</groupId><artifactId>spring-data-redis</artifactId><version>1.0.1</version></dependency>",
    "<dependency><groupId>redis.clients</groupId><artifactId>jedis</artifactId><version>2.0.0</version></dependency>",
    "</dependencies></project>"
  ].join("\n"));
  fs.writeFileSync(path.join(redisProject, "src", "main", "java", "com", "example", "RedisClientService.java"), [
    "package com.example;",
    "import org.springframework.data.redis.core.RedisTemplate;",
    "import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;",
    "public class RedisClientService { RedisTemplate<String, String> template; JedisConnectionFactory factory; }"
  ].join("\n"));

  const rpcRoot = path.join(sourceRoot, "dubbo-platform");
  const rpcModule = path.join(rpcRoot, "dubbo-remoting");
  fs.mkdirSync(path.join(rpcModule, "src", "main", "java", "com", "example"), { recursive: true });
  fs.writeFileSync(path.join(rpcRoot, "pom.xml"), [
    "<project><modules><module>dubbo-remoting</module></modules>",
    "<dependencies><dependency><groupId>com.alibaba</groupId><artifactId>dubbo</artifactId><version>2.7.0</version></dependency></dependencies>",
    "</project>"
  ].join("\n"));
  fs.writeFileSync(path.join(rpcModule, "pom.xml"), [
    "<project><dependencies><dependency><groupId>com.alibaba</groupId><artifactId>dubbo</artifactId><version>2.7.0</version></dependency></dependencies></project>"
  ].join("\n"));
  fs.writeFileSync(path.join(rpcModule, "src", "main", "java", "com", "example", "RpcFilter.java"), [
    "package com.example;",
    "import com.alibaba.dubbo.rpc.RpcContext;",
    "import com.alibaba.dubbo.rpc.Invoker;",
    "public class RpcFilter { RpcContext context; Invoker<?> invoker; }"
  ].join("\n"));

  const adminProject = path.join(sourceRoot, "admin-console");
  fs.mkdirSync(path.join(adminProject, "src", "main", "java", "com", "example"), { recursive: true });
  fs.writeFileSync(path.join(adminProject, "pom.xml"), [
    "<project><dependencies>",
    "<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId><version>2.7.0</version></dependency>",
    "<dependency><groupId>org.mybatis</groupId><artifactId>mybatis</artifactId><version>3.5.0</version></dependency>",
    "</dependencies></project>"
  ].join("\n"));
  fs.writeFileSync(path.join(adminProject, "README.md"), "Enterprise admin software with RBAC, reporting, audit, Swagger, permissions, and database backed service.");
}

function createRedisGitRepository(repoPath) {
  fs.mkdirSync(path.join(repoPath, "src", "main", "java", "com", "example"), { recursive: true });
  fs.writeFileSync(path.join(repoPath, "pom.xml"), [
    "<project>",
    "  <dependencies>",
    "    <dependency><groupId>org.springframework.data</groupId><artifactId>spring-data-redis</artifactId><version>1.0.1</version></dependency>",
    "    <dependency><groupId>redis.clients</groupId><artifactId>jedis</artifactId><version>2.0.0</version></dependency>",
    "  </dependencies>",
    "</project>"
  ].join("\n"));
  fs.writeFileSync(path.join(repoPath, "src", "main", "java", "com", "example", "RedisClientService.java"), [
    "package com.example;",
    "import org.springframework.data.redis.core.RedisTemplate;",
    "import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;",
    "import org.springframework.data.redis.serializer.RedisSerializer;",
    "public class RedisClientService {",
    "  RedisTemplate<String, String> template;",
    "  JedisConnectionFactory factory;",
    "  RedisSerializer<String> serializer;",
    "}"
  ].join("\n"));
  git(["init"], repoPath);
  git(["checkout", "-b", "main"], repoPath);
  git(["config", "user.email", "evopilot-harness@example.com"], repoPath);
  git(["config", "user.name", "EvoPilot Harness Test"], repoPath);
  git(["add", "."], repoPath);
  git(["commit", "-m", "initial redis client fixture"], repoPath);
  return repoPath;
}

function git(args, cwd) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return run.stdout.trim();
}

function runJson(args, options = {}) {
  return runJsonWithRaw(args, options).result;
}

function runJsonWithRaw(args, options = {}) {
  const run = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: withoutAdvisorEnv(), ...options });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stderr, "");
  try {
    return { result: JSON.parse(run.stdout), stdout: run.stdout, stderr: run.stderr };
  } catch (error) {
    assert.fail(`Expected JSON output, got:\n${run.stdout}\n${error.message}`);
  }
}

async function runJsonWithRawAsync(args, options = {}) {
  const child = spawn(process.execPath, [cli, ...args], { env: withoutAdvisorEnv(), ...options });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const status = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  assert.equal(status, 0, stderr || stdout);
  assert.equal(stderr, "");
  try {
    return { result: JSON.parse(stdout), stdout, stderr };
  } catch (error) {
    assert.fail(`Expected JSON output, got:\n${stdout}\n${error.message}`);
  }
}

function withoutAdvisorEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of [
    "EVOPILOT_HARNESS_LLM_ADVISOR",
    "EVOPILOT_HARNESS_LLM_API_KEY",
    "EVOPILOT_HARNESS_LLM_BASE_URL",
    "EVOPILOT_HARNESS_LLM_MODEL_NAME",
    "EVOPILOT_HARNESS_LLM_PROVIDER_NAME",
    "EVOPILOT_HARNESS_LLM_PROVIDER_PRESET",
    "EVOPILOT_HARNESS_LLM_PROFILE",
    "EVOPILOT_HARNESS_LLM_PROFILE_ID",
    "EVOPILOT_HARNESS_LLM_MODEL_ID",
    "EVOPILOT_HARNESS_LLM_MODELS_FILE",
    "EVOPILOT_HARNESS_LLM_API_KEY_ENV",
    "EVOPILOT_LLM_API_KEY",
    "EVOPILOT_LLM_BASE_URL",
    "EVOPILOT_LLM_MODEL_NAME",
    "EVOPILOT_LLM_PROVIDER_NAME"
  ]) delete env[key];
  return { ...env, EVOPILOT_HARNESS_LLM_MODELS_FILE: path.join(os.tmpdir(), "evopilot-harness-test-missing-models.json"), ...overrides };
}
