#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const CATALOG_BLOCK = "evopilot-harness-catalog";
const DEFAULT_COMPATIBLE_EVOPILOT = ">=3.0.0";
const DEFAULT_DATA_ROOT = ".evopilot-harness";
const EVOLUTION_STATUSES = ["CREATED", "SOURCES_COLLECTED", "ANALYZED", "REVIEW_REQUIRED", "APPROVED", "PUBLISHED", "BLOCKED"];
const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");

async function main(argv) {
  const args = parseArgs(argv);
  const [group, action, idArg] = args.positionals;
  if (!group || args.options.help || args.options.h) {
    printHelp();
    return 0;
  }
  if (group === "catalog" && action === "publish") return publishCatalog(args);
  if (group === "catalog" && action === "validate") return validateCatalog(args);
  if (group === "harness" && action === "list") return listHarnesses(args);
  if (group === "harness" && action === "inspect") return inspectHarness(args, idArg);
  if (group === "harness" && action === "validate") return validateHarness(args, idArg);
  if (group === "harness" && action === "publish") return publishHarness(args, idArg);
  if (group === "harness" && action === "deprecate") return deprecateHarness(args, idArg);
  if (group === "evolution" && action === "list") return listEvolutions(args);
  if (group === "evolution" && action === "create") return createEvolution(args);
  if (group === "evolution" && action === "sources") return addEvolutionSources(args, idArg);
  if (group === "evolution" && action === "advance") return advanceEvolution(args, idArg);
  if (group === "evolution" && action === "review") return inspectEvolution(args, idArg);
  if (group === "evolution" && action === "approve") return approveEvolution(args, idArg);
  if (group === "evolution" && action === "publish") return publishEvolution(args, idArg);
  if (group === "evolution" && action === "impact") return evolutionImpact(args, idArg);
  if (group === "evolve") return oneClickEvolve(args);
  if (group === "hub" && action === "snapshot") return hubSnapshot(args);
  if (group === "hub" && action === "serve") return serveHub(args);
  throw usage("Use: evopilot-harness <catalog|harness|evolution|evolve> --help.");
}

function publishCatalog(args) {
  const source = path.resolve(stringOption(args, "source") ?? "harnesses");
  const out = path.resolve(stringOption(args, "out") ?? "published");
  const catalogId = safeId(stringOption(args, "catalog-id") ?? stringOption(args, "id") ?? "evopilot-public-harness-catalog");
  const names = stringListOption(args, "name");
  const packs = listHarnessPacks(source).filter((pack) => names.length === 0 || names.includes(pack.id));
  if (packs.length === 0) throw usage(`No Harness packs found in ${source}.`);
  fs.mkdirSync(out, { recursive: true });
  const entries = packs.map((pack) => publishPack(pack, out));
  const catalog = {
    catalogVersion: 1,
    catalogId,
    generatedAt: generatedTimestamp(args),
    compatibleEvopilot: stringOption(args, "compatible-evopilot") ?? DEFAULT_COMPATIBLE_EVOPILOT,
    entries
  };
  const markdown = renderCatalogMarkdown(catalog, entries);
  fs.writeFileSync(path.join(out, "CATALOG.md"), markdown, "utf8");
  const result = {
    schema: "evopilot-harness-catalog-publish-result/v1",
    status: "PUBLISHED",
    catalogId,
    out,
    templateCount: entries.length,
    entries,
    catalogDigest: digestText(markdown)
  };
  printResult(args, result, `catalog=${catalogId} templates=${entries.length} out=${out}`);
  return 0;
}

function validateCatalog(args) {
  const source = path.resolve(stringOption(args, "source") ?? stringOption(args, "path") ?? "published");
  const catalogPath = path.join(source, "CATALOG.md");
  const checks = [];
  if (!fs.existsSync(catalogPath)) {
    checks.push({ id: "catalog-md", status: "FAIL", evidence: [`missing=${catalogPath}`] });
  } else {
    checks.push({ id: "catalog-md", status: "PASS", evidence: [`path=${catalogPath}`] });
  }
  let catalog;
  if (fs.existsSync(catalogPath)) {
    const markdown = fs.readFileSync(catalogPath, "utf8");
    const block = extractCatalogBlock(markdown);
    if (block) {
      checks.push({ id: "catalog-block", status: "PASS", evidence: [`block=${CATALOG_BLOCK}`] });
      catalog = parseYaml(block);
    } else {
      checks.push({ id: "catalog-block", status: "FAIL", evidence: [`block=${CATALOG_BLOCK}`] });
    }
  }
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  for (const entry of entries) {
    const file = path.resolve(source, String(entry.path ?? ""));
    const ok = file.startsWith(source + path.sep) && fs.existsSync(file);
    checks.push({
      id: `entry:${entry.name}@${entry.version}`,
      status: ok ? "PASS" : "FAIL",
      evidence: [String(entry.path ?? "missing")]
    });
    if (ok) {
      const template = parseYaml(fs.readFileSync(file, "utf8"));
      for (const check of validateHarnessTemplateContract(template, entry)) checks.push(check);
    }
  }
  const blockers = checks.filter((check) => check.status === "FAIL").map((check) => `${check.id}:${check.evidence.join(",")}`);
  const result = {
    schema: "evopilot-harness-catalog-validation-result/v1",
    status: blockers.length === 0 ? "VALIDATED" : "FAILED",
    source,
    entryCount: entries.length,
    checks,
    blockers
  };
  printResult(args, result, `catalog=${source} status=${result.status} entries=${entries.length}`);
  return blockers.length === 0 ? 0 : 2;
}

function listHarnesses(args) {
  const source = path.resolve(stringOption(args, "source") ?? "harnesses");
  const packs = listHarnessPacks(source).map(packSummary);
  const result = {
    schema: "evopilot-harness-list/v1",
    status: "READY",
    source,
    count: packs.length,
    harnesses: packs,
    nextAction: packs.length === 0 ? "create-or-publish-harness" : "inspect-evolve-or-publish-harness"
  };
  printResult(args, result, `harnesses=${packs.length}`);
  return 0;
}

function inspectHarness(args, idArg) {
  const source = path.resolve(stringOption(args, "source") ?? "harnesses");
  const id = safeId(idArg ?? requiredOption(args, "name"));
  const pack = findHarnessPack(source, id);
  if (!pack) throw usage(`Harness ${id} not found in ${source}.`);
  const result = {
    schema: "evopilot-harness-inspect/v1",
    status: "FOUND",
    source,
    harness: packSummary(pack),
    template: pack.template,
    templateDigest: digestText(pack.templateText),
    paths: {
      root: pack.root,
      template: pack.templatePath,
      readme: fs.existsSync(pack.readmePath) ? pack.readmePath : undefined,
      changelog: fs.existsSync(pack.changelogPath) ? pack.changelogPath : undefined
    }
  };
  printResult(args, result, `${pack.id}@${pack.version}`);
  return 0;
}

function validateHarness(args, idArg) {
  const source = path.resolve(stringOption(args, "source") ?? "harnesses");
  const ids = idArg ? [safeId(idArg)] : stringListOption(args, "name");
  const packs = listHarnessPacks(source).filter((pack) => ids.length === 0 || ids.includes(pack.id));
  if (packs.length === 0) throw usage(`No Harness packs found in ${source}.`);
  const checks = packs.flatMap((pack) => validateHarnessTemplateContract(pack.template, {
    name: pack.id,
    version: pack.version,
    layer: pack.template.harnessLayer ?? pack.template.runtimePatterns?.harnessLayer,
    domain: pack.template.domain ?? pack.template.runtimePatterns?.domain
  }));
  for (const pack of packs) {
    checks.unshift({ id: `pack:${pack.id}@${pack.version}:template`, status: "PASS", evidence: [path.relative(process.cwd(), pack.templatePath)] });
  }
  const blockers = checks.filter((check) => check.status === "FAIL").map((check) => `${check.id}:${check.evidence.join(",")}`);
  const result = {
    schema: "evopilot-harness-validation-result/v1",
    status: blockers.length === 0 ? "VALIDATED" : "FAILED",
    source,
    harnessCount: packs.length,
    checks,
    blockers
  };
  printResult(args, result, `status=${result.status} harnesses=${packs.length}`);
  return blockers.length === 0 ? 0 : 2;
}

function publishHarness(args, idArg) {
  const name = safeId(idArg ?? requiredOption(args, "name"));
  args.options.name = name;
  return publishCatalog(args);
}

function deprecateHarness(args, idArg) {
  const source = path.resolve(stringOption(args, "source") ?? "harnesses");
  const id = safeId(idArg ?? requiredOption(args, "name"));
  const reason = stringOption(args, "reason") ?? "Deprecated by administrator.";
  const pack = findHarnessPack(source, id);
  if (!pack) throw usage(`Harness ${id} not found in ${source}.`);
  const template = structuredCloneJson(pack.template);
  template.lifecycle = { ...(isRecord(template.lifecycle) ? template.lifecycle : {}), status: "deprecated", reason, deprecatedAt: new Date().toISOString() };
  fs.writeFileSync(pack.templatePath, stringifyYaml(template), "utf8");
  const result = {
    schema: "evopilot-harness-deprecate-result/v1",
    status: "DEPRECATED",
    harnessId: id,
    version: String(template.version),
    reason,
    templatePath: pack.templatePath,
    nextAction: "publish-catalog"
  };
  printResult(args, result, `deprecated=${id}`);
  return 0;
}

function listEvolutions(args) {
  const dataRoot = evolutionDataRoot(args);
  const runs = listEvolutionRuns(dataRoot);
  const result = {
    schema: "evopilot-harness-evolution-list/v1",
    status: "READY",
    dataRoot,
    count: runs.length,
    evolutions: runs.map(evolutionSummary)
  };
  printResult(args, result, `evolutions=${runs.length}`);
  return 0;
}

function oneClickEvolve(args) {
  const run = createEvolutionRunFromArgs(args);
  const advanced = advanceRunToReview(args, run);
  let result = advanced;
  if (args.options["approve-and-publish"]) {
    result = approveRun(args, result);
    result = publishRun(args, result);
  }
  printResult(args, evolveResult(result), `evolution=${result.evolutionId} status=${result.status}`);
  return result.status === "BLOCKED" ? 2 : 0;
}

function createEvolution(args) {
  const run = createEvolutionRunFromArgs(args);
  printResult(args, evolutionDetail(run), `evolution=${run.evolutionId} status=${run.status}`);
  return 0;
}

function addEvolutionSources(args, idArg) {
  const run = readRequiredEvolution(args, idArg);
  if (!["CREATED", "SOURCES_COLLECTED", "ANALYZED", "REVIEW_REQUIRED"].includes(run.status)) {
    throw usage(`Cannot add sources while evolution status is ${run.status}.`);
  }
  const sources = collectSourceInputs(args);
  if (sources.length === 0) throw usage("No sources supplied.");
  const next = { ...run, sources: [...run.sources, ...sources], status: "CREATED", updatedAt: new Date().toISOString(), nextAction: "advance-evolution" };
  writeEvolutionRun(args, next);
  printResult(args, evolutionDetail(next), `evolution=${next.evolutionId} sources=${next.sources.length}`);
  return 0;
}

function advanceEvolution(args, idArg) {
  const run = readRequiredEvolution(args, idArg);
  const next = advanceRunToReview(args, run);
  printResult(args, evolutionDetail(next), `evolution=${next.evolutionId} status=${next.status}`);
  return next.status === "BLOCKED" ? 2 : 0;
}

function inspectEvolution(args, idArg) {
  const run = readRequiredEvolution(args, idArg);
  printResult(args, evolutionDetail(run), `evolution=${run.evolutionId} status=${run.status}`);
  return 0;
}

function approveEvolution(args, idArg) {
  const run = readRequiredEvolution(args, idArg);
  const next = approveRun(args, run);
  printResult(args, evolutionDetail(next), `evolution=${next.evolutionId} status=${next.status}`);
  return 0;
}

function publishEvolution(args, idArg) {
  const run = readRequiredEvolution(args, idArg);
  const next = publishRun(args, run);
  printResult(args, evolutionDetail(next), `evolution=${next.evolutionId} status=${next.status}`);
  return 0;
}

function evolutionImpact(args, idArg) {
  const run = readRequiredEvolution(args, idArg);
  const report = impactReport(run);
  const next = { ...run, impactReport: report, updatedAt: new Date().toISOString() };
  writeEvolutionRun(args, next);
  printResult(args, { schema: "evopilot-harness-evolution-impact/v1", ...report }, `evolution=${run.evolutionId} impacted=${report.impactedConsumers.length}`);
  return 0;
}

function hubSnapshot(args) {
  const snapshot = buildHubSnapshot(args);
  const out = stringOption(args, "out");
  if (out) {
    const file = path.resolve(out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }
  printResult(args, snapshot, `hub snapshot entries=${snapshot.catalog.entryCount} evolutions=${snapshot.evolutions.length}${out ? ` out=${path.resolve(out)}` : ""}`);
  return snapshot.status === "READY" ? 0 : 2;
}

function serveHub(args) {
  const host = stringOption(args, "host") ?? process.env.EVOPILOT_HARNESS_HUB_HOST ?? "127.0.0.1";
  const port = Number(stringOption(args, "port") ?? process.env.EVOPILOT_HARNESS_HUB_PORT ?? 4176);
  const uiRoot = path.resolve(stringOption(args, "ui-root") ?? path.join(PACKAGE_ROOT, "ui", "harness-hub"));
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (requestUrl.pathname === "/api/hub/snapshot") {
      writeJson(response, buildHubSnapshot(args));
      return;
    }
    serveStaticFile(response, uiRoot, requestUrl.pathname);
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      printResult(args, {
        schema: "evopilot-harness-hub-serve-result/v1",
        status: "READY",
        url: `http://${host}:${actualPort}`,
        uiRoot,
        catalogRoot: hubCatalogRoot(args),
        sourceRoot: hubSourceRoot(args)
      }, `Harness Hub listening on http://${host}:${actualPort}`);
    });
    const shutdown = () => server.close(() => resolve(0));
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

function buildHubSnapshot(args) {
  const catalogRoot = hubCatalogRoot(args);
  const sourceRoot = hubSourceRoot(args);
  const dataRoot = evolutionDataRoot(args);
  const catalog = readHubCatalog(catalogRoot);
  const harnesses = listHarnessPacks(sourceRoot).map((pack) => ({
    ...packSummary(pack),
    sourcePath: path.relative(process.cwd(), pack.root),
    templatePath: path.relative(process.cwd(), pack.templatePath),
    lifecycleStatus: pack.template.lifecycle?.status ?? "active",
    contract: templateContractSummary(pack.template),
    commands: lifecycleCommands(pack.id)
  }));
  const evolutions = listEvolutionRuns(dataRoot).slice(0, 20).map((run) => ({
    ...evolutionSummary(run),
    updatedAt: run.updatedAt,
    autoMatchDecision: run.autoMatch?.decision,
    validationStatus: run.validation?.status,
    publication: run.publication
  }));
  return {
    schema: "evopilot-harness-hub-snapshot/v1",
    status: catalog.status === "READY" ? "READY" : "ATTENTION",
    generatedAt: new Date().toISOString(),
    project: {
      name: "evopilot-harness",
      version: readPackageVersion(),
      compatibleEvopilot: DEFAULT_COMPATIBLE_EVOPILOT,
      boundary: "Harness lifecycle is managed here; EvoPilot reads published Catalog directories at goal-plan time."
    },
    catalog,
    harnesses,
    evolutions,
    sourceTypes: hubSourceTypes(),
    lifecycleCommands: lifecycleCommandModel(),
    nextAction: catalog.status === "READY" ? "use-hub-review-evolve-or-publish" : "run-catalog-publish-and-validate"
  };
}

function readHubCatalog(catalogRoot) {
  const catalogPath = path.join(catalogRoot, "CATALOG.md");
  if (!fs.existsSync(catalogPath)) {
    return {
      status: "MISSING",
      catalogRoot,
      catalogPath,
      catalogId: "missing",
      entryCount: 0,
      catalogDigest: undefined,
      entries: [],
      blockers: [`missing=${catalogPath}`]
    };
  }
  const markdown = fs.readFileSync(catalogPath, "utf8");
  const block = extractCatalogBlock(markdown);
  if (!block) {
    return {
      status: "FAILED",
      catalogRoot,
      catalogPath,
      catalogId: "unreadable",
      entryCount: 0,
      catalogDigest: digestText(markdown),
      entries: [],
      blockers: [`missing fenced block=${CATALOG_BLOCK}`]
    };
  }
  const parsed = parseYaml(block);
  const entries = Array.isArray(parsed?.entries) ? parsed.entries.map((entry) => hubCatalogEntry(catalogRoot, entry)) : [];
  return {
    status: "READY",
    catalogRoot,
    catalogPath,
    catalogId: String(parsed.catalogId ?? "catalog"),
    catalogVersion: parsed.catalogVersion,
    compatibleEvopilot: parsed.compatibleEvopilot ?? DEFAULT_COMPATIBLE_EVOPILOT,
    generatedAt: parsed.generatedAt,
    entryCount: entries.length,
    catalogDigest: digestText(markdown),
    entries,
    blockers: entries.filter((entry) => entry.status !== "published").map((entry) => `${entry.name}@${entry.version}:${entry.status}`)
  };
}

function hubCatalogEntry(catalogRoot, entry) {
  const entryPath = String(entry.path ?? "");
  const absolute = path.resolve(catalogRoot, entryPath);
  const insideCatalog = absolute.startsWith(catalogRoot + path.sep);
  const exists = insideCatalog && fs.existsSync(absolute);
  let contract;
  let templateDigest = entry.digest;
  if (exists) {
    const text = fs.readFileSync(absolute, "utf8");
    templateDigest = digestText(text);
    contract = templateContractSummary(parseYaml(text));
  }
  return {
    name: String(entry.name ?? "harness"),
    version: String(entry.version ?? "0.1.0"),
    layer: entry.layer,
    domain: entry.domain,
    status: exists ? String(entry.status ?? "published") : "missing-template",
    path: entryPath,
    digest: templateDigest,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    matchSummary: entry.matchSummary,
    contract
  };
}

function templateContractSummary(template) {
  const domainExecution = isRecord(template.runtimePatterns?.domainExecution) ? template.runtimePatterns.domainExecution : {};
  return {
    requiredActionCount: Array.isArray(domainExecution.requiredActions) ? domainExecution.requiredActions.length : 0,
    evidenceAdapterCount: Array.isArray(domainExecution.evidenceAdapters) ? domainExecution.evidenceAdapters.length : 0,
    releaseBlockerCount: Array.isArray(domainExecution.releaseBlockers) ? domainExecution.releaseBlockers.length : 0,
    requiredActions: labels(domainExecution.requiredActions, "id").slice(0, 6),
    evidenceAdapters: labels(domainExecution.evidenceAdapters, "id").slice(0, 6),
    releaseBlockers: Array.isArray(domainExecution.releaseBlockers) ? domainExecution.releaseBlockers.slice(0, 6).map(String) : []
  };
}

function lifecycleCommands(harnessId) {
  return {
    inspect: `evopilot-harness harness inspect ${harnessId} --json`,
    validate: `evopilot-harness harness validate ${harnessId} --json`,
    publish: `evopilot-harness harness publish ${harnessId} --source harnesses --out published --json`,
    evolve: `evopilot-harness evolve --source-project /path/to/source-project --goal "Evolve ${harnessId}" --json`
  };
}

function lifecycleCommandModel() {
  return [
    { id: "scan-auto-match", label: "Scan and auto-match", command: "evopilot-harness evolve --source-project /path/to/source-project --goal \"...\" --json" },
    { id: "review-draft", label: "Review draft", command: "evopilot-harness evolution review <evolution-id> --json" },
    { id: "approve", label: "Approve", command: "evopilot-harness evolution approve <evolution-id> --confirmed-by <actor> --confirmation <text> --json" },
    { id: "publish", label: "Publish usable Harness", command: "evopilot-harness evolution publish <evolution-id> --json" },
    { id: "validate-catalog", label: "Validate Catalog", command: "evopilot-harness catalog validate --source published --json" }
  ];
}

function hubSourceTypes() {
  return [
    { id: "source-project", label: "Source Project", description: "Local code, architecture docs, tests, manifests, and runbooks." },
    { id: "source-corpus", label: "Source Corpus", description: "Multiple historical projects used as domain knowledge." },
    { id: "attachment", label: "Attachment", description: "PPT, PDF, Word, spreadsheet, Markdown, or text material." },
    { id: "production-log", label: "Production Log", description: "Redacted runtime logs and incident diagnostics." },
    { id: "evopilot-history", label: "EvoPilot History", description: "Goal loop history and evidence exported from EvoPilot." },
    { id: "runtime-evidence", label: "Runtime Evidence", description: "Evidence bundles, smoke output, traces, and metrics." }
  ];
}

function writeJson(response, payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(payload.status === "READY" ? 200 : 207, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(text);
}

function serveStaticFile(response, uiRoot, requestPath) {
  const pathname = decodeURIComponent(requestPath);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(uiRoot, relative);
  if (!(filePath === uiRoot || filePath.startsWith(uiRoot + path.sep)) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found\n");
    return;
  }
  response.writeHead(200, { "content-type": contentType(filePath), "cache-control": "no-store" });
  fs.createReadStream(filePath).pipe(response);
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function hubCatalogRoot(args) {
  return path.resolve(stringOption(args, "catalog") ?? stringOption(args, "catalog-root") ?? process.env.EVOPILOT_HARNESS_CATALOG_ROOT ?? "published");
}

function hubSourceRoot(args) {
  return path.resolve(stringOption(args, "source") ?? process.env.EVOPILOT_HARNESS_SOURCE_ROOT ?? "harnesses");
}

function createEvolutionRunFromArgs(args) {
  const sources = collectSourceInputs(args);
  if (sources.length === 0) throw usage("Supply at least one source with --source-project, --file, --production-log, or --note.");
  const now = new Date().toISOString();
  const goal = stringOption(args, "goal") ?? stringOption(args, "intent") ?? "Create or evolve a reusable Harness definition.";
  const evolutionId = safeId(stringOption(args, "id") ?? `evoh-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${digestText(JSON.stringify({ goal, sources })).slice(7, 15)}`);
  const run = {
    schema: "evopilot-harness-evolution/v1",
    evolutionId,
    status: "CREATED",
    goal,
    createdAt: now,
    updatedAt: now,
    sources,
    sourceCoverage: undefined,
    autoMatch: undefined,
    draft: undefined,
    validation: undefined,
    approval: undefined,
    publication: undefined,
    nextAction: "advance-evolution"
  };
  writeEvolutionRun(args, run);
  return run;
}

function advanceRunToReview(args, run) {
  if (run.status === "APPROVED" || run.status === "PUBLISHED") return run;
  const source = path.resolve(stringOption(args, "source") ?? "harnesses");
  const dataRoot = evolutionDataRoot(args);
  const sourceCoverage = buildSourceCoverage(run.sources);
  const corpus = buildCorpus(run.sources);
  const packs = listHarnessPacks(source);
  const autoMatch = autoMatchHarness(packs, corpus, run.goal, args);
  const draft = createDraftPack(run, autoMatch, corpus, args);
  const validation = validateDraftPack(draft);
  const nextStatus = validation.blockers.length === 0 ? "REVIEW_REQUIRED" : "BLOCKED";
  writeDraftFiles(dataRoot, run.evolutionId, draft);
  const next = {
    ...run,
    status: nextStatus,
    updatedAt: new Date().toISOString(),
    sourceCoverage,
    autoMatch,
    draft,
    validation,
    workflow: {
      steps: [
        { id: "collect-sources", status: "COMPLETED" },
        { id: "auto-match", status: "COMPLETED" },
        { id: "generate-draft", status: "COMPLETED" },
        { id: "validate-draft", status: validation.blockers.length === 0 ? "COMPLETED" : "BLOCKED" }
      ]
    },
    nextAction: validation.blockers.length === 0 ? "review-approve-harness" : "repair-draft-validation"
  };
  writeEvolutionRun(args, next);
  return next;
}

function approveRun(args, run) {
  if (run.status !== "REVIEW_REQUIRED") throw usage(`Only REVIEW_REQUIRED evolution runs can be approved. Current status=${run.status}.`);
  const confirmedBy = stringOption(args, "confirmed-by");
  const confirmation = stringOption(args, "confirmation");
  if (!confirmedBy || !confirmation) throw usage("Approval requires --confirmed-by and --confirmation.");
  const next = {
    ...run,
    status: "APPROVED",
    updatedAt: new Date().toISOString(),
    approval: { confirmedBy, confirmation, approvedAt: new Date().toISOString() },
    nextAction: "publish-harness"
  };
  writeEvolutionRun(args, next);
  return next;
}

function publishRun(args, run) {
  if (run.status !== "APPROVED") throw usage(`Only APPROVED evolution runs can be published. Current status=${run.status}.`);
  const draft = run.draft;
  if (!draft?.templateYaml) throw usage("Evolution has no draft template.");
  const harnessRoot = path.resolve(stringOption(args, "source") ?? "harnesses");
  const out = path.resolve(stringOption(args, "out") ?? "published");
  const targetRoot = path.join(harnessRoot, safeId(draft.harnessId));
  fs.mkdirSync(path.join(targetRoot, "examples"), { recursive: true });
  fs.writeFileSync(path.join(targetRoot, "template.yaml"), draft.templateYaml, "utf8");
  fs.writeFileSync(path.join(targetRoot, "README.md"), draft.readme, "utf8");
  fs.writeFileSync(path.join(targetRoot, "CHANGELOG.md"), draft.changelog, "utf8");
  fs.writeFileSync(path.join(targetRoot, "examples", "selected-harness-binding.yaml"), draft.exampleProfile, "utf8");
  const catalogArgs = {
    ...args,
    options: {
      ...args.options,
      source: harnessRoot,
      out,
      json: false,
      silent: true
    }
  };
  publishCatalog(catalogArgs);
  const next = {
    ...run,
    status: "PUBLISHED",
    updatedAt: new Date().toISOString(),
    publication: {
      publishedAt: new Date().toISOString(),
      harnessId: draft.harnessId,
      version: draft.version,
      harnessRoot: targetRoot,
      catalogRoot: out
    },
    impactReport: impactReport(run),
    nextAction: "publish-catalog-directory-and-configure-evopilot-catalog-dir"
  };
  writeEvolutionRun(args, next);
  return next;
}

function collectSourceInputs(args) {
  const sources = [];
  const sourceProjects = stringListRaw(args, "source-project");
  for (const sourceProject of sourceProjects) sources.push(sourceProjectSource(sourceProject));
  const files = [...stringListRaw(args, "file"), ...stringListRaw(args, "attachment")];
  for (const file of files) sources.push(fileSource(file, "attachment"));
  for (const file of stringListRaw(args, "production-log")) sources.push(fileSource(file, "production-log"));
  for (const note of stringListRaw(args, "note")) sources.push(noteSource(note));
  return sources;
}

function sourceProjectSource(projectPath) {
  const absolute = path.resolve(projectPath);
  if (!fs.existsSync(absolute)) throw usage(`source-project not found: ${projectPath}`);
  const scan = scanSourceProject(absolute);
  return {
    id: `source-${safeId(path.basename(absolute))}-${digestText(absolute).slice(7, 15)}`,
    type: "source-project",
    name: path.basename(absolute),
    uri: absolute,
    digest: digestText(JSON.stringify(scan)),
    scan,
    contentText: scan.extractedText
  };
}

function fileSource(filePath, type) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) throw usage(`${type} not found: ${filePath}`);
  const raw = fs.readFileSync(absolute);
  const textCandidate = raw.toString("utf8");
  const printableCount = textCandidate.match(/[\u0009\u000a\u000d\u0020-\u007e\u4e00-\u9fa5]/g)?.length ?? 0;
  const isMostlyText = raw.length === 0 || printableCount / Math.max(textCandidate.length, 1) > 0.85;
  const rawText = isMostlyText ? textCandidate : `Attachment ${path.basename(absolute)} (${path.extname(absolute) || "binary"}) bytes=${raw.length} digest=${digestText(raw)}`;
  const contentText = type === "production-log" ? redactSensitiveText(rawText) : rawText.slice(0, 80_000);
  return {
    id: `${type}-${safeId(path.basename(absolute))}-${digestText(contentText).slice(7, 15)}`,
    type,
    name: path.basename(absolute),
    uri: absolute,
    digest: digestText(contentText),
    redactionApplied: type === "production-log",
    contentText
  };
}

function noteSource(note) {
  return {
    id: `note-${digestText(note).slice(7, 15)}`,
    type: "admin-note",
    name: "admin-note",
    digest: digestText(note),
    contentText: note
  };
}

function scanSourceProject(root) {
  const files = [];
  walk(root, files, 260);
  const selected = files.filter((file) => shouldReadForScan(file)).slice(0, 90);
  const excerpts = [];
  for (const file of selected) {
    try {
      const text = fs.readFileSync(file, "utf8").slice(0, 12_000);
      excerpts.push(`## ${path.relative(root, file)}\n${text}`);
    } catch {
      // Ignore non-text files.
    }
  }
  const extensions = {};
  for (const file of files) {
    const ext = path.extname(file).toLowerCase() || "<none>";
    extensions[ext] = (extensions[ext] ?? 0) + 1;
  }
  return {
    root,
    fileCount: files.length,
    selectedFileCount: selected.length,
    topExtensions: Object.entries(extensions).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([extension, count]) => ({ extension, count })),
    selectedFiles: selected.map((file) => path.relative(root, file)),
    extractedText: excerpts.join("\n\n").slice(0, 120_000)
  };
}

function walk(dir, files, limit) {
  if (files.length >= limit) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (files.length >= limit) return;
    if ([".git", "node_modules", "dist", "build", "target", ".next", "coverage", ".evopilot-harness"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files, limit);
    else if (entry.isFile()) files.push(full);
  }
}

function shouldReadForScan(file) {
  const base = path.basename(file).toLowerCase();
  const rel = file.toLowerCase();
  if (/^(readme|architecture|design|overview|package|go\.mod|pom\.xml|build\.gradle|pyproject\.toml|requirements\.txt|cargo\.toml|dockerfile|compose)/.test(base)) return true;
  if (rel.includes(`${path.sep}docs${path.sep}`) || rel.includes(`${path.sep}.github${path.sep}`)) return true;
  return [".md", ".txt", ".yaml", ".yml", ".json", ".toml", ".xml", ".go", ".java", ".rs", ".py", ".ts", ".js"].includes(path.extname(file).toLowerCase());
}

function buildSourceCoverage(sources) {
  return {
    schema: "evopilot-harness-source-coverage/v1",
    sourceCount: sources.length,
    sources: sources.map((source) => ({
      id: source.id,
      type: source.type,
      name: source.name,
      digest: source.digest,
      redactionApplied: Boolean(source.redactionApplied),
      knowledgeCategory: source.type === "production-log" ? "runtime-operations" : source.type === "source-project" ? "source-architecture" : "supporting-material",
      projectActions: projectActionsForSource(source)
    }))
  };
}

function projectActionsForSource(source) {
  if (source.type === "production-log") return ["extract failure modes", "add diagnostics and observability evidence"];
  if (source.type === "source-project") return ["extract domain capabilities", "match or create Harness", "generate draft pack"];
  return ["review source material", "map reusable Harness guidance"];
}

function buildCorpus(sources) {
  const text = sources.map((source) => [source.name, source.type, source.contentText ?? ""].join("\n")).join("\n\n");
  return {
    text,
    normalizedText: text.toLowerCase(),
    keywords: topKeywords(text),
    digest: digestText(text)
  };
}

function autoMatchHarness(packs, corpus, goal, args) {
  const explicitTarget = stringOption(args, "target-id");
  const goalText = goal.toLowerCase();
  const candidates = packs.map((pack) => {
    const signals = harnessSignals(pack);
    const matched = signals.filter((signal) => corpus.normalizedText.includes(signal.toLowerCase()) || goalText.includes(signal.toLowerCase()));
    const score = signals.length === 0 ? 0 : matched.length / Math.min(signals.length, 24);
    return {
      harnessId: pack.id,
      version: pack.version,
      domain: pack.template.domain ?? pack.template.runtimePatterns?.domain,
      score: Number(score.toFixed(3)),
      matchedSignals: matched.slice(0, 20),
      templatePath: pack.templatePath,
      basePack: pack
    };
  }).sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const matched = best && best.score >= Number(stringOption(args, "match-threshold") ?? 0.08);
  const targetHarnessId = safeId(explicitTarget ?? (matched ? best.harnessId : inferHarnessId(goal, corpus)));
  const decision = matched && targetHarnessId === best.harnessId ? "EVOLVE_EXISTING" : matched ? "FORK_FROM_MATCH" : "CREATE_NEW";
  return {
    schema: "evopilot-harness-auto-match/v1",
    decision,
    confidence: matched ? best.score : 0,
    targetHarnessId,
    targetVersion: matched ? bumpPatch(best.version) : "0.1.0",
    targetDomain: inferDomain(targetHarnessId, goal, corpus),
    baseHarnessRef: matched ? { id: best.harnessId, version: best.version, digest: digestText(best.basePack.templateText) } : undefined,
    candidates: candidates.map(({ basePack, ...candidate }) => candidate).slice(0, 8),
    reasons: matched ? best.matchedSignals.slice(0, 8) : ["no-confident-existing-harness-match"],
    nextAction: "review-generated-draft"
  };
}

function createDraftPack(run, match, corpus, args) {
  const source = path.resolve(stringOption(args, "source") ?? "harnesses");
  const basePack = match.baseHarnessRef ? findHarnessPack(source, match.baseHarnessRef.id) : undefined;
  const template = basePack ? structuredCloneJson(basePack.template) : createGenericDomainTemplate(match.targetHarnessId, match.targetDomain);
  template.id = match.targetHarnessId;
  template.version = match.targetVersion;
  template.name = humanName(match.targetHarnessId);
  template.description = `Generated Harness draft for ${match.targetDomain} from ${run.sources.length} source(s).`;
  template.harnessLayer = template.harnessLayer ?? "domain";
  template.domain = match.targetDomain;
  template.matchSignals = {
    ...(isRecord(template.matchSignals) ? template.matchSignals : {}),
    include: uniqueStrings([...(Array.isArray(template.matchSignals?.include) ? template.matchSignals.include : []), ...corpus.keywords.slice(0, 20), match.targetDomain, match.targetHarnessId])
  };
  template.sourceReferences = [
    ...(Array.isArray(template.sourceReferences) ? template.sourceReferences : []),
    ...run.sources.map((source) => ({
      name: source.name,
      type: source.type,
      uri: source.uri,
      digest: source.digest,
      description: `Harness evolution source ${source.type}.`
    }))
  ];
  template.changelog = [
    ...(Array.isArray(template.changelog) ? template.changelog : []),
    {
      version: template.version,
      date: new Date().toISOString().slice(0, 10),
      changes: [`Generated by evopilot-harness evolution ${run.evolutionId}.`]
    }
  ];
  ensureDomainExecution(template, match.targetDomain);
  const templateYaml = stringifyYaml(template);
  const readme = renderDraftReadme(run, template, match);
  const changelog = renderDraftChangelog(run, template, match);
  const exampleProfile = renderExampleProfile(template);
  return {
    schema: "evopilot-harness-draft-pack/v1",
    harnessId: template.id,
    version: String(template.version),
    domain: String(template.domain),
    digest: digestText(templateYaml),
    template,
    templateYaml,
    readme,
    changelog,
    exampleProfile,
    diffFromBase: {
      baseHarnessRef: match.baseHarnessRef,
      changedSections: ["metadata", "matchSignals", "sourceReferences", "domainExecution", "changelog"]
    }
  };
}

function createGenericDomainTemplate(id, domain) {
  return {
    schema: "evopilot-harness-template/v1",
    id,
    version: "0.1.0",
    name: humanName(id),
    description: `Domain baseline for ${domain}.`,
    scope: "platform",
    languageFamily: "generic",
    harnessLayer: "domain",
    domain,
    capabilities: [
      { id: "source-boundary", name: "Source boundary", boundary: "Project source and ownership are explicit.", requiredEvidence: ["source-readiness"] },
      { id: "domain-runtime", name: "Domain runtime", boundary: "Domain-specific runtime commands and checks are declared.", requiredEvidence: ["runtime-output"] },
      { id: "test-and-quality", name: "Test and quality gates", boundary: "Tests and quality checks produce evidence.", requiredEvidence: ["test-report"] },
      { id: "observability", name: "Observability", boundary: "Health, logs, metrics, and traces are available.", requiredEvidence: ["runtime-log"] },
      { id: "release-governance", name: "Release governance", boundary: "Release evidence and decisions are required.", requiredEvidence: ["release-decision"] }
    ],
    runtimePatterns: {
      harnessLayer: "domain",
      domain,
      runtimeProfiles: ["generic"],
      domainExecution: {
        requiredActions: [
          { id: "declare-domain-boundary", action: "Declare the domain boundary, core workflows, failure modes, and release criteria.", evidence: ["domain-boundary.md"] }
        ],
        evidenceAdapters: [
          { id: "runtime-log", artifact: "runtime-log", description: "Runtime logs with request, error, and owner context." }
        ],
        releaseBlockers: ["missing domain boundary evidence", "missing runtime evidence"]
      }
    },
    validationBaseline: { requiredCommandGroups: ["install", "test", "smoke"], commandEvidenceRequired: true, realBoundaryEvidenceRequired: true, noMockEvidenceForReleaseClaims: true },
    evidenceContract: { format: "json", requiredArtifacts: ["runtime-log", "test-report"], correlationFields: ["requestId", "traceId"] },
    failureTaxonomy: { categories: ["runtime", "dependency", "data", "observability", "governance"] },
    diagnosticsBaseline: { requiredSignals: ["command", "log-excerpt", "root-cause", "next-action"] },
    observabilityBaseline: { requiredSignals: ["health", "readiness", "logs", "metrics"] },
    governanceRules: { noSilentProfileMutation: true, promotionRequiresReleaseDecision: true },
    phaseMapping: { alpha: ["source-boundary"], beta: ["test-and-quality"], rc: ["observability"], ga: ["release-governance"] },
    llmDraftPolicy: { enabled: true, requireUserReview: true }
  };
}

function ensureDomainExecution(template, domain) {
  template.runtimePatterns = isRecord(template.runtimePatterns) ? template.runtimePatterns : {};
  template.runtimePatterns.harnessLayer = template.runtimePatterns.harnessLayer ?? "domain";
  template.runtimePatterns.domain = template.runtimePatterns.domain ?? domain;
  template.runtimePatterns.domainExecution = isRecord(template.runtimePatterns.domainExecution) ? template.runtimePatterns.domainExecution : {};
  const execution = template.runtimePatterns.domainExecution;
  if (!Array.isArray(execution.requiredActions) || execution.requiredActions.length === 0) {
    execution.requiredActions = [{ id: "declare-domain-boundary", action: "Declare domain boundary and release evidence.", evidence: ["domain-boundary.md"] }];
  }
  if (!Array.isArray(execution.evidenceAdapters) || execution.evidenceAdapters.length === 0) {
    execution.evidenceAdapters = [{ id: "runtime-log", artifact: "runtime-log", description: "Runtime diagnostic logs." }];
  }
  if (!Array.isArray(execution.releaseBlockers) || execution.releaseBlockers.length === 0) {
    execution.releaseBlockers = ["missing domain runtime evidence"];
  }
}

function validateDraftPack(draft) {
  const checks = [
    { id: "draft-template", status: draft.templateYaml ? "PASS" : "FAIL", evidence: [`digest=${draft.digest}`] },
    { id: "draft-readme", status: draft.readme ? "PASS" : "FAIL", evidence: [`bytes=${draft.readme?.length ?? 0}`] },
    ...validateHarnessTemplateContract(draft.template, { name: draft.harnessId, version: draft.version, layer: "domain", domain: draft.domain })
  ];
  return {
    schema: "evopilot-harness-draft-validation/v1",
    status: checks.every((check) => check.status === "PASS") ? "VALIDATED" : "FAILED",
    checks,
    blockers: checks.filter((check) => check.status === "FAIL").map((check) => `${check.id}:${check.evidence.join(",")}`)
  };
}

function writeDraftFiles(dataRoot, evolutionId, draft) {
  const draftRoot = path.join(dataRoot, "evolutions", evolutionId, "draft");
  fs.mkdirSync(path.join(draftRoot, "examples"), { recursive: true });
  fs.writeFileSync(path.join(draftRoot, "template.yaml"), draft.templateYaml, "utf8");
  fs.writeFileSync(path.join(draftRoot, "README.md"), draft.readme, "utf8");
  fs.writeFileSync(path.join(draftRoot, "CHANGELOG.md"), draft.changelog, "utf8");
  fs.writeFileSync(path.join(draftRoot, "examples", "selected-harness-binding.yaml"), draft.exampleProfile, "utf8");
}

function listHarnessPacks(source) {
  if (!fs.existsSync(source)) return [];
  return fs.readdirSync(source)
    .map((entry) => path.join(source, entry))
    .filter((entryPath) => fs.statSync(entryPath).isDirectory())
    .map(readHarnessPack)
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function readHarnessPack(packRoot) {
  const templatePath = ["template.yaml", "harness.yaml"].map((file) => path.join(packRoot, file)).find((file) => fs.existsSync(file));
  if (!templatePath) return undefined;
  const templateText = fs.readFileSync(templatePath, "utf8");
  const template = parseYaml(templateText);
  const id = safeId(String(template.id ?? path.basename(packRoot)));
  const version = String(template.version ?? "0.1.0");
  return {
    id,
    version,
    root: packRoot,
    templatePath,
    templateText,
    template,
    readmePath: path.join(packRoot, "README.md"),
    changelogPath: path.join(packRoot, "CHANGELOG.md"),
    examplesPath: path.join(packRoot, "examples")
  };
}

function findHarnessPack(source, id) {
  return listHarnessPacks(source).find((pack) => pack.id === id);
}

function packSummary(pack) {
  return {
    id: pack.id,
    version: pack.version,
    name: pack.template.name ?? humanName(pack.id),
    domain: pack.template.domain ?? pack.template.runtimePatterns?.domain,
    layer: pack.template.harnessLayer ?? pack.template.runtimePatterns?.harnessLayer ?? "runtime",
    digest: digestText(pack.templateText),
    description: pack.template.description
  };
}

function publishPack(pack, out) {
  const targetRoot = path.join(out, pack.id, pack.version);
  fs.rmSync(targetRoot, { recursive: true, force: true });
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.copyFileSync(pack.templatePath, path.join(targetRoot, path.basename(pack.templatePath)));
  if (fs.existsSync(pack.readmePath)) fs.copyFileSync(pack.readmePath, path.join(targetRoot, "README.md"));
  if (fs.existsSync(pack.changelogPath)) fs.copyFileSync(pack.changelogPath, path.join(targetRoot, "CHANGELOG.md"));
  if (fs.existsSync(pack.examplesPath)) fs.cpSync(pack.examplesPath, path.join(targetRoot, "examples"), { recursive: true });
  const templateFile = path.basename(pack.templatePath);
  const relativePath = `./${pack.id}/${pack.version}/${templateFile}`;
  return {
    name: pack.id,
    version: pack.version,
    layer: pack.template.harnessLayer ?? pack.template.runtimePatterns?.harnessLayer ?? "runtime",
    domain: pack.template.domain ?? pack.template.runtimePatterns?.domain,
    status: pack.template.lifecycle?.status === "deprecated" ? "deprecated" : "published",
    path: relativePath,
    digest: digestText(pack.templateText),
    tags: catalogTags(pack.template),
    matchSummary: pack.template.description ?? pack.template.name ?? pack.id
  };
}

function validateHarnessTemplateContract(template, entry) {
  const runtimePatterns = isRecord(template.runtimePatterns) ? template.runtimePatterns : {};
  const domainExecution = isRecord(runtimePatterns.domainExecution) ? runtimePatterns.domainExecution : {};
  const harnessLayer = String(template.harnessLayer ?? runtimePatterns.harnessLayer ?? entry.layer ?? "").trim();
  const domain = String(template.domain ?? runtimePatterns.domain ?? entry.domain ?? "").trim();
  const checks = [];
  if (!template.id) checks.push({ id: `template:${entry.name}:id`, status: "FAIL", evidence: ["missing id"] });
  if (!template.version) checks.push({ id: `template:${entry.name}:version`, status: "FAIL", evidence: ["missing version"] });
  if (harnessLayer !== "domain" && !domain) return checks.length ? checks : [];
  const requiredActions = Array.isArray(domainExecution.requiredActions) ? domainExecution.requiredActions : [];
  const evidenceAdapters = Array.isArray(domainExecution.evidenceAdapters) ? domainExecution.evidenceAdapters : [];
  const releaseBlockers = Array.isArray(domainExecution.releaseBlockers) ? domainExecution.releaseBlockers : [];
  checks.push({
    id: `domain:${entry.name}@${entry.version}:required-actions`,
    status: requiredActions.length > 0 && requiredActions.every(isRecord) ? "PASS" : "FAIL",
    evidence: [`count=${requiredActions.length}`]
  });
  checks.push({
    id: `domain:${entry.name}@${entry.version}:evidence-adapters`,
    status: evidenceAdapters.length > 0 && evidenceAdapters.every(isRecord) ? "PASS" : "FAIL",
    evidence: [`count=${evidenceAdapters.length}`]
  });
  checks.push({
    id: `domain:${entry.name}@${entry.version}:release-blockers`,
    status: releaseBlockers.length > 0 && releaseBlockers.every((item) => typeof item === "string" && item.trim()) ? "PASS" : "FAIL",
    evidence: [`count=${releaseBlockers.length}`]
  });
  return checks;
}

function renderCatalogMarkdown(catalog, entries) {
  const block = stringifyYaml({
    catalogVersion: catalog.catalogVersion,
    catalogId: catalog.catalogId,
    generatedAt: catalog.generatedAt,
    compatibleEvopilot: catalog.compatibleEvopilot,
    entries
  });
  const lines = [
    "# Harness Catalog",
    "",
    "This catalog is published by evopilot-harness. EvoPilot reads the fenced catalog block and then loads each published Harness definition by path.",
    "",
    `Published Harness count: ${entries.length}`,
    "",
    ...entries.map((entry) => `- ${entry.name}@${entry.version} (${entry.domain ?? entry.layer})`),
    "",
    "```yaml " + CATALOG_BLOCK,
    block.trimEnd(),
    "```",
    ""
  ];
  return lines.join("\n");
}

function catalogTags(template) {
  return uniqueStrings([
    template.languageFamily,
    template.harnessLayer,
    template.domain,
    template.runtimePatterns?.harnessLayer,
    template.runtimePatterns?.domain,
    ...(Array.isArray(template.runtimePatterns?.runtimeProfiles) ? template.runtimePatterns.runtimeProfiles : []),
    ...(Array.isArray(template.matchSignals?.include) ? template.matchSignals.include.slice(0, 8) : [])
  ].filter(Boolean).map(String).flatMap((item) => item.split(/[,/| ]+/)).filter((item) => item.length >= 2));
}

function harnessSignals(pack) {
  return uniqueStrings([
    pack.id,
    pack.template.name,
    pack.template.description,
    pack.template.domain,
    pack.template.runtimePatterns?.domain,
    ...(Array.isArray(pack.template.matchSignals?.include) ? pack.template.matchSignals.include : []),
    ...catalogTags(pack.template)
  ].filter(Boolean).map(String).flatMap((item) => item.split(/[,/|]+/)).map((item) => item.trim()).filter((item) => item.length >= 2));
}

function renderDraftReadme(run, template, match) {
  return `# ${template.name}

Generated by evopilot-harness evolution \`${run.evolutionId}\`.

## Goal

${run.goal}

## Auto Match

- Decision: ${match.decision}
- Confidence: ${match.confidence}
- Base: ${match.baseHarnessRef ? `${match.baseHarnessRef.id}@${match.baseHarnessRef.version}` : "none"}

## Required Review

Review domain actions, evidence adapters, release blockers, and source references before approval.
`;
}

function renderDraftChangelog(run, template, match) {
  return `# Changelog

## ${template.version} - ${new Date().toISOString().slice(0, 10)}

- Generated by evolution ${run.evolutionId}.
- Auto-match decision: ${match.decision}.
- Source count: ${run.sources.length}.
`;
}

function renderExampleProfile(template) {
  return stringifyYaml({
    schema: "evopilot-selected-harness-example/v1",
    scope: "example-only",
    selectedHarness: {
      harnessId: template.id,
      version: template.version,
      domain: template.domain,
      catalogId: "evopilot-public-harness-catalog",
      binding: "EvoPilot writes this at goal plan time after reading the published Catalog directory."
    }
  });
}

function labels(value, key) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => isRecord(item) ? item[key] ?? item.name ?? item.artifact : item)
    .filter(Boolean)
    .map(String);
}

function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
}

function generatedTimestamp(args) {
  return stringOption(args, "generated-at") ?? process.env.EVOPILOT_HARNESS_GENERATED_AT ?? new Date().toISOString();
}

function evolutionDataRoot(args) {
  return path.resolve(stringOption(args, "data-root") ?? DEFAULT_DATA_ROOT);
}

function evolutionPath(dataRoot, evolutionId) {
  return path.join(dataRoot, "evolutions", safeId(evolutionId), "run.json");
}

function writeEvolutionRun(args, run) {
  const dataRoot = evolutionDataRoot(args);
  const file = evolutionPath(dataRoot, run.evolutionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

function readEvolutionRun(args, evolutionId) {
  const file = evolutionPath(evolutionDataRoot(args), evolutionId);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readRequiredEvolution(args, idArg) {
  const evolutionId = safeId(idArg ?? requiredOption(args, "id"));
  const run = readEvolutionRun(args, evolutionId);
  if (!run) throw usage(`Evolution ${evolutionId} not found.`);
  return run;
}

function listEvolutionRuns(dataRoot) {
  const root = path.join(dataRoot, "evolutions");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .map((id) => path.join(root, id, "run.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => JSON.parse(fs.readFileSync(file, "utf8")))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function evolutionSummary(run) {
  return {
    evolutionId: run.evolutionId,
    status: run.status,
    goal: run.goal,
    sourceCount: run.sources?.length ?? 0,
    targetHarnessId: run.autoMatch?.targetHarnessId,
    targetVersion: run.autoMatch?.targetVersion,
    nextAction: run.nextAction
  };
}

function evolutionDetail(run) {
  return { schema: "evopilot-harness-evolution-detail/v1", ...run };
}

function evolveResult(run) {
  return {
    schema: "evopilot-harness-evolve-result/v1",
    evolutionId: run.evolutionId,
    status: run.status,
    autoMatch: run.autoMatch,
    sourceCoverage: run.sourceCoverage,
    validation: run.validation,
    draft: run.draft,
    publication: run.publication,
    nextAction: run.nextAction
  };
}

function impactReport(run) {
  return {
    generatedAt: new Date().toISOString(),
    harnessId: run.draft?.harnessId,
    version: run.draft?.version,
    impactedConsumers: ["EvoPilot servers configured with the published Catalog directory"],
    projectAction: "Regenerate goal plans to bind the new selectedHarness digest.",
    staleActiveProfiles: []
  };
}

function inferHarnessId(goal, corpus) {
  const text = `${goal}\n${corpus.normalizedText}`;
  if (/cache|redis|memcached|kv|ttl|eviction|缓存/.test(text)) return "distributed-cache-harness";
  if (/gateway|ingress|route|traffic|proxy|网关/.test(text)) return "api-gateway-harness";
  if (/database|sql|dbms|storage engine|optimizer|transaction|数据库/.test(text)) return "database-product-harness";
  if (/schedule|scheduler|cron|workflow|调度/.test(text)) return "scheduling-system-harness";
  return `${safeId(corpus.keywords.slice(0, 3).join("-") || "domain")}-harness`;
}

function inferDomain(targetHarnessId, goal, corpus) {
  return targetHarnessId.replace(/-harness$/, "") || inferHarnessId(goal, corpus).replace(/-harness$/, "");
}

function topKeywords(text) {
  const stop = new Set(["the", "and", "for", "with", "this", "that", "from", "into", "class", "function", "const", "return", "public", "private", "project"]);
  const counts = new Map();
  for (const word of text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\u4e00-\u9fa5]{2,}/g) ?? []) {
    if (stop.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([word]) => word);
}

function bumpPatch(version) {
  const parts = String(version).split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return "0.1.0";
  parts[2] += 1;
  return parts.join(".");
}

function humanName(id) {
  return safeId(id).split("-").map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join(" ");
}

function extractCatalogBlock(markdown) {
  const pattern = new RegExp("```(?:yaml|yml)\\s+" + CATALOG_BLOCK + "\\s*\\n([\\s\\S]*?)```", "i");
  return markdown.match(pattern)?.[1];
}

function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s).filter((part) => part !== undefined);
    if (inlineValue !== undefined) {
      addOption(options, rawKey, inlineValue);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      addOption(options, rawKey, true);
    } else {
      addOption(options, rawKey, next);
      index += 1;
    }
  }
  return { positionals, options };
}

function addOption(options, key, value) {
  if (options[key] === undefined) options[key] = value;
  else options[key] = Array.isArray(options[key]) ? [...options[key], value] : [options[key], value];
}

function printResult(args, data, text) {
  if (args.options.silent) return;
  if (args.options.json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  else process.stdout.write(`${text}\n`);
}

function printHelp() {
  process.stdout.write(`EvoPilot Harness CLI

Usage:
  evopilot-harness catalog publish --source harnesses --out published [--catalog-id <id>] [--json]
  evopilot-harness catalog validate --source published [--json]
  evopilot-harness harness list|inspect|validate|publish|deprecate [harness-id] [--json]
  evopilot-harness evolution create --source-project <path> --goal <text> [--json]
  evopilot-harness evolution sources <evolution-id> --source-project <path> [--json]
  evopilot-harness evolution advance|review|approve|publish|impact <evolution-id> [--json]
  evopilot-harness evolve --source-project <path> --goal <text> [--approve-and-publish --confirmed-by <actor> --confirmation <text>] [--json]
  evopilot-harness hub snapshot [--catalog published] [--source harnesses] [--out ui/harness-hub/catalog-snapshot.json] [--json]
  evopilot-harness hub serve [--host 127.0.0.1] [--port 4176] [--catalog published] [--source harnesses]
`);
}

function requiredOption(args, name) {
  const value = stringOption(args, name);
  if (!value) throw usage(`Missing required --${name}.`);
  return value;
}

function stringOption(args, name) {
  const value = args.options[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringListOption(args, name) {
  return stringListRaw(args, name).map(safeId);
}

function stringListRaw(args, name) {
  const value = args.options[name];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") return [value];
  return [];
}

function safeId(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "harness";
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function structuredCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function digestText(value) {
  const payload = Buffer.isBuffer(value) ? value : String(value);
  return `sha256:${crypto.createHash("sha256").update(payload).digest("hex")}`;
}

function redactSensitiveText(text) {
  return text
    .replace(/(authorization|token|password|api[_-]?key|secret)([=:\s]+)([^\s"',}]+)/gi, "$1$2[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .slice(0, 80_000);
}

function usage(message) {
  const error = new Error(message);
  error.name = "UsageError";
  throw error;
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.name === "UsageError" ? 2 : 1;
});
