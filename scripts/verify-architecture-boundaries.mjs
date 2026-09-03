import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const failures = [];

const anchors = [
  ["src/v3/constants.mjs", "PACKAGE_ROOT", "Engine"],
  ["src/v3/workspace.mjs", "initializeWorkspace", "Workspace"],
  ["src/v3/cli.mjs", "handleV3Command", "CLI"],
  ["src/v3/hub.mjs", "serveHubV3", "Harness Hub"],
  ["src/v3/reasoning.mjs", "collectEvidence", "Source Ingestion"],
  ["src/v3/utils.mjs", "redact", "Snapshot/Redaction"],
  ["src/v3/constants.mjs", "EVIDENCE_GRAPH_SCHEMA", "Evidence Graph"],
  ["src/v4/classification/taxonomy.mjs", "SEMANTIC_FOUNDATION_SCHEMA", "Semantic Foundation/Taxonomy Resolution"],
  ["src/v3/reasoning.mjs", "MatchPolicyPack", "MatchPolicyPack"],
  ["src/v3/reasoning.mjs", "eligibilityGate", "Eligibility Gate"],
  ["src/v3/reasoning.mjs", "retrieveAndScore", "Candidate Retrieval/Scoring"],
  ["src/v3/reasoning.mjs", "function decide", "Decision Aggregator"],
  ["src/v3/advisor.mjs", "AdvisorPolicyPack", "AdvisorPolicyPack"],
  ["src/v3/advisor.mjs", "runAdvisor", "GLM Advisor"],
  ["schemas/harness-asset-v3.schema.json", "HarnessComponent", "HarnessComponent"],
  ["schemas/harness-asset-v3.schema.json", "HarnessProfile", "HarnessProfile"],
  ["schemas/harness-asset-v3.schema.json", "HarnessBundle", "HarnessBundle/Export"],
  ["src/v3/lifecycle.mjs", "buildEvaluationPack", "EvaluationPack"],
  ["src/v3/review.mjs", "reviewProposal", "Proposal Review Engine"],
  ["src/v3/lifecycle.mjs", "approveProposal", "Proposal Lifecycle"],
  ["src/v3/schema.mjs", "validateDocument", "Schema Validator"],
  ["src/v3/catalog.mjs", "publishCatalog", "Catalog Publisher/Optional Signing"],
  ["src/v3/cli.mjs", "validateRegistryV3", "Registry"],
  ["src/v3/migration.mjs", "rollbackMigration", "Migration/Rollback"],
  ["src/v3/comparison.mjs", "ingestComparisonPackage", "Comparison Evidence Intake/Immutable Store"],
  ["src/v3/comparison.mjs", "scoreComparison", "Comparability/Paired Scoring"],
  ["src/v3/comparison.mjs", "rescoreComparison", "Versioned Rescoring"],
  ["src/v3/calibration.mjs", "runCalibration", "Matching/Proposal Calibration"]
];

const agentAnchors = [
  ["digital-expert/core/instructions.md", "Ask exactly one shortest missing question", "Digital Expert Core"],
  ["digital-expert/expert-manifest.yaml", "evopilot-harness-digital-expert/v1", "Digital Expert Artifact"],
  ["src/v4/engine-adapter.mjs", "executeV3Operation", "Structured Engine Adapter"],
  ["src/v4/operation-server/server.mjs", "StdioMcpServer", "Harness Operation Server"],
  ["src/v4/session/store.mjs", "AGENT_SESSION_SCHEMA", "AgentOperationSession"],
  ["src/v4/protocol/tools.mjs", "authorize_proposal_publication", "Agent Protocol Tools"],
  ["digital-expert/conformance/generic-host.mjs", "generic-agent-host-conformance", "Independent Generic Agent Host"],
  ["src/v4/interaction/business-projection.mjs", "evopilot-harness-business-presentation/v2", "Engine-owned Presentation Sandbox"],
  ["src/v4/interaction/professional-reasoning.mjs", "createHarnessProfessionalAnalysis", "Professional Source-to-Harness Reasoning"],
  ["src/v4/interaction/professional-reasoning.mjs", "createEvolutionContextBinding", "Evolution Context Binding"],
  ["src/v4/interaction/professional-reasoning.mjs", "createAgentHostBoundaryContract", "Third-party Agent Host Boundary"]
];

const classificationAnchors = [
  ["docs/architecture/adr/0005-source-first-business-classification.md", "Accepted", "v4.5 source-first classification ADR"],
  ["schemas/source-descriptor-v1.schema.json", "ORDERED_ATTACHMENT_SET", "Unified SourceDescriptor contract"],
  ["src/v4/classification/source-descriptor.mjs", "BOUNDED_READ_ONLY_GIT", "Bounded Source Resolver"],
  ["src/v4/classification/source-descriptor.mjs", "SOURCE_GIT_LFS_UNSUPPORTED", "GitHub static-acquisition blocker boundary"],
  ["src/v4/source/static-text.mjs", "STATIC_EVIDENCE_EXTRACTORS", "Static document Source extraction allowlist"],
  ["src/v4/classification/taxonomy.mjs", "taxonomy-c14n/v1", "Taxonomy canonicalization"],
  ["src/v4/classification/source-concept.mjs", "taxonomyExposed: false", "Taxonomy-blind Source hypothesis"],
  ["src/v4/classification/classifier.mjs", "open-world-taxonomy-classifier/v1", "Multi-signal classification retrieval"],
  ["src/v4/classification/classifier.mjs", "taxonomy-decision-aggregate/v1", "Deterministic classification authority"],
  ["src/v4/classification/advisor.mjs", "invocationCount: 1", "Single-call advisory evidence"],
  ["src/v4/classification/engine.mjs", "classificationProvesEligibility: false", "Classification authority boundary"],
  ["src/v4/classification/session-store.mjs", "createAgentSession", "Explicit classification-to-Harness handoff"],
  ["schemas/classification-analysis-receipt-v1.schema.json", "executionEvidenceOnly", "Classification analysis idempotency receipt"],
  ["src/v4/session/store.mjs", "PRE_V45_SESSION_UNSUPPORTED", "Fresh v4.5 Session reset boundary"],
  ["src/v4/protocol/tools.mjs", "start_project_classification", "Classification MCP entry"],
  ["src/v4/protocol/tools.mjs", "continue_classification_to_harness", "Classification handoff MCP gate"],
  ["scripts/validate-e2e-source-portfolio.mjs", "sourceMutation: false", "Target-bound read-only Source Portfolio acceptance"],
  ["scripts/run-live-github-discovery.mjs", "candidateOutputAvailableDuringSelection: false", "Candidate-blind live GitHub discovery"],
  ["scripts/freeze-github-discovery-oracle.mjs", "candidateOutputsVisible: false", "Candidate-blind expected-result oracle"]
];

const learningAnchors = [
  ["src/v3/learning.mjs", "ingestLearningDocument", "Curriculum/Research/Contribution Immutable Intake"],
  ["src/v3/learning.mjs", "createEvidenceRunManifest", "Evidence Run Manifest"],
  ["src/v3/learning.mjs", "createCurriculumSnapshot", "Curriculum Snapshot"],
  ["src/v3/learning.mjs", "scoreProfessionalCompleteness", "Professional Completeness"],
  ["src/v3/learning.mjs", "rescoreProfessionalCompleteness", "Append-only Completeness Rescoring"],
  ["schemas/domain-role-proposal-v1.schema.json", "DomainRoleProposal", "Domain and Role Proposal"]
];

for (const [file, needle, moduleName] of anchors) mustContain(file, needle, `${moduleName} boundary anchor is missing`);
for (const [file, needle, moduleName] of agentAnchors) mustContain(file, needle, `${moduleName} boundary anchor is missing`);
for (const [file, needle, moduleName] of learningAnchors) mustContain(file, needle, `${moduleName} boundary anchor is missing`);
for (const [file, needle, moduleName] of classificationAnchors) mustContain(file, needle, `${moduleName} boundary anchor is missing`);

mustContain("AGENTS.md", "28 enforced Engine module boundaries", "root agent instructions must reference the complete Engine module boundary set");
mustContain("docs/architecture/adr/0001-product-and-module-boundaries.md", "Accepted", "module boundary ADR must remain accepted");
mustContain("docs/architecture/adr/0003-controlled-comparative-evidence.md", "Accepted", "controlled comparative evidence ADR must remain accepted");
mustContain("docs/architecture/adr/0001-product-and-module-boundaries.md", "superseded for v4.5.0 and later by [ADR 0005]", "module 8 replacement must remain explicit");
mustContain("governance/roadmap.yaml", '"roadmapFamily": "evopilot-series-agentic-evolution"', "the accepted Harness Roadmap contract must remain installed");
mustContain("governance/roadmap.yaml", '"harness-must-not-execute-evopilot-loops"', "the Roadmap must preserve the producer/control-plane boundary");
mustContain("AGENTS.md", "Continue implementation only for `ALIGNED`", "agent instructions must stop Roadmap deviations before implementation");
mustContain("package.json", '"roadmap:check"', "package scripts must expose static Roadmap validation");
mustContain("package.json", '"roadmap:release"', "package scripts must expose the release-version Roadmap gate");
mustContain("src/v3/workspace.mjs", 'mode: "read-only"', "Engine must remain read-only");
mustContain("src/v3/workspace.mjs", "mutationAllowed: false", "Engine mutation must remain forbidden");
mustContain("src/v3/hub.mjs", 'request.method !== "GET"', "Harness Hub HTTP surface must remain read-only");
mustContain("src/v3/feedback.mjs", "proposalCreated: false", "feedback processing must not create Proposals in v3.3");
mustContain("src/v3/feedback.mjs", "assetMutation: false", "feedback processing must not mutate Harness assets in v3.3");
mustContain("src/v3/feedback.mjs", "sourceExecution: false", "feedback processing must not execute source projects");
mustContain("src/v3/catalog.mjs", '["HarnessComponent", "HarnessProfile", "HarnessBundle"]', "feedback packages and effectiveness reports must remain outside Catalog asset discovery");
mustContain("src/v3/reasoning.mjs", "EVIDENCE_EXTRACTION_COMMANDS", "source evidence tools must use an explicit allowlist");
mustContain("src/v3/lifecycle.mjs", 'proposal.status !== "APPROVED"', "publication must require an approved Proposal");
mustContain("src/v3/lifecycle.mjs", '"catalogs/organization/assets"', "publication must target Organization Catalog assets");
mustContain("src/v3/advisor.mjs", "deterministicDecisionPreserved: true", "Advisor must preserve the deterministic decision");
mustContain("src/v3/review.mjs", "mayApprove: false", "Proposal Review Engine must not approve Proposals");
mustContain("package.json", '"verify:architecture"', "package scripts must expose architecture verification");
mustContain("package.json", "npm run verify:architecture", "npm run check must execute architecture verification");
mustContain("package.json", '"digital-expert:check"', "package scripts must expose deterministic Digital Expert validation");
const packageVersion = JSON.parse(read("package.json")).version;
if (!/^4\.(?:[2-9]|\d{2,})\.\d+$/.test(packageVersion)) failures.push("Professional Asset Learning must remain available in the approved v4.2+ product line");
mustContain("src/index.mjs", 'argv[0] === "mcp" && argv[1] === "serve"', "CLI must expose the local MCP process entry");
mustContain("src/v4/constants.mjs", "assertExternalWorkspace", "Agent state must remain outside the Release");
mustContain("src/v4/session/store.mjs", "CONFIRM_OPERATION_PLAN", "Plan confirmation must be explicit and digest-bound");
mustContain("src/v4/session/store.mjs", "APPROVE_PROPOSAL", "Proposal approval must be explicit and digest-bound");
mustContain("src/v4/session/store.mjs", "AUTHORIZE_PUBLICATION", "publication must be a separate explicit decision");
mustContain("src/v4/session/store.mjs", "AUTHORIZE_PLAN_PUBLICATION", "maintenance publication must have a separate operation authorization");
mustContain("src/v4/session/store.mjs", "ACCEPT_OPERATION_RECEIPT", "interrupted operation recovery must support immutable receipt reconciliation");
mustContain("src/v4/session/store.mjs", "CONFIRM_RETRY_UNCHANGED_OPERATION", "interrupted retries must require an unchanged Workspace digest and exact token");
mustContain("src/v4/engine-adapter.mjs", "evopilot-harness-engine-operation-receipt/v1", "planned Engine operations must persist idempotency receipts");
mustContain("src/v4/protocol/tools.mjs", "authorize_plan_publication_operation", "Agent protocol must expose the maintenance publication authorization gate");
mustContain("src/v4/protocol/tools.mjs", "resolve_interrupted_operation", "Agent protocol must expose fail-closed interruption reconciliation");
mustContain("schemas/agent-operation-session-v1.schema.json", "OPERATION_AUTHORIZATION_REQUIRED", "Session schema must declare the maintenance publication authorization state");
mustContain("src/v4/session/store.mjs", "CLEANUP_OWNERSHIP_UNCERTAIN", "cleanup must fail closed on uncertain ownership");
mustContain("src/v4/operation-server/server.mjs", "networkListening: false", "stdio MCP must not claim a network listener");
mustContain("digital-expert/core/policies.yaml", "sourceExecution", "Digital Expert must preserve the source execution prohibition");
mustContain("src/v4/interaction/business-projection.mjs", "createBusinessInteractionProjection", "Protocol v3 business presentation must remain Engine-owned");
mustContain("src/v4/interaction/business-projection.mjs", "hostAuthored: false", "Host must not author Harness business semantics");
mustContain("src/v4/interaction/business-projection.mjs", "evopilot-harness-business-presentation/v2", "the Engine-owned presentation sandbox must use the reviewed v2 template");
mustContain("src/v4/interaction/professional-reasoning.mjs", "REQUIRED_GOVERNED_HOST_CAPABILITIES", "governed third-party Hosts must pass one executable capability contract");
mustContain("src/v4/interaction/professional-reasoning.mjs", "NOT_HARNESS_ELIGIBLE", "professional reasoning must explain unsuitable Sources");
mustContain("src/v4/interaction/professional-reasoning.mjs", "NEED_MORE_EVIDENCE", "professional reasoning must explain insufficient evidence");
mustContain("src/v4/session/store.mjs", "createEvolutionContextBinding", "Sessions must bind the authoritative Evolution Context before Plan presentation");
mustContain("src/v4/session/store.mjs", "reevaluateAgentSession", "explicit Evolution Context reevaluation must preserve the prior Session and create a new governed Plan");
mustContain("src/v4/protocol/tools.mjs", "reevaluate_operation_session", "the Agent protocol must expose append-only explicit Evolution Context reevaluation");
mustContain("src/v4/agent-host-installer.mjs", '"src/v4/interaction/professional-reasoning.mjs"', "the isolated WorkBuddy runtime integrity digest must bind professional reasoning code");
mustContain("src/v4/interaction/controller.mjs", "wholeTurnDelivered: true", "canonical presentation receipts must bind the complete visible turn");
mustContain("src/v4/interaction/controller.mjs", "hostAuthoredGovernedProseCount: 0", "canonical presentation receipts must reject Host-authored governed prose");
mustContain("schemas/canonical-presentation-delivery-receipt-v1.schema.json", '"hostAuthoredGovernedProseCount": { "const": 0 }', "canonical receipt schema must enforce zero Host-authored prose");
mustContain("src/v4/session/store.mjs", "recordBusinessViewDelivery", "Protocol v3 must bind exact Business View delivery");
mustContain("src/v4/session/store.mjs", "historicalBusinessViewsFabricated: false", "v2 migration must not fabricate historical Business Views");
mustContain("src/v4/session/store.mjs", "PRE_V45_SESSION_UNSUPPORTED", "v4.5 must reject superseded pre-v4.5 Session representations");
mustContain("docs/architecture/adr/0004-deterministic-business-centric-interaction.md", "Host-authored summaries", "ADR 0004 must preserve deterministic business semantics across Hosts");
mustContain(".agents/skills/evopilot-harness-guided-operator/SKILL.md", "Compatibility Alias", "legacy Guided Operator must not retain a second authority");
mustContain("src/v3/comparison.mjs", "sourceExecution: false", "comparison processing must never execute source projects");
mustContain("src/v3/comparison.mjs", "assetMutation: false", "comparison processing must not mutate Harness assets");
mustContain("src/v3/comparison.mjs", "mayRollback: false", "comparison recommendations must not perform rollback");
mustContain("src/v3/comparison.mjs", "priorReportsMutated: false", "rescoring must preserve prior reports");
mustContain("src/v3/calibration.mjs", "activePolicyMutated: false", "calibration must not activate or mutate policy");
mustContain("src/v4/session/store.mjs", "EVIDENCE_REVIEW_REQUIRED", "Agent sessions must stop for comparison and calibration report review");
mustContain("src/v4/session/store.mjs", "ACKNOWLEDGE_${type}_REVIEW:${reportId}:${expectedReportDigest}", "evidence review acknowledgement must bind its type, report id, and digest");
mustContain("src/v4/protocol/tools.mjs", "acknowledge_evidence_report_review", "Agent protocol must expose evidence report review acknowledgement");
mustContain("src/v3/lifecycle.mjs", "proposal-comparison-assessment-drift", "approval and publication must reject comparison snapshot drift");
mustContain("src/v3/review.mjs", "controlled-comparison", "Proposal Review must include the deterministic controlled-comparison gate");
mustContain("package.json", "policies", "the npm runtime allowlist must include comparison policies");
mustContain("package.json", "schemas", "the npm runtime allowlist must include comparison schemas");

mustNotContain("src/v3/advisor.mjs", "approveProposal", "Advisor must not approve Proposals");
mustNotContain("src/v3/advisor.mjs", "publishProposal", "Advisor must not publish Proposals");
mustNotMatch("src/v3/advisor.mjs", /\b(?:execFileSync|execSync|spawn|spawnSync)\b/, "Advisor must not execute commands");
mustNotContain("src/v3/review.mjs", "approveProposal", "Proposal Review Engine must not approve Proposals");
mustNotContain("src/v3/review.mjs", "publishProposal", "Proposal Review Engine must not publish Proposals");
mustNotMatch("src/v3/review.mjs", /\b(?:execFileSync|execSync|spawn|spawnSync)\b/, "Proposal Review Engine must not execute commands");
mustNotMatch("src/v3/reasoning.mjs", /\b(?:execSync|spawn|spawnSync)\b|shell\s*:\s*true/, "source ingestion must not use shell or process execution outside the reviewed tool path");
mustNotMatch("src/v3/lifecycle.mjs", /(?:writeYaml|writeJson|writeFileSync|copyFileSync)\([^\n]*catalogs\/builtin/, "Proposal lifecycle must not write Built-in Catalog assets");
mustNotMatch("src/v3/migration.mjs", /(?:writeYaml|writeJson|writeFileSync|copyFileSync)\([^\n]*catalogs\/builtin/, "migration must not write Built-in Catalog assets");
mustNotMatch("src/v4/operation-server/server.mjs", /from\s+["']node:(?:http|https|net|tls|dgram|child_process)["']/, "Operation Server must remain local stdio and may not spawn or listen");
mustNotMatch("src/v4/mcp/stdio-server.mjs", /from\s+["']node:(?:http|https|net|tls|dgram|child_process)["']/, "MCP transport must remain stdio-only");
mustNotMatch("src/v4/interaction/professional-reasoning.mjs", /from\s+["']node:(?:http|https|net|tls|dgram|child_process)["']|\b(?:execFileSync|execSync|spawn|spawnSync)\b/, "professional reasoning must not access the network or execute Source commands");
for (const file of ["src/v4/classification/taxonomy.mjs", "src/v4/classification/source-concept.mjs", "src/v4/classification/classifier.mjs", "src/v4/classification/engine.mjs", "src/v4/classification/session-store.mjs"]) {
  mustNotMatch(file, /from\s+["']node:(?:http|https|net|tls|dgram|child_process)["']|\b(?:execFileSync|execSync|spawn|spawnSync)\b/, "classification must not access the network or execute Source commands");
  mustNotMatch(file, /localeCompare|toLocaleLowerCase|toLocaleUpperCase/, "classification ordering and case normalization must remain locale-independent");
  mustNotContain(file, "publishProposal", "classification must not publish a Proposal");
  mustNotContain(file, "approveProposal", "classification must not approve a Proposal");
}
mustNotMatch("src/v4/classification/source-descriptor.mjs", /from\s+["']node:(?:http|https|net|tls|dgram)["']|\b(?:execSync|spawn|spawnSync)\b|shell\s*:\s*true/, "Source Resolver may use bounded argument-vector Git only and must not open arbitrary network or shell execution");
mustContain("src/v4/classification/source-descriptor.mjs", 'GIT_TERMINAL_PROMPT: "0"', "Source Resolver must disable interactive credential prompting");
mustContain("src/v4/classification/source-descriptor.mjs", 'sourceExecution: false', "Source Resolver must preserve Source non-execution");
mustNotMatch("src/v4/source/static-text.mjs", /from\s+["']node:(?:http|https|net|tls|dgram)["']|\b(?:execSync|spawn|spawnSync)\b|shell\s*:\s*true/, "static document extraction must remain offline and argument-vector only");
const staticExtractors = [...read("src/v4/source/static-text.mjs").matchAll(/extract\("([^"]+)"/g)].map((match) => match[1]);
for (const tool of staticExtractors) if (!["pdftotext", "unzip"].includes(tool)) failures.push(`unreviewed v4.5 static Source extractor: ${tool}`);
mustNotMatch("src/v4/session/store.mjs", /(?:writeFileSync|appendFileSync|renameSync|rmSync)\([^\n]*(?:models\.json|source-project)/, "Agent sessions must not mutate model configuration or source projects");
mustNotMatch("src/v4/operation-server/server.mjs", /(?:writeFileSync|appendFileSync|renameSync|rmSync)\([^\n]*(?:models\.json|source-project)/, "Operation Server must not mutate model configuration or source projects");
mustNotContain("src/v3/comparison.mjs", "approveProposal", "comparison evidence must not approve Proposals");
mustNotContain("src/v3/comparison.mjs", "publishProposal", "comparison evidence must not publish Proposals");
mustNotContain("src/v3/calibration.mjs", "approveProposal", "calibration must not approve Proposals");
mustNotContain("src/v3/calibration.mjs", "publishProposal", "calibration must not publish Proposals");
mustNotMatch("src/v3/comparison.mjs", /\b(?:execFileSync|execSync|spawn|spawnSync)\b/, "comparison evidence must not execute commands");
mustNotMatch("src/v3/calibration.mjs", /\b(?:execFileSync|execSync|spawn|spawnSync)\b/, "calibration must not execute commands");
mustNotMatch("src/v3/comparison.mjs", /(?:writeYaml|writeJson|writeFileSync|copyFileSync)\([^\n]*catalogs\/(?:builtin|organization)/, "comparison evidence must not write Catalog assets");
mustNotMatch("src/v3/calibration.mjs", /(?:writeYaml|writeJson|writeFileSync|copyFileSync)\([^\n]*catalogs\/(?:builtin|organization)/, "calibration must not write Catalog assets");
mustNotMatch("src/v3/learning.mjs", /from\s+["']node:(?:http|https|net|tls|dgram|child_process)["']|\b(?:execFileSync|execSync|spawn|spawnSync)\b/, "professional learning must not access network or execute code");
mustNotMatch("src/v3/learning.mjs", /(?:writeYaml|writeJson|writeFileSync|copyFileSync)\([^\n]*catalogs\/(?:builtin|organization)/, "professional learning must not write Catalog assets");
mustNotContain("src/v3/learning.mjs", "approveProposal", "professional learning must not approve Proposals");
mustNotContain("src/v3/learning.mjs", "publishProposal", "professional learning must not publish Proposals");

const reasoning = read("src/v3/reasoning.mjs");
const allowedTools = new Set(["git", "pdftotext", "unzip", "curl"]);
const invokedTools = [...reasoning.matchAll(/(?:execFileSync|extractCommand)\("([^"]+)"/g)].map((match) => match[1]);
for (const tool of invokedTools) {
  if (!allowedTools.has(tool)) failures.push(`unreviewed source evidence command: ${tool}`);
}

for (const assetRoot of ["assets/v3", "harnesses", "published"]) {
  for (const file of walkFiles(path.join(root, assetRoot))) {
    if (/\/(?:Users|home)\/[^\s"']+|howbuy_project/i.test(fs.readFileSync(file, "utf8"))) {
      failures.push(`Evidence Source path leaked into Harness asset tree: ${path.relative(root, file)}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Architecture boundary verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Architecture boundary verification passed (${anchors.length}/28 Engine-module anchors, ${agentAnchors.length} Agent-operation enforcement anchors, ${learningAnchors.length}/6 v4.2 professional-learning anchors, ${classificationAnchors.length} v4.5 classification anchors).`);

function read(relativePath) {
  const file = path.join(root, relativePath);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function mustContain(relativePath, needle, message) {
  const content = read(relativePath);
  if (!content) failures.push(`${relativePath} is missing or empty`);
  else if (!content.includes(needle)) failures.push(`${message}: ${relativePath} does not contain ${needle}`);
}

function mustNotContain(relativePath, needle, message) {
  if (read(relativePath).includes(needle)) failures.push(`${message}: ${relativePath} contains ${needle}`);
}

function mustNotMatch(relativePath, pattern, message) {
  if (pattern.test(read(relativePath))) failures.push(`${message}: ${relativePath}`);
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(target) : [target];
  });
}
