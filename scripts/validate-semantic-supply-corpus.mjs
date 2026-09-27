#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const CORPUS_ROOT = path.resolve(import.meta.dirname, "..");
export const PLAN_PATH = "tests/e2e/versions/4.8.1/case-plan.json";
export const LOCAL_SUITES = Object.freeze([
  "tests/v4.8.1-semantic-catalog-contract.test.mjs",
  "tests/v4.8.1-semantic-catalog-materials.test.mjs",
  "tests/v4.8.1-semantic-catalog-store.test.mjs",
  "tests/v4.8.1-semantic-catalog-supply.test.mjs",
  "tests/v4.8.1-semantic-catalog-public-negative.test.mjs"
]);
const sha = value => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
function requireCorpus(condition, code) {
  if (!condition) throw Object.assign(new Error(code), {code});
}
export function projectCasePlan(targetBytes) {
  const target = JSON.parse(targetBytes);
  requireCorpus(target.schema === "evopilot-evolution-target/v1" &&
    target.id === "evopilot-harness-v4.8.1-semantic-catalog-supply-repair" && target.revision === 2, "TARGET_IDENTITY_MISMATCH");
  requireCorpus(Array.isArray(target.acceptance) && Array.isArray(target.realCaseCoverage), "TARGET_CASES_INVALID");
  requireCorpus(isDeepStrictEqual(target.realCaseCoverage.map(item => item.id), ["RC01", "RC02", "RC03", "RC04", "RC05"]), "TARGET_CASES_INVALID");
  return {
    schema: "evopilot-harness-e2e-development-plan/v1", version: "4.8.1", projectionMode: "DEVELOPMENT_CASE_PLAN",
    target: {id: target.id, revision: target.revision, fileDigest: sha(targetBytes)},
    acceptanceIds: target.acceptance.map(item => item.id), inheritedObligationsPointer: "/inheritedAcceptance",
    cases: target.realCaseCoverage.map((item, i) => ({id: item.id, scenario: item.scenario, hosts: item.hosts,
      targetPointer: `/realCaseCoverage/${i}`, coversAcceptanceIds: item.coversAcceptanceIds,
      machineVariants: item.machineVariants.map((variant, j) => ({id: variant.id, scenario: variant.scenario, hosts: variant.hosts,
        targetPointer: `/realCaseCoverage/${i}/machineVariants/${j}`, coversAcceptanceIds: variant.coversAcceptanceIds}))})),
    supportingLocalSuites: [...LOCAL_SUITES],
    evidencePolicy: "LOCAL_SYNTHETIC_SUPPORT_ONLY_NOT_RC_ACCEPTANCE",
    authority: {productAuthority: false, acceptanceAuthority: false, releaseAuthority: false}
  };
}

export function safeRepositoryFile(root, relative) {
  requireCorpus(typeof relative === "string" && /^[a-zA-Z0-9._/-]+$/.test(relative) && !path.isAbsolute(relative) &&
    relative.split("/").every(part => part && part !== "." && part !== ".."), "UNSAFE_REFERENCE");
  let current = fs.realpathSync(root);
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    requireCorpus(!stat.isSymbolicLink(), "UNSAFE_REFERENCE");
  }
  requireCorpus(fs.statSync(current).isFile(), "CASE_FILE_MISSING");
  return current;
}

export function validateCasePlan(plan, targetBytes, root = CORPUS_ROOT) {
  requireCorpus(plan?.target?.fileDigest === sha(targetBytes), "TARGET_DIGEST_MISMATCH");
  // Exact projection comparison rejects missing/reordered cases, unsafe replacement
  // references, embedded authority/status, extra commands and changed coverage.
  requireCorpus(isDeepStrictEqual(plan, projectCasePlan(targetBytes)), "CASE_PLAN_MISMATCH");
  for (const file of LOCAL_SUITES) safeRepositoryFile(root, file);
  const pkg = JSON.parse(fs.readFileSync(safeRepositoryFile(root, "package.json")));
  requireCorpus(Array.isArray(pkg.files) && pkg.files.every(file => !file.startsWith("tests") && !/[?*]/.test(file) && file !== "." && file !== ""), "PACKAGE_ISOLATION_INVALID");
  return {schema: "evopilot-harness-e2e-development-validation/v1", status: "CASE_PLAN_VALIDATED", version: "4.8.1",
    targetFileDigest: plan.target.fileDigest, caseCount: plan.cases.length,
    machineVariantCount: plan.cases.reduce((n, item) => n + item.machineVariants.length, 0),
    currentCriterionCount: plan.acceptanceIds.length, localSyntheticTests: "NOT_RUN", installedPackageE2E: "NOT_RUN",
    realHost: "NOT_RUN", inheritedAcceptanceReplay: "NOT_RUN", formalAcceptance: "NOT_RUN",
    targetCriteriaClosed: 0, authority: {...plan.authority}};
}

function run() {
  const args = process.argv.slice(2);
  requireCorpus((args.length === 2 || (args.length === 3 && args[2] === "--run-local")) && args[0] === "--target" && args[1], "EXPLICIT_TARGET_REQUIRED");
  // The explicit external Target is read-only input. Never copy private evidence
  // or mutate its status. It is not a command, source project or policy authority.
  const targetFile = path.resolve(args[1]);
  requireCorpus(fs.statSync(targetFile).size <= 33554432, "TARGET_SIZE_LIMIT");
  const targetBytes = fs.readFileSync(targetFile);
  const planFile = safeRepositoryFile(CORPUS_ROOT, PLAN_PATH);
  requireCorpus(fs.statSync(planFile).size <= 1048576, "PLAN_SIZE_LIMIT");
  const plan = JSON.parse(fs.readFileSync(planFile));
  const report = validateCasePlan(plan, targetBytes);
  const historicalScript = safeRepositoryFile(CORPUS_ROOT, "scripts/validate-repository-e2e.mjs");
  const historical = spawnSync(process.execPath, [historicalScript], {cwd: CORPUS_ROOT, encoding: "utf8", timeout: 30000, maxBuffer: 4194304});
  requireCorpus(historical.status === 0, "HISTORICAL_PROJECTION_FAILED");
  const old = JSON.parse(historical.stdout);
  report.historicalProjection = {status: old.status, validationDigest: old.validationDigest};
  if (args.includes("--run-local")) {
    // Fixed reviewed local suites only; no manifest-supplied executable/arguments.
    const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...LOCAL_SUITES],
      {cwd: CORPUS_ROOT, encoding: "utf8", timeout: 120000, maxBuffer: 4194304});
    requireCorpus(result.status === 0, "LOCAL_SYNTHETIC_TESTS_FAILED");
    const count = Number(result.stdout.match(/^# pass (\d+)$/m)?.[1]);
    requireCorpus(Number.isSafeInteger(count) && count > 0 && /^# fail 0$/m.test(result.stdout), "LOCAL_TEST_REPORT_INVALID");
    report.localSyntheticTests = {status: "PASSED", passedCount: count, outputDigest: sha(result.stdout)};
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { run(); } catch (error) {
    process.stdout.write(`${JSON.stringify({status: "BLOCKED", code: error.code ?? "CORPUS_VALIDATION_FAILED", formalAcceptance: "NOT_RUN", targetCriteriaClosed: 0, grantsProductAuthority: false})}\n`);
    process.exitCode = 2;
  }
}
