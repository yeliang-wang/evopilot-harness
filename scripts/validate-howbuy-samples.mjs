#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cli = path.join(repoRoot, "src", "index.mjs");
const args = parseArgs(process.argv.slice(2));
if (!args["source-root"]) throw new Error("--source-root is required; no personal Source path is built into this validator.");
const sourceRoot = path.resolve(args["source-root"]);
const harnessSource = path.resolve(args.source ?? path.join(repoRoot, "harnesses"));
const samples = [
  {
    relativePath: "platform/Howbuy-Cache/redisclient",
    primaryRole: "redis-client-library",
    targetHarnessId: "redis-client-harness",
    decision: "CREATE_NEW_WITH_PARENT_REFERENCE"
  },
  {
    relativePath: "platform/ProxyCheck",
    primaryRole: "cache-proxy-monitor",
    targetHarnessId: "cache-proxy-monitor-harness",
    decision: "CREATE_NEW_WITH_PARENT_REFERENCE"
  },
  {
    relativePath: "platform/noodel",
    primaryRole: "workflow-engine",
    targetHarnessId: "workflow-engine-harness",
    decision: "CREATE_NEW_WITH_PARENT_REFERENCE"
  },
  {
    relativePath: "AppFramework/LogUnified",
    primaryRole: "logging-sdk",
    targetHarnessId: "logging-sdk-harness",
    decision: "CREATE_NEW_WITH_PARENT_REFERENCE"
  },
  {
    relativePath: "opensource/dubbo",
    primaryRole: "rpc-framework",
    targetHarnessId: "rpc-framework-harness",
    decision: "CREATE_NEW_WITH_PARENT_REFERENCE"
  },
  {
    relativePath: "project/Howbuy-pa/mofang-butler/butler-admin",
    primaryRole: "enterprise-admin-software",
    targetHarnessId: "generic-management-software-harness",
    decision: "EVOLVE_EXISTING"
  },
  {
    relativePath: "website_web/deploy_website",
    primaryRole: "frontend-admin-app",
    targetHarnessId: "frontend-admin-app-harness",
    decision: "CREATE_NEW_WITH_PARENT_REFERENCE"
  }
];

const results = [];
for (const sample of samples) {
  const project = path.join(sourceRoot, sample.relativePath);
  if (!fs.existsSync(project)) {
    results.push({ ...sample, status: "SKIPPED", reason: `missing=${sample.relativePath}` });
    continue;
  }
  const run = spawnSync(process.execPath, [
    cli,
    "detect",
    "--source", harnessSource,
    "--source-project", project,
    "--goal", "Create or evolve a reusable domain Harness from this project.",
    "--json"
  ], { encoding: "utf8" });
  if (run.status !== 0) {
    results.push({ ...sample, status: "FAILED", reason: run.stderr || run.stdout });
    continue;
  }
  const detected = JSON.parse(run.stdout);
  const actual = {
    primaryRole: detected.sourceProfile.primaryRole,
    targetHarnessId: detected.autoMatch.targetHarnessId,
    decision: detected.autoMatch.decision,
    confidence: detected.autoMatch.confidence
  };
  const failures = Object.entries(sample)
    .filter(([key]) => key !== "relativePath")
    .filter(([key, expected]) => actual[key] !== expected)
    .map(([key, expected]) => `${key}: expected=${expected} actual=${actual[key]}`);
  results.push({
    relativePath: sample.relativePath,
    status: failures.length === 0 ? "PASSED" : "FAILED",
    expected: sample,
    actual,
    failures
  });
}

const failed = results.filter((result) => result.status === "FAILED");
const payload = {
  schema: "evopilot-harness-howbuy-sample-validation/v1",
  status: failed.length === 0 ? "VALIDATED" : "FAILED",
  sourceRoot: path.basename(sourceRoot),
  harnessSource: path.relative(repoRoot, harnessSource) || ".",
  sampleCount: results.length,
  passedCount: results.filter((result) => result.status === "PASSED").length,
  skippedCount: results.filter((result) => result.status === "SKIPPED").length,
  failedCount: failed.length,
  results
};
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
process.exit(failed.length === 0 ? 0 : 2);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
