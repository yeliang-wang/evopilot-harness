import { digest, persistedJson } from "../../v3/utils.mjs";

export const REQUIRED_COMPLETE_LIFECYCLE_STAGES = Object.freeze([
  "PLAN_PRESENTATION",
  "PROPOSAL_REVIEW_PRESENTATION",
  "PROPOSAL_APPROVAL_DECISION",
  "PUBLICATION_PRESENTATION",
  "CATALOG_VALIDATION_PRESENTATION",
  "CLOSE_PRESENTATION"
]);

export const REQUIRED_ENGINE_OWNED_BUSINESS_PHASES = Object.freeze([
  Object.freeze({ id: "OPERATION_PLAN", stages: Object.freeze(["PLAN_PRESENTATION"]) }),
  Object.freeze({ id: "PROFESSIONAL_ANALYSIS_AND_PROPOSAL_REVIEW", stages: Object.freeze(["PROPOSAL_REVIEW_PRESENTATION"]) }),
  Object.freeze({ id: "PROPOSAL_HUMAN_DECISION", stages: Object.freeze(["PROPOSAL_APPROVAL_DECISION"]) }),
  Object.freeze({ id: "PUBLICATION_AND_SESSION_LIFECYCLE", stages: Object.freeze(["PUBLICATION_PRESENTATION", "CATALOG_VALIDATION_PRESENTATION", "CLOSE_PRESENTATION"]) })
]);

export function createLifecycleFrameManifest(frames, { requiredStages = REQUIRED_COMPLETE_LIFECYCLE_STAGES } = {}) {
  const orderedFrames = uniqueFrames(frames);
  const stages = orderedFrames.map((frame) => frame.stage);
  const missingStages = requiredStages.filter((stage) => !stages.includes(stage));
  if (missingStages.length) throw replayError("LIFECYCLE_FRAME_SET_INCOMPLETE", `Lifecycle Frame set is missing: ${missingStages.join(", ")}.`);
  const entries = orderedFrames.map((frame, index) => {
    assertFrame(frame);
    return {
      index,
      stage: frame.stage,
      frameId: frame.frameId,
      frameDigest: frame.frameDigest,
      businessViewDigest: frame.businessView.businessViewDigest,
      renderedBusinessViewDigest: frame.businessView.renderedBusinessViewDigest,
      decisionDefinitionDigest: frame.decisionDefinition?.decisionDefinitionDigest ?? null,
      locale: frame.businessView.template.locale,
      finiteChoices: persistedJson(frame.decisionDefinition?.options ?? []),
      canonicalMarkdown: frame.businessView.canonicalMarkdown,
      canonicalMarkdownDigest: digest(frame.businessView.canonicalMarkdown),
      normalizedCanonicalMarkdown: normalizeGovernedMarkdown(frame.businessView.canonicalMarkdown),
      frameStructure: structureOf(frame.businessView),
      businessSemantics: governedBusinessSemantics(frame)
    };
  });
  const core = {
    schema: "evopilot-harness-lifecycle-frame-manifest/v1",
    requiredStages: [...requiredStages],
    businessPhases: REQUIRED_ENGINE_OWNED_BUSINESS_PHASES.map((phase) => ({ id: phase.id, stages: [...phase.stages] })),
    stages,
    entries
  };
  core.manifestDigest = digest(core);
  return core;
}

export function verifyCompleteLifecycleReplays({ baselineFrames, replays, requiredStages = REQUIRED_COMPLETE_LIFECYCLE_STAGES }) {
  const baseline = createLifecycleFrameManifest(baselineFrames, { requiredStages });
  const records = Array.isArray(replays) ? replays : [];
  const workBuddy = records.filter((record) => /workbuddy|codebuddy/i.test(record.hostId ?? ""));
  const independent = records.filter((record) => !/workbuddy|codebuddy/i.test(record.hostId ?? ""));
  if (workBuddy.length < 3) throw replayError("WORKBUDDY_COMPLETE_REPLAY_COUNT_INSUFFICIENT", "At least three complete WorkBuddy lifecycle replays are required.");
  if (independent.length < 1) throw replayError("INDEPENDENT_HOST_REPLAY_REQUIRED", "At least one independent Host lifecycle replay is required.");
  requireFreshWorkBuddyRuns(workBuddy);
  const governedInputDigests = new Set(workBuddy.map((record) => record.governedInputDigest));
  if (governedInputDigests.size !== 1 || governedInputDigests.has(undefined)) throw replayError("GOVERNED_INPUT_DRIFT", "All three fresh WorkBuddy runs must bind the same Source, candidate version, Harness configuration, Catalog and policy baseline, locale, and explicit decision inputs.");

  const replayResults = records.map((record, replayIndex) => {
    const replay = createLifecycleFrameManifest(record.frames?.map((entry) => entry.frame ?? entry), { requiredStages });
    if (replay.entries.length !== baseline.entries.length) throw replayError("LIFECYCLE_STAGE_COUNT_DRIFT", `Replay ${replayIndex + 1} has ${replay.entries.length} Frames; expected ${baseline.entries.length}.`);
    const stageResults = replay.entries.map((entry, index) => {
      const expected = baseline.entries[index];
      const source = record.frames[index];
      const visibleText = source?.visibleText ?? source?.frame?.businessView?.canonicalMarkdown ?? source?.businessView?.canonicalMarkdown;
      const before = source?.contentBefore ?? "";
      const after = source?.contentAfter ?? "";
      const comparisons = {
        stage: entry.stage === expected.stage,
        frameStructure: JSON.stringify(entry.frameStructure) === JSON.stringify(expected.frameStructure),
        businessSemantics: JSON.stringify(entry.businessSemantics) === JSON.stringify(expected.businessSemantics),
        canonicalMarkdown: entry.normalizedCanonicalMarkdown === expected.normalizedCanonicalMarkdown,
        finiteChoices: JSON.stringify(entry.finiteChoices) === JSON.stringify(expected.finiteChoices),
        locale: entry.locale === expected.locale,
        visibleText: normalizeGovernedMarkdown(visibleText) === expected.normalizedCanonicalMarkdown,
        hostProse: before.length === 0 && after.length === 0
      };
      const failures = Object.entries(comparisons).filter(([, passed]) => !passed).map(([field]) => field);
      if (failures.length) throw replayError("LIFECYCLE_RENDERING_DRIFT", `Replay ${replayIndex + 1} stage ${expected.stage} drifted in: ${failures.join(", ")}.`);
      return { stage: expected.stage, canonicalMarkdownDigest: expected.canonicalMarkdownDigest, zeroDrift: true };
    });
    return {
      hostId: String(record.hostId),
      hostVersion: String(record.hostVersion ?? "unknown"),
      modelId: String(record.modelId ?? "unknown"),
      restartOrdinal: record.restartOrdinal,
      workspaceId: String(record.workspaceId),
      sessionId: String(record.sessionId),
      taskId: String(record.taskId),
      governedInputDigest: String(record.governedInputDigest),
      observedAt: String(record.observedAt),
      manifestDigest: replay.manifestDigest,
      stageResults,
      zeroDrift: true
    };
  });
  const result = {
    schema: "evopilot-harness-three-fresh-production-lifecycle-conformance-report/v1",
    baselineManifestDigest: baseline.manifestDigest,
    orderedStages: baseline.stages,
    workBuddyReplayCount: workBuddy.length,
    independentHostReplayCount: independent.length,
    restartOrdinals: [...new Set(workBuddy.map((record) => record.restartOrdinal))],
    modelIds: [...new Set(workBuddy.map((record) => String(record.modelId)))],
    calendarDays: [...new Set(workBuddy.map((record) => calendarDay(record.observedAt)))],
    businessPhases: REQUIRED_ENGINE_OWNED_BUSINESS_PHASES.map((phase) => phase.id),
    hostSurfaceExcluded: true,
    comparisonBoundary: "ENGINE_OWNED_HARNESS_FRAMES",
    replays: replayResults,
    governedMutationReplayCount: 0,
    zeroDrift: true
  };
  result.reportDigest = digest(result);
  return result;
}

function requireFreshWorkBuddyRuns(records) {
  for (const field of ["workspaceId", "sessionId", "taskId"]) {
    const values = records.map((record) => record[field]).filter((value) => typeof value === "string" && value.length > 0);
    if (values.length !== records.length || new Set(values).size !== records.length) {
      throw replayError("WORKBUDDY_FRESH_RUN_IDENTITY_REQUIRED", `Every WorkBuddy production run requires a distinct ${field}.`);
    }
  }
}

function normalizeGovernedMarkdown(value) {
  return String(value ?? "")
    .replace(/sha256:[0-9a-f]{64}/g, "sha256:<bound-digest>")
    .replace(/\b(?:session|frame|job|receipt)-[a-z0-9-]+\b/gi, (match) => `${match.split("-")[0]}-<run-id>`)
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z\b/g, "<run-timestamp>");
}

function structureOf(value) {
  if (Array.isArray(value)) return [value.length ? structureOf(value[0]) : null];
  if (!value || typeof value !== "object") return typeof value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, structureOf(value[key])]));
}

function governedBusinessSemantics(frame) {
  return persistedJson({
    stage: frame.stage,
    locale: frame.businessView.template?.locale,
    templateSchema: frame.businessView.template?.schema,
    sectionOrder: frame.businessView.template?.sectionOrder,
    informationArchitecture: frame.businessView.informationArchitecture,
    navigation: frame.businessView.taskNavigation,
    risk: frame.businessView.risk,
    sourceOutcome: frame.businessView.sourceOutcomeExplanation?.outcome,
    decisionKind: frame.decisionDefinition?.kind,
    options: frame.decisionDefinition?.options ?? []
  });
}

function uniqueFrames(frames) {
  if (!Array.isArray(frames)) throw replayError("LIFECYCLE_FRAME_SET_REQUIRED", "Lifecycle replay requires an ordered Frame array.");
  const seen = new Set();
  return frames.filter((candidate) => {
    const frame = candidate?.frame ?? candidate;
    if (!frame?.frameDigest || seen.has(frame.frameDigest)) return false;
    seen.add(frame.frameDigest);
    return true;
  }).map((candidate) => candidate?.frame ?? candidate);
}

function assertFrame(frame) {
  if (frame?.schema !== "evopilot-harness-interaction-frame/v2" || !frame.frameDigest || !frame.businessView?.canonicalMarkdown) {
    throw replayError("LIFECYCLE_FRAME_INVALID", "Lifecycle replay accepts only immutable Interaction Frame v2 objects with an Engine-owned Business Decision View.");
  }
  if (digest(frame.businessView.canonicalMarkdown) !== frame.businessView.renderedBusinessViewDigest) {
    throw replayError("LIFECYCLE_FRAME_CANONICAL_DIGEST_MISMATCH", `Frame ${frame.frameId} canonical Markdown is not bound to its rendered digest.`);
  }
}

function calendarDay(value) {
  const timestamp = Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) throw replayError("REPLAY_PROVENANCE_TIME_REQUIRED", "Every replay requires a valid observedAt timestamp.");
  return new Date(timestamp).toISOString().slice(0, 10);
}

function replayError(code, message) {
  const error = new Error(message);
  error.name = "LifecycleReplayError";
  error.code = code;
  return error;
}
