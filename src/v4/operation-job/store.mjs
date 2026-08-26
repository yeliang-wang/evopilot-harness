import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { digest, persistedJson, safeId } from "../../v3/utils.mjs";
import { requireWorkspace } from "../../v3/workspace.mjs";
import { assertExternalWorkspace, assertWorkspaceTreeConfined, resolveWorkspacePath } from "../constants.mjs";
import { assertNoSensitiveMaterial } from "../security/sensitive.mjs";
import { inspectAgentSession, reviewSessionProposals } from "../session/store.mjs";

const SUPPORTED_OPERATIONS = new Set(["proposal.review"]);

export function startOperationJob({ home, sessionId, expectedSessionDigest, operation, input = {}, now = new Date().toISOString() }) {
  const workspace = prepare(home);
  if (!SUPPORTED_OPERATIONS.has(operation)) throw jobError("UNSUPPORTED_ASYNC_OPERATION", `OperationJob does not support ${operation}.`, "inspect-capabilities-and-use-a-declared-operation");
  const normalizedInput = normalizeInput(operation, input);
  const inputDigest = digest(normalizedInput);
  const identityDigest = digest({ sessionId, expectedSessionDigest, operation, inputDigest });
  const jobId = safeId(`job-${identityDigest.slice("sha256:".length, "sha256:".length + 24)}`);
  const existing = readJob(workspace, jobId, false);
  if (existing) return publicJob(existing);
  const session = inspectAgentSession(workspace, sessionId);
  if (session.sessionDigest !== expectedSessionDigest) throw jobError("SESSION_DIGEST_MISMATCH", "Agent Operation Session changed before the OperationJob was created.", "reload-session-before-starting-operation-job");
  if (operation === "proposal.review" && session.status !== "PROPOSAL_REVIEW_REQUIRED") throw jobError("INVALID_SESSION_STATE", `Session ${sessionId} is ${session.status}; expected PROPOSAL_REVIEW_REQUIRED.`, session.nextAction);
  assertNoCompetingJob(workspace, { sessionId, operation, identityDigest });

  const job = {
    schema: "evopilot-harness-operation-job/v1",
    jobId,
    identityDigest,
    operation,
    sessionId,
    expectedSessionDigest,
    inputDigest,
    input: normalizedInput,
    status: "RUNNING",
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
    workerPid: null,
    result: null,
    resultDigest: null,
    error: null,
    nextAction: "inspect-operation-job"
  };
  persistJob(workspace, job);
  const worker = spawn(process.execPath, [path.join(import.meta.dirname, "worker.mjs"), workspace, jobId], { detached: true, stdio: "ignore" });
  job.workerPid = worker.pid;
  job.updatedAt = new Date().toISOString();
  persistJob(workspace, job);
  worker.unref();
  return publicJob(job);
}

export function inspectOperationJob({ home, jobId, expectedJobDigest }) {
  const workspace = prepare(home);
  const job = readJob(workspace, jobId, true);
  if (expectedJobDigest && job.jobDigest !== expectedJobDigest) throw jobError("OPERATION_JOB_DIGEST_MISMATCH", "OperationJob changed since the caller last inspected it.", "inspect-operation-job");
  return publicJob(job);
}

export function listOperationJobs(home) {
  const workspace = prepare(home);
  return jobFiles(workspace).map((file) => publicJob(readAndValidate(file)));
}

export function recoverInterruptedOperationJobs(home, now = new Date().toISOString()) {
  const workspace = prepare(home);
  const recovered = [];
  for (const file of jobFiles(workspace)) {
    const job = readAndValidate(file);
    if (job.status !== "RUNNING" || processIsAlive(job.workerPid)) continue;
    job.status = "INTERRUPTED_UNCERTAIN";
    job.updatedAt = now;
    job.completedAt = now;
    job.error = {
      code: "OPERATION_JOB_PROCESS_INTERRUPTED",
      message: "The OperationJob process ended before a durable result was recorded; automatic re-execution is forbidden.",
      retryable: false
    };
    job.nextAction = "inspect-operation-session-before-explicit-recovery";
    persistJob(workspace, job);
    recovered.push(publicJob(job));
  }
  return recovered;
}

export async function executeOperationJob(home, jobId) {
  const workspace = prepare(home);
  let job = readJob(workspace, jobId, true);
  if (job.status !== "RUNNING") return publicJob(job);
  try {
    let result;
    if (job.operation === "proposal.review") {
      result = await reviewSessionProposals({
        home: workspace,
        sessionId: job.sessionId,
        expectedSessionDigest: job.expectedSessionDigest,
        operationJobId: job.jobId,
        ...job.input
      });
    }
    job = readJob(workspace, job.jobId, true);
    job.status = "SUCCEEDED";
    job.result = persistedJson(result);
    job.resultDigest = digest(job.result);
    job.error = null;
    job.nextAction = "consume-authoritative-operation-result";
  } catch (error) {
    job = readJob(workspace, job.jobId, true);
    job.status = "FAILED";
    job.error = {
      code: error.code ?? "OPERATION_JOB_FAILED",
      message: "The long-running Engine operation failed; inspect the durable Session and this job code before recovery.",
      nextAction: error.nextAction ?? "inspect-operation-job-failure"
    };
    job.nextAction = job.error.nextAction;
  }
  job.updatedAt = new Date().toISOString();
  job.completedAt = job.updatedAt;
  persistJob(workspace, job);
  return publicJob(job);
}

function normalizeInput(operation, input) {
  const value = input && typeof input === "object" && !Array.isArray(input) ? persistedJson(input) : {};
  const allowed = operation === "proposal.review" ? new Set(["modelsFile", "model", "advisorTimeoutMs", "reviewTimeoutMs"]) : new Set();
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw jobError("OPERATION_JOB_INPUT_INVALID", `Unsupported ${operation} OperationJob input: ${key}.`, "remove-undeclared-operation-job-input");
  assertNoSensitiveMaterial(value, "operationJob.input");
  return value;
}

function assertNoCompetingJob(home, candidate) {
  for (const file of jobFiles(home)) {
    const job = readAndValidate(file);
    if (job.sessionId === candidate.sessionId && job.operation === candidate.operation && job.status === "RUNNING" && job.identityDigest !== candidate.identityDigest) {
      throw jobError("OPERATION_JOB_CONFLICT", `Session ${candidate.sessionId} already has an active ${candidate.operation} OperationJob.`, "inspect-existing-operation-job");
    }
  }
}

function prepare(home) {
  const workspace = assertExternalWorkspace(home);
  requireWorkspace(workspace);
  assertWorkspaceTreeConfined(workspace);
  fs.mkdirSync(jobRoot(workspace), { recursive: true });
  return workspace;
}

function jobRoot(home) {
  return resolveWorkspacePath(home, "agent-operation-jobs");
}

function jobFile(home, jobId) {
  return resolveWorkspacePath(home, "agent-operation-jobs", `${safeId(jobId)}.json`);
}

function jobFiles(home) {
  const root = jobRoot(home);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((name) => name.endsWith(".json")).sort().map((name) => path.join(root, name));
}

function readJob(home, jobId, required) {
  const file = jobFile(home, jobId);
  if (!fs.existsSync(file)) {
    if (!required) return null;
    throw jobError("OPERATION_JOB_NOT_FOUND", `OperationJob ${jobId} does not exist.`, "list-operation-jobs");
  }
  return readAndValidate(file);
}

function readAndValidate(file) {
  const job = JSON.parse(fs.readFileSync(file, "utf8"));
  if (job.schema !== "evopilot-harness-operation-job/v1" || !job.jobId || !job.identityDigest || !job.status) {
    throw jobError("OPERATION_JOB_INVALID", `OperationJob is invalid: ${file}.`, "stop-and-repair-operation-job");
  }
  const expected = calculateJobDigest(job);
  if (job.jobDigest !== expected) throw jobError("OPERATION_JOB_INTEGRITY_FAILED", `OperationJob digest mismatch: ${file}.`, "stop-and-repair-operation-job");
  return job;
}

function persistJob(home, job) {
  assertWorkspaceTreeConfined(home);
  const root = jobRoot(home);
  fs.mkdirSync(root, { recursive: true });
  assertNoSensitiveMaterial(job, "operationJob");
  job.jobDigest = calculateJobDigest(job);
  const file = jobFile(home, job.jobId);
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(job, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
  return job;
}

function calculateJobDigest(job) {
  const value = persistedJson(job);
  delete value.jobDigest;
  return digest(value);
}

function publicJob(job) {
  const value = persistedJson(job);
  if (!value.result) return value;
  const frame = value.result.interaction?.currentFrame ?? null;
  const proposal = value.result.proposals?.[0] ?? null;
  value.result = {
    schema: "evopilot-harness-operation-job-result-view/v1",
    status: value.result.status,
    sessionId: value.result.sessionId,
    sessionDigest: value.result.sessionDigest,
    nextAction: value.result.nextAction,
    proposal: proposal ? {
      proposalId: proposal.proposalId,
      proposalDigest: proposal.proposalDigest,
      status: proposal.status,
      reviewDigest: proposal.review?.reviewDigest ?? null,
      reviewVerdict: proposal.review?.verdict ?? null
    } : null,
    presentation: frame ? {
      stage: frame.stage,
      frameId: frame.frameId,
      frameDigest: frame.frameDigest,
      sessionDigest: frame.sessionDigest,
      canonicalMarkdown: frame.canonicalMarkdown,
      businessViewDigest: digest(frame.businessView),
      auditEnvelopeDigest: digest(frame.auditEnvelope),
      sourceReasoningMapDigest: digest(frame.sourceReasoningMap),
      decisionDefinition: persistedJson(frame.decisionDefinition)
    } : null,
    auditResource: `evopilot-harness://sessions/${value.sessionId}`
  };
  return value;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function jobError(code, message, nextAction) {
  const error = new Error(message);
  error.name = "OperationJobError";
  error.code = code;
  error.nextAction = nextAction;
  return error;
}
