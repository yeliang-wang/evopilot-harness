#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseCli, option, writeJson } from "../src/v3/utils.mjs";

const args = parseCli(process.argv.slice(2));
const contractFile = requiredPath("contract");
const targetFile = requiredPath("target");
const portfolioFile = requiredPath("portfolio");
const out = option(args, "out") ? path.resolve(option(args, "out")) : null;
const contract = readJson(contractFile);
const target = readJson(targetFile);
const portfolio = readJson(portfolioFile);

if (contract.schema !== "evopilot-harness-fixed-wave-acceptance-contract/v1") fail("FIXED_WAVE_CONTRACT_SCHEMA_INVALID", "Unsupported fixed-wave acceptance contract schema.");
if (contract.authority !== "target-derived-acceptance-execution-only" || contract.runnerMayAddOutcomeConstraints !== false) fail("FIXED_WAVE_CONTRACT_AUTHORITY_INVALID", "The runner must not add outcome constraints beyond the frozen contract.");
if (contract.target?.id !== target.id || contract.target?.revision !== target.revision || contract.target?.fileDigest !== sha256Bytes(fs.readFileSync(targetFile))) fail("FIXED_WAVE_TARGET_BINDING_MISMATCH", "The fixed-wave contract is not bound to the exact Target revision bytes.");
if (contract.sourcePortfolio?.fileDigest !== sha256Bytes(fs.readFileSync(portfolioFile))) fail("FIXED_WAVE_PORTFOLIO_BINDING_MISMATCH", "The fixed-wave contract is not bound to the exact Source Portfolio bytes.");

const targetCases = collectTargetCases(target);
const portfolioBindings = new Map(portfolio.caseBindings.map((item) => [item.caseId, item.sourceIds]));
const contractCases = new Map();
for (const item of contract.cases ?? []) {
  if (!/^RC(?:0[1-9]|1[0-5])$/.test(item?.caseId) || contractCases.has(item.caseId)) fail("FIXED_WAVE_CASE_INVALID", `Invalid or duplicate case: ${item?.caseId ?? "[missing]"}.`);
  const targetCase = targetCases.get(item.caseId);
  if (!targetCase) fail("FIXED_WAVE_TARGET_CASE_MISSING", `Target case ${item.caseId} is missing.`);
  const acceptanceDigest = sha256Json({ scenario: targetCase.scenario, startingState: targetCase.startingState, terminalState: targetCase.terminalState, requiredEvidence: targetCase.requiredEvidence });
  if (item.targetAcceptanceDigest !== acceptanceDigest) fail("FIXED_WAVE_CASE_TARGET_DRIFT", `Target acceptance text drifted for ${item.caseId}.`);
  if (JSON.stringify(item.sourceIds) !== JSON.stringify(portfolioBindings.get(item.caseId))) fail("FIXED_WAVE_CASE_SOURCE_DRIFT", `Source binding drifted for ${item.caseId}.`);
  validateOracle(item);
  contractCases.set(item.caseId, item);
}
for (let index = 1; index <= 15; index += 1) {
  const caseId = `RC${String(index).padStart(2, "0")}`;
  if (!contractCases.has(caseId)) fail("FIXED_WAVE_CASE_MISSING", `Fixed-wave contract does not bind ${caseId}.`);
}

const report = {
  schema: "evopilot-harness-fixed-wave-contract-validation/v1",
  status: "PASSED",
  contractDigest: sha256Bytes(fs.readFileSync(contractFile)),
  targetFileDigest: sha256Bytes(fs.readFileSync(targetFile)),
  sourcePortfolioFileDigest: sha256Bytes(fs.readFileSync(portfolioFile)),
  caseCount: contractCases.size,
  invariantOnlyCases: [...contractCases.values()].filter((item) => item.oracle.mode === "INVARIANTS_ONLY").map((item) => item.caseId),
  authority: { acceptanceExecutionOnly: true, productAuthority: false, releaseAuthority: false }
};
if (out) writeJson(out, report);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function validateOracle(item) {
  const allowedModes = new Set(["EXACT", "SEQUENCE", "CASE_ORACLE", "INVARIANTS_ONLY", "BLOCKER_MATRIX", "SEMANTIC_EQUIVALENCE", "LIFECYCLE_ORACLE", "CUMULATIVE_REGRESSION"]);
  if (!allowedModes.has(item.oracle?.mode)) fail("FIXED_WAVE_ORACLE_MODE_INVALID", `Case ${item.caseId} has an invalid oracle mode.`);
  if (item.oracle.mode === "INVARIANTS_ONLY" && (item.oracle.exactAggregate || item.oracle.exactSequence)) fail("FIXED_WAVE_INVARIANT_OVERCONSTRAINED", `Case ${item.caseId} is invariant-only and must not acquire an exact classification branch.`);
  if (item.oracle.mode === "EXACT" && !["TAXONOMY_MATCHED", "TAXONOMY_EXTENSION_SUGGESTED", "TAXONOMY_EVIDENCE_INSUFFICIENT", "TAXONOMY_AMBIGUOUS"].includes(item.oracle.exactAggregate)) fail("FIXED_WAVE_EXACT_ORACLE_INVALID", `Case ${item.caseId} lacks a valid exact aggregate.`);
  if (!Array.isArray(item.requiredAssertions) || item.requiredAssertions.length === 0) fail("FIXED_WAVE_ASSERTIONS_MISSING", `Case ${item.caseId} must declare its Target-derived assertions.`);
}

function collectTargetCases(value, cases = new Map()) {
  if (Array.isArray(value)) for (const item of value) collectTargetCases(item, cases);
  else if (value && typeof value === "object") {
    if (/^RC(?:0[1-9]|1[0-5])$/.test(value.id ?? "")) cases.set(value.id, value);
    for (const item of Object.values(value)) collectTargetCases(item, cases);
  }
  return cases;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function requiredPath(name) { const value = option(args, name); if (!value) fail("FIXED_WAVE_ARGUMENT_REQUIRED", `--${name} is required.`); return path.resolve(value); }
function sha256Bytes(bytes) { return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; }
function sha256Json(value) { return sha256Bytes(JSON.stringify(value)); }
function fail(code, message) { process.stderr.write(`${code}: ${message}\n`); process.exit(2); }
