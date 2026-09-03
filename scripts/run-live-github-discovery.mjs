#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import YAML from "yaml";
import { buildSourceConceptHypothesis } from "../src/v4/classification/source-concept.mjs";
import { normalizeSourceDescriptor, resolveSourceDescriptor } from "../src/v4/classification/source-descriptor.mjs";
import { assertExternalWorkspace } from "../src/v4/constants.mjs";
import { requireWorkspace } from "../src/v3/workspace.mjs";
import { digest, parseCli, option } from "../src/v3/utils.mjs";
import { candidateAcceptanceBindingRunbookDigest } from "../.agents/skills/evopilot-agent-host-production-simulator/scripts/modular_contracts.mjs";
import { distribution, preAdjudicateSource, validatePreAdjudicationProfile } from "./lib/github-pre-adjudication.mjs";

const root = path.resolve(import.meta.dirname, "..");
const args = parseCli(process.argv.slice(2));
const planRecord = readBoundJson("plan", option(args, "expected-plan-digest"));
const plan = planRecord.document;
validatePlan(plan);

if (args.options["validate-plan-only"] === true) {
  process.stdout.write(`${JSON.stringify({ schema: "evopilot-harness-live-github-discovery-plan-validation/v1", status: "PASSED", planDigest: planRecord.fileDigest, targetVersion: plan.targetVersion, queryIds: plan.queries.map((item) => item.id), authority: "acceptance-tooling-only" }, null, 2)}\n`);
  process.exit(0);
}

const candidateRecord = readBoundJson("candidate");
const fixedWaveRecord = readBoundJson("fixed-wave-report");
const workBuddyRunbooksRecord = readBoundJson("workbuddy-runbooks");
const candidateBindingRecord = option(args, "candidate-binding") ? readBoundJson("candidate-binding") : null;
const workspace = assertExternalWorkspace(requiredOption("workspace"));
requireWorkspace(workspace);
const out = path.resolve(requiredOption("out"));
const candidate = validateCandidate(candidateRecord.document);
const fixedWave = validateFixedWave(fixedWaveRecord.document, candidate.candidateDigest, plan);
const workBuddyRunbooks = validateWorkBuddyRunbooks(workBuddyRunbooksRecord.document, candidate, fixedWave, candidateBindingRecord?.document ?? null, plan);
if (args.options["validate-rc16-preconditions-only"] === true) {
  process.stdout.write(`${JSON.stringify({ schema: "evopilot-harness-rc16-start-readiness/v1", status: "PASSED", candidate, fixedWave, workBuddyRunbooks, authority: { acceptanceEvidenceOnly: true, workBuddyPass: false, releaseAuthority: false } }, null, 2)}\n`);
  process.exit(0);
}
const preAdjudication = loadPreAdjudication({ required: true });
if (fs.existsSync(out)) fail("GITHUB_DISCOVERY_APPEND_ONLY_VIOLATION", "Discovery output already exists; a new wave requires a new output path.");

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
const searchCaptures = [];
const queryCandidates = new Map();
let firstSearchResponseAt = null;
for (const query of plan.queries) {
  const items = [];
  for (let page = 1; page <= plan.provider.requestParameters.maximumPagesPerQuery; page += 1) {
    const capture = await searchGitHub({ plan, query, page, token });
    if (!firstSearchResponseAt) firstSearchResponseAt = capture.respondedAt;
    searchCaptures.push(capture.record);
    items.push(...capture.items);
    if (capture.items.length < plan.provider.requestParameters.perPage || !capture.hasNextPage) break;
  }
  queryCandidates.set(query.id, uniqueRepositories(items).sort(repositoryOrder));
}

const selected = [];
const rejectionLedger = [];
const owners = new Set();
const repositories = new Set();
const languageCounts = new Map();
for (const query of plan.queries) {
  let acceptedForQuery = 0;
  const candidates = queryCandidates.get(query.id);
  for (let rank = 0; rank < candidates.length && acceptedForQuery < query.selectionCount; rank += 1) {
    const candidateMetadata = candidates[rank];
    const basicReason = basicRejection(candidateMetadata, owners, repositories, languageCounts, selected.length, plan.selection);
    if (basicReason) { rejectionLedger.push(rejection(query, rank + 1, candidateMetadata, basicReason)); continue; }
    const sourceId = `live-${query.id.toLowerCase()}-${String(acceptedForQuery + 1).padStart(2, "0")}`;
    try {
      const movingDescriptor = normalizeSourceDescriptor({ sourceId, safeLabel: candidateMetadata.fullName, type: "GITHUB_REPOSITORY", repository: candidateMetadata.fullName, requestedRef: candidateMetadata.defaultBranch });
      const movingResolution = resolveSourceDescriptor({ descriptor: movingDescriptor, workspace });
      const frozenDescriptor = normalizeSourceDescriptor({ sourceId, safeLabel: candidateMetadata.fullName, type: "GITHUB_REPOSITORY", repository: candidateMetadata.fullName, requestedRef: movingResolution.resolvedCommit });
      const frozenResolution = resolveSourceDescriptor({ descriptor: frozenDescriptor, workspace });
      const hypothesis = buildSourceConceptHypothesis(frozenResolution);
      const preAdjudicationResult = preAdjudicateSource({ hypothesis, taxonomyDigest: preAdjudication.taxonomyDigest });
      const requiredBranch = preAdjudication.assignments.get(query.id);
      if (preAdjudicationResult.branch !== requiredBranch) {
        rejectionLedger.push(rejection(query, rank + 1, candidateMetadata, "PRE_ADJUDICATION_BRANCH_MISMATCH", `Candidate-blind static pre-adjudication returned ${preAdjudicationResult.branch}; this stratum requires ${requiredBranch}.`, { requiredBranch, observedBranch: preAdjudicationResult.branch, preAdjudicationDigest: preAdjudicationResult.preAdjudicationDigest }));
        continue;
      }
      const entry = {
        sourceId,
        queryId: query.id,
        stratum: query.stratum,
        selectionRank: acceptedForQuery + 1,
        discoveryRank: rank + 1,
        repository: candidateMetadata.fullName,
        repositoryUrl: candidateMetadata.htmlUrl,
        defaultBranch: candidateMetadata.defaultBranch,
        resolvedCommit: frozenResolution.resolvedCommit,
        sourceDescriptor: frozenDescriptor,
        sourceDescriptorDigest: frozenResolution.sourceDescriptorDigest,
        sourceResolutionDigest: frozenResolution.sourceResolutionDigest,
        sourceSnapshotDigest: hypothesis.sourceSnapshotDigest,
        cacheKey: frozenResolution.cacheKey,
        acquisitionPolicy: frozenResolution.acquisitionPolicy,
        observed: candidateMetadata,
        provenance: frozenResolution.provenance,
        licenseDiscovery: frozenResolution.licenseDiscovery,
        redactionResult: hypothesis.sourceSnapshot.redactionResult,
        suspectedSecretScan: { status: hypothesis.sourceSnapshot.redactionResult.applied ? "REDACTION_APPLIED" : "NO_PATTERN_MATCH_IN_BOUNDED_TEXT", bounded: hypothesis.sourceSnapshot.bounded },
        preAdjudicationHint: [preAdjudicationResult.branch],
        preAdjudication: preAdjudicationResult,
        candidateOutputObserved: false,
        sourceExecution: false
      };
      selected.push(entry);
      owners.add(ownerOf(candidateMetadata.fullName));
      repositories.add(candidateMetadata.fullName.toLowerCase());
      increment(languageCounts, candidateMetadata.language ?? "[unknown]");
      acceptedForQuery += 1;
    } catch (error) {
      rejectionLedger.push(rejection(query, rank + 1, candidateMetadata, error.code ?? "STATIC_ACQUISITION_BLOCKED", error.message));
    }
  }
  if (acceptedForQuery !== query.selectionCount) fail("GITHUB_DISCOVERY_STRATUM_INCOMPLETE", `Unable to freeze ${query.selectionCount} eligible repositories for ${query.id}.`, { queryId: query.id, rejectionLedger });
}

validateDiversity(selected, plan);
validateOutcomeDistribution(selected, preAdjudication.requiredDistribution);
const frozenAt = new Date().toISOString();
const freshnessMinutes = (Date.parse(frozenAt) - Date.parse(firstSearchResponseAt)) / 60_000;
if (!Number.isFinite(freshnessMinutes) || freshnessMinutes > plan.freshness.maximumMinutesFromFirstSearchResponseToSelectionFreeze) fail("GITHUB_DISCOVERY_FREEZE_STALE", "Selection freeze exceeded the Target-bound freshness window.");
const core = {
  schema: "evopilot-harness-github-discovery-selection-manifest/v1",
  status: "FROZEN_AWAITING_ORACLE",
  waveId: `github-wave-${crypto.randomUUID()}`,
  targetVersion: plan.targetVersion,
  candidate: { candidateId: candidate.candidateId, candidateDigest: candidate.candidateDigest, frozen: true, sourceCheckoutUsed: false },
  planDigest: planRecord.fileDigest,
  fixedWaveReportDigest: fixedWaveRecord.fileDigest,
  firstSearchResponseAt,
  frozenAt,
  freshnessMinutes,
  searchCaptures,
  rejectionLedger,
  repositories: selected,
  diversity: diversityRecord(selected),
  candidateIsolation: { candidateFrozenBeforeSearch: true, fixedWavePassedBeforeSearch: true, candidateOutputAvailableDuringSelection: false, candidateInvocationCountBeforeFreeze: 0, preAdjudicationProfileDigest: preAdjudication.profileDigest, acceptanceTaxonomyDigest: preAdjudication.taxonomyDigest, preAdjudicationAlgorithm: "candidate-blind-static-taxonomy-pre-adjudication/v1" },
  authority: { acceptanceEvidenceOnly: true, engineAuthority: false, llmAuthority: false, productMutation: false, sourceExecution: false, releaseAuthority: false }
};
core.selectionManifestDigest = digest(core);
validateSelectionManifest(core);
writeExclusiveJson(out, core);
process.stdout.write(`${JSON.stringify({ schema: "evopilot-harness-live-github-discovery-result/v1", status: core.status, waveId: core.waveId, planDigest: core.planDigest, candidateDigest: candidate.candidateDigest, selectionManifestDigest: core.selectionManifestDigest, repositoryCount: core.repositories.length, diversity: core.diversity, out }, null, 2)}\n`);

async function searchGitHub({ plan, query, page, token }) {
  const params = new URLSearchParams({ q: query.query, sort: plan.provider.requestParameters.sort, order: plan.provider.requestParameters.order, per_page: String(plan.provider.requestParameters.perPage), page: String(page) });
  const url = `https://api.github.com/search/repositories?${params}`;
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": plan.provider.apiVersion, "User-Agent": "evopilot-harness-acceptance-discovery" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  let body;
  let rateLimitWaitCount = 0;
  let rateLimitWaitMilliseconds = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) }); }
    catch (error) { fail("GITHUB_DISCOVERY_PROVIDER_UNAVAILABLE", `GitHub repository search is unavailable: ${error.name}.`); }
    body = await response.text();
    if (response.ok) break;
    const waitMilliseconds = retryDelayMilliseconds(response);
    if ((response.status === 403 || response.status === 429) && waitMilliseconds !== null && attempt < 3) {
      rateLimitWaitCount += 1;
      rateLimitWaitMilliseconds += waitMilliseconds;
      await boundedDelay(waitMilliseconds);
      continue;
    }
    break;
  }
  const respondedAt = new Date().toISOString();
  const responseDigest = `sha256:${crypto.createHash("sha256").update(body).digest("hex")}`;
  if (!response.ok) fail(response.status === 403 || response.status === 429 ? "GITHUB_DISCOVERY_RATE_LIMITED" : "GITHUB_DISCOVERY_PROVIDER_FAILED", `GitHub search failed with HTTP ${response.status}.`);
  let document;
  try { document = JSON.parse(body); } catch { fail("GITHUB_DISCOVERY_RESPONSE_INVALID", "GitHub search returned invalid JSON."); }
  if (document.incomplete_results !== false || !Array.isArray(document.items)) fail("GITHUB_DISCOVERY_RESPONSE_INCOMPLETE", `GitHub search response for ${query.id} page ${page} is incomplete.`);
  const items = document.items.map(safeRepositoryMetadata);
  return {
    respondedAt,
    hasNextPage: /rel="next"/.test(response.headers.get("link") ?? ""),
    items,
    record: {
      queryId: query.id,
      stratum: query.stratum,
      query: query.query,
      apiVersion: plan.provider.apiVersion,
      page,
      perPage: plan.provider.requestParameters.perPage,
      respondedAt,
      status: response.status,
      incompleteResults: false,
      itemCount: items.length,
      totalCount: Number(document.total_count),
      responseDigest,
      rateLimit: {
        resource: response.headers.get("x-ratelimit-resource"),
        limit: numericHeader(response, "x-ratelimit-limit"),
        remaining: numericHeader(response, "x-ratelimit-remaining"),
        used: numericHeader(response, "x-ratelimit-used"),
        resetEpochSeconds: numericHeader(response, "x-ratelimit-reset"),
        authenticated: Boolean(token),
        credentialRecorded: false,
        waitCount: rateLimitWaitCount,
        waitMilliseconds: rateLimitWaitMilliseconds
      },
      candidates: items
    }
  };
}

function validatePlan(value) {
  const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/github-discovery-plan-v1.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  if (!validate(value)) fail("GITHUB_DISCOVERY_PLAN_INVALID", new Ajv2020().errorsText(validate.errors));
  const queryIds = value.queries.map((item) => item.id);
  if (new Set(queryIds).size !== queryIds.length || value.queries.some((item) => !Number.isInteger(item.selectionCount) || item.selectionCount < 1)) fail("GITHUB_DISCOVERY_PLAN_QUERY_MATRIX_INVALID", "Discovery plan must define unique queries with positive integer selection counts.");
  const selectedByQueries = value.queries.reduce((sum, item) => sum + item.selectionCount, 0);
  if (
    !Number.isInteger(value.selection.exactRepositoryCount) || value.selection.exactRepositoryCount < 1 ||
    !Number.isInteger(value.selection.selectionCountPerQuery) || value.selection.selectionCountPerQuery < 1 ||
    selectedByQueries !== value.selection.exactRepositoryCount ||
    value.queries.some((item) => item.selectionCount !== value.selection.selectionCountPerQuery) ||
    value.selection.replacementAfterSelectionFreeze !== false ||
    value.selection.candidateOutputAvailableDuringSelection !== false
  ) fail("GITHUB_DISCOVERY_PLAN_SELECTION_INVALID", "Discovery plan selection counts and no-replacement rules are invalid.");
}
function loadPreAdjudication({ required }) {
  const profilePath = option(args, "pre-adjudication-profile");
  const taxonomyPath = option(args, "pre-adjudication-taxonomy");
  if (!profilePath && !taxonomyPath && !required) return null;
  if (!profilePath || !taxonomyPath) fail("GITHUB_PRE_ADJUDICATION_ARGUMENT_REQUIRED", "--pre-adjudication-profile and --pre-adjudication-taxonomy are required for a counted discovery freeze.");
  const profileRecord = readBoundJson("pre-adjudication-profile", option(args, "expected-pre-adjudication-profile-digest"));
  const taxonomyRecord = readBoundYaml("pre-adjudication-taxonomy", option(args, "expected-pre-adjudication-taxonomy-digest"));
  try {
    return validatePreAdjudicationProfile({ profile: profileRecord.document, profileDigest: profileRecord.fileDigest, plan, planDigest: planRecord.fileDigest, taxonomy: taxonomyRecord.document, taxonomyDigest: taxonomyRecord.fileDigest });
  } catch (error) {
    fail(error.code ?? "GITHUB_PRE_ADJUDICATION_INVALID", error.message);
  }
}
function validateCandidate(value) {
  const candidateDigest = value?.candidateDigest ?? value?.digest;
  const candidateId = value?.candidateId ?? value?.id;
  if (value?.status !== "FROZEN" || !candidateId || !/^sha256:[a-f0-9]{64}$/.test(candidateDigest ?? "") || value.sourceCheckoutUsed !== false || value.candidateOutputAvailableDuringDiscovery !== false) fail("GITHUB_DISCOVERY_CANDIDATE_NOT_FROZEN", "Candidate manifest must prove FROZEN, sourceCheckoutUsed=false and candidate output unavailable during discovery.");
  return { candidateId, candidateDigest };
}
function validateFixedWave(value, candidateDigest, plan) {
  const cases = Array.isArray(value?.cases) ? value.cases : Array.isArray(value?.criteria) ? value.criteria : value?.cases && typeof value.cases === "object" ? Object.entries(value.cases).map(([id, item]) => ({ id, ...item })) : [];
  const passed = new Set(cases.filter((item) => item.status === "PASS" || item.status === "PASSED" || item.machineEvidenceStatus === "PASS" || item.machineEvidenceStatus === "PASSED").map((item) => item.id ?? item.caseId));
  const requiredStageIds = plan?.preconditions?.requiredMachineStageIds ?? Array.from({ length: 15 }, (_, index) => `RC${String(index + 1).padStart(2, "0")}`);
  const missing = requiredStageIds.filter((id) => !passed.has(id));
  const machineEvidencePassed = /^PASS(?:ED)?$/.test(value?.status ?? "") || (value?.status === "MACHINE_EVIDENCE_PASSED_TARGET_SEQUENCE_BLOCKED" && value?.acceptance?.rc01ToRc15MachineEvidence === "PASSED");
  const boundCandidateDigest = value?.candidateDigest ?? value?.candidate?.packageDigest;
  if (!machineEvidencePassed || boundCandidateDigest !== candidateDigest || missing.length) fail("GITHUB_DISCOVERY_FIXED_WAVE_INCOMPLETE", `Required pre-discovery non-WorkBuddy machine evidence must all pass for the exact frozen candidate. Missing: ${missing.join(", ") || "none"}.`);
  return { status: "PASSED", candidateDigest, machineEvidencePassedCases: passed.size, workBuddyHumanOperationStatus: "PENDING" };
}
function validateWorkBuddyRunbooks(value, candidate, fixedWave, candidateBinding, plan) {
  const expectedCases = plan?.workBuddyCaseIds ?? [...Array.from({ length: 15 }, (_, index) => `RC${String(index + 1).padStart(2, "0")}`), "RC17", "RC18"];
  const expectedRevision = plan?.targetRevision ?? 12;
  if (value?.schema !== "evopilot-workbuddy-human-runbook-set/v1" || value?.targetRevision !== expectedRevision || value?.runbookCount !== expectedCases.length || canonicalArray(value?.caseIds) !== canonicalArray(expectedCases)) fail("GITHUB_DISCOVERY_WORKBUDDY_RUNBOOK_SET_INCOMPLETE", `Discovery requires the complete frozen WorkBuddy runbook set bound to Target revision ${expectedRevision}.`);
  if (value?.candidateBindingType === "CANDIDATE_ACCEPTANCE_BINDING") {
    if (!candidateBinding || candidateBinding.schema !== "evopilot-candidate-acceptance-binding/v1") fail("GITHUB_DISCOVERY_CANDIDATE_BINDING_REQUIRED", "--candidate-binding must provide the exact Candidate Acceptance Binding used by the runbook set.");
    if (candidateBinding.candidate?.id !== candidate.candidateId || candidateBinding.candidate?.packageDigest !== candidate.candidateDigest || candidateBinding.candidate?.sourceCheckoutUsed !== false) fail("GITHUB_DISCOVERY_CANDIDATE_BINDING_MISMATCH", "Candidate Acceptance Binding does not match the frozen RC16 Candidate.");
    if (value.candidateBindingId !== candidateBinding.id || value.candidateBindingDigestScope !== "CANDIDATE_ACCEPTANCE_BINDING_WITHOUT_RUNBOOK_SET_ARTIFACT" || value.candidateBindingDigest !== candidateAcceptanceBindingRunbookDigest(candidateBinding)) fail("GITHUB_DISCOVERY_WORKBUDDY_RUNBOOK_BINDING_MISMATCH", "WorkBuddy runbook set does not bind the exact Candidate Acceptance Binding projection.");
    if (value.candidate?.id !== candidate.candidateId || value.candidate?.packageDigest !== candidate.candidateDigest || value.candidate?.manifestDigest !== candidateBinding.candidate?.manifestDigest) fail("GITHUB_DISCOVERY_WORKBUDDY_RUNBOOK_CANDIDATE_MISMATCH", "WorkBuddy runbook set Candidate identity does not match the Candidate Acceptance Binding.");
  } else if (value?.candidateBindingType !== "ACCEPTANCE_REBINDING") {
    fail("GITHUB_DISCOVERY_WORKBUDDY_RUNBOOK_BINDING_UNSUPPORTED", "WorkBuddy runbook set uses an unsupported Candidate binding type.");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(value?.runbooksDigest ?? "") || value?.executionPolicy !== "human-operated-workbuddy/v1" || value?.completionPolicy !== "designated-human-range-completion/v1") fail("GITHUB_DISCOVERY_WORKBUDDY_RUNBOOK_SET_INVALID", "WorkBuddy runbook policy or digest is invalid.");
  return { status: "FROZEN", candidateId: candidate.candidateId, candidateBindingId: value.candidateBindingId ?? null, runbookCount: value.runbookCount, runbooksDigest: value.runbooksDigest, humanOperationStatus: fixedWave.workBuddyHumanOperationStatus };
}
function canonicalArray(value) { return JSON.stringify(value ?? []); }
function validateDiversity(selected, plan) {
  const record = diversityRecord(selected);
  const minimumLanguages = plan.selection.minimumPrimaryLanguages ?? 4;
  const maximumPerLanguage = plan.selection.maximumRepositoriesPerLanguage ?? 4;
  if (selected.length !== plan.selection.exactRepositoryCount || record.ownerCount !== selected.length || record.repositoryCount !== selected.length || record.languageCount < minimumLanguages || Math.max(...Object.values(record.languageCounts)) > maximumPerLanguage) fail("GITHUB_DISCOVERY_DIVERSITY_FAILED", "Frozen GitHub selection does not satisfy repository, owner, or language diversity.");
}
function validateOutcomeDistribution(selected, requiredDistribution) {
  const observed = distribution(selected.map((item) => item.preAdjudication?.branch));
  if (JSON.stringify(observed) !== JSON.stringify(requiredDistribution)) fail("GITHUB_PRE_ADJUDICATION_DISTRIBUTION_FAILED", "Frozen GitHub selection does not satisfy the Target-bound candidate-blind outcome distribution.", { requiredDistribution, observed });
}
function validateSelectionManifest(value) {
  const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/github-discovery-selection-manifest-v1.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  if (!validate(value)) fail("GITHUB_DISCOVERY_SELECTION_MANIFEST_INVALID", new Ajv2020().errorsText(validate.errors));
}
function safeRepositoryMetadata(item) { return { fullName: item.full_name, owner: item.owner?.login, htmlUrl: item.html_url, cloneUrl: item.clone_url, defaultBranch: item.default_branch, language: item.language ?? null, sizeKiB: item.size, stars: item.stargazers_count, fork: item.fork, archived: item.archived, disabled: item.disabled, visibility: item.visibility, license: item.license ? { key: item.license.key, spdxId: item.license.spdx_id, name: item.license.name } : null, pushedAt: item.pushed_at, updatedAt: item.updated_at } }
function basicRejection(item, owners, repositories, languageCounts, selectedCount, selection) {
  if (!item.fullName || item.visibility !== "public" || item.archived || item.disabled || item.fork || !item.defaultBranch) return "METADATA_ELIGIBILITY_FAILED";
  if (repositories.has(item.fullName.toLowerCase())) return "DUPLICATE_REPOSITORY";
  if (owners.has(ownerOf(item.fullName))) return "DUPLICATE_OWNER";
  const language = item.language ?? "[unknown]";
  const maximumPerLanguage = selection.maximumRepositoriesPerLanguage ?? 4;
  const minimumLanguages = selection.minimumPrimaryLanguages ?? 4;
  if ((languageCounts.get(language) ?? 0) >= maximumPerLanguage) return "LANGUAGE_MAXIMUM_EXCEEDED";
  const languages = new Set(languageCounts.keys());
  const remainingAfter = selection.exactRepositoryCount - selectedCount - 1;
  if (languages.size < minimumLanguages && languages.has(language) && remainingAfter < minimumLanguages - languages.size) return "LANGUAGE_DIVERSITY_REQUIRED";
  return null;
}
function rejection(query, rank, item, code, message = null, details = null) { return { queryId: query.id, discoveryRank: rank, repository: item.fullName ?? "[unknown]", code, message: message ? redact(message) : null, ...(details ? { details } : {}), candidateOutputObserved: false }; }
function repositoryOrder(left, right) { return right.stars - left.stars || left.fullName.localeCompare(right.fullName); }
function uniqueRepositories(items) { const seen = new Set(); return items.filter((item) => { const key = item.fullName?.toLowerCase(); if (!key || seen.has(key)) return false; seen.add(key); return true; }); }
function ownerOf(repository) { return String(repository).split("/")[0].toLowerCase(); }
function increment(map, key) { map.set(key, (map.get(key) ?? 0) + 1); }
function diversityRecord(selected) { const owners = new Set(selected.map((item) => ownerOf(item.repository))); const repositories = new Set(selected.map((item) => item.repository.toLowerCase())); const languageCounts = {}; for (const item of selected) languageCounts[item.observed.language ?? "[unknown]"] = (languageCounts[item.observed.language ?? "[unknown]"] ?? 0) + 1; return { repositoryCount: repositories.size, ownerCount: owners.size, languageCount: Object.keys(languageCounts).length, languageCounts, strata: Object.fromEntries([...new Set(selected.map((item) => item.queryId))].map((id) => [id, selected.filter((item) => item.queryId === id).length])) }; }
function numericHeader(response, name) { const value = response.headers.get(name); return value == null ? null : Number(value); }
function retryDelayMilliseconds(response) {
  const retryAfter = numericHeader(response, "retry-after");
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.max(1_000, Math.ceil(retryAfter * 1_000) + 1_000);
  const remaining = numericHeader(response, "x-ratelimit-remaining");
  const reset = numericHeader(response, "x-ratelimit-reset");
  if (remaining === 0 && Number.isFinite(reset)) return Math.max(1_000, Math.ceil(reset * 1_000 - Date.now()) + 1_000);
  return null;
}
async function boundedDelay(milliseconds) {
  let remaining = milliseconds;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 55_000);
    await new Promise((resolve) => setTimeout(resolve, chunk));
    remaining -= chunk;
  }
}
function readBoundJson(name, expectedDigest) { const file = path.resolve(requiredOption(name)); const bytes = fs.readFileSync(file); const fileDigest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; if (expectedDigest && fileDigest !== expectedDigest) fail("GITHUB_DISCOVERY_BOUND_FILE_DIGEST_MISMATCH", `${name} digest mismatch.`); return { file, fileDigest, document: JSON.parse(bytes) }; }
function readBoundYaml(name, expectedDigest) { const file = path.resolve(requiredOption(name)); const bytes = fs.readFileSync(file); const fileDigest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`; if (expectedDigest && fileDigest !== expectedDigest) fail("GITHUB_DISCOVERY_BOUND_FILE_DIGEST_MISMATCH", `${name} digest mismatch.`); return { file, fileDigest, document: YAML.parse(bytes.toString("utf8")) }; }
function requiredOption(name) { const value = option(args, name); if (!value) fail("GITHUB_DISCOVERY_ARGUMENT_REQUIRED", `--${name} is required.`); return value; }
function writeExclusiveJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); }
function redact(value) { return String(value).replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, "https://[REDACTED]@").replace(/\/Users\/[^/\s]+/g, "/Users/[REDACTED]").slice(0, 500); }
function fail(code, message, details = null) { const error = new Error(message); error.name = "GitHubDiscoveryError"; error.code = code; if (details) error.details = details; throw error; }
