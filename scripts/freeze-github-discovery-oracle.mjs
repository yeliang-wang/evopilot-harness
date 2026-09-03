#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { digest, parseCli, option } from "../src/v3/utils.mjs";

const root = path.resolve(import.meta.dirname, "..");
const args = parseCli(process.argv.slice(2));
const mode = option(args, "mode", "propose");
const out = path.resolve(required("out"));
if (fs.existsSync(out)) fail("GITHUB_ORACLE_APPEND_ONLY_VIOLATION", "Oracle output already exists; use a new append-only path.");
if (mode === "propose") propose();
else if (mode === "confirm") confirm();
else fail("GITHUB_ORACLE_MODE_INVALID", "--mode must be propose or confirm.");

function propose() {
  const selection = readJson("selection");
  const decisions = readJson("decisions");
  if (selection.schema !== "evopilot-harness-github-discovery-selection-manifest/v1" || selection.status !== "FROZEN_AWAITING_ORACLE") fail("GITHUB_ORACLE_SELECTION_NOT_FROZEN", "Oracle requires one frozen discovery selection.");
  if (decisions.schema !== "evopilot-harness-github-discovery-oracle-decisions/v1" || decisions.candidateOutputsVisible !== false || decisions.selectionManifestDigest !== selection.selectionManifestDigest) fail("GITHUB_ORACLE_DECISIONS_INVALID", "Oracle decisions must be candidate-blind and bind the exact selection manifest.");
  const selectionById = new Map(selection.repositories.map((item) => [item.sourceId, item]));
  if (!Array.isArray(decisions.repositories) || decisions.repositories.length !== selection.repositories.length || new Set(decisions.repositories.map((item) => item.sourceId)).size !== selection.repositories.length) fail("GITHUB_ORACLE_SOURCE_ACCOUNTING_INVALID", "Oracle decisions must cover every frozen Source exactly once.");
  const repositories = decisions.repositories.map((decision) => {
    const selected = selectionById.get(decision.sourceId);
    if (!selected || decision.sourceSnapshotDigest !== selected.sourceSnapshotDigest || decision.resolvedCommit !== selected.resolvedCommit) fail("GITHUB_ORACLE_SOURCE_BINDING_MISMATCH", `Oracle decision does not bind frozen Source ${decision.sourceId}.`);
    if (!classificationBranches().includes(decision.expectedClassificationBranch)) fail("GITHUB_ORACLE_CLASSIFICATION_BRANCH_INVALID", `Invalid classification branch for ${decision.sourceId}.`);
    if (!Array.isArray(decision.allowedHarnessTerminals) || !decision.allowedHarnessTerminals.length || !Array.isArray(decision.evidenceLimitations)) fail("GITHUB_ORACLE_HARNESS_BRANCH_INVALID", `Oracle decision for ${decision.sourceId} requires allowed Harness terminals and evidence limitations.`);
    if (!decision.analysisProvenance?.deterministicEvidenceDigest || !decision.analysisProvenance?.advisorOutputDigest || decision.analysisProvenance?.candidateOutputObserved !== false) fail("GITHUB_ORACLE_PROVENANCE_INVALID", `Oracle decision for ${decision.sourceId} lacks candidate-blind deterministic and advisory provenance.`);
    return decision;
  });
  const branchCoverage = coverage(repositories);
  for (const branch of classificationBranches()) if (!branchCoverage.classification[branch]) fail("GITHUB_ORACLE_BRANCH_COVERAGE_INCOMPLETE", `Oracle does not cover ${branch}.`);
  if (!(branchCoverage.harness.NOT_HARNESS_ELIGIBLE || branchCoverage.harness.NEED_MORE_EVIDENCE)) fail("GITHUB_ORACLE_NEGATIVE_HARNESS_BRANCH_MISSING", "Oracle requires NOT_HARNESS_ELIGIBLE or NEED_MORE_EVIDENCE.");
  const core = {
    schema: "evopilot-harness-github-discovery-oracle/v1",
    status: "REVIEW_REQUIRED",
    selectionManifestDigest: selection.selectionManifestDigest,
    candidateDigest: selection.candidate.candidateDigest,
    candidateOutputsVisible: false,
    createdAt: new Date().toISOString(),
    repositories,
    branchCoverage,
    authority: { candidateBlindAcceptanceEvidence: true, engineAuthority: false, llmAuthority: false, taxonomyMutation: false, productMutation: false, approvalAuthority: false, publicationAuthority: false, releaseAuthority: false }
  };
  core.oracleDigest = digest(core);
  validateOracle(core);
  writeExclusive(out, core);
  process.stdout.write(`${JSON.stringify({ schema: "evopilot-harness-github-discovery-oracle-proposal-result/v1", status: core.status, oracleDigest: core.oracleDigest, selectionManifestDigest: core.selectionManifestDigest, repositoryCount: repositories.length, branchCoverage, confirmation: `CONFIRM_GITHUB_DISCOVERY_ORACLE:${core.oracleDigest}`, out }, null, 2)}\n`);
}

function confirm() {
  const proposal = readJson("oracle");
  if (proposal.schema !== "evopilot-harness-github-discovery-oracle/v1" || proposal.status !== "REVIEW_REQUIRED") fail("GITHUB_ORACLE_PROPOSAL_INVALID", "Confirmation requires one REVIEW_REQUIRED oracle proposal.");
  const confirmedBy = String(option(args, "confirmed-by") ?? "").trim();
  const confirmation = String(option(args, "confirmation") ?? "");
  const expected = `CONFIRM_GITHUB_DISCOVERY_ORACLE:${proposal.oracleDigest}`;
  if (!confirmedBy || confirmation !== expected) fail("GITHUB_ORACLE_EXPLICIT_CONFIRMATION_REQUIRED", `Confirmation must equal ${expected} and include confirmed-by.`);
  const confirmed = {
    ...proposal,
    status: "HUMAN_CONFIRMED",
    humanConfirmation: { confirmedBy, confirmationDigest: digest({ confirmation, oracleDigest: proposal.oracleDigest }), confirmedAt: new Date().toISOString(), candidateOutputsVisible: false }
  };
  confirmed.confirmedOracleDigest = digest(confirmed);
  validateOracle(confirmed);
  writeExclusive(out, confirmed);
  process.stdout.write(`${JSON.stringify({ schema: "evopilot-harness-github-discovery-oracle-confirmation-result/v1", status: confirmed.status, oracleDigest: confirmed.oracleDigest, confirmedOracleDigest: confirmed.confirmedOracleDigest, selectionManifestDigest: confirmed.selectionManifestDigest, out, authority: { acceptanceEvidenceOnly: true, releaseAuthority: false } }, null, 2)}\n`);
}

function coverage(repositories) {
  const classification = Object.fromEntries(classificationBranches().map((branch) => [branch, repositories.filter((item) => item.expectedClassificationBranch === branch).length]));
  const harness = {};
  for (const item of repositories) for (const terminal of item.allowedHarnessTerminals) harness[terminal] = (harness[terminal] ?? 0) + 1;
  return { classification, harness };
}
function classificationBranches() { return ["TAXONOMY_MATCHED", "TAXONOMY_EXTENSION_SUGGESTED", "TAXONOMY_EVIDENCE_INSUFFICIENT", "TAXONOMY_AMBIGUOUS"]; }
function validateOracle(value) { const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/github-discovery-oracle-v1.schema.json"), "utf8")); const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema); if (!validate(value)) fail("GITHUB_ORACLE_SCHEMA_INVALID", new Ajv2020().errorsText(validate.errors)); }
function readJson(name) { return JSON.parse(fs.readFileSync(path.resolve(required(name)), "utf8")); }
function required(name) { const value = option(args, name); if (!value) fail("GITHUB_ORACLE_ARGUMENT_REQUIRED", `--${name} is required.`); return value; }
function writeExclusive(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); }
function fail(code, message) { const error = new Error(message); error.name = "GitHubDiscoveryOracleError"; error.code = code; throw error; }
