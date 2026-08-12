import fs from "node:fs";
import path from "node:path";
import { PACKAGE_ROOT } from "./constants.mjs";
import { digest, option, readYaml, walkFiles, writeJson } from "./utils.mjs";

export const DEFAULT_ADVISOR_TIMEOUT_MS = 180_000;
export const DEFAULT_DOCTOR_TIMEOUT_MS = 60_000;

export async function runAdvisor({ args, home, graph, reasoning, knowledge, runRoot }) {
  const mode = String(option(args, "advisor", "auto")).toLowerCase();
  const required = reasoning.advisorRequired || mode === "required";
  const started = Date.now();
  const requestId = `advisor-${graph.runId}-${started.toString(36)}`;
  const complete = (status, extra = {}) => persistAdvisorResult(runRoot, advisorResult(status, required, {
    mode,
    requestId,
    startedAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    ...extra
  }));
  if (mode === "off" || mode === "disabled") {
    return complete("SKIPPED", {
      failureType: required ? "REQUIRED_ADVISOR_DISABLED" : "ADVISOR_DISABLED",
      reason: required ? "Advisor is policy-required but was disabled by the operator; human review remains blocking." : "Advisor is not required for this deterministic decision."
    });
  }
  if (!required && mode !== "on") return complete("SKIPPED", { reason: "Clear existing-profile evolution does not require LLM review." });

  const advisorPolicyFile = latestPack(path.join(home, "policies/advisor"), "AdvisorPolicyPack");
  if (!advisorPolicyFile) return complete("UNAVAILABLE", { failureType: "ADVISOR_POLICY_UNAVAILABLE", reason: "No published AdvisorPolicyPack is installed." });
  const advisorPolicy = readYaml(advisorPolicyFile);
  const modelsFile = path.resolve(option(args, "models-file", process.env.EVOPILOT_HARNESS_LLM_MODELS_FILE || path.join(PACKAGE_ROOT, "models.json")));
  const profileId = option(args, "model", process.env.EVOPILOT_HARNESS_LLM_PROFILE_ID);
  const model = loadConfiguredModel(modelsFile, profileId);
  if (!model) return complete("UNAVAILABLE", { failureType: "MODEL_NOT_CONFIGURED", reason: `No usable Zhipu GLM profile is configured in the manually maintained file ${modelsFile}.`, modelsFile });

  const evidenceProjection = projectAdvisorEvidence(graph, reasoning, advisorPolicy);
  const evidencePayload = evidenceProjection.nodes;
  const advisorGraph = { ...graph, nodes: evidenceProjection.nodes };
  const promptPayload = {
    task: "Review Harness asset eligibility and candidate relationships.",
    deterministicResult: reasoning,
    evidenceGraph: evidencePayload,
    ontology: knowledge.ontology,
    matchPolicy: { metadata: knowledge.policy.metadata, thresholds: knowledge.policy.spec.thresholds, risk: knowledge.policy.spec.risk },
    outputContract: advisorPolicy.spec.outputContract,
    evidenceProjection: evidenceProjection.summary,
    rules: [
      "Cite evidenceId values for every conclusion.",
      "Treat model confidence as advisory only.",
      "Do not approve, publish, execute, or mutate configuration."
    ]
  };
  const requestBody = {
    model: model.modelName,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: advisorPolicy.spec.systemPrompt },
      { role: "user", content: JSON.stringify(promptPayload) }
    ]
  };
  const repairPolicy = advisorPolicy.spec.outputContract.repair ?? { maxAttempts: 0, retryOn: [] };
  const maxRepairs = Math.min(1, Math.max(0, Number(repairPolicy.maxAttempts ?? 0)));
  const retryOn = new Set(repairPolicy.retryOn ?? []);
  const attempts = [];
  let activeRequest = requestBody;
  let finalEnvelope;
  let finalRecommendation;
  let finalValidation;
  let finalRaw;

  for (let index = 0; index <= maxRepairs; index += 1) {
    const attempt = await requestAdvisorAttempt({
      model,
      requestBody: activeRequest,
      timeoutMs: Number(option(args, "advisor-timeout-ms", DEFAULT_ADVISOR_TIMEOUT_MS)),
      graph: advisorGraph,
      advisorPolicy,
      attempt: index + 1
    });
    attempts.push(attempt.record);
    if (attempt.status === "SUCCEEDED") {
      finalEnvelope = attempt.envelope;
      finalRecommendation = attempt.recommendation;
      finalValidation = attempt.validation;
      finalRaw = attempt.raw;
      break;
    }
    const repairAllowed = index < maxRepairs && retryOn.has(attempt.failureType);
    if (!repairAllowed) return complete(attempt.status, {
      failureType: attempt.failureType,
      reason: attempt.reason,
      httpStatus: attempt.httpStatus,
      validation: attempt.validation,
      responseDigest: attempt.responseDigest,
      model: publicModel(model),
      usage: aggregateUsage(attempts),
      attempts,
      attemptCount: attempts.length,
      repairAttempted: attempts.length > 1,
      evidenceProjection: evidenceProjection.summary,
      retryable: attempt.retryable
    });
    activeRequest = repairRequestBody({
      model,
      advisorPolicy,
      graph: advisorGraph,
      deterministicDecision: reasoning.decision,
      previous: attempt
    });
  }

  const result = complete("SUCCEEDED", {
    model: publicModel(model),
    policy: { id: advisorPolicy.metadata.id, version: advisorPolicy.metadata.version, digest: digest(advisorPolicy) },
    promptDigest: digest(activeRequest),
    responseDigest: digest(finalRaw),
    recommendation: finalRecommendation,
    validation: finalValidation,
    usage: aggregateUsage(attempts),
    attempts,
    attemptCount: attempts.length,
    repairAttempted: attempts.length > 1,
    evidenceProjection: evidenceProjection.summary,
    authority: advisorPolicy.spec.authority,
    deterministicDecisionPreserved: true
  });
  writeJson(path.join(runRoot, "advisor-replay.json"), {
    schema: "evopilot-harness-advisor-replay/v3",
    promptDigest: result.promptDigest,
    policy: result.policy,
    ontology: reasoning.ontology,
    deterministicDecision: reasoning.decision,
    recommendation: finalRecommendation,
    responseDigest: result.responseDigest,
    validation: finalValidation,
    attempts,
    evidenceProjection: evidenceProjection.summary
  });
  return result;
}

export function projectAdvisorEvidence(graph, reasoning, policy) {
  const configured = policy.spec.outputContract.evidenceProjection ?? {};
  const algorithm = configured.algorithm ?? "reasoning-source-kind-round-robin/v1";
  const maxNodes = Math.max(1, Number(configured.maxNodes ?? 48));
  const maxCharacters = Math.max(1, Number(configured.maxCharacters ?? 96_000));
  const maxExcerptCharacters = Math.max(1, Number(configured.maxExcerptCharacters ?? 2_000));
  const selected = [];
  const selectedIds = new Set();
  let selectedCharacters = 0;
  const add = (node) => {
    if (!node || selectedIds.has(node.evidenceId) || selected.length >= maxNodes) return false;
    const remaining = maxCharacters - selectedCharacters;
    if (remaining <= 0) return false;
    const excerpt = String(node.excerpt ?? "").slice(0, Math.min(maxExcerptCharacters, remaining));
    const projected = {
      evidenceId: node.evidenceId,
      kind: node.kind,
      label: node.label,
      sourceType: node.sourceType,
      sourceRefDigest: digest(String(node.sourceRef ?? "")),
      sourceBucketDigest: sourceBucketKey(node, graph.sources),
      concepts: node.concepts,
      excerpt
    };
    selected.push(projected);
    selectedIds.add(node.evidenceId);
    selectedCharacters += excerpt.length;
    return true;
  };
  const nodeById = new Map(graph.nodes.map((node) => [node.evidenceId, node]));
  for (const evidenceId of reasoning.evidenceIds ?? []) add(nodeById.get(evidenceId));

  const buckets = new Map();
  for (const node of graph.nodes) {
    if (selectedIds.has(node.evidenceId)) continue;
    const sourceBucket = sourceBucketKey(node, graph.sources);
    const key = `${sourceBucket}\u0000${node.kind ?? "unknown"}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(node);
  }
  const queues = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, nodes]) => nodes);
  let progress = true;
  while (progress && selected.length < maxNodes && selectedCharacters < maxCharacters) {
    progress = false;
    for (const queue of queues) {
      while (queue.length && selectedIds.has(queue[0].evidenceId)) queue.shift();
      if (!queue.length) continue;
      progress = add(queue.shift()) || progress;
      if (selected.length >= maxNodes || selectedCharacters >= maxCharacters) break;
    }
  }
  const selectedKinds = [...new Set(selected.map((node) => node.kind))].sort();
  const selectedSourceDigests = [...new Set(selected.map((node) => node.sourceBucketDigest))].sort();
  const summary = {
    schema: "evopilot-harness-advisor-evidence-projection/v1",
    algorithm,
    graphDigest: graph.graphDigest,
    projectionDigest: digest(selected),
    totalNodeCount: graph.nodes.length,
    selectedNodeCount: selected.length,
    omittedNodeCount: Math.max(0, graph.nodes.length - selected.length),
    selectedCharacterCount: selectedCharacters,
    maxNodes,
    maxCharacters,
    maxExcerptCharacters,
    selectedEvidenceIds: selected.map((node) => node.evidenceId),
    selectedKinds,
    selectedSourceCount: selectedSourceDigests.length
  };
  return { nodes: selected, summary };
}

function sourceBucketKey(node, sources) {
  const reference = String(node.sourceRef ?? "");
  const matching = (sources ?? [])
    .filter((source) => source.input && source.input !== "inline" && reference.startsWith(String(source.input)))
    .sort((left, right) => String(right.input).length - String(left.input).length)[0];
  return matching ? digest(String(matching.input)) : digest(`${node.sourceType ?? "unknown"}:${reference.split(/[\\/]/)[0] ?? ""}`);
}

async function requestAdvisorAttempt({ model, requestBody, timeoutMs, graph, advisorPolicy, attempt }) {
  const started = Date.now();
  const base = (status, extra = {}) => ({
    status,
    attempt,
    startedAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    promptDigest: digest(requestBody),
    ...extra
  });
  let response;
  try {
    response = await fetch(modelEndpoint(model.url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${model.apiKey}` },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const failureType = error?.name === "TimeoutError" ? "TRANSPORT_TIMEOUT" : "TRANSPORT_ERROR";
    const reason = error instanceof Error ? error.message : String(error);
    const record = base("FAILED", { failureType, reason, retryable: true });
    return { ...record, record };
  }
  const raw = await response.text();
  const responseDigest = digest(raw);
  if (!response.ok) {
    const record = base("FAILED", {
      failureType: "HTTP_ERROR",
      reason: `GLM request failed with HTTP ${response.status}.`,
      httpStatus: response.status,
      responseDigest,
      retryable: response.status === 429 || response.status >= 500
    });
    return { ...record, raw, record };
  }
  let envelope;
  let recommendation;
  try {
    envelope = JSON.parse(raw);
    recommendation = parseJsonContent(envelope?.choices?.[0]?.message?.content);
  } catch (error) {
    const record = base("FAILED", {
      failureType: "INVALID_RESPONSE_JSON",
      reason: `GLM response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      responseDigest,
      usage: normalizeUsage(envelope?.usage),
      retryable: false
    });
    return { ...record, raw, record };
  }
  const validation = validateRecommendation(recommendation, graph, advisorPolicy);
  if (validation.status !== "VALIDATED") {
    const record = base("REJECTED", {
      failureType: "CONTRACT_REJECTED",
      reason: "LLM response violated the evidence-bound Advisor contract.",
      validation,
      responseDigest,
      usage: normalizeUsage(envelope.usage),
      retryable: false
    });
    return { ...record, raw, envelope, recommendation, validation, record };
  }
  const record = base("SUCCEEDED", {
    responseDigest,
    validation,
    usage: normalizeUsage(envelope.usage)
  });
  return { ...record, raw, envelope, recommendation, validation, record };
}

function repairRequestBody({ model, advisorPolicy, graph, deterministicDecision, previous }) {
  const repairPayload = {
    task: "Repair the previous Advisor output so it exactly satisfies the existing output contract.",
    deterministicDecision,
    outputContract: advisorPolicy.spec.outputContract,
    allowedEvidenceIds: graph.nodes.map((node) => node.evidenceId),
    failedValidation: previous.validation ?? { failureType: previous.failureType },
    previousOutput: previous.recommendation ?? String(previous.raw ?? "").slice(0, 8000),
    rules: [
      "Return one JSON object only.",
      "Use evidenceIds exactly as listed in allowedEvidenceIds; never alter, suffix, or invent an id.",
      "Repair structure and citations only; do not change the deterministic decision or add new evidence.",
      "Do not approve, publish, execute, or mutate configuration."
    ]
  };
  return {
    model: model.modelName,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: advisorPolicy.spec.systemPrompt },
      { role: "user", content: JSON.stringify(repairPayload) }
    ]
  };
}

function aggregateUsage(attempts) {
  return attempts.reduce((total, attempt) => ({
    inputTokens: total.inputTokens + Number(attempt.usage?.inputTokens ?? 0),
    outputTokens: total.outputTokens + Number(attempt.usage?.outputTokens ?? 0),
    totalTokens: total.totalTokens + Number(attempt.usage?.totalTokens ?? 0)
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
}

export function validateRecommendation(value, graph, policy) {
  const required = policy.spec.outputContract.requiredFields;
  const missing = required.filter((field) => value?.[field] == null);
  const allowed = policy.spec.outputContract.allowedRecommendations.includes(value?.recommendation);
  const knownIds = new Set(graph.nodes.map((node) => node.evidenceId));
  const evidenceIds = Array.isArray(value?.evidenceIds) ? value.evidenceIds : [];
  const unknownEvidenceIds = evidenceIds.filter((id) => !knownIds.has(id));
  const checks = [
    { id: "required-fields", status: missing.length ? "FAIL" : "PASS", evidence: missing },
    { id: "allowed-recommendation", status: allowed ? "PASS" : "FAIL", evidence: [String(value?.recommendation)] },
    { id: "evidence-citations", status: evidenceIds.length > 0 && unknownEvidenceIds.length === 0 ? "PASS" : "FAIL", evidence: unknownEvidenceIds.length ? unknownEvidenceIds : evidenceIds }
  ];
  return { status: checks.every((check) => check.status === "PASS") ? "VALIDATED" : "FAILED", checks };
}

export function inspectModels(modelsFile, selectedId) {
  const resolved = path.resolve(modelsFile);
  if (!fs.existsSync(resolved)) return {
    schema: "evopilot-harness-models/v3",
    status: "NOT_CONFIGURED",
    readinessScope: "CONFIGURATION_ONLY",
    connectionVerified: false,
    modelsFile: resolved,
    models: [],
    nextAction: "configure-models-json"
  };
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(resolved, "utf8")); } catch (error) { return { schema: "evopilot-harness-models/v3", status: "FAILED", modelsFile: resolved, error: error.message, models: [] }; }
  const models = (Array.isArray(parsed.models) ? parsed.models : []).map((model) => ({
    id: model.id,
    name: model.name,
    vendor: model.vendor,
    url: model.url,
    modelName: model.modelName ?? model.id,
    apiKeyConfigured: Boolean(model.apiKey),
    eligible: model.vendor === "zhipu" && /^glm/i.test(String(model.id ?? model.modelName ?? ""))
  }));
  const selected = models.find((model) => model.id === selectedId) ?? models.find((model) => model.eligible);
  return {
    schema: "evopilot-harness-models/v3",
    status: selected ? "READY" : "NOT_CONFIGURED",
    readinessScope: "CONFIGURATION_ONLY",
    connectionVerified: false,
    modelsFile: resolved,
    selected,
    models,
    nextAction: selected ? "llm-v3-doctor" : "configure-models-json"
  };
}

export async function diagnoseModel(modelsFile, selectedId, timeoutMs = DEFAULT_DOCTOR_TIMEOUT_MS) {
  const started = Date.now();
  const requestId = `llm-doctor-${started.toString(36)}`;
  const model = loadConfiguredModel(path.resolve(modelsFile), selectedId);
  const complete = (status, extra = {}) => ({
    schema: "evopilot-harness-llm-doctor/v3",
    status,
    requestId,
    startedAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    ...extra
  });
  if (!model) return complete("NOT_CONFIGURED", { failureType: "MODEL_NOT_CONFIGURED", reason: "No usable Zhipu GLM profile is configured." });
  const requestBody = {
    model: model.modelName,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Return one JSON object only." },
      { role: "user", content: "Return exactly {\"status\":\"ok\"}." }
    ]
  };
  let response;
  try {
    response = await fetch(modelEndpoint(model.url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${model.apiKey}` },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(Number(timeoutMs))
    });
  } catch (error) {
    return complete("FAILED", {
      failureType: error?.name === "TimeoutError" ? "TRANSPORT_TIMEOUT" : "TRANSPORT_ERROR",
      reason: error instanceof Error ? error.message : String(error),
      model: publicModel(model),
      retryable: true
    });
  }
  const raw = await response.text();
  if (!response.ok) return complete("FAILED", {
    failureType: "HTTP_ERROR",
    reason: `GLM request failed with HTTP ${response.status}.`,
    httpStatus: response.status,
    responseDigest: digest(raw),
    model: publicModel(model),
    retryable: response.status === 429 || response.status >= 500
  });
  try {
    const envelope = JSON.parse(raw);
    const content = parseJsonContent(envelope?.choices?.[0]?.message?.content);
    if (content?.status !== "ok") return complete("FAILED", {
      failureType: "DOCTOR_CONTRACT_REJECTED",
      reason: "GLM connectivity response did not satisfy the doctor contract.",
      responseDigest: digest(raw),
      model: publicModel(model),
      usage: normalizeUsage(envelope.usage),
      retryable: false
    });
    return complete("READY", {
      readinessScope: "LIVE_CONNECTIVITY",
      connectionVerified: true,
      model: publicModel(model),
      responseDigest: digest(raw),
      usage: normalizeUsage(envelope.usage),
      nextAction: "run-produce"
    });
  } catch (error) {
    return complete("FAILED", {
      failureType: "INVALID_RESPONSE_JSON",
      reason: `GLM response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      responseDigest: digest(raw),
      model: publicModel(model),
      retryable: false
    });
  }
}

export function loadConfiguredModel(modelsFile, selectedId) {
  if (!fs.existsSync(modelsFile)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(modelsFile, "utf8")); } catch { return null; }
  const candidates = Array.isArray(parsed.models) ? parsed.models : [];
  const model = candidates.find((item) => item.id === selectedId) ?? candidates.find((item) => item.vendor === "zhipu" && /^glm/i.test(String(item.id ?? item.modelName ?? "")));
  if (!model || model.vendor !== "zhipu" || !model.apiKey || !model.url) return null;
  return { id: model.id, name: model.name, vendor: model.vendor, modelName: model.modelName ?? model.id, apiKey: model.apiKey, url: model.url };
}

export function publicModel(model) {
  return { id: model.id, name: model.name, provider: model.vendor, model: model.modelName, url: model.url, apiKeyConfigured: true };
}

export function parseJsonContent(content) {
  if (typeof content === "object" && content) return content;
  const text = String(content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(text);
}

export function modelEndpoint(base) {
  const normalized = String(base).replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

export function normalizeUsage(usage = {}) {
  return {
    inputTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? 0)
  };
}

function advisorResult(status, required, extra = {}) {
  return { schema: "evopilot-harness-advisor-result/v3", status, required, ...extra };
}

function persistAdvisorResult(runRoot, result) {
  const resultPath = path.join(runRoot, "advisor-result.json");
  const persisted = { ...result, resultPath };
  writeJson(resultPath, persisted);
  return persisted;
}

function latestPack(root, kind) {
  return walkFiles(root, (file) => /\.ya?ml$/i.test(file)).map((file) => {
    try { return { file, document: readYaml(file) }; } catch { return null; }
  }).filter((item) => item?.document?.kind === kind && ["published", "approved"].includes(item.document.metadata?.lifecycle)).sort((a, b) => String(b.document.metadata.version).localeCompare(String(a.document.metadata.version), undefined, { numeric: true }))[0]?.file;
}
