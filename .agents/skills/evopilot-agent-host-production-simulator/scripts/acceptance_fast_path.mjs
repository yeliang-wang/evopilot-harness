#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SKILL_ROOT = path.resolve(path.dirname(SCRIPT_FILE), "..");
const TERMINAL_RESULTS = new Set(["PASSED", "FAILED", "BLOCKED"]);
const STAGE_KINDS = new Set(["MACHINE", "HUMAN_GATE"]);
const REPLAYABLE_DECISIONS = new Set([
  "CONFIRM_PLAN",
  "CONTINUE_TO_PROPOSAL_DECISION",
  "APPROVE_PROPOSAL",
  "REJECT_PROPOSAL",
  "PUBLISH",
  "DO_NOT_PUBLISH",
  "CLOSE"
]);
const FAILURE_POLICIES = Object.freeze({
  RUNNER_PROJECTION: { rerunScope: "AFFECTED_STAGE_ONLY", requiresNewCandidate: false, automaticRetryAllowed: true },
  TOOLING_DRIFT: { rerunScope: "AFFECTED_TOOLING_CHECK_ONLY", requiresNewCandidate: false, automaticRetryAllowed: true },
  HOST_TRANSPORT: { rerunScope: "AFFECTED_HOST_LEG_ONLY", requiresNewCandidate: false, automaticRetryAllowed: false },
  SOURCE_BINDING: { rerunScope: "AFFECTED_SOURCE_WAVE_ONLY", requiresNewCandidate: false, automaticRetryAllowed: false },
  PRODUCT_BEHAVIOR: { rerunScope: "IMPACT_CLOSURE_THEN_FULL_REQUIRED_MATRIX", requiresNewCandidate: true, automaticRetryAllowed: false },
  SEMANTIC_MISMATCH: { rerunScope: "EXACT_HUMAN_DECISION", requiresNewCandidate: false, automaticRetryAllowed: false },
  STALE_BINDING: { rerunScope: "CROSS_LAYER_PREFLIGHT", requiresNewCandidate: false, automaticRetryAllowed: false },
  UNCERTAIN_MUTATION: { rerunScope: "RESOLVE_CURRENT_SESSION_WITHOUT_REPLAY", requiresNewCandidate: false, automaticRetryAllowed: false }
});

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

try {
  if (command === "init") initState(args);
  else if (command === "status") printStatus(loadFreshState(required(args, "state")));
  else if (command === "record") recordStage(args);
  else if (command === "evaluate-replay") evaluateReplay(args);
  else throw new Error("command must be init, status, record or evaluate-replay");
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", error: error.message }, null, 2)}\n`);
  process.exit(3);
}

function initState(options) {
  const stateFile = path.resolve(required(options, "state"));
  refuseSkillTreeState(stateFile);
  if (fs.existsSync(stateFile)) throw new Error("acceptance state already exists; resume it instead of replacing it");
  const bindingFile = path.resolve(required(options, "candidateBinding"));
  const manifestFile = path.resolve(required(options, "targetManifest"));
  const planFile = path.resolve(required(options, "acceptancePlan"));
  const stagePlanFile = path.resolve(required(options, "stagePlan"));
  const binding = readJson(bindingFile);
  const manifest = readJson(manifestFile);
  const stages = readJson(stagePlanFile);
  if (binding?.schema !== "evopilot-candidate-acceptance-binding/v1") throw new Error("Candidate Acceptance Binding schema mismatch");
  if (!isCandidateNeutralTargetManifest(manifest)) throw new Error("Target Acceptance Manifest schema mismatch or Candidate identity leak");
  if (binding?.targetManifest?.id !== manifest.id) throw new Error("Candidate and Target manifest identities do not match");
  if (!Array.isArray(stages) || stages.length === 0) throw new Error("stage plan must be a non-empty JSON array");
  const ids = new Set();
  for (const stage of stages) {
    if (!stage || typeof stage.id !== "string" || !STAGE_KINDS.has(stage.kind)) throw new Error("each stage requires a unique id and MACHINE or HUMAN_GATE kind");
    if (ids.has(stage.id)) throw new Error(`duplicate stage id: ${stage.id}`);
    ids.add(stage.id);
  }
  const state = {
    schema: "evopilot-acceptance-fast-path-state/v1",
    candidate: { id: binding.candidate?.id ?? null, file: bindingFile, bindingDigest: fileDigest(bindingFile) },
    targetManifest: { id: manifest.id, file: manifestFile, digest: fileDigest(manifestFile) },
    acceptancePlan: { file: planFile, digest: fileDigest(planFile) },
    stagePlan: { file: stagePlanFile, digest: fileDigest(stagePlanFile) },
    continuationPolicy: "UNTIL_FAILURE_STALE_BINDING_UNCERTAIN_MUTATION_OR_HUMAN_GATE",
    stages: stages.map((stage) => ({ id: stage.id, kind: stage.kind, status: "PENDING", attempts: [] })),
    events: [],
    authority: {
      authorizesWorkBuddyOperation: false,
      authorizesRepair: false,
      authorizesPublication: false,
      authorizesRelease: false
    }
  };
  atomicWrite(stateFile, state);
  printStatus(state);
}

function recordStage(options) {
  const stateFile = path.resolve(required(options, "state"));
  const state = loadFreshState(stateFile);
  const stageId = required(options, "stage");
  const result = required(options, "result");
  if (!TERMINAL_RESULTS.has(result)) throw new Error("result must be PASSED, FAILED or BLOCKED");
  const stage = state.stages.find((item) => item.id === stageId);
  if (!stage) throw new Error(`unknown stage: ${stageId}`);
  const active = nextPendingOrFailed(state);
  if (!active || active.id !== stage.id) throw new Error(`stage ${stageId} is not the current resumable stage`);
  const retry = stage.status === "FAILED" || stage.status === "BLOCKED";
  const previous = stage.attempts.at(-1);
  if (retry && previous?.failurePolicy?.requiresNewCandidate) throw new Error("this failure requires a new Candidate binding and a new state file");
  if (retry && options.retry !== "true") throw new Error("retrying a failed stage requires --retry true");
  if (!retry && stage.status !== "PENDING") throw new Error(`stage ${stageId} is already complete`);
  const evidence = values(options, "evidence").map((file) => {
    const resolved = path.resolve(file);
    if (!isFile(resolved)) throw new Error(`evidence file is missing: ${file}`);
    return { file: resolved, digest: fileDigest(resolved) };
  });
  if (evidence.length === 0) throw new Error("at least one --evidence file is required");
  let replay = null;
  if (stage.kind === "HUMAN_GATE" && result === "PASSED") {
    const replayFile = options.replayRecord ? path.resolve(options.replayRecord) : null;
    const decisionDigest = options.humanDecisionDigest ?? null;
    if (!replayFile && !/^sha256:[a-f0-9]{64}$/.test(decisionDigest ?? "")) throw new Error("a passed human gate requires --human-decision-digest or --replay-record");
    if (replayFile) {
      const record = readJson(replayFile);
      if (record?.schema !== "evopilot-acceptance-decision-replay-record/v1" || record?.status !== "PASS") throw new Error("replay record is not a passing controlled replay");
      if (record.candidateBindingDigest !== state.candidate.bindingDigest || record.targetManifestDigest !== state.targetManifest.digest) throw new Error("replay record binding mismatch");
      replay = { file: replayFile, digest: fileDigest(replayFile), decision: record.decision };
    }
  }
  const failureClass = result === "PASSED" ? null : required(options, "failureClass");
  const failurePolicy = failureClass ? FAILURE_POLICIES[failureClass] : null;
  if (failureClass && !failurePolicy) throw new Error(`unsupported failure class: ${failureClass}`);
  const attempt = {
    sequence: state.events.length + 1,
    result,
    retry,
    evidence,
    failureClass,
    failurePolicy,
    replay,
    humanDecisionDigest: options.humanDecisionDigest ?? null
  };
  stage.attempts.push(attempt);
  stage.status = result;
  state.events.push({ type: "STAGE_RESULT", stageId, ...attempt });
  atomicWrite(stateFile, state);
  printStatus(state);
}

function evaluateReplay(options) {
  const state = loadFreshState(path.resolve(required(options, "state")));
  const manifestFile = path.resolve(required(options, "replayManifest"));
  const frameFile = path.resolve(required(options, "currentFrame"));
  const manifest = readJson(manifestFile);
  const frame = readJson(frameFile);
  const errors = [];
  if (manifest?.schema !== "evopilot-acceptance-decision-replay/v1" || manifest?.status !== "AUTHORIZED") errors.push("replay manifest is not authorized");
  if (manifest?.candidateBindingDigest !== state.candidate.bindingDigest || manifest?.targetManifestDigest !== state.targetManifest.digest) errors.push("replay manifest binding mismatch");
  if (!REPLAYABLE_DECISIONS.has(manifest?.decision)) errors.push("decision is not replayable");
  if (!Array.isArray(manifest?.repetitionIds) || !manifest.repetitionIds.includes(frame?.repetitionId)) errors.push("repetition is outside replay scope");
  if (!manifest?.expiresAt || Date.parse(manifest.expiresAt) <= Date.now()) errors.push("replay manifest is expired");
  if (manifest?.authority?.authorizesCleanup !== false || manifest?.authority?.authorizesRelease !== false || manifest?.authority?.authorizesUnrelatedMutation !== false) errors.push("replay authority boundary is invalid");
  if (canonical(manifest?.baseline?.semanticOracle) !== canonical(frame?.semanticOracle)) errors.push("current semantic gate does not match the baseline oracle");
  if (!Array.isArray(frame?.semanticOracle?.choices) || !frame.semanticOracle.choices.includes(manifest?.decision)) errors.push("decision is not offered by the current frame");
  if ((frame?.semanticOracle?.blockers ?? []).length > 0 || (frame?.semanticOracle?.warningsRequiringDecision ?? []).length > 0 || frame?.semanticOracle?.hostAuthoredGovernedProse !== false) errors.push("current frame contains a blocker, decision warning or Host-authored governed prose");
  const result = {
    schema: "evopilot-acceptance-decision-replay-record/v1",
    status: errors.length ? "FAIL" : "PASS",
    errors,
    manifestDigest: fileDigest(manifestFile),
    candidateBindingDigest: state.candidate.bindingDigest,
    targetManifestDigest: state.targetManifest.digest,
    repetitionId: frame?.repetitionId ?? null,
    stageId: frame?.semanticOracle?.stageId ?? null,
    decision: errors.length ? null : manifest.decision,
    currentBindings: frame?.currentBindings ?? null,
    authority: "CURRENT_FRAME_CONDITIONAL_DECISION_ONLY_NO_TOKEN_REUSE_CLEANUP_RELEASE_OR_UNRELATED_MUTATION"
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(errors.length ? 4 : 0);
}

function loadFreshState(file) {
  const state = readJson(file);
  if (state?.schema !== "evopilot-acceptance-fast-path-state/v1") throw new Error("acceptance state schema mismatch");
  for (const binding of [state.candidate, state.targetManifest, state.acceptancePlan, state.stagePlan]) {
    if (!binding?.file || !isFile(binding.file) || fileDigest(binding.file) !== (binding.bindingDigest ?? binding.digest)) throw new Error(`stale acceptance binding: ${binding?.file ?? "unknown"}`);
  }
  return state;
}

function printStatus(state) {
  const active = nextPendingOrFailed(state);
  let disposition = "COMPLETE";
  if (active?.status === "FAILED" || active?.status === "BLOCKED") disposition = "STOP_FAILED";
  else if (active?.kind === "HUMAN_GATE") disposition = "NEEDS_HUMAN_DECISION";
  else if (active) disposition = "CONTINUE_AUTOMATICALLY";
  const lastAttempt = active?.attempts?.at(-1) ?? null;
  process.stdout.write(`${JSON.stringify({
    schema: "evopilot-acceptance-fast-path-status/v1",
    status: disposition,
    candidateId: state.candidate.id,
    completedStageIds: state.stages.filter((stage) => stage.status === "PASSED").map((stage) => stage.id),
    currentStage: active ? { id: active.id, kind: active.kind, status: active.status } : null,
    failure: lastAttempt?.failureClass ? { failureClass: lastAttempt.failureClass, ...lastAttempt.failurePolicy } : null,
    automaticContinuationAuthorized: disposition === "CONTINUE_AUTOMATICALLY",
    authority: state.authority
  }, null, 2)}\n`);
}

function nextPendingOrFailed(state) {
  return state.stages.find((stage) => stage.status !== "PASSED") ?? null;
}

function refuseSkillTreeState(file) {
  const relative = path.relative(SKILL_ROOT, file);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) throw new Error("acceptance runtime state must remain outside the canonical Skill tree");
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temporary, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fileDigest(file) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function isCandidateNeutralTargetManifest(manifest) {
  if (manifest?.schema === "evopilot-real-host-acceptance-manifest/v3") return !Object.hasOwn(manifest, "candidate");
  if (manifest?.schema !== "evopilot-real-host-acceptance-manifest/v2") return false;
  const candidate = manifest?.candidate;
  return candidate?.bindingMode === "EXTERNAL_CANDIDATE_BINDING" &&
    candidate?.requiredSchema === "evopilot-candidate-acceptance-binding/v1" &&
    !Object.hasOwn(candidate, "requiredCandidateId") &&
    !Object.hasOwn(candidate, "requiredCandidateDigest");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = "true";
    else {
      index += 1;
      if (result[key] === undefined) result[key] = next;
      else result[key] = Array.isArray(result[key]) ? [...result[key], next] : [result[key], next];
    }
  }
  return result;
}

function required(options, key) {
  if (typeof options[key] !== "string" || options[key].length === 0) throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  return options[key];
}

function values(options, key) {
  if (options[key] === undefined) return [];
  return Array.isArray(options[key]) ? options[key] : [options[key]];
}
