import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { CORPUS_ROOT, PLAN_PATH, LOCAL_SUITES, projectCasePlan, safeRepositoryFile, validateCasePlan } from "../scripts/validate-semantic-supply-corpus.mjs";

const checkedIn = JSON.parse(fs.readFileSync(path.join(CORPUS_ROOT, PLAN_PATH)));
// Minimal synthetic Target tests projection mechanics, not real approval or evidence.
const targetBytes = Buffer.from(JSON.stringify({schema: "evopilot-evolution-target/v1", id: checkedIn.target.id,
  revision: 3, acceptance: checkedIn.acceptanceIds.map(id => ({id, status: "PENDING", evidenceRefs: []})),
  realCaseCoverage: checkedIn.cases.map(({targetPointer, ...item}) => ({...item,
    machineVariants: item.machineVariants.map(({targetPointer, ...variant}) => variant)}))}));
const fixture = () => projectCasePlan(targetBytes);
const code = expected => error => error.code === expected;

test("versioned local corpus includes the actual public negative matrix exactly once", () => {
  const file = "tests/v4.8.1-semantic-catalog-public-negative.test.mjs";
  assert.equal(LOCAL_SUITES.filter(item => item === file).length, 1);
  assert.equal(checkedIn.supportingLocalSuites.filter(item => item === file).length, 1);
  const incomplete = fixture(); incomplete.supportingLocalSuites = incomplete.supportingLocalSuites.filter(item => item !== file);
  assert.throws(() => validateCasePlan(incomplete, targetBytes), code("CASE_PLAN_MISMATCH"));
});

test("development corpus declares five RC journeys, eleven variants and twelve criteria without authority", () => {
  const plan = fixture();
  assert.deepEqual({...checkedIn, target: plan.target}, plan);
  assert.equal(checkedIn.target.fileDigest, "sha256:9aed985247cfa303eb8ba8b716eb071933d56dc32c017492d8836af526496578");
  const report = validateCasePlan(plan, targetBytes);
  assert.equal(report.caseCount, 5);
  for (const item of [...plan.cases, ...plan.cases.flatMap(c => c.machineVariants)]) assert.deepEqual(item.hosts, ["Codex"]);
  assert.equal(report.machineVariantCount, 11);
  assert.equal(report.currentCriterionCount, 12);
  assert.equal(report.formalAcceptance, "NOT_RUN");
  assert.equal(report.targetCriteriaClosed, 0);
  assert.equal(report.localSyntheticTests, "NOT_RUN");
  assert.equal(report.inheritedAcceptanceReplay, "NOT_RUN");
});

test("Target byte drift and wrong identity cannot inherit case approval", () => {
  assert.throws(() => validateCasePlan(fixture(), Buffer.concat([targetBytes, Buffer.from("\n")])), code("TARGET_DIGEST_MISMATCH"));
  const target = JSON.parse(targetBytes); target.id = "different-target";
  assert.throws(() => projectCasePlan(Buffer.from(JSON.stringify(target))), code("TARGET_IDENTITY_MISMATCH"));
});

test("missing reordered or relabeled cases and changed coverage fail closed", () => {
  for (const change of [plan => plan.cases.pop(), plan => plan.cases.reverse(),
    plan => plan.cases[0].machineVariants.pop(), plan => plan.cases[0].coversAcceptanceIds.pop(),
    plan => { plan.cases[0].hosts = ["WorkBuddy"]; },
    plan => { plan.cases[0].machineVariants[0].hosts = ["WorkBuddy"]; },
    plan => { plan.cases[0].targetPointer = "/approvals"; }, plan => { plan.cases[0].id = "RC99"; }]) {
    const plan = fixture(); change(plan);
    assert.throws(() => validateCasePlan(plan, targetBytes), code("CASE_PLAN_MISMATCH"));
  }
});

test("unsafe suite references and embedded commands or authority are never executable", () => {
  for (const unsafe of ["../escape.mjs", "/tmp/escape.mjs", "https://example.invalid/test", "tests/injected.mjs"]) {
    const plan = fixture(); plan.supportingLocalSuites[0] = unsafe;
    assert.throws(() => validateCasePlan(plan, targetBytes), code("CASE_PLAN_MISMATCH"));
  }
  for (const key of ["status", "approvals", "release", "evidenceRefs", "command"]) {
    const plan = fixture(); plan.cases[0][key] = "injected";
    assert.throws(() => validateCasePlan(plan, targetBytes), code("CASE_PLAN_MISMATCH"));
  }
});

test("case files must exist and cannot be symlink substitutions", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-corpus-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  assert.throws(() => validateCasePlan(fixture(), targetBytes, root), {code: "ENOENT"});
  fs.mkdirSync(path.join(root, "tests"));
  fs.symlinkSync(path.join(CORPUS_ROOT, LOCAL_SUITES[0]), path.join(root, LOCAL_SUITES[0]));
  assert.throws(() => validateCasePlan(fixture(), targetBytes, root), code("UNSAFE_REFERENCE"));
  assert.throws(() => safeRepositoryFile(root, "../package.json"), code("UNSAFE_REFERENCE"));
});

test("package allowlist must continue excluding repository case plans", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-corpus-package-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, "tests"));
  for (const file of LOCAL_SUITES) fs.writeFileSync(path.join(root, file), "// synthetic path fixture\n");
  for (const files of [["tests"], ["**"], ["."]]) {
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({files}));
    assert.throws(() => validateCasePlan(fixture(), targetBytes, root), code("PACKAGE_ISOLATION_INVALID"));
  }
});

test("development command requires an explicit external Target before running anything", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-semantic-supply-corpus.mjs"], {cwd: CORPUS_ROOT, encoding: "utf8"});
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).code, "EXPLICIT_TARGET_REQUIRED");
  assert.equal(JSON.parse(result.stdout).targetCriteriaClosed, 0);
});
