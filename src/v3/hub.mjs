import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { PACKAGE_ROOT } from "./constants.mjs";
import { discoverAssets, validateCatalog } from "./catalog.mjs";
import { digest, readYaml, walkFiles, writeJson } from "./utils.mjs";
import { workspaceStatus } from "./workspace.mjs";
import { feedbackSummary } from "./feedback.mjs";

export function buildHubSnapshot(home) {
  const assets = discoverAssets([path.join(home, "catalogs/organization/assets"), path.join(home, "catalogs/builtin/assets")]);
  const proposals = walkFiles(path.join(home, "evolution-runs"), (file) => path.basename(file) === "proposal.yaml").map((file) => {
    try { return { file, proposal: readYaml(file) }; } catch { return null; }
  }).filter(Boolean).map(({ file, proposal }) => ({
    proposalId: proposal.proposalId,
    status: proposal.status,
    decision: proposal.decision,
    assetCount: proposal.proposedAssets?.length ?? 0,
    blockers: proposal.blockers ?? [],
    advisorStatus: proposal.advisor?.status,
    reviewStatus: proposal.review?.status,
    reviewVerdict: proposal.review?.verdict,
    reviewReportDigest: proposal.review?.reportDigest,
    reviewReportPath: proposal.review?.reportPath,
    nextAction: proposal.nextAction,
    assetDelta: proposal.assetDeltaProposal ? {
      id: proposal.assetDeltaProposal.metadata.id,
      version: proposal.assetDeltaProposal.metadata.version,
      status: proposal.assetDeltaProposal.spec.status,
      publicationAllowed: proposal.assetDeltaProposal.spec.publicationAllowed,
      deltaCount: proposal.assetDeltaProposal.spec.deltas.length,
      operations: countBy(proposal.assetDeltaProposal.spec.deltas.map((item) => item.operation)),
      impactStatus: proposal.assetDeltaProposal.spec.deltas.length ? proposal.assetDeltaProposal.spec.deltas.every((item) => item.impact?.status === "READY") ? "READY" : "BLOCKED" : "NOT_APPLICABLE",
      compatibility: countBy(proposal.assetDeltaProposal.spec.deltas.map((item) => item.impact?.compatibility?.status)),
      blastRadius: countBy(proposal.assetDeltaProposal.spec.deltas.map((item) => item.impact?.blastRadius?.level)),
      rollback: countBy(proposal.assetDeltaProposal.spec.deltas.map((item) => item.impact?.rollback?.status))
    } : null,
    evaluationCoverage: proposal.evaluationPack ? {
      apiVersion: proposal.evaluationPack.apiVersion,
      status: proposal.evaluationPack.spec.status,
      caseCount: proposal.evaluationPack.spec.cases?.length ?? 0,
      reviewedCount: proposal.evaluationPack.spec.cases?.filter((item) => item.reviewStatus === "approved").length ?? 0,
      polarities: countBy(proposal.evaluationPack.spec.cases?.map((item) => item.polarity).filter(Boolean) ?? []),
      validatorVersions: proposal.evaluationPack.spec.validators?.map((item) => `${item.id}@${item.version}`) ?? [],
      scorerVersions: proposal.evaluationPack.spec.scorers?.map((item) => `${item.id}@${item.version}`) ?? []
    } : null,
    path: file
  }));
  const catalogRoot = fs.existsSync(path.join(home, "catalogs/organization/CATALOG.md")) ? path.join(home, "catalogs/organization") : path.join(home, "catalogs/builtin");
  const catalogValidation = validateCatalog(catalogRoot);
  const catalogLock = fs.existsSync(path.join(catalogRoot, "catalog.lock.json")) ? JSON.parse(fs.readFileSync(path.join(catalogRoot, "catalog.lock.json"), "utf8")) : { entries: [] };
  const packs = [
    ...packSummaries(path.join(home, "ontology"), "OntologyPack"),
    ...packSummaries(path.join(home, "policies/matcher"), "MatchPolicyPack"),
    ...packSummaries(path.join(home, "policies/advisor"), "AdvisorPolicyPack")
  ];
  const advisorRuns = walkFiles(path.join(home, "evolution-runs"), (file) => path.basename(file) === "advisor-result.json").map((file) => {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  }).filter(Boolean);
  const reviewRuns = walkFiles(path.join(home, "evolution-runs"), (file) => path.basename(file) === "semantic-review-result.json").map((file) => {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  }).filter(Boolean);
  const usage = [...advisorRuns, ...reviewRuns].reduce((result, run) => ({ inputTokens: result.inputTokens + Number(run.usage?.inputTokens ?? 0), outputTokens: result.outputTokens + Number(run.usage?.outputTokens ?? 0), totalTokens: result.totalTokens + Number(run.usage?.totalTokens ?? 0) }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  const records = assets.map((record) => ({ kind: record.asset.kind, id: record.asset.metadata.id, name: record.asset.metadata.name, version: record.asset.metadata.version, lifecycle: record.asset.metadata.lifecycle, description: record.asset.metadata.description, domain: record.asset.spec.classification?.domain, digest: record.digest, file: record.file }));
  return {
    schema: "evopilot-harness-hub-snapshot/v3",
    status: catalogValidation.status === "VALIDATED" ? "READY" : "ATTENTION",
    generatedAt: new Date().toISOString(),
    workspace: workspaceStatus(home),
    catalog: {
      catalogId: catalogLock.catalogId,
      catalogPath: path.join(catalogRoot, "CATALOG.md"),
      catalogDigest: catalogValidation.catalogDigest,
      entryCount: catalogLock.entryCount ?? records.length,
      status: catalogValidation.status,
      entries: (catalogLock.entries ?? []).map((entry) => ({ ...entry, name: entry.id, domain: entry.classification?.domain, digest: entry.assetDigest, status: entry.lifecycle }))
    },
    assetCounts: countBy(records.map((record) => record.kind)),
    assets: records,
    harnesses: records.filter((record) => record.kind === "HarnessProfile").map((record) => ({ ...record, lifecycleStatus: record.lifecycle, commands: { evolve: `evopilot-harness produce --source-project /path/to/project --workspace ${home} --json` } })),
    proposals,
    evolutions: proposals.map((proposal) => ({ evolutionId: proposal.proposalId, status: proposal.status, targetHarnessId: proposal.decision, reviewStatus: proposal.reviewStatus, reviewVerdict: proposal.reviewVerdict, reviewReportDigest: proposal.reviewReportDigest, assetDelta: proposal.assetDelta, evaluationCoverage: proposal.evaluationCoverage, nextAction: proposal.nextAction ?? (proposal.reviewVerdict === "READY_FOR_HUMAN_APPROVAL" ? "proposal-approve" : proposal.reviewVerdict ? `review:${proposal.reviewVerdict.toLowerCase()}` : proposal.blockers.length ? proposal.blockers[0] : "proposal-review") })),
    governancePacks: packs,
    llmUsage: { runCount: advisorRuns.length + reviewRuns.length, advisorRunCount: advisorRuns.length, reviewRunCount: reviewRuns.length, ...usage },
    evaluation: evaluationSummary(home),
    feedback: feedbackSummary(home),
    sourceTypes: [
      { id: "source-project", label: "Source project", description: "Local project code, manifests, architecture, and design files." },
      { id: "source-root", label: "Project corpus", description: "Valid projects under a root, grouped by v3 reasoning outcomes." },
      { id: "github-repository", label: "GitHub repository", description: "Commit-resolved repository snapshot in the workspace cache." },
      { id: "attachment", label: "Attachment", description: "PDF, PPTX, DOCX, or text evidence with extraction and redaction." },
      { id: "runtime-log", label: "Production log", description: "Redacted runtime evidence correlated to Harness decisions." },
      { id: "execution-feedback-package", label: "Execution feedback package", description: "Approved, redacted, immutable-Bundle-bound Outcome, Process, Safety, and Cost evidence." },
      { id: "operator-note", label: "Operator note", description: "Goal or contextual note; never sufficient by itself for publication." }
    ],
    lifecycleCommands: ["workspace init", "produce", "feedback inspect", "feedback validate", "feedback process", "feedback aggregate", "feedback report", "proposal inspect", "proposal validate", "proposal review", "proposal review-inspect", "proposal approve", "proposal publish", "asset v3-validate", "catalog v3-publish", "catalog v3-sign", "registry v3-validate", "eval v3-run"],
    nextAction: proposals.some((proposal) => proposal.status === "REVIEW_REQUIRED") ? "review-proposals" : "produce-or-review-assets"
  };
}

export function writeHubSnapshot(home, out) {
  const snapshot = buildHubSnapshot(home);
  writeJson(path.resolve(out), snapshot);
  return { ...snapshot, snapshotPath: path.resolve(out) };
}

export function serveHubV3(home, { host = "127.0.0.1", port = 4176 } = {}) {
  const uiRoot = path.join(PACKAGE_ROOT, "ui/harness-hub");
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
    if (request.method !== "GET") return json(response, 405, { status: "method-not-allowed", allowed: ["GET"] });
    if (url.pathname === "/api/health") return json(response, 200, { status: "ok", service: "evopilot-harness-hub", apiVersion: "v3" });
    if (["/api/hub/snapshot", "/api/v3/snapshot"].includes(url.pathname)) return json(response, 200, buildHubSnapshot(home));
    const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const file = path.resolve(uiRoot, relative);
    if (!file.startsWith(`${uiRoot}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(response, 404, { status: "not-found" });
    response.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
    fs.createReadStream(file).pipe(response);
  });
  server.listen(port, host, () => process.stdout.write(`Harness Hub v3 listening on http://${host}:${port}\n`));
  return server;
}

function packSummaries(root, kind) {
  return walkFiles(root, (file) => /\.ya?ml$/i.test(file)).map((file) => {
    try { return { file, document: readYaml(file) }; } catch { return null; }
  }).filter((item) => item?.document?.kind === kind).map(({ file, document }) => ({ kind, id: document.metadata.id, version: document.metadata.version, lifecycle: document.metadata.lifecycle, digest: digest(document), file }));
}

function evaluationSummary(home) {
  const packs = walkFiles(path.join(home, "evaluations"), (file) => /\.ya?ml$/i.test(file)).map((file) => {
    try { return readYaml(file); } catch { return null; }
  }).filter((item) => item?.kind === "EvaluationPack");
  return {
    packCount: packs.length,
    readyCount: packs.filter((pack) => pack.spec.status === "READY").length,
    insufficientCount: packs.filter((pack) => pack.spec.status === "INSUFFICIENT_EVAL_EVIDENCE").length,
    versionCounts: countBy(packs.map((pack) => pack.apiVersion)),
    positiveCaseCount: packs.flatMap((pack) => pack.spec.cases ?? []).filter((item) => item.polarity === "positive").length,
    negativeCaseCount: packs.flatMap((pack) => pack.spec.cases ?? []).filter((item) => item.polarity === "negative").length
  };
}

function countBy(values) {
  return Object.fromEntries([...new Set(values)].map((value) => [value, values.filter((item) => item === value).length]));
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function contentType(file) {
  return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" })[path.extname(file)] ?? "application/octet-stream";
}
