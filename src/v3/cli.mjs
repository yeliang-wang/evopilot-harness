import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { EVIDENCE_GRAPH_SCHEMA, PACKAGE_ROOT, REGISTRY_SCHEMA } from "./constants.mjs";
import { DEFAULT_DOCTOR_TIMEOUT_MS, diagnoseModel, inspectModels, runAdvisor, validateRecommendation } from "./advisor.mjs";
import { discoverAssets, generateSigningKey, publishCatalog, signFile, validateAssets, validateCatalog, verifyFile } from "./catalog.mjs";
import { approveProposal, createProposal, inspectProposal, publishProposal } from "./lifecycle.mjs";
import { serveHubV3, writeHubSnapshot } from "./hub.mjs";
import { applyV2Migration, planV2Migration, rollbackMigration } from "./migration.mjs";
import { collectEvidence, reasonCorpus, reasonEvidence } from "./reasoning.mjs";
import { inspectProposalReview, reviewProposal } from "./review.mjs";
import { validateDocument, validateFile, validateTree } from "./schema.mjs";
import { booleanOption, digest, option, parseCli, print, readYaml, safeId, usage, walkFiles, writeJson, writeYaml } from "./utils.mjs";
import { defaultHarnessHome } from "./constants.mjs";
import { initializeWorkspace, requireWorkspace, workspaceStatus } from "./workspace.mjs";

const V3_COMMANDS = new Set(["workspace", "produce", "proposal", "ontology", "policy", "migrate", "keys"]);

export async function handleV3Command(argv) {
  const args = parseCli(argv);
  const [group, action, id] = args.positionals;
  const explicitV3 = V3_COMMANDS.has(group) || action?.startsWith("v3-") || (group === "eval" && action === "v3-run") || (group === "registry" && action?.startsWith("v3-")) || (group === "llm" && action === "v3-models");
  if (!explicitV3) return { handled: false };
  try {
    const code = await dispatch(args, group, action, id);
    return { handled: true, exitCode: code ?? 0 };
  } catch (error) {
    const result = {
      schema: "evopilot-harness-error/v3",
      status: "FAILED",
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.name : "Error"
    };
    if (args.options.json) print(result, true);
    else process.stderr.write(`${result.error}\n`);
    return { handled: true, exitCode: error?.name === "UsageError" ? 2 : 1 };
  }
}

async function dispatch(args, group, action, id) {
  const home = path.resolve(option(args, "workspace", defaultHarnessHome()));
  if (group === "workspace" && action === "init") return output(args, initializeWorkspace(home, { force: booleanOption(args, "force") }));
  if (group === "workspace" && action === "status") return output(args, workspaceStatus(home));
  if (group === "keys" && action === "generate") {
    requireWorkspace(home);
    const result = generateSigningKey(path.resolve(option(args, "private-key", path.join(home, "keys/catalog-signing-private.pem"))), path.resolve(option(args, "public-key", path.join(home, "keys/catalog-signing-public.pem"))));
    return output(args, { schema: "evopilot-harness-key-generation/v3", status: "GENERATED", ...result });
  }
  requireWorkspace(home);
  if (group === "asset" && action === "v3-validate") {
    const roots = assetRoots(args, home);
    const result = validateAssets(roots);
    return output(args, result, result.status === "VALIDATED" ? 0 : 2);
  }
  if (group === "asset" && action === "v3-test") {
    const validation = validateAssets(assetRoots(args, home));
    const evaluation = runV3Evaluation(home);
    const status = validation.status === "VALIDATED" && evaluation.status === "PASSED" ? "PASSED" : "FAILED";
    return output(args, { schema: "evopilot-harness-asset-test/v3", status, validation, evaluation }, status === "PASSED" ? 0 : 2);
  }
  if (group === "asset" && action === "v3-inspect") {
    const records = discoverAssets(assetRoots(args, home));
    const record = records.find((item) => item.asset.metadata.id === id && (!option(args, "kind") || item.asset.kind === option(args, "kind")));
    if (!record) throw usage(`Asset ${id} was not found.`);
    return output(args, { schema: "evopilot-harness-asset-inspect/v3", status: "FOUND", file: record.file, digest: record.digest, asset: record.asset });
  }
  if (group === "asset" && action === "v3-sign") return output(args, signCommand(args));
  if (group === "asset" && action === "v3-verify") {
    const result = verifyCommand(args);
    return output(args, result, result.status === "VERIFIED" ? 0 : 2);
  }
  if (group === "catalog" && action === "v3-publish") {
    const result = publishCatalog({ roots: assetRoots(args, home), out: path.resolve(option(args, "out", path.join(home, "catalogs/organization"))), catalogId: option(args, "catalog-id", "organization"), generatedAt: option(args, "generated-at", new Date().toISOString()) });
    return output(args, result, result.status === "PUBLISHED" ? 0 : 2);
  }
  if (group === "catalog" && action === "v3-validate") {
    const result = validateCatalog(path.resolve(option(args, "source", path.join(home, "catalogs/organization"))));
    return output(args, result, result.status === "VALIDATED" ? 0 : 2);
  }
  if (group === "catalog" && action === "v3-sign") {
    const catalogFile = path.join(path.resolve(option(args, "source", path.join(home, "catalogs/organization"))), "CATALOG.md");
    return output(args, signFile(catalogFile, requiredOption(args, "private-key"), option(args, "signature", `${catalogFile}.sig.json`)));
  }
  if (group === "catalog" && action === "v3-verify") {
    const catalogFile = path.join(path.resolve(option(args, "source", path.join(home, "catalogs/organization"))), "CATALOG.md");
    const result = verifyFile(catalogFile, requiredOption(args, "public-key"), option(args, "signature", `${catalogFile}.sig.json`));
    return output(args, result, result.status === "VERIFIED" ? 0 : 2);
  }
  if (group === "catalog" && action === "v3-diff") return output(args, catalogDiff(requiredOption(args, "left"), requiredOption(args, "right")));
  if (group === "registry" && action === "v3-validate") {
    const result = validateRegistryV3(path.resolve(option(args, "registry", path.join(home, "harness-registry.yaml"))));
    return output(args, result, result.status === "VALIDATED" ? 0 : 2);
  }
  if (group === "registry" && action === "v3-sign") return output(args, signFile(path.resolve(option(args, "registry", path.join(home, "harness-registry.yaml"))), requiredOption(args, "private-key"), option(args, "signature")));
  if (group === "registry" && action === "v3-verify") {
    const file = path.resolve(option(args, "registry", path.join(home, "harness-registry.yaml")));
    const result = verifyFile(file, requiredOption(args, "public-key"), option(args, "signature", `${file}.sig.json`));
    return output(args, result, result.status === "VERIFIED" ? 0 : 2);
  }
  if (["ontology", "policy"].includes(group)) return packCommand(args, group, action, home);
  if (group === "migrate" && action === "v2-to-v3") {
    const source = path.resolve(option(args, "source", path.join(PACKAGE_ROOT, "harnesses")));
    const result = booleanOption(args, "apply") ? applyV2Migration(source, home) : planV2Migration(source, home);
    return output(args, result, ["READY", "MIGRATED"].includes(result.status) ? 0 : 2);
  }
  if (group === "migrate" && action === "rollback") return output(args, rollbackMigration(home, id ?? requiredOption(args, "migration-id")));
  if (group === "produce") return produce(args, home);
  if (group === "proposal" && action === "inspect") return output(args, inspectProposal(home, id ?? requiredOption(args, "proposal-id")));
  if (group === "proposal" && action === "review") {
    const result = await reviewProposal(home, id ?? requiredOption(args, "proposal-id"), args);
    return output(args, result, result.status === "BLOCKED" ? 2 : 0);
  }
  if (group === "proposal" && action === "review-inspect") return output(args, inspectProposalReview(home, id ?? requiredOption(args, "proposal-id")));
  if (group === "proposal" && action === "approve") {
    const result = approveProposal(home, id ?? requiredOption(args, "proposal-id"), { confirmedBy: option(args, "confirmed-by"), confirmation: option(args, "confirmation"), evaluationReviewed: booleanOption(args, "evaluation-reviewed") });
    return output(args, result, result.status === "APPROVED" ? 0 : 2);
  }
  if (group === "proposal" && action === "publish") {
    const result = publishProposal(home, id ?? requiredOption(args, "proposal-id"));
    return output(args, result, result.status === "PUBLISHED" ? 0 : 2);
  }
  if (group === "llm" && action === "v3-models") {
    const file = path.resolve(option(args, "models-file", process.env.EVOPILOT_HARNESS_LLM_MODELS_FILE || path.join(PACKAGE_ROOT, "models.json")));
    return output(args, inspectModels(file, option(args, "model")));
  }
  if (group === "llm" && action === "v3-doctor") {
    const file = path.resolve(option(args, "models-file", process.env.EVOPILOT_HARNESS_LLM_MODELS_FILE || path.join(PACKAGE_ROOT, "models.json")));
    const result = await diagnoseModel(file, option(args, "model"), Number(option(args, "timeout-ms", DEFAULT_DOCTOR_TIMEOUT_MS)));
    return output(args, result, result.status === "READY" ? 0 : 2);
  }
  if (group === "hub" && action === "v3-snapshot") return output(args, writeHubSnapshot(home, option(args, "out", path.join(home, "cache/hub-snapshot.json"))));
  if (group === "hub" && action === "v3-serve") {
    serveHubV3(home, { host: option(args, "host", "127.0.0.1"), port: Number(option(args, "port", 4176)) });
    return await new Promise(() => {});
  }
  if (group === "eval" && action === "v3-run") {
    const result = runV3Evaluation(home);
    return output(args, result, result.status === "PASSED" ? 0 : 2);
  }
  throw usage("Unknown v3 command. Use workspace, produce, proposal inspect|review|review-inspect|approve|publish, asset v3-*, catalog v3-*, registry v3-*, ontology, policy, migrate, llm v3-models|v3-doctor, or eval v3-run.");
}

async function produce(args, home) {
  if (option(args, "source-root")) {
    const corpus = reasonCorpus(args, home);
    const proposals = [];
    for (const group of corpus.groups) {
      const grouped = mergeCorpusEvidence(home, group);
      const reasoned = reasonEvidence(grouped.graph, home);
      writeJson(path.join(grouped.runRoot, "reasoning-result.json"), reasoned.result);
      const advisor = await runAdvisor({ args, home, graph: reasoned.graph, reasoning: reasoned.result, knowledge: reasoned.knowledge, runRoot: grouped.runRoot });
      const proposal = createProposal({ home, runRoot: grouped.runRoot, graph: reasoned.graph, reasoning: reasoned.result, advisor });
      proposals.push({ groupId: group.groupId, projects: group.projects, ...proposal });
    }
    const blocked = proposals.some((proposal) => proposal.status === "BLOCKED");
    const result = {
      ...corpus,
      status: blocked ? "BLOCKED" : "REVIEW_REQUIRED",
      proposals,
      advisorSummary: summarizeAdvisorRuns(proposals.map((proposal) => proposal.advisor)),
      nextAction: blocked ? "repair-advisor-and-rerun" : "review-corpus-proposals"
    };
    return output(args, result, blocked ? 2 : 0);
  }
  const evidence = collectEvidence(args, home);
  const reasoned = reasonEvidence(evidence.graph, home);
  writeJson(path.join(evidence.runRoot, "evidence-graph.json"), reasoned.graph);
  writeJson(path.join(evidence.runRoot, "reasoning-result.json"), reasoned.result);
  const advisor = await runAdvisor({ args, home, graph: reasoned.graph, reasoning: reasoned.result, knowledge: reasoned.knowledge, runRoot: evidence.runRoot });
  const proposal = createProposal({ home, runRoot: evidence.runRoot, graph: reasoned.graph, reasoning: reasoned.result, advisor });
  const result = {
    schema: "evopilot-harness-produce-result/v3",
    status: proposal.status,
    runId: evidence.runId,
    evidenceGraph: { path: path.join(evidence.runRoot, "evidence-graph.json"), digest: reasoned.graph.graphDigest, nodeCount: reasoned.graph.nodeCount },
    reasoning: reasoned.result,
    advisor,
    proposal,
    nextAction: proposal.nextAction
  };
  return output(args, result, proposal.status === "BLOCKED" ? 2 : 0);
}

function summarizeAdvisorRuns(advisors) {
  const runs = advisors.filter(Boolean);
  return {
    runCount: runs.length,
    succeededCount: runs.filter((advisor) => advisor.status === "SUCCEEDED").length,
    failedCount: runs.filter((advisor) => ["FAILED", "REJECTED", "UNAVAILABLE"].includes(advisor.status)).length,
    skippedCount: runs.filter((advisor) => advisor.status === "SKIPPED").length,
    usage: runs.reduce((total, advisor) => ({
      inputTokens: total.inputTokens + Number(advisor.usage?.inputTokens ?? 0),
      outputTokens: total.outputTokens + Number(advisor.usage?.outputTokens ?? 0),
      totalTokens: total.totalTokens + Number(advisor.usage?.totalTokens ?? 0)
    }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  };
}

function mergeCorpusEvidence(home, group) {
  const runId = safeId(`corpus-${group.groupId}-${new Date().toISOString()}-${Math.random().toString(16).slice(2, 10)}`);
  const runRoot = path.join(home, "evolution-runs", runId);
  const snapshotRoot = path.join(home, "evidence", runId);
  fs.mkdirSync(runRoot, { recursive: true });
  fs.mkdirSync(snapshotRoot, { recursive: true });
  const graphs = group.runIds.map((sourceRunId) => JSON.parse(fs.readFileSync(path.join(home, "evolution-runs", sourceRunId, "evidence-graph.json"), "utf8")));
  const nodes = graphs.flatMap((graph) => graph.nodes).map((node, index) => {
    const evidenceId = `evidence-${String(index + 1).padStart(4, "0")}`;
    const snapshotRef = path.join(snapshotRoot, `${evidenceId}.txt`);
    fs.writeFileSync(snapshotRef, node.excerpt, "utf8");
    return { ...node, evidenceId, snapshotRef };
  });
  const graph = {
    schema: EVIDENCE_GRAPH_SCHEMA,
    runId,
    createdAt: new Date().toISOString(),
    redactionApplied: true,
    sourceCount: graphs.reduce((sum, item) => sum + item.sourceCount, 0),
    nodeCount: nodes.length,
    sources: graphs.flatMap((item) => item.sources),
    nodes
  };
  graph.graphDigest = digest(graph);
  writeJson(path.join(runRoot, "evidence-graph.json"), graph);
  writeJson(path.join(snapshotRoot, "manifest.json"), {
    schema: "evopilot-harness-redacted-snapshot/v1",
    runId,
    graphDigest: graph.graphDigest,
    files: nodes.map((node) => ({ evidenceId: node.evidenceId, snapshotRef: node.snapshotRef, excerptDigest: node.excerptDigest }))
  });
  return { runId, runRoot, graph };
}

function packCommand(args, group, action, home) {
  const kindMap = group === "ontology" ? { kind: "OntologyPack", directory: "ontology" } : { kind: option(args, "type", "matcher") === "advisor" ? "AdvisorPolicyPack" : "MatchPolicyPack", directory: `policies/${option(args, "type", "matcher")}` };
  if (action === "inspect") {
    const files = packFiles(path.join(home, kindMap.directory), kindMap.kind);
    return output(args, { schema: `evopilot-harness-${group}-inspect/v3`, status: files.length ? "READY" : "EMPTY", packs: files.map((file) => ({ file, document: readYaml(file), digest: digest(readYaml(file)) })) });
  }
  if (action === "validate") {
    const file = option(args, "file");
    const result = file ? validateFile(path.resolve(file)) : validateTree(path.join(home, kindMap.directory));
    return output(args, result, result.valid === false || result.status === "FAILED" ? 2 : 0);
  }
  if (action === "diff") return output(args, semanticDiff(readYaml(path.resolve(requiredOption(args, "left"))), readYaml(path.resolve(requiredOption(args, "right")))));
  if (action === "publish") {
    const source = path.resolve(requiredOption(args, "file"));
    const document = readYaml(source);
    if (document.kind !== kindMap.kind) throw usage(`Expected ${kindMap.kind}, got ${document.kind}.`);
    const validation = validateDocument(document, source);
    if (!validation.valid) return output(args, { status: "FAILED", validation }, 2);
    if (!["approved", "published"].includes(document.metadata.lifecycle)) return output(args, { status: "BLOCKED", blockers: ["pack-must-be-approved-before-publish"] }, 2);
    document.metadata.lifecycle = "published";
    const destination = path.join(home, kindMap.directory, `${document.metadata.id}@${document.metadata.version}.yaml`);
    if (fs.existsSync(destination)) return output(args, { status: "BLOCKED", blockers: ["immutable-pack-version-exists"], destination }, 2);
    writeYaml(destination, document);
    return output(args, { schema: `evopilot-harness-${group}-publication/v3`, status: "PUBLISHED", destination, digest: digest(document) });
  }
  throw usage(`Unknown ${group} action. Use inspect, validate, diff, or publish.`);
}

function validateRegistryV3(file) {
  const checks = [];
  let registry;
  try { registry = readYaml(file); } catch (error) { return { schema: "evopilot-harness-registry-validation/v3", status: "FAILED", file, checks: [{ id: "registry-file", status: "FAIL", evidence: [error.message] }] }; }
  checks.push({ id: "registry-schema", status: registry.schema === REGISTRY_SCHEMA ? "PASS" : "FAIL", evidence: [String(registry.schema)] });
  checks.push({ id: "registry-no-assets", status: registry.assets == null && registry.entries == null ? "PASS" : "FAIL", evidence: ["Registry lists Catalog roots only."] });
  const base = path.dirname(file);
  const catalogs = [];
  for (const reference of Array.isArray(registry.catalogs) ? registry.catalogs : []) {
    const root = path.resolve(base, reference.root);
    const catalogFile = path.join(root, "CATALOG.md");
    if (!reference.enabled) { catalogs.push({ id: reference.id, status: "DISABLED", root }); continue; }
    if (!fs.existsSync(catalogFile)) { checks.push({ id: `catalog:${reference.id}`, status: reference.id === "builtin" ? "FAIL" : "PASS", evidence: [`CATALOG.md missing at ${root}; empty writable Catalog is allowed only before first publish.`] }); catalogs.push({ id: reference.id, status: "EMPTY", root }); continue; }
    const result = validateCatalog(root);
    checks.push({ id: `catalog:${reference.id}`, status: result.status === "VALIDATED" ? "PASS" : "FAIL", evidence: [result.status] });
    catalogs.push({ id: reference.id, status: result.status, root, catalogDigest: result.catalogDigest });
  }
  return { schema: "evopilot-harness-registry-validation/v3", status: checks.every((check) => check.status === "PASS") ? "VALIDATED" : "FAILED", file, catalogCount: catalogs.length, catalogs, checks };
}

function runV3Evaluation(home) {
  const fixtures = walkFiles(path.join(PACKAGE_ROOT, "eval/v3"), (file) => file.endsWith(".json"));
  const cases = [];
  for (const file of fixtures) {
    const fixture = JSON.parse(fs.readFileSync(file, "utf8"));
    if (fixture.type === "advisor-contract") {
      const policyFile = packFiles(path.join(home, "policies/advisor"), "AdvisorPolicyPack").sort((left, right) => {
        const leftVersion = readYaml(left).metadata.version;
        const rightVersion = readYaml(right).metadata.version;
        return String(rightVersion).localeCompare(String(leftVersion), undefined, { numeric: true });
      })[0];
      if (!policyFile) throw new Error("No published AdvisorPolicyPack is installed.");
      const policy = readYaml(policyFile);
      const result = validateRecommendation(fixture.response, fixture.graph, policy);
      cases.push({ id: fixture.id, expected: fixture.expectedStatus, actual: result.status, passed: result.status === fixture.expectedStatus });
    } else if (fixture.type === "asset-schema") {
      const result = validateDocument(fixture.document);
      cases.push({ id: fixture.id, expected: fixture.expectedValid, actual: result.valid, passed: result.valid === fixture.expectedValid });
    } else if (fixture.type === "asset-file") {
      const result = validateFile(path.join(PACKAGE_ROOT, fixture.file));
      cases.push({ id: fixture.id, expected: fixture.expectedValid, actual: result.valid, passed: result.valid === fixture.expectedValid });
    } else if (fixture.type === "reasoning-contract") {
      const result = reasonEvidence(fixture.graph, home).result;
      cases.push({ id: fixture.id, expected: fixture.expectedDecision, actual: result.decision, passed: result.decision === fixture.expectedDecision });
    }
  }
  const reviewedCases = fixtures.map((file) => JSON.parse(fs.readFileSync(file, "utf8"))).filter((fixture) => fixture.reviewStatus === "approved").length;
  return {
    schema: "evopilot-harness-evaluation-report/v3",
    status: cases.length > 0 && cases.every((item) => item.passed) ? "PASSED" : "FAILED",
    scope: "contract-and-safety-regression",
    caseCount: cases.length,
    passedCount: cases.filter((item) => item.passed).length,
    failedCount: cases.filter((item) => !item.passed).length,
    cases,
    accuracyClaim: reviewedCases >= 20 ? "REVIEWED_CORPUS_AVAILABLE" : "INSUFFICIENT_EVAL_EVIDENCE",
    reviewedCaseCount: reviewedCases,
    note: "Passing contract fixtures does not establish open-domain matching accuracy."
  };
}

function signCommand(args) {
  return signFile(path.resolve(requiredOption(args, "file")), requiredOption(args, "private-key"), option(args, "signature"));
}

function verifyCommand(args) {
  return verifyFile(path.resolve(requiredOption(args, "file")), requiredOption(args, "public-key"), option(args, "signature"));
}

function assetRoots(args, home) {
  const source = option(args, "source");
  return source ? [path.resolve(source)] : [path.join(home, "catalogs/organization/assets"), path.join(home, "catalogs/builtin/assets")];
}

function requiredOption(args, name) {
  const value = option(args, name);
  if (!value) throw usage(`Missing required --${name}.`);
  return path.resolve(value);
}

function output(args, value, code = 0) {
  print(value, Boolean(args.options.json));
  return code;
}

function packFiles(root, kind) {
  return walkFiles(root, (file) => /\.ya?ml$/i.test(file)).filter((file) => {
    try { return readYaml(file)?.kind === kind; } catch { return false; }
  });
}

function semanticDiff(left, right) {
  const leftFlat = flatten(left);
  const rightFlat = flatten(right);
  const keys = new Set([...Object.keys(leftFlat), ...Object.keys(rightFlat)]);
  const changes = [...keys].filter((key) => JSON.stringify(leftFlat[key]) !== JSON.stringify(rightFlat[key])).map((key) => ({ path: key, before: leftFlat[key], after: rightFlat[key] }));
  return { schema: "evopilot-harness-semantic-diff/v3", status: "READY", changed: changes.length > 0, changeCount: changes.length, changes };
}

function catalogDiff(leftRoot, rightRoot) {
  const left = JSON.parse(fs.readFileSync(path.join(path.resolve(leftRoot), "catalog.lock.json"), "utf8"));
  const right = JSON.parse(fs.readFileSync(path.join(path.resolve(rightRoot), "catalog.lock.json"), "utf8"));
  const key = (entry) => `${entry.kind}:${entry.id}@${entry.version}`;
  const leftMap = new Map(left.entries.map((entry) => [key(entry), entry]));
  const rightMap = new Map(right.entries.map((entry) => [key(entry), entry]));
  return { schema: "evopilot-harness-catalog-diff/v3", status: "READY", added: [...rightMap.keys()].filter((item) => !leftMap.has(item)), removed: [...leftMap.keys()].filter((item) => !rightMap.has(item)), changed: [...rightMap.keys()].filter((item) => leftMap.has(item) && leftMap.get(item).assetDigest !== rightMap.get(item).assetDigest) };
}

function flatten(value, prefix = "$") {
  if (!value || typeof value !== "object") return { [prefix]: value };
  return Object.entries(value).reduce((result, [key, item]) => Object.assign(result, flatten(item, `${prefix}.${key}`)), {});
}
