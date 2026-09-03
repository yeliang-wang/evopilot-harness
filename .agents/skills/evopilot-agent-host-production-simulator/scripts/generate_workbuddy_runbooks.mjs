#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { candidateAcceptanceBindingRunbookDigest } from "./modular_contracts.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.target) throw new Error("--target is required");
const targetPath = path.resolve(args.target);
if (!args.portfolio) throw new Error("--portfolio is required");
if (!args.candidate && !args.rebinding && !args.candidateBinding) throw new Error("--candidate, --rebinding or --candidate-binding is required");
if (!args.workspaceRoot) throw new Error("--workspace-root is required");
if (!args.modelRoute) throw new Error("--model-route is required");
const portfolioPath = path.resolve(args.portfolio);
const candidateBindingPath = path.resolve(args.candidate ?? args.rebinding ?? args.candidateBinding);
const workspaceRoot = path.resolve(args.workspaceRoot);

const target = readJson(targetPath);
const portfolio = readJson(portfolioPath);
const candidateBinding = readJson(candidateBindingPath);
const sourceBindingsPath = args.sourceBindings ? path.resolve(args.sourceBindings) : null;
const sourceBindings = sourceBindingsPath ? readJson(sourceBindingsPath) : null;
if (!Number.isInteger(target.revision) || target.status !== "APPROVED") throw new Error("an approved Target revision is required");
const candidate = resolveCandidateBinding(candidateBinding, target);
if (portfolio.sourceMutation !== false || portfolio.projectMutation !== false) throw new Error("Source Portfolio must be read-only");

const sourceById = new Map((portfolio.sources ?? []).map((item) => [item.id, item]));
const bindingByCase = new Map((portfolio.caseBindings ?? []).map((item) => [item.caseId, item.sourceIds]));
const oracleBySourceId = new Map((portfolio.acceptanceOracles ?? []).map((item) => [item.sourceId, item]));
const workBuddyCases = target.realCaseCoverage.filter((item) => item.hosts.some((host) => /WorkBuddy/i.test(host)));
const sourceBindingOverrides = validateSourceBindings(sourceBindings, sourceBindingsPath, target, portfolioPath, workBuddyCases, sourceById);
const realCaseIds = target.realCaseCoverage.map((item) => item.id);
if (realCaseIds.length === 0) throw new Error("Target realCaseCoverage must be non-empty");
const finalDeclaration = `${realCaseIds[0]}～${realCaseIds.at(-1)} 已完成`;
const exactGoal = "请使用 Harness全生命周期数字专家，基于本任务已绑定的精确 Source 执行该验收场景；只展示 Engine 生成的完整结论，并在每一个需要我决定的步骤停下。";

const runbooks = workBuddyCases.map((item) => {
  const sourceIds = sourceBindingOverrides.get(item.id) ?? bindingByCase.get(item.id) ?? [];
  if (sourceIds.length === 0) throw new Error(`${item.id} has no Source binding`);
  const sources = sourceIds.map((id) => {
    const source = sourceById.get(id);
    if (!source) return { id, binding: "TARGET_OR_PRIOR_WAVE_DEFINED", readOnly: true };
    const result = { id, type: source.type, readOnly: source.readOnly === true };
    for (const key of ["locator", "repository", "repositoryUrl", "requestedRef", "expectedResolvedCommit", "sourceArtifactDigest", "expectedSourceSnapshotDigest"]) {
      if (source[key] !== undefined) result[key] = source[key];
    }
    if (Array.isArray(source.members)) result.members = [...source.members];
    return result;
  });
  if (sources.some((source) => source.readOnly !== true)) throw new Error(`${item.id} contains a writable Source`);
  return {
    schema: "evopilot-workbuddy-human-runbook/v2",
    caseId: item.id,
    executionPolicy: "human-operated-workbuddy/v1",
    completionPolicy: "designated-human-range-completion/v1",
    operator: "DESIGNATED_HUMAN",
    codexRole: "RUNBOOK_ISSUANCE_AND_FINAL_DECLARATION_ONLY",
    candidate: {
      id: candidate.id,
      packageDigest: candidate.packageDigest,
      reinstallRequired: candidate.reinstallRequired
    },
    workspace: path.join(workspaceRoot, `${item.id}-workspace-${safeSegment(candidate.id)}`),
    modelRoute: {
      id: args.modelRoute,
      configurationAuthority: "USER_MANAGED",
      credentialsIncluded: false
    },
    sources,
    acceptanceOracles: sourceIds.map((id) => oracleBySourceId.get(id)).filter(Boolean).map(({ sourceId, digest, storedOutsideSourceSnapshot, candidateBlind, candidateOutputUsed }) => ({ sourceId, digest, storedOutsideSourceSnapshot, candidateBlind, candidateOutputUsed })),
    goal: exactGoal,
    startingState: item.startingState,
    scenario: item.scenario,
    visibleSteps: [
      "Create one fresh blank WorkBuddy task.",
      "Open 专家·技能·连接器 and select Harness全生命周期数字专家.",
      "Verify the exact Candidate-bound Expert and fresh external Workspace.",
      "Attach each bound Source exactly once in the declared order and verify every visible identity.",
      "Enter the exact goal from this runbook and verify it before sending once.",
      "At each Engine-owned human gate, inspect the complete current view and make only the separately authorized current decision.",
      "Perform only the restart, resume, retry, cancellation, publication or close actions declared by this scenario and separately authorized at that gate.",
      "Continue independently through every applicable frozen RC runbook without reporting per-case progress to Codex.",
      `Only after the complete ${realCaseIds[0]}-${realCaseIds.at(-1)} range has been performed, send the final declaration ${finalDeclaration}.`
    ],
    terminalState: item.terminalState,
    prohibitedEffects: item.prohibitedEffects,
    workBuddyArtifactsToProvide: [],
    perCaseReportRequired: false,
    finalDeclaration,
    resultRule: "This WorkBuddy human-operation leg remains PENDING until the final range declaration is received; no WorkBuddy execution artifact is requested or reviewed."
  };
});

const manifest = {
  schema: "evopilot-workbuddy-human-runbook-set/v1",
  targetId: target.id,
  targetRevision: target.revision,
  targetAuthorizationDigest: target.approvals.target.authorizationDigest,
  candidateBindingId: candidate.bindingId,
  candidateBindingDigest: candidate.bindingDigest,
  candidateBindingDigestScope: candidate.bindingDigestScope,
  candidateBindingType: candidate.bindingType,
  candidate: {
    id: candidate.id,
    packageDigest: candidate.packageDigest,
    manifestDigest: candidate.manifestDigest
  },
  sourcePortfolioDigest: fileDigest(portfolioPath),
  sourceBindingsDigest: sourceBindingsPath ? fileDigest(sourceBindingsPath) : null,
  executionPolicy: "human-operated-workbuddy/v1",
  completionPolicy: "designated-human-range-completion/v1",
  codexRole: "RUNBOOK_ISSUANCE_AND_FINAL_DECLARATION_ONLY",
  finalDeclaration,
  workBuddyArtifactsRequired: false,
  perCaseReportRequired: false,
  runbookCount: runbooks.length,
  caseIds: runbooks.map((item) => item.caseId),
  runbooksDigest: digest(runbooks),
  authority: "RUNBOOKS_DO_NOT_AUTHOR_ENGINE_RESULTS_HUMAN_DECISIONS_ACCEPTANCE_OR_RELEASE"
};

if (args.check) {
  process.stdout.write(`${JSON.stringify({ status: "PASS", manifest }, null, 2)}\n`);
  process.exit(0);
}
if (!args.out) throw new Error("--out is required unless --check is used");
const outputRoot = path.resolve(args.out);
if (args.sourceCheckout && isInside(outputRoot, path.resolve(args.sourceCheckout))) throw new Error("runbooks must be written outside the product repository");
fs.mkdirSync(outputRoot, { recursive: true });
for (const runbook of runbooks) fs.writeFileSync(path.join(outputRoot, `${runbook.caseId}.json`), `${JSON.stringify(runbook, null, 2)}\n`);
fs.writeFileSync(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: "PASS", outputRoot, manifest }, null, 2)}\n`);

function parseArgs(values) {
  const result = { check: values.includes("--check") };
  for (let index = 0; index < values.length; index += 1) {
    if (["--target", "--portfolio", "--candidate", "--rebinding", "--candidate-binding", "--source-bindings", "--workspace-root", "--model-route", "--source-checkout", "--out"].includes(values[index])) {
      const key = values[index].slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      result[key] = values[++index];
    }
  }
  return result;
}
function validateSourceBindings(value, file, target, portfolioFile, workBuddyCases, sourceById) {
  const result = new Map();
  if (!value) return result;
  if (value.schema !== "evopilot-workbuddy-source-bindings/v1") throw new Error("WorkBuddy Source bindings schema mismatch");
  if (value.target?.id !== target.id || value.target?.revision !== target.revision || value.target?.authorizationDigest !== target.approvals?.target?.authorizationDigest) throw new Error("WorkBuddy Source bindings Target mismatch");
  if (value.sourcePortfolioDigest !== fileDigest(portfolioFile)) throw new Error("WorkBuddy Source bindings Portfolio digest mismatch");
  if (value.sourceMutation !== false || value.projectMutation !== false || value.candidateOutputUsed !== false) throw new Error("WorkBuddy Source bindings must be read-only and Candidate-blind");
  const allowedCases = new Set(workBuddyCases.map((item) => item.id));
  for (const binding of value.bindings ?? []) {
    if (!allowedCases.has(binding?.caseId) || result.has(binding.caseId) || !Array.isArray(binding.sourceIds) || binding.sourceIds.length === 0) throw new Error("WorkBuddy Source binding is invalid");
    if (new Set(binding.sourceIds).size !== binding.sourceIds.length || binding.sourceIds.some((id) => !sourceById.has(id))) throw new Error(`${binding.caseId} WorkBuddy Source binding contains an unknown or duplicate Source`);
    result.set(binding.caseId, [...binding.sourceIds]);
  }
  if (!file || !/^sha256:[a-f0-9]{64}$/.test(fileDigest(file))) throw new Error("WorkBuddy Source bindings file digest is invalid");
  return result;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(value) { return `sha256:${crypto.createHash("sha256").update(canonical(value)).digest("hex")}`; }
function fileDigest(file) { return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`; }
function resolveCandidateBinding(value, target) {
  if (value?.schema === "evopilot-candidate-acceptance-binding/v1") {
    if (value.target?.id !== target.id || value.target?.revision !== target.revision || value.candidate?.sourceCheckoutUsed !== false) throw new Error("Candidate Acceptance Binding does not match the approved Target");
    if (!/(?:^|-)candidate-[1-9]\d*$/.test(value.candidate?.id ?? "") || !/^sha256:[a-f0-9]{64}$/.test(value.candidate?.packageDigest ?? "") || !/^sha256:[a-f0-9]{64}$/.test(value.candidate?.manifestDigest ?? "")) throw new Error("Candidate Acceptance Binding identity is invalid");
    return {
      id: value.candidate.id,
      packageDigest: value.candidate.packageDigest,
      manifestDigest: value.candidate.manifestDigest,
      reinstallRequired: false,
      bindingId: value.id,
      bindingDigest: candidateAcceptanceBindingRunbookDigest(value),
      bindingDigestScope: "CANDIDATE_ACCEPTANCE_BINDING_WITHOUT_RUNBOOK_SET_ARTIFACT",
      bindingType: "CANDIDATE_ACCEPTANCE_BINDING"
    };
  }
  if (value?.schema === "evopilot-harness-acceptance-candidate/v1") {
    if (value.status !== "FROZEN" || value.target?.revision !== target.revision || value.target?.authorizationDigest !== target.approvals?.target?.authorizationDigest || value.sourceCheckoutUsed !== false) throw new Error("frozen Candidate bound to the approved Target and sourceCheckoutUsed=false is required");
    if (typeof value.candidateId !== "string" || !/candidate-[1-9]\d*$/.test(value.candidateId) || !/^sha256:[a-f0-9]{64}$/.test(value.candidateDigest ?? "")) throw new Error("Candidate identity or package digest is invalid");
    return { id: value.candidateId, packageDigest: value.candidateDigest, reinstallRequired: true, bindingType: "FROZEN_CANDIDATE" };
  }
  if (value?.status !== "PASS" || value.toTarget?.authorizationDigest !== target.approvals?.target?.authorizationDigest) throw new Error("passing acceptance rebinding or frozen Candidate manifest is required");
  if (!value.candidate?.id || !/^sha256:[a-f0-9]{64}$/.test(value.candidate?.packageDigest ?? "")) throw new Error("acceptance rebinding Candidate identity is invalid");
  return { id: value.candidate.id, packageDigest: value.candidate.packageDigest, reinstallRequired: false, bindingType: "ACCEPTANCE_REBINDING" };
}
function safeSegment(value) {
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("Candidate id cannot form a safe Workspace segment");
  return normalized;
}
function isInside(candidate, parent) {
  const base = fs.statSync(parent).isDirectory() ? parent : path.dirname(parent);
  const relative = path.relative(base, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
