import fs from "node:fs";
import path from "node:path";
import { PACKAGE_ROOT } from "./constants.mjs";
import { digest, option, readYaml, walkFiles, writeJson } from "./utils.mjs";

export async function runAdvisor({ args, home, graph, reasoning, knowledge, runRoot }) {
  const mode = String(option(args, "advisor", "auto")).toLowerCase();
  const required = reasoning.advisorRequired || mode === "required";
  if (mode === "off" || mode === "disabled") {
    return advisorResult("SKIPPED", required, { reason: required ? "Advisor is policy-required but was disabled by the operator; human review remains blocking." : "Advisor is not required for this deterministic decision." });
  }
  if (!required && mode !== "on") return advisorResult("SKIPPED", false, { reason: "Clear existing-profile evolution does not require LLM review." });

  const advisorPolicyFile = latestPack(path.join(home, "policies/advisor"), "AdvisorPolicyPack");
  if (!advisorPolicyFile) return advisorResult("UNAVAILABLE", required, { reason: "No published AdvisorPolicyPack is installed." });
  const advisorPolicy = readYaml(advisorPolicyFile);
  const modelsFile = path.resolve(option(args, "models-file", process.env.EVOPILOT_HARNESS_LLM_MODELS_FILE || path.join(PACKAGE_ROOT, "models.json")));
  const profileId = option(args, "model", process.env.EVOPILOT_HARNESS_LLM_PROFILE_ID);
  const model = loadModel(modelsFile, profileId);
  if (!model) return advisorResult("UNAVAILABLE", required, { reason: `No usable Zhipu GLM profile is configured in the manually maintained file ${modelsFile}.`, modelsFile });

  const evidencePayload = graph.nodes.map((node) => ({ evidenceId: node.evidenceId, kind: node.kind, label: node.label, concepts: node.concepts, excerpt: node.excerpt.slice(0, 4000) }));
  const promptPayload = {
    task: "Review Harness asset eligibility and candidate relationships.",
    deterministicResult: reasoning,
    evidenceGraph: evidencePayload,
    ontology: knowledge.ontology,
    matchPolicy: { metadata: knowledge.policy.metadata, thresholds: knowledge.policy.spec.thresholds, risk: knowledge.policy.spec.risk },
    outputContract: advisorPolicy.spec.outputContract,
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
  const startedAt = new Date().toISOString();
  let response;
  try {
    response = await fetch(endpoint(model.url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${model.apiKey}` },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(Number(option(args, "advisor-timeout-ms", 60_000)))
    });
  } catch (error) {
    return advisorResult("FAILED", required, { reason: error instanceof Error ? error.message : String(error), model: publicModel(model) });
  }
  const raw = await response.text();
  if (!response.ok) return advisorResult("FAILED", required, { reason: `GLM request failed with HTTP ${response.status}.`, responseDigest: digest(raw), model: publicModel(model) });
  let envelope;
  let recommendation;
  try {
    envelope = JSON.parse(raw);
    recommendation = parseJsonContent(envelope?.choices?.[0]?.message?.content);
  } catch (error) {
    return advisorResult("FAILED", required, { reason: `GLM response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`, responseDigest: digest(raw), model: publicModel(model) });
  }
  const validation = validateRecommendation(recommendation, graph, advisorPolicy);
  if (validation.status !== "VALIDATED") return advisorResult("REJECTED", required, { reason: "LLM response violated the evidence-bound Advisor contract.", validation, responseDigest: digest(raw), model: publicModel(model) });
  const result = advisorResult("SUCCEEDED", required, {
    model: publicModel(model),
    policy: { id: advisorPolicy.metadata.id, version: advisorPolicy.metadata.version, digest: digest(advisorPolicy) },
    promptDigest: digest(requestBody),
    responseDigest: digest(raw),
    recommendation,
    validation,
    usage: normalizeUsage(envelope.usage),
    startedAt,
    completedAt: new Date().toISOString(),
    authority: advisorPolicy.spec.authority,
    deterministicDecisionPreserved: true
  });
  writeJson(path.join(runRoot, "advisor-result.json"), result);
  writeJson(path.join(runRoot, "advisor-replay.json"), {
    schema: "evopilot-harness-advisor-replay/v3",
    promptDigest: result.promptDigest,
    policy: result.policy,
    ontology: reasoning.ontology,
    deterministicDecision: reasoning.decision,
    recommendation,
    responseDigest: result.responseDigest,
    validation
  });
  return result;
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
  if (!fs.existsSync(resolved)) return { schema: "evopilot-harness-models/v3", status: "NOT_CONFIGURED", modelsFile: resolved, models: [] };
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
  return { schema: "evopilot-harness-models/v3", status: selected ? "READY" : "NOT_CONFIGURED", modelsFile: resolved, selected, models };
}

function loadModel(modelsFile, selectedId) {
  if (!fs.existsSync(modelsFile)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(modelsFile, "utf8")); } catch { return null; }
  const candidates = Array.isArray(parsed.models) ? parsed.models : [];
  const model = candidates.find((item) => item.id === selectedId) ?? candidates.find((item) => item.vendor === "zhipu" && /^glm/i.test(String(item.id ?? item.modelName ?? "")));
  if (!model || model.vendor !== "zhipu" || !model.apiKey || !model.url) return null;
  return { id: model.id, name: model.name, vendor: model.vendor, modelName: model.modelName ?? model.id, apiKey: model.apiKey, url: model.url };
}

function publicModel(model) {
  return { id: model.id, name: model.name, provider: model.vendor, model: model.modelName, url: model.url, apiKeyConfigured: true };
}

function parseJsonContent(content) {
  if (typeof content === "object" && content) return content;
  const text = String(content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(text);
}

function endpoint(base) {
  const normalized = String(base).replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

function normalizeUsage(usage = {}) {
  return {
    inputTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? 0)
  };
}

function advisorResult(status, required, extra = {}) {
  return { schema: "evopilot-harness-advisor-result/v3", status, required, ...extra };
}

function latestPack(root, kind) {
  return walkFiles(root, (file) => /\.ya?ml$/i.test(file)).map((file) => {
    try { return { file, document: readYaml(file) }; } catch { return null; }
  }).filter((item) => item?.document?.kind === kind && ["published", "approved"].includes(item.document.metadata?.lifecycle)).sort((a, b) => String(b.document.metadata.version).localeCompare(String(a.document.metadata.version), undefined, { numeric: true }))[0]?.file;
}
