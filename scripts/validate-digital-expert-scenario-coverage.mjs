#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const root = process.cwd();
const matrixFile = path.join(root, "digital-expert/conformance/scenario-matrix.yaml");
const matrix = parseYaml(fs.readFileSync(matrixFile, "utf8"));
const runtimeTests = new Map();

validateCoverage("evidenceSources", matrix.evidenceSources, matrix.coverage?.evidenceSources);
validateCoverage("terminalDecisions", matrix.terminalDecisions, matrix.coverage?.terminalDecisions);
validateCoverage("engineOperations", matrix.engineOperations, matrix.coverage?.engineOperations);
validateCoverage("lifecycleBranches", matrix.lifecycleBranches, matrix.coverage?.lifecycleBranches);
executeBoundTests();

process.stdout.write(`${JSON.stringify({
  schema: "evopilot-harness-digital-expert-scenario-coverage/v1",
  status: "VALIDATED",
  matrix: path.relative(root, matrixFile),
  counts: {
    evidenceSources: matrix.evidenceSources.length,
    terminalDecisions: matrix.terminalDecisions.length,
    engineOperations: matrix.engineOperations.length,
    lifecycleBranches: matrix.lifecycleBranches.length
  },
  runtimeTestsExecuted: runtimeTests.size
}, null, 2)}\n`);

function validateCoverage(section, declared, bindings) {
  assert.ok(bindings && typeof bindings === "object" && !Array.isArray(bindings), `${section} coverage must be an object`);
  assert.deepEqual(Object.keys(bindings).sort(), [...declared].sort(), `${section} coverage must exactly match declarations`);
  for (const item of declared) {
    const rawBinding = bindings[item];
    const binding = { ...(rawBinding?.["<<"] ?? {}), ...rawBinding };
    assert.equal(typeof binding.testFile, "string", `${section}.${item} requires testFile`);
    assert.equal(typeof binding.testName, "string", `${section}.${item} requires testName`);
    assert.equal(typeof binding.marker, "string", `${section}.${item} requires marker`);
    assert.ok(binding.testFile.startsWith("tests/") && binding.testFile.endsWith(".test.mjs"), `${section}.${item} must bind an executable Node test`);
    const file = path.join(root, binding.testFile);
    assert.ok(fs.existsSync(file), `${section}.${item} test file is missing: ${binding.testFile}`);
    const source = fs.readFileSync(file, "utf8");
    const body = testBody(source, binding.testName);
    assert.ok(body.includes(binding.marker), `${section}.${item} marker ${JSON.stringify(binding.marker)} is absent from ${binding.testName}`);
    runtimeTests.set(`${binding.testFile}\0${binding.testName}`, { testFile: binding.testFile, testName: binding.testName });
  }
}

function executeBoundTests() {
  for (const binding of runtimeTests.values()) {
    const pattern = `^${binding.testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
    const run = spawnSync(process.execPath, ["--test", `--test-name-pattern=${pattern}`, binding.testFile], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, EVOPILOT_SCENARIO_COVERAGE_RUN: "1" },
      timeout: 120_000
    });
    assert.equal(run.status, 0, `Runtime coverage test failed: ${binding.testName}\n${run.stdout}\n${run.stderr}`);
  }
}

function testBody(source, name) {
  const prefix = `test(${JSON.stringify(name)}`;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `test name is missing: ${name}`);
  const next = source.indexOf("\ntest(\"", start + prefix.length);
  return source.slice(start, next === -1 ? source.length : next);
}
