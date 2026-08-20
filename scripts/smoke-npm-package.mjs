#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-npm-smoke-"));
const packageDir = path.join(temporary, "package");
const app = path.join(temporary, "app");
const workspace = path.join(temporary, "workspace");
fs.mkdirSync(packageDir, { recursive: true });
fs.mkdirSync(app, { recursive: true });

try {
  const pack = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", packageDir], root))[0];
  const tarball = path.join(packageDir, pack.filename);
  fs.writeFileSync(path.join(app, "package.json"), `${JSON.stringify({ name: "evopilot-harness-package-smoke", private: true })}\n`);
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], app);

  const packageRoot = fs.realpathSync(path.join(app, "node_modules", "@evopilot", "harness"));
  const cli = path.join(app, "node_modules", ".bin", "evopilot-harness");
  assert.ok(fs.existsSync(cli), "installed evopilot-harness binary is missing");
  const version = JSON.parse(run(cli, ["--version", "--json"], app));
  assert.equal(version.version, "4.1.0");

  const bootstrap = JSON.parse(run(cli, ["agent", "bootstrap", "--host", "workbuddy", "--workspace", workspace, "--json"], app));
  assert.equal(bootstrap.status, "READY");
  assert.equal(bootstrap.package.name, "@evopilot/harness");
  assert.equal(bootstrap.package.version, "4.1.0");
  assert.equal(bootstrap.package.distributionMode, "installed-package");
  assert.equal(bootstrap.package.sourceCheckoutRequired, false);
  assert.ok(fs.realpathSync(bootstrap.package.root).startsWith(packageRoot));
  assert.ok(fs.realpathSync(bootstrap.adapter.path).startsWith(packageRoot));
  assert.deepEqual(bootstrap.mcp.exactNpxCommand, {
    command: "npx",
    args: ["--yes", "--package", "@evopilot/harness@4.1.0", "evopilot-harness", "mcp", "serve", "--transport", "stdio", "--workspace", bootstrap.workspace.path]
  });
  assert.equal(bootstrap.workspace.externalToRelease, true);

  const conformance = JSON.parse(run(process.execPath, [
    path.join(packageRoot, "digital-expert", "conformance", "generic-host.mjs"),
    "--workspace", workspace,
    "--adapter-id", "workbuddy"
  ], app));
  assert.equal(conformance.status, "PASSED");
  assert.equal(conformance.adapterId, "workbuddy");
  assert.equal(conformance.server.version, "4.1.0");

  const installedMcp = await runInstalledMcpScenario({ app, cli, packageRoot, workspace });

  console.log(JSON.stringify({
    schema: "evopilot-harness-npm-package-smoke/v1",
    status: "PASSED",
    package: "@evopilot/harness@4.1.0",
    cli,
    packageRoot,
    sourceCheckoutUsed: false,
    bootstrap: { host: bootstrap.host.id, adapter: bootstrap.adapter.packageRelativePath },
    mcp: {
      protocolVersion: conformance.protocolVersion,
      toolCount: conformance.toolCount,
      networkListening: conformance.networkListening,
      comparison: installedMcp.comparison,
      calibration: installedMcp.calibration
    }
  }, null, 2));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_update_notifier: "false" },
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

async function runInstalledMcpScenario({ app, cli, packageRoot, workspace }) {
  const catalog = await installedModule(packageRoot, "src/v3/catalog.mjs");
  const comparison = await installedModule(packageRoot, "src/v3/comparison.mjs");
  const calibration = await installedModule(packageRoot, "src/v3/calibration.mjs");
  const utils = await installedModule(packageRoot, "src/v3/utils.mjs");

  const initialized = JSON.parse(run(cli, ["workspace", "init", "--workspace", workspace, "--json"], app));
  assert.equal(initialized.status, "READY");
  const profiles = catalog.discoverAssets([path.join(workspace, "catalogs/builtin/assets")])
    .filter((item) => item.asset.kind === "HarnessProfile" && item.asset.metadata.lifecycle === "published");
  assert.ok(profiles.length >= 2, "installed package must provide at least two immutable published profiles for the smoke comparison");

  const now = new Date();
  const generatedAt = new Date(now.getTime() - 120_000).toISOString();
  const approvedAt = new Date(now.getTime() - 60_000).toISOString();
  const expiresAt = new Date(now.getTime() + 86_400_000).toISOString();
  const comparisonId = "installed-package-comparison";
  const packageId = "installed-package-comparison-a";
  const document = {
    apiVersion: "comparison.evopilot.io/v1",
    kind: "HarnessComparisonEvidencePackage",
    metadata: {
      comparisonId,
      packageId,
      version: "1.0.0",
      generatedAt,
      expiresAt,
      producer: { name: "installed-package-smoke", version: "1.0.0", instanceId: packageId },
      packageDigest: zeroDigest()
    },
    approval: { status: "APPROVED", approvedBy: "package-smoke-reviewer", approvedAt, purpose: "HARNESS_COMPARISON_EVIDENCE" },
    redaction: { status: "REDACTED", method: "installed-package-smoke/v1", payloadDigest: zeroDigest() },
    baseline: catalogBinding(profiles[0]),
    candidate: catalogBinding(profiles[1]),
    comparisonContext: {
      task: { id: "installed-package-task", digest: utils.digest("installed-package-task") },
      sourceSnapshotDigest: utils.digest("installed-package-source-snapshot"),
      environmentDigest: utils.digest("installed-package-environment"),
      modelConfigurationDigest: utils.digest("installed-package-model"),
      toolchainDigest: utils.digest("installed-package-toolchain"),
      evaluationPackRef: { id: "installed-package-evaluation", version: "1.0.0", digest: utils.digest("installed-package-evaluation@1.0.0") },
      scorerSet: [{ id: "installed-package-scorer", version: "1.0.0", digest: utils.digest("installed-package-scorer@1.0.0") }]
    },
    metricDefinitions: [
      { id: "outcome-success", dimension: "OUTCOME", valueType: "BOOLEAN", direction: "TRUE_IS_BETTER", required: true, blocking: false, minimumMeaningfulDelta: 0, maximumAllowedRegression: 0 },
      { id: "safety-safe", dimension: "SAFETY", valueType: "BOOLEAN", direction: "TRUE_IS_BETTER", required: true, blocking: true, minimumMeaningfulDelta: 0, maximumAllowedRegression: 0 }
    ],
    observations: Array.from({ length: 5 }, (_, index) => ({
      pairId: `installed-pair-${index + 1}`,
      baseline: {
        executionId: `installed-baseline-${index + 1}`,
        completedAt: generatedAt,
        metrics: [
          { metricId: "outcome-success", status: "OBSERVED", value: index < 2 },
          { metricId: "safety-safe", status: "OBSERVED", value: true }
        ]
      },
      candidate: {
        executionId: `installed-candidate-${index + 1}`,
        completedAt: approvedAt,
        metrics: [
          { metricId: "outcome-success", status: "OBSERVED", value: true },
          { metricId: "safety-safe", status: "OBSERVED", value: true }
        ]
      }
    })),
    provenance: {
      sourceId: packageId,
      sourceType: "EVALUATOR",
      generatedBy: "installed-package-smoke",
      evidenceDigests: [utils.digest("installed-package-comparison-evidence")]
    }
  };
  document.redaction.payloadDigest = comparison.comparisonPayloadDigest(document);
  document.metadata.packageDigest = comparison.comparisonPackageDigest(document);
  const fixtures = path.join(workspace, "fixtures");
  fs.mkdirSync(fixtures, { recursive: true });
  const packageFile = path.join(fixtures, "comparison.yaml");
  utils.writeYaml(packageFile, document);

  const client = createSmokeMcpClient({ command: cli, args: ["mcp", "serve", "--transport", "stdio", "--workspace", workspace], cwd: app });
  try {
    await client.initialize(packageRoot);
    const validated = structured(await client.tool("run_engine_diagnostic", { operation: "comparison.validate", input: { file: packageFile, now: now.toISOString() } }));
    assert.equal(validated.status, "VALIDATED");
    let comparisonSession = structured(await client.tool("start_operation_session", { intent: "Compare installed package Baseline and Candidate evidence", adapterId: "installed-package-smoke" }));
    comparisonSession = structured(await client.tool("plan_operation_session", {
      sessionId: comparisonSession.sessionId,
      expectedSessionDigest: comparisonSession.sessionDigest,
      scenario: "comparison",
      goal: comparisonSession.intent.text,
      sources: { comparisonFile: packageFile, now: now.toISOString() }
    }));
    comparisonSession = structured(await client.tool("confirm_operation_plan", {
      sessionId: comparisonSession.sessionId,
      expectedSessionDigest: comparisonSession.sessionDigest,
      expectedPlanDigest: comparisonSession.planDigest,
      confirmedBy: "package-smoke-reviewer",
      confirmation: `CONFIRM_OPERATION_PLAN:${comparisonSession.planDigest}`
    }));
    comparisonSession = structured(await client.tool("execute_operation_plan", {
      sessionId: comparisonSession.sessionId,
      expectedSessionDigest: comparisonSession.sessionDigest,
      expectedPlanDigest: comparisonSession.planDigest
    }));
    assert.equal(comparisonSession.status, "EVIDENCE_REVIEW_REQUIRED");
    const comparisonReport = comparisonSession.evidenceReports[0];
    assert.equal(comparisonReport.type, "COMPARISON");
    comparisonSession = structured(await client.tool("acknowledge_evidence_report_review", {
      sessionId: comparisonSession.sessionId,
      expectedSessionDigest: comparisonSession.sessionDigest,
      reportType: "COMPARISON",
      reportId: comparisonReport.reportId,
      expectedReportDigest: comparisonReport.reportDigest,
      confirmedBy: "package-smoke-reviewer",
      confirmation: `ACKNOWLEDGE_COMPARISON_REVIEW:${comparisonReport.reportId}:${comparisonReport.reportDigest}`
    }));
    assert.equal(comparisonSession.status, "COMPLETED");

    const report = structured(await client.tool("run_engine_diagnostic", { operation: "comparison.report", input: { reportId: comparisonReport.reportId } })).result.report;
    const caseSet = calibrationCaseSet({ calibration, report, reviewedAt: now.toISOString(), utils });
    const caseSetFile = path.join(fixtures, "calibration-case-set.yaml");
    utils.writeYaml(caseSetFile, caseSet);
    const baselinePolicy = fs.readdirSync(path.join(workspace, "policies/comparison"))
      .map((name) => path.join(workspace, "policies/comparison", name))
      .find((file) => utils.readYaml(file).kind === "ComparisonPolicyPack");
    assert.ok(baselinePolicy, "installed comparison policy is missing");
    const candidatePolicy = path.join(workspace, "candidate-comparison-policy.yaml");
    const candidatePolicyDocument = utils.readYaml(baselinePolicy);
    candidatePolicyDocument.metadata.id = "installed-package-candidate-comparison";
    candidatePolicyDocument.metadata.version = "2.0.0";
    candidatePolicyDocument.metadata.lifecycle = "review";
    candidatePolicyDocument.spec.minPairedObservations = 10;
    utils.writeYaml(candidatePolicy, candidatePolicyDocument);

    const calibrationValidation = structured(await client.tool("run_engine_diagnostic", { operation: "calibration.validate", input: { file: caseSetFile } }));
    assert.equal(calibrationValidation.status, "VALIDATED");
    let calibrationSession = structured(await client.tool("start_operation_session", { intent: "Calibrate installed package Proposal comparison policies", adapterId: "installed-package-smoke" }));
    calibrationSession = structured(await client.tool("plan_operation_session", {
      sessionId: calibrationSession.sessionId,
      expectedSessionDigest: calibrationSession.sessionDigest,
      scenario: "calibration",
      goal: calibrationSession.intent.text,
      sources: {
        calibrationCaseSet: caseSetFile,
        baselineComparisonPolicy: baselinePolicy,
        candidateComparisonPolicy: candidatePolicy,
        now: now.toISOString()
      }
    }));
    calibrationSession = structured(await client.tool("confirm_operation_plan", {
      sessionId: calibrationSession.sessionId,
      expectedSessionDigest: calibrationSession.sessionDigest,
      expectedPlanDigest: calibrationSession.planDigest,
      confirmedBy: "package-smoke-reviewer",
      confirmation: `CONFIRM_OPERATION_PLAN:${calibrationSession.planDigest}`
    }));
    calibrationSession = structured(await client.tool("execute_operation_plan", {
      sessionId: calibrationSession.sessionId,
      expectedSessionDigest: calibrationSession.sessionDigest,
      expectedPlanDigest: calibrationSession.planDigest
    }));
    assert.equal(calibrationSession.status, "EVIDENCE_REVIEW_REQUIRED");
    const calibrationReport = calibrationSession.evidenceReports[0];
    assert.equal(calibrationReport.type, "CALIBRATION");
    calibrationSession = structured(await client.tool("acknowledge_evidence_report_review", {
      sessionId: calibrationSession.sessionId,
      expectedSessionDigest: calibrationSession.sessionDigest,
      reportType: "CALIBRATION",
      reportId: calibrationReport.reportId,
      expectedReportDigest: calibrationReport.reportDigest,
      confirmedBy: "package-smoke-reviewer",
      confirmation: `ACKNOWLEDGE_CALIBRATION_REVIEW:${calibrationReport.reportId}:${calibrationReport.reportDigest}`
    }));
    assert.equal(calibrationSession.status, "COMPLETED");
    return {
      comparison: { reportId: comparisonReport.reportId, recommendation: comparisonReport.recommendation, reviewed: true },
      calibration: { reportId: calibrationReport.reportId, recommendation: calibrationReport.recommendation, reviewed: true }
    };
  } finally {
    await client.close();
  }
}

function calibrationCaseSet({ calibration, report, reviewedAt, utils }) {
  const reportRef = { reportId: report.metadata.reportId, reportDigest: report.metadata.reportDigest };
  const document = {
    apiVersion: "comparison.evopilot.io/v1",
    kind: "HarnessCalibrationCaseSet",
    metadata: { id: "installed-package-calibration", version: "1.0.0", createdAt: reviewedAt, caseSetDigest: zeroDigest() },
    review: {
      status: "APPROVED",
      reviewedBy: "package-smoke-reviewer",
      reviewedAt,
      evidenceRefs: [utils.digest("installed-package-calibration-review")]
    },
    cases: Array.from({ length: 3 }, (_, index) => ({
      id: `installed-proposal-case-${index + 1}`,
      caseType: "PROPOSAL",
      comparisonId: report.metadata.comparisonId,
      expectedRecommendation: report.recommendation,
      comparisonReportRef: reportRef
    }))
  };
  document.metadata.caseSetDigest = calibration.calibrationCaseSetDigest(document);
  return document;
}

function catalogBinding(record) {
  return {
    source: "CATALOG",
    assetRefs: [{ kind: record.asset.kind, id: record.asset.metadata.id, version: record.asset.metadata.version, digest: record.digest }]
  };
}

function zeroDigest() {
  return "sha256:".padEnd(71, "0");
}

async function installedModule(packageRoot, relativePath) {
  return import(pathToFileURL(path.join(packageRoot, relativePath)).href);
}

function structured(result) {
  assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
  return result.structuredContent;
}

function createSmokeMcpClient(options) {
  return new class SmokeMcpClient {
  constructor({ command, args, cwd }) {
    this.child = spawn(command, args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = "";
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => { this.stderr += chunk; });
    this.child.on("exit", (code, signal) => {
      for (const pending of this.pending.values()) pending.reject(new Error(`installed MCP exited code=${code} signal=${signal}; stderr=${this.stderr}`));
      this.pending.clear();
    });
    const lines = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      const message = JSON.parse(line);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  tool(name, args = {}) {
    return this.request("tools/call", { name, arguments: args });
  }

  async initialize(packageRoot) {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(packageRoot, "digital-expert/manifest.lock.json"), "utf8"));
    const result = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "installed-package-smoke",
        version: "1.0.0",
        compatibility: {
          productVersion: manifest.version,
          expertVersion: lock.expertVersion,
          coreDigest: lock.coreDigest,
          agentProtocolVersion: "evopilot-harness-agent-operations/v1",
          engineApiVersion: "harness.evopilot.io/v3"
        }
      }
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    return result;
  }

  async close() {
    this.child.stdin.end();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.child.kill("SIGKILL");
        reject(new Error(`installed MCP did not close after stdin EOF; stderr=${this.stderr}`));
      }, 5000);
      this.child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  }(options);
}
