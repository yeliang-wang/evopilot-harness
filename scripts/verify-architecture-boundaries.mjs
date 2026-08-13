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
  ["src/v3/reasoning.mjs", "OntologyPack", "OntologyPack"],
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
  ["src/v3/migration.mjs", "rollbackMigration", "Migration/Rollback"]
];

for (const [file, needle, moduleName] of anchors) mustContain(file, needle, `${moduleName} boundary anchor is missing`);

mustContain("AGENTS.md", "The 24 accepted module boundaries", "root agent instructions must reference all module boundaries");
mustContain("docs/architecture/adr/0001-product-and-module-boundaries.md", "Accepted", "module boundary ADR must remain accepted");
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

mustNotContain("src/v3/advisor.mjs", "approveProposal", "Advisor must not approve Proposals");
mustNotContain("src/v3/advisor.mjs", "publishProposal", "Advisor must not publish Proposals");
mustNotMatch("src/v3/advisor.mjs", /\b(?:execFileSync|execSync|spawn|spawnSync)\b/, "Advisor must not execute commands");
mustNotContain("src/v3/review.mjs", "approveProposal", "Proposal Review Engine must not approve Proposals");
mustNotContain("src/v3/review.mjs", "publishProposal", "Proposal Review Engine must not publish Proposals");
mustNotMatch("src/v3/review.mjs", /\b(?:execFileSync|execSync|spawn|spawnSync)\b/, "Proposal Review Engine must not execute commands");
mustNotMatch("src/v3/reasoning.mjs", /\b(?:execSync|spawn|spawnSync)\b|shell\s*:\s*true/, "source ingestion must not use shell or process execution outside the reviewed tool path");
mustNotMatch("src/v3/lifecycle.mjs", /(?:writeYaml|writeJson|writeFileSync|copyFileSync)\([^\n]*catalogs\/builtin/, "Proposal lifecycle must not write Built-in Catalog assets");
mustNotMatch("src/v3/migration.mjs", /(?:writeYaml|writeJson|writeFileSync|copyFileSync)\([^\n]*catalogs\/builtin/, "migration must not write Built-in Catalog assets");

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

console.log(`Architecture boundary verification passed (${anchors.length}/24 module anchors).`);

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
