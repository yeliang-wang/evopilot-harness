import fs from "node:fs";
import path from "node:path";
import { digest, persistedJson, safeId } from "../../v3/utils.mjs";

export const HARNESS_PROFESSIONAL_ANALYSIS_SCHEMA = "evopilot-harness-professional-analysis/v1";
export const HARNESS_ARCHITECTURE_ASSESSMENT_SCHEMA = "evopilot-harness-architecture-assessment/v1";
export const SOURCE_OUTCOME_EXPLANATION_SCHEMA = "evopilot-harness-source-outcome-explanation/v1";
export const EVOLUTION_CONTEXT_BINDING_SCHEMA = "evopilot-harness-evolution-context-binding/v1";
export const AGENT_HOST_BOUNDARY_CONTRACT_SCHEMA = "evopilot-harness-agent-host-boundary-contract/v1";
export const HOST_CONFORMANCE_PROFILE_SCHEMA = "evopilot-harness-host-conformance-profile/v1";
export const CANONICAL_PRESENTATION_DELIVERY_RECEIPT_SCHEMA = "evopilot-harness-canonical-presentation-delivery-receipt/v1";

export const PROFESSIONAL_OUTCOMES = Object.freeze([
  "REUSE_EXISTING",
  "EVOLVE_EXISTING",
  "COMPOSE_NEW_BUNDLE",
  "PROPOSE_NEW_PROFILE",
  "NOT_HARNESS_ELIGIBLE",
  "NEED_MORE_EVIDENCE",
  "NO_CHANGE",
  "REJECT"
]);

export const REQUIRED_GOVERNED_HOST_CAPABILITIES = Object.freeze([
  "deterministic-rendering",
  "governed-operation-interception",
  "ordered-visible-transcript-evidence",
  "interaction-frame-binding",
  "business-view-digest-binding",
  "exact-canonical-markdown-rendering",
  "complete-turn-digest-receipt",
  "fixed-locale-rendering",
  "host-prose-suppression",
  "workspace-state-recovery"
]);

const POSITIVE_OUTCOMES = new Set(["REUSE_EXISTING", "EVOLVE_EXISTING", "COMPOSE_NEW_BUNDLE", "PROPOSE_NEW_PROFILE"]);
const CONTEXT_STABLE_REASONING_STAGES = new Set(["PLAN_PRESENTATION", "EVIDENCE_REPORT_PRESENTATION", "PROPOSAL_REVIEW_PRESENTATION", "PROPOSAL_APPROVAL_DECISION"]);

export function createEvolutionContextBinding({ session, plan = session?.plan, renderModel = {}, locale, templateVersion = "evopilot-harness-business-presentation/v2" }) {
  if (session?.evolutionContext?.schema === EVOLUTION_CONTEXT_BINDING_SCHEMA) return persistedJson(session.evolutionContext);
  return buildEvolutionContextBinding({ session, plan, renderModel, locale, templateVersion });
}

export function inspectEvolutionContextBinding({ session, plan = session?.plan, renderModel = {}, locale, templateVersion }) {
  const bound = session?.evolutionContext?.schema === EVOLUTION_CONTEXT_BINDING_SCHEMA ? persistedJson(session.evolutionContext) : null;
  const current = buildEvolutionContextBinding({
    session: { ...session, evolutionContext: null },
    plan,
    renderModel,
    locale: locale ?? bound?.locale,
    templateVersion: templateVersion ?? bound?.presentationTemplateVersion ?? "evopilot-harness-business-presentation/v2"
  });
  const fields = ["sourceSnapshotDigest", "classificationHandoffBinding", "catalogBinding", "ontologyBinding", "matchPolicyBinding", "advisorPolicyBinding", "advisorProfile", "operationIntentDigest", "locale", "presentationTemplateVersion"];
  const changedFields = bound ? fields.filter((field) => digest(bound[field]) !== digest(current[field])) : [];
  const result = {
    schema: "evopilot-harness-evolution-context-inspection/v1",
    status: !bound ? "UNBOUND" : changedFields.length ? "REEVALUATION_REQUIRED" : "UNCHANGED",
    boundContextDigest: bound?.evolutionContextDigest ?? null,
    currentContextDigest: current.evolutionContextDigest,
    changedFields,
    priorContextPreserved: true,
    automaticMutationAllowed: false
  };
  result.contextInspectionDigest = digest(result);
  return result;
}

function buildEvolutionContextBinding({ session, plan, renderModel, locale, templateVersion }) {
  const boundLocale = locale ?? deriveBoundLocale(session, renderModel);
  const normalizedPlan = plan && typeof plan === "object" ? plan : {};
  const sourceBinding = normalizedPlan.sources ?? renderModel.sources ?? {};
  const advisor = advisorIdentity(normalizedPlan, renderModel);
  const core = {
    schema: EVOLUTION_CONTEXT_BINDING_SCHEMA,
    sourceSnapshotDigest: session?.classificationHandoff?.sourceSnapshotDigest ?? digestSourceBinding(sourceBinding),
    classificationHandoffBinding: session?.classificationHandoff ? { handoffDigest: session.classificationHandoff.handoffDigest, sourceDescriptorDigest: session.classificationHandoff.sourceDescriptorDigest, sourceResolutionDigest: session.classificationHandoff.sourceResolutionDigest, sourceSnapshotDigest: session.classificationHandoff.sourceSnapshotDigest, taxonomyDigest: session.classificationHandoff.taxonomyDigest, classificationContextDigest: session.classificationHandoff.classificationContextDigest, provesEligibility: false } : null,
    catalogBinding: governedWorkspaceBinding(session?.workspace?.home, ["harness-registry.yaml", "catalogs/organization", "catalogs/builtin"]),
    ontologyBinding: governedWorkspaceBinding(session?.workspace?.home, ["ontology"]),
    matchPolicyBinding: governedWorkspaceBinding(session?.workspace?.home, ["policies/matcher"]),
    advisorPolicyBinding: governedWorkspaceBinding(session?.workspace?.home, ["policies/advisor"]),
    advisorProfile: advisor,
    operationIntentDigest: digest({ intentDigest: session?.intent?.digest ?? digest(session?.intent?.text ?? ""), scenario: normalizedPlan.scenario ?? null, goal: normalizedPlan.goal ?? session?.intent?.text ?? null }),
    locale: boundLocale,
    presentationTemplateVersion: templateVersion,
    authority: { engineOwned: true, hostMayMutate: false, advisorMayMutate: false, chatMemoryAuthoritative: false }
  };
  core.evolutionContextDigest = digest(core);
  core.contextId = safeId(`context-${core.evolutionContextDigest.slice(7, 23)}`);
  return core;
}

export function createProfessionalReasoning({ session, stage, subject, authoritative, reasoningMap, locale, templateVersion }) {
  const evolutionContext = createEvolutionContextBinding({ session, renderModel: authoritative, locale, templateVersion });
  if (session?.evolutionContext && CONTEXT_STABLE_REASONING_STAGES.has(stage)) {
    const inspection = inspectEvolutionContextBinding({ session, renderModel: authoritative, locale, templateVersion });
    if (inspection.status === "REEVALUATION_REQUIRED") {
      const error = new Error(`Evolution Context changed in ${inspection.changedFields.join(", ")}; create an explicit re-evaluation Session before continuing.`);
      error.name = "EvolutionContextError";
      error.code = "EVOLUTION_CONTEXT_CHANGED_REEVALUATION_REQUIRED";
      error.nextAction = "create-explicit-evolution-context-reevaluation";
      error.contextInspection = inspection;
      throw error;
    }
  }
  const sourceOutcomeExplanation = createSourceOutcomeExplanation({ stage, authoritative, reasoningMap });
  const architectureAssessment = createHarnessArchitectureAssessment({ subject, authoritative, sourceOutcomeExplanation });
  const professionalAnalysis = createHarnessProfessionalAnalysis({ subject, authoritative, reasoningMap, sourceOutcomeExplanation, architectureAssessment });
  return { evolutionContext, sourceOutcomeExplanation, architectureAssessment, professionalAnalysis };
}

export function createSourceOutcomeExplanation({ stage, authoritative = {}, reasoningMap = {} }) {
  if (!outcomeAvailable(stage, authoritative, reasoningMap)) return null;
  const outcome = normalizeProfessionalOutcome(authoritative, reasoningMap);
  const reasons = unique([
    ...array(authoritative.reasons),
    authoritative.review?.summary,
    authoritative.review?.rationale,
    ...array(authoritative.review?.reasons),
    ...array(authoritative.eligibility?.reasons),
    ...array(reasoningMap.entries).map((entry) => entry.rationale)
  ]);
  const failedCriteria = unique([
    ...array(authoritative.eligibility?.checks).filter((item) => item?.status && !["PASS", "PASSED", "ELIGIBLE"].includes(String(item.status).toUpperCase())).map((item) => item.id ?? item.criterion),
    ...array(authoritative.review?.remainingBlockers),
    ...array(authoritative.blockers)
  ]);
  const missingEvidence = unique([
    ...array(authoritative.missingEvidence),
    ...array(authoritative.review?.missingEvidence),
    ...array(authoritative.review?.suggestedActions).filter((item) => /evidence|证据/i.test(String(item)))
  ]);
  const counterEvidence = unique([
    ...array(authoritative.counterEvidence),
    ...array(authoritative.review?.counterEvidence),
    ...array(authoritative.review?.findings).filter((item) => ["warning", "error", "blocker"].includes(String(item?.severity).toLowerCase())).map((item) => item.conclusion ?? item.reasons).flat()
  ]);
  const alternatives = unique([
    ...array(authoritative.alternatives),
    ...array(authoritative.candidates).map((item) => typeof item === "string" ? item : item?.id ?? item?.name),
    ...array(reasoningMap.entries).flatMap((entry) => array(entry.alternatives))
  ]);
  const core = {
    schema: SOURCE_OUTCOME_EXPLANATION_SCHEMA,
    outcome,
    suitableForHarnessEvolution: POSITIVE_OUTCOMES.has(outcome),
    reasons: reasons.length ? reasons : [defaultOutcomeReason(outcome)],
    failedCriteria,
    missingEvidence,
    counterEvidence,
    alternatives,
    nextAction: outcomeNextAction(outcome),
    proposalAllowed: POSITIVE_OUTCOMES.has(outcome),
    authority: { engineDerived: true, advisorAdvisoryOnly: true, hostAuthored: false }
  };
  core.outcomeExplanationDigest = digest(core);
  return core;
}

export function createHarnessArchitectureAssessment({ subject = {}, authoritative = {}, sourceOutcomeExplanation }) {
  if (!sourceOutcomeExplanation) return null;
  const proposal = authoritative.proposal ?? authoritative.report?.proposal ?? {};
  const assets = array(proposal.proposedAssets ?? authoritative.assets).map((asset) => ({
    kind: asset?.kind ?? "NOT_REPORTED",
    id: asset?.metadata?.id ?? asset?.id ?? subject.id ?? "NOT_REPORTED",
    version: asset?.metadata?.version ?? asset?.version ?? "NOT_REPORTED",
    dependencies: unique(asset?.spec?.dependencies ?? asset?.dependencies),
    inScope: unique(asset?.spec?.boundary?.inScope ?? asset?.boundary?.inScope),
    outOfScope: unique(asset?.spec?.boundary?.outOfScope ?? asset?.boundary?.outOfScope)
  }));
  const core = {
    schema: HARNESS_ARCHITECTURE_ASSESSMENT_SCHEMA,
    outcome: sourceOutcomeExplanation.outcome,
    assets,
    moduleBoundaries: unique(assets.map((asset) => asset.kind)),
    dependencies: unique(assets.flatMap((asset) => asset.dependencies)),
    qualityAttributes: unique(authoritative.qualityAttributes ?? proposal.qualityAttributes ?? proposal.acceptance?.qualityAttributes),
    compatibilityImpact: authoritative.compatibilityImpact ?? proposal.compatibilityImpact ?? "NOT_REPORTED",
    blastRadius: authoritative.blastRadius ?? proposal.blastRadius ?? (assets.length ? "PROPOSED_ASSETS_ONLY" : "NO_ASSET_CHANGE"),
    migration: authoritative.migration ?? proposal.migration ?? "NOT_REQUIRED_OR_NOT_REPORTED",
    rollback: authoritative.rollback ?? proposal.rollback ?? "PRESERVE_PRIOR_IMMUTABLE_ASSET_AND_SUPERSEDE_WITH_A_LATER_VERSION",
    authority: { engineDerived: true, hostAuthored: false }
  };
  core.architectureAssessmentDigest = digest(core);
  return core;
}

export function createHarnessProfessionalAnalysis({ subject = {}, authoritative = {}, reasoningMap = {}, sourceOutcomeExplanation, architectureAssessment }) {
  if (!sourceOutcomeExplanation) return null;
  const proposal = authoritative.proposal ?? authoritative.report?.proposal ?? {};
  const capabilities = array(reasoningMap.entries).map((entry, index) => ({
    capabilityId: entry.harnessCapability ?? `${subject.id ?? "capability"}-${index + 1}`,
    sourceEvidence: [{ sourceId: entry.sourceId, sourceRef: entry.sourceRef, sourceDigest: entry.sourceDigest, evidenceIds: unique(entry.evidenceIds), observedFacts: unique(entry.observedFacts) }],
    extractionMethod: ["STATIC_SOURCE_INGESTION", "EVIDENCE_GRAPH_NORMALIZATION", "ELIGIBILITY_GATE", "ONTOLOGY_MAPPING", "CATALOG_RETRIEVAL_AND_SCORING", "DECISION_AGGREGATION", "ARCHITECTURE_AND_EVALUATION_ASSESSMENT"],
    rationale: entry.rationale,
    confidence: normalizeConfidence(entry.uncertainty),
    counterEvidence: unique(entry.counterEvidence),
    alternatives: unique(entry.alternatives),
    catalogRelationship: entry.catalogRelationship,
    evaluationCoverage: authoritative.review?.evaluationSufficiency?.status ?? proposal.evaluationCoverage?.status ?? proposal.evaluationPack?.spec?.status ?? "NOT_REPORTED",
    knownLimits: unique(authoritative.limitations ?? authoritative.review?.limitations)
  }));
  const core = {
    schema: HARNESS_PROFESSIONAL_ANALYSIS_SCHEMA,
    subject: persistedJson(subject),
    outcome: sourceOutcomeExplanation.outcome,
    capabilities,
    extractionAlgorithm: ["STATIC_SOURCE_INGESTION", "SNAPSHOT_AND_REDACTION", "EVIDENCE_GRAPH", "ELIGIBILITY_GATE", "ONTOLOGY_MAPPING", "CATALOG_CANDIDATE_SCORING", "DECISION_AGGREGATION", "PROPOSAL_AND_EVALUATION_DESIGN"],
    catalogComparison: {
      recommendation: sourceOutcomeExplanation.outcome,
      existingRelationship: unique(capabilities.map((item) => item.catalogRelationship)),
      alternatives: sourceOutcomeExplanation.alternatives,
      rejectedAlternatives: sourceOutcomeExplanation.alternatives.map((alternative) => ({ alternative, reason: "LOWER_EVIDENCE_OR_POLICY_FIT_THAN_THE_ENGINE_RECOMMENDATION" }))
    },
    architectureAssessmentDigest: architectureAssessment?.architectureAssessmentDigest ?? null,
    confidence: aggregateConfidence(capabilities),
    counterEvidence: sourceOutcomeExplanation.counterEvidence,
    evaluationCoverage: unique(capabilities.map((item) => item.evaluationCoverage)),
    knownLimits: unique(capabilities.flatMap((item) => item.knownLimits)),
    authority: { engineDerived: true, advisorAdvisoryOnly: true, hostAuthored: false, sourceExecution: false }
  };
  core.professionalAnalysisDigest = digest(core);
  return core;
}

export function createAgentHostBoundaryContract() {
  const core = {
    schema: AGENT_HOST_BOUNDARY_CONTRACT_SCHEMA,
    version: 1,
    hostAllowed: ["conversation-ui", "attachment-and-workspace-selection", "digital-expert-loading", "declared-mcp-transport", "exact-canonical-rendering", "non-authoritative-progress-transport", "explicit-user-choice-transport"],
    hostForbidden: ["harness-reasoning", "translation", "summarization", "rewriting", "supplementation", "omission", "reordering", "business-decision", "visible-chain-of-thought", "tool-selection-narration", "chat-memory-state-recovery", "host-memory-mutation", "host-overview-generation", "host-skill-mutation", "host-artifact-write", "post-operation-housekeeping", "approval-inference", "publication", "catalog-mutation"],
    mcpOwns: ["protocol-transport", "capability-negotiation", "session-coordination", "delivery-receipts", "operation-jobs", "recovery"],
    engineOwns: ["source-ingestion", "evidence-graph", "eligibility", "matching", "scoring", "professional-reasoning", "architecture-assessment", "outcome", "templates", "state", "gates", "proposal", "evaluation", "review", "publication", "catalog"],
    adapterPolicy: "GENERATED_FROM_ONE_AGENT_NEUTRAL_CORE_TRANSPORT_MAPPING_ONLY",
    unsupportedHostPolicy: "FAIL_CLOSED_BEFORE_GOVERNED_LIFECYCLE"
  };
  core.boundaryContractDigest = digest(core);
  return core;
}

export function createHostConformanceProfile(host) {
  const capabilities = unique(host?.capabilities);
  const missingCapabilities = REQUIRED_GOVERNED_HOST_CAPABILITIES.filter((item) => !capabilities.includes(item));
  const core = {
    schema: HOST_CONFORMANCE_PROFILE_SCHEMA,
    hostId: String(host?.id ?? "unverified-host"),
    hostVersion: String(host?.version ?? "unverified"),
    level: host?.level ?? "TRANSPORT_ONLY",
    capabilities,
    requiredCapabilities: [...REQUIRED_GOVERNED_HOST_CAPABILITIES],
    missingCapabilities,
    exactRendering: capabilities.includes("exact-canonical-markdown-rendering"),
    completeTurnReceipt: capabilities.includes("complete-turn-digest-receipt"),
    fixedLocale: capabilities.includes("fixed-locale-rendering"),
    governedOperationInterception: capabilities.includes("governed-operation-interception"),
    workspaceRecovery: capabilities.includes("workspace-state-recovery"),
    status: host?.level === "GOVERNED_HUMAN_GATE_COMPATIBLE" && missingCapabilities.length === 0 ? "CONFORMANT" : "NONCONFORMANT"
  };
  core.hostConformanceDigest = digest(core);
  return core;
}

export function deriveBoundLocale(session, model = {}) {
  if (["zh-CN", "en"].includes(session?.evolutionContext?.locale)) return session.evolutionContext.locale;
  const declared = model.locale ?? session?.intent?.locale ?? session?.interaction?.host?.locale;
  if (["zh-CN", "en"].includes(declared)) return declared;
  const sample = [session?.intent?.text, session?.intent?.goal, session?.intent?.summary, model?.goal, model?.proposal?.goal].filter(Boolean).join(" ");
  return /[\u3400-\u9fff]/.test(sample) ? "zh-CN" : "en";
}

function governedWorkspaceBinding(home, roots) {
  const files = [];
  if (home && fs.existsSync(home)) {
    for (const relative of roots) collectFiles(home, path.join(home, relative), files);
  }
  const entries = files.sort().map((file) => ({ path: path.relative(home, file), digest: digest(fs.readFileSync(file)) }));
  return { files: entries, digest: digest(entries), empty: entries.length === 0 };
}

function digestSourceBinding(sourceBinding) {
  const declared = persistedJson(sourceBinding ?? {});
  const paths = [];
  collectDeclaredSourcePaths(declared, paths);
  const snapshots = [...new Set(paths)].sort().map((sourcePath) => {
    const absolute = path.resolve(sourcePath);
    if (!fs.existsSync(absolute)) return { ref: sourcePath, status: "DECLARED_NOT_LOCAL" };
    const files = [];
    collectFiles(absolute, absolute, files);
    return {
      ref: sourcePath,
      status: "STATIC_SNAPSHOT",
      files: files.sort().map((file) => ({ path: path.relative(absolute, file) || path.basename(file), digest: digest(fs.readFileSync(file)) }))
    };
  });
  return digest({ declared, snapshots });
}

function collectDeclaredSourcePaths(value, output) {
  if (typeof value === "string") {
    if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDeclaredSourcePaths(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value)) collectDeclaredSourcePaths(item, output);
}

function collectFiles(home, target, files) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) {
    files.push(target);
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(target).sort()) collectFiles(home, path.join(target, entry), files);
}

function advisorIdentity(plan, model) {
  const sources = plan?.sources ?? {};
  return {
    mode: sources.advisor ?? model.advisor ?? "auto",
    profileId: sources.model ?? model.model ?? "auto",
    userOwnedConfigurationRequired: true,
    hostModelExcluded: true,
    credentialsIncluded: false
  };
}

function outcomeAvailable(stage, model, reasoningMap) {
  return stage === "PROPOSAL_REVIEW_PRESENTATION"
    || stage === "PROPOSAL_APPROVAL_DECISION"
    || stage === "EVIDENCE_REPORT_PRESENTATION"
    || stage === "BLOCKER_PRESENTATION"
    || Boolean(model.proposal || model.review || model.eligibility || model.decision || array(reasoningMap.entries).some((entry) => entry?.harnessOutcome));
}

function normalizeProfessionalOutcome(model, reasoningMap) {
  const values = [model.outcome, model.decision, model.proposal?.decision, model.review?.verdict, model.review?.status, ...array(reasoningMap.entries).map((entry) => entry?.harnessOutcome)].filter(Boolean).map((item) => String(item).toUpperCase());
  const value = values.join(" ");
  if (/NOT_HARNESS_ELIGIBLE|INELIGIBLE|NOT[_ -]?SUITABLE/.test(value)) return "NOT_HARNESS_ELIGIBLE";
  if (/NEED_MORE_EVIDENCE|INSUFFICIENT|MORE[_ -]?EVIDENCE/.test(value)) return "NEED_MORE_EVIDENCE";
  if (/NO_CHANGE|ALREADY[_ -]?COVERED/.test(value)) return "NO_CHANGE";
  if (/REJECT|INVALID|UNSAFE/.test(value)) return "REJECT";
  if (/REUSE/.test(value)) return "REUSE_EXISTING";
  if (/COMPOS/.test(value)) return "COMPOSE_NEW_BUNDLE";
  if (/EVOLV|REVIS/.test(value)) return "EVOLVE_EXISTING";
  return "PROPOSE_NEW_PROFILE";
}

function defaultOutcomeReason(outcome) {
  const reasons = {
    REUSE_EXISTING: "The existing Catalog asset already satisfies the evidence-bound capability.",
    EVOLVE_EXISTING: "The Source provides evidence-backed capability beyond the current immutable Catalog asset.",
    COMPOSE_NEW_BUNDLE: "The required capability is best satisfied by composing compatible published assets.",
    PROPOSE_NEW_PROFILE: "No existing asset provides sufficient evidence and policy fit for the reusable capability.",
    NOT_HARNESS_ELIGIBLE: "The Source does not describe a reusable, bounded, verifiable Harness capability.",
    NEED_MORE_EVIDENCE: "The available Source evidence cannot support a safe Harness conclusion.",
    NO_CHANGE: "The current Catalog already covers the supported capability without a material gap.",
    REJECT: "The proposed evolution conflicts with evidence, policy, or accepted product boundaries."
  };
  return reasons[outcome];
}

function outcomeNextAction(outcome) {
  if (POSITIVE_OUTCOMES.has(outcome)) return "REVIEW_PROFESSIONAL_ANALYSIS_AND_PROPOSAL";
  if (outcome === "NEED_MORE_EVIDENCE") return "PROVIDE_DECLARED_MISSING_EVIDENCE";
  if (outcome === "NOT_HARNESS_ELIGIBLE") return "PRESERVE_SOURCE_AS_EVIDENCE_WITHOUT_PROPOSAL";
  if (outcome === "NO_CHANGE") return "PRESERVE_CURRENT_CATALOG_WITHOUT_DUPLICATION";
  return "REVIEW_REJECTION_AND_SAFE_ALTERNATIVES";
}

function normalizeConfidence(value) {
  if (typeof value === "number") return Math.max(0, Math.min(1, value));
  const text = String(value ?? "").toUpperCase();
  if (/HIGH|SUFFICIENT|PASS|READY/.test(text)) return 0.9;
  if (/MEDIUM|PARTIAL/.test(text)) return 0.6;
  if (/LOW|INSUFFICIENT|UNCERTAIN|NOT_REPORTED/.test(text)) return 0.3;
  return 0.5;
}

function aggregateConfidence(capabilities) {
  if (!capabilities.length) return 0;
  return Number((capabilities.reduce((sum, item) => sum + item.confidence, 0) / capabilities.length).toFixed(4));
}

function array(value) {
  return Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
}

function unique(value) {
  return [...new Set(array(value).flat(Infinity).filter((item) => item !== undefined && item !== null && item !== "").map((item) => typeof item === "string" ? item : JSON.stringify(item)))].map((item) => {
    if (!String(item).startsWith("{") && !String(item).startsWith("[")) return item;
    try { return JSON.parse(item); } catch { return item; }
  });
}
