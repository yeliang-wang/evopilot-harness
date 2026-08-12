#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { handleV3Command } from "./v3/cli.mjs";

const CATALOG_BLOCK = "evopilot-harness-catalog";
const REGISTRY_SCHEMA = "evopilot-harness-registry/v1";
const DEFAULT_COMPATIBLE_EVOPILOT = ">=3.0.0";
const DEFAULT_DATA_ROOT = ".evopilot-harness";
const EVOLUTION_STATUSES = ["CREATED", "SOURCES_COLLECTED", "ANALYZED", "REVIEW_REQUIRED", "APPROVED", "PUBLISHED", "BLOCKED"];
const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const LLM_ADVISOR_SCHEMA = "evopilot-harness-llm-advisor/v1";
const LLM_MODELS_SCHEMA = "evopilot-harness-llm-models/v1";
const DETECT_SCHEMA = "evopilot-harness-detect-result/v2";
const SOURCE_PROFILE_SCHEMA = "evopilot-harness-source-profile/v2";
const CORPUS_SCHEMA = "evopilot-harness-corpus/v1";
const HARNESS_ASSET_API_VERSION = "evopilot.dev/v2";
const HARNESS_ASSET_KIND = "HarnessAsset";
const HARNESS_TEMPLATE_SCHEMA_V2 = "evopilot-harness-template/v2";
const AUTO_MATCH_SCHEMA = "evopilot-harness-auto-match/v2";
const DEFAULT_EVAL_FIXTURE_ROOT = path.join(PACKAGE_ROOT, "eval", "unknown-source", "cases");
const DEFAULT_LLM_REPLAY_FIXTURE_ROOT = path.join(PACKAGE_ROOT, "eval", "llm-replay", "cases");
const DEFAULT_GLM_BASE_URL = "https://open.bigmodel.cn/api/coding/paas/v4";
const DEFAULT_GLM_MODEL = "glm-5.1";
const DEFAULT_LLM_PROFILE_ID = "evopilot-glm";
const DEFAULT_LLM_MODELS_FILE = path.join(PACKAGE_ROOT, "models.json");
const DEFAULT_MATCH_THRESHOLD = 0.45;
const AMBIGUOUS_MATCH_DELTA = 0.1;
const DEFAULT_CORPUS_GROUP_LIMIT = 5;
const DEFAULT_GITHUB_CLONE_DEPTH = 1;
const DEFINITION_QUALITY_TARGET = {
  objective: "more accurate, professional, and fine-grained Harness definition",
  focusAreas: [
    "product boundary precision",
    "match policy specificity",
    "evidence contract completeness",
    "domain execution action granularity",
    "review warnings and negative signal coverage"
  ],
  nonGoals: [
    "large-scale performance optimization",
    "throughput expansion",
    "runtime performance tuning"
  ]
};

async function main(argv) {
  if (argv[0] === "version" || argv.includes("--version")) {
    const result = { name: "evopilot-harness", version: readPackageVersion(), engineApiVersion: "harness.evopilot.io/v3" };
    process.stdout.write(argv.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : `${result.name} ${result.version}\n`);
    return 0;
  }
  const v3 = await handleV3Command(argv);
  if (v3.handled) return v3.exitCode;
  const args = parseArgs(argv);
  const [group, action, idArg] = args.positionals;
  if (!group || args.options.help || args.options.h) {
    printHelp();
    return 0;
  }
  if (group === "catalog" && action === "publish") return publishCatalog(args);
  if (group === "catalog" && action === "validate") return validateCatalog(args);
  if (group === "registry" && action === "publish") return publishRegistry(args);
  if (group === "registry" && action === "validate") return validateRegistry(args);
  if (group === "harness" && action === "list") return listHarnesses(args);
  if (group === "harness" && action === "inspect") return inspectHarness(args, idArg);
  if (group === "harness" && action === "validate") return validateHarness(args, idArg);
  if (group === "harness" && action === "publish") return publishHarness(args, idArg);
  if (group === "harness" && action === "deprecate") return deprecateHarness(args, idArg);
  if (group === "asset" && action === "inspect") return inspectHarnessAsset(args, idArg);
  if (group === "asset" && action === "validate") return validateHarnessAssets(args, idArg);
  if (group === "evolution" && action === "list") return listEvolutions(args);
  if (group === "evolution" && action === "create") return createEvolution(args);
  if (group === "evolution" && action === "sources") return addEvolutionSources(args, idArg);
  if (group === "evolution" && action === "advance") return advanceEvolution(args, idArg);
  if (group === "evolution" && action === "review") return inspectEvolution(args, idArg);
  if (group === "evolution" && action === "approve") return approveEvolution(args, idArg);
  if (group === "evolution" && action === "publish") return publishEvolution(args, idArg);
  if (group === "evolution" && action === "impact") return evolutionImpact(args, idArg);
  if (group === "corpus" && action === "list") return listCorpora(args);
  if (group === "corpus" && action === "scan") return scanCorpus(args);
  if (group === "corpus" && action === "plan") return planCorpus(args);
  if (group === "corpus" && action === "review") return inspectCorpus(args, idArg);
  if (group === "corpus" && action === "approve") return approveCorpus(args, idArg);
  if (group === "corpus" && action === "publish") return publishCorpus(args, idArg);
  if (group === "detect" && action === "batch") return detectBatch(args);
  if (group === "detect") return detectSources(args);
  if (group === "evolve" && action === "corpus") return oneClickCorpusEvolve(args);
  if (group === "evolve") return oneClickEvolve(args);
  if (group === "llm" && action === "models") return inspectLlmModels(args);
  if (group === "llm" && action === "replay") return replayLlmAdvisor(args);
  if (group === "eval" && action === "run") return runUnknownSourceEval(args);
  if (group === "hub" && action === "snapshot") return hubSnapshot(args);
  if (group === "hub" && action === "serve") return serveHub(args);
  throw usage("Use: evopilot-harness <catalog|registry|harness|detect|corpus|evolution|evolve|llm|hub> --help.");
}

function publishRegistry(args) {
  const registryPath = registryFilePath(args);
  const catalogRoot = hubCatalogRoot(args);
  const catalogPath = path.join(catalogRoot, "CATALOG.md");
  if (!fs.existsSync(catalogPath)) throw usage(`CATALOG.md was not found in ${catalogRoot}. Run catalog publish first.`);
  const markdown = fs.readFileSync(catalogPath, "utf8");
  const block = extractCatalogBlock(markdown);
  if (!block) throw usage(`CATALOG.md must contain a non-empty ${CATALOG_BLOCK} YAML block.`);
  const parsed = parseYaml(block);
  const catalogId = safeId(stringOption(args, "catalog-id") ?? stringOption(args, "id") ?? parsed?.catalogId ?? path.basename(catalogRoot));
  const existing = readRegistryFileIfExists(registryPath);
  const catalogs = Array.isArray(existing.catalogs) ? existing.catalogs.filter((catalog) => isRecord(catalog)) : [];
  const updatedRef = {
    id: catalogId,
    enabled: args.options.disabled ? false : true,
    priority: numberOption(args, "priority", 100),
    root: stringOption(args, "root") ?? portableCatalogRoot(registryPath, catalogRoot),
    release: stringOption(args, "release") ?? `v${readPackageVersion()}`,
    expectedCatalogDigest: stringOption(args, "expected-catalog-digest") ?? digestText(markdown),
    description: stringOption(args, "description") ?? `Published Harness Catalog ${catalogId}`,
    owner: stringOption(args, "owner")
  };
  const nextCatalogs = catalogs
    .filter((catalog) => safeId(catalog.id) !== catalogId)
    .concat(updatedRef)
    .map(compactRecord)
    .sort(compareRegistryCatalogRefs);
  const registry = compactRecord({
    schema: REGISTRY_SCHEMA,
    generatedBy: "evopilot-harness",
    generatedAt: generatedTimestamp(args),
    catalogs: nextCatalogs
  });
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, stringifyYaml(registry), "utf8");
  const result = {
    schema: "evopilot-harness-registry-publish-result/v1",
    status: "PUBLISHED",
    registryPath,
    registryDigest: digestText(fs.readFileSync(registryPath, "utf8")),
    catalogId,
    catalogRoot,
    catalogDigest: digestText(markdown),
    catalogCount: nextCatalogs.length,
    nextAction: "configure-evopilot-with-EVOPILOT_HARNESS_REGISTRY_CONFIG"
  };
  printResult(args, result, `registry=${registryPath} catalogs=${nextCatalogs.length}`);
  return 0;
}

function validateRegistry(args) {
  const registryPath = registryFilePath(args);
  const result = validateRegistryResult(registryPath);
  printResult(args, result, `registry=${registryPath} status=${result.status} catalogs=${result.catalogCount}`);
  return result.blockers.length === 0 ? 0 : 2;
}

function validateRegistryResult(registryPath) {
  const checks = [];
  const catalogResults = [];
  let registry;
  if (!fs.existsSync(registryPath)) {
    checks.push({ id: "registry-file", status: "FAIL", evidence: [`missing=${registryPath}`] });
  } else {
    checks.push({ id: "registry-file", status: "PASS", evidence: [`path=${registryPath}`] });
    try {
      registry = parseYaml(fs.readFileSync(registryPath, "utf8"));
    } catch (error) {
      checks.push({ id: "registry-yaml", status: "FAIL", evidence: [error instanceof Error ? error.message : String(error)] });
    }
  }

  const registryRecord = isRecord(registry) ? registry : {};
  checks.push({
    id: "registry-schema",
    status: registryRecord.schema === REGISTRY_SCHEMA ? "PASS" : "FAIL",
    evidence: [`schema=${String(registryRecord.schema ?? "missing")}`]
  });
  if (Array.isArray(registryRecord.entries)) {
    checks.push({ id: "registry-no-entries", status: "FAIL", evidence: ["registry must not duplicate CATALOG.md entries"] });
  } else {
    checks.push({ id: "registry-no-entries", status: "PASS", evidence: ["entries=absent"] });
  }

  const catalogs = Array.isArray(registryRecord.catalogs) ? registryRecord.catalogs : [];
  checks.push({
    id: "registry-catalogs",
    status: catalogs.length > 0 ? "PASS" : "FAIL",
    evidence: [`count=${catalogs.length}`]
  });

  const seenIds = new Set();
  for (const catalog of catalogs) {
    const record = isRecord(catalog) ? catalog : {};
    const id = safeId(record.id ?? "");
    const enabled = record.enabled !== false;
    const rootValue = String(record.root ?? "").trim();
    const resolvedRoot = rootValue ? resolveRegistryCatalogRoot(registryPath, rootValue) : "";
    const result = {
      id: id || "missing",
      enabled,
      priority: numberOption({ options: record }, "priority", 0),
      root: rootValue,
      resolvedRoot,
      status: "SKIPPED",
      catalogDigest: undefined,
      blockers: []
    };
    catalogResults.push(result);
    if (!id) {
      checks.push({ id: "catalog:id", status: "FAIL", evidence: ["missing id"] });
      result.blockers.push("missing id");
    } else if (seenIds.has(id)) {
      checks.push({ id: `catalog:${id}:unique-id`, status: "FAIL", evidence: ["duplicate id"] });
      result.blockers.push("duplicate id");
    } else {
      seenIds.add(id);
      checks.push({ id: `catalog:${id}:id`, status: "PASS", evidence: [`id=${id}`] });
    }
    if (Array.isArray(record.entries)) {
      checks.push({ id: `catalog:${id || "missing"}:no-entries`, status: "FAIL", evidence: ["registry catalog refs must not duplicate CATALOG.md entries"] });
      result.blockers.push("registry catalog ref contains entries");
    }
    if (!rootValue) {
      checks.push({ id: `catalog:${id || "missing"}:root`, status: "FAIL", evidence: ["missing root"] });
      result.blockers.push("missing root");
      continue;
    }
    checks.push({ id: `catalog:${id || "missing"}:root`, status: "PASS", evidence: [`root=${rootValue}`] });
    if (!enabled) {
      result.status = "DISABLED";
      continue;
    }
    const catalogPath = path.join(resolvedRoot, "CATALOG.md");
    if (!fs.existsSync(catalogPath)) {
      checks.push({ id: `catalog:${id}:catalog-md`, status: "FAIL", evidence: [`missing=${catalogPath}`] });
      result.status = "FAILED";
      result.blockers.push(`missing=${catalogPath}`);
      continue;
    }
    checks.push({ id: `catalog:${id}:catalog-md`, status: "PASS", evidence: [`path=${catalogPath}`] });
    const markdown = fs.readFileSync(catalogPath, "utf8");
    result.catalogDigest = digestText(markdown);
    const block = extractCatalogBlock(markdown);
    if (!block) {
      checks.push({ id: `catalog:${id}:catalog-block`, status: "FAIL", evidence: [`block=${CATALOG_BLOCK}`] });
      result.status = "FAILED";
      result.blockers.push(`missing block=${CATALOG_BLOCK}`);
      continue;
    }
    checks.push({ id: `catalog:${id}:catalog-block`, status: "PASS", evidence: [`block=${CATALOG_BLOCK}`] });
    let parsed;
    try {
      parsed = parseYaml(block);
    } catch (error) {
      checks.push({ id: `catalog:${id}:catalog-yaml`, status: "FAIL", evidence: [error instanceof Error ? error.message : String(error)] });
      result.status = "FAILED";
      result.blockers.push("catalog yaml parse failed");
      continue;
    }
    const expectedDigest = stringOption({ options: record }, "expectedCatalogDigest") ?? stringOption({ options: record }, "expected-catalog-digest");
    if (expectedDigest && expectedDigest !== result.catalogDigest) {
      checks.push({ id: `catalog:${id}:digest`, status: "FAIL", evidence: [`expected=${expectedDigest}`, `actual=${result.catalogDigest}`] });
      result.status = "FAILED";
      result.blockers.push("catalog digest mismatch");
    } else {
      checks.push({ id: `catalog:${id}:digest`, status: "PASS", evidence: [`digest=${result.catalogDigest}`] });
      result.status = "VALIDATED";
    }
    if (parsed?.catalogId && safeId(parsed.catalogId) !== id) {
      checks.push({ id: `catalog:${id}:catalog-id`, status: "WARN", evidence: [`catalogId=${parsed.catalogId}`] });
    }
  }

  const blockers = checks.filter((check) => check.status === "FAIL").map((check) => `${check.id}:${check.evidence.join(",")}`);
  const result = {
    schema: "evopilot-harness-registry-validation-result/v1",
    status: blockers.length === 0 ? "VALIDATED" : "FAILED",
    registryPath,
    registryDigest: fs.existsSync(registryPath) ? digestText(fs.readFileSync(registryPath, "utf8")) : undefined,
    catalogCount: catalogs.length,
    enabledCount: catalogResults.filter((catalog) => catalog.enabled).length,
    catalogs: catalogResults,
    checks,
    blockers
  };
  return result;
}

function publishCatalog(args) {
  const source = path.resolve(stringOption(args, "source") ?? "harnesses");
  const out = path.resolve(stringOption(args, "out") ?? "published");
  const catalogId = safeId(stringOption(args, "catalog-id") ?? stringOption(args, "id") ?? "evopilot-public-harness-catalog");
  const names = stringListOption(args, "name");
  const packs = listHarnessPacks(source).filter((pack) => names.length === 0 || names.includes(pack.id));
  if (packs.length === 0) throw usage(`No Harness packs found in ${source}.`);
  if (args.options.strict) {
    const checks = packs.flatMap((pack) => validateHarnessTemplateContract(pack.template, {
      name: pack.id,
      version: pack.version,
      layer: pack.template.harnessLayer ?? pack.template.runtimePatterns?.harnessLayer,
      domain: pack.template.domain ?? pack.template.runtimePatterns?.domain
    }, { strict: true }));
    const blockers = checks.filter((check) => check.status === "FAIL").map((check) => `${check.id}:${check.evidence.join(",")}`);
    if (blockers.length > 0) {
      const result = { schema: "evopilot-harness-catalog-publish-result/v1", status: "FAILED", source, blockers, checks };
      printResult(args, result, `catalog=${catalogId} status=FAILED`);
      return 2;
    }
  }
  fs.mkdirSync(out, { recursive: true });
  const generatedAt = generatedTimestamp(args);
  const entries = packs.map((pack) => publishPack(pack, out, { generatedAt }));
  const catalog = {
    catalogVersion: 2,
    catalogId,
    generatedAt,
    assetApiVersion: HARNESS_ASSET_API_VERSION,
    assetKind: HARNESS_ASSET_KIND,
    generatedBy: "evopilot-harness",
    release: `v${readPackageVersion()}`,
    compatibleEvopilot: stringOption(args, "compatible-evopilot") ?? DEFAULT_COMPATIBLE_EVOPILOT,
    qualityReport: catalogQualityReport(entries),
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
      const assetPath = entry.assetPath ? path.resolve(source, String(entry.assetPath)) : path.join(path.dirname(file), "asset.yaml");
      if (fs.existsSync(assetPath) && assetPath.startsWith(source + path.sep)) {
        const asset = parseYaml(fs.readFileSync(assetPath, "utf8"));
        for (const check of validateHarnessAssetContract(asset, entry)) checks.push(check);
        const expectedAssetDigest = entry.assetDigest ? String(entry.assetDigest) : "";
        const actualAssetDigest = digestText(fs.readFileSync(assetPath, "utf8"));
        if (expectedAssetDigest) {
          checks.push({
            id: `asset:${entry.name}@${entry.version}:digest`,
            status: expectedAssetDigest === actualAssetDigest ? "PASS" : "FAIL",
            evidence: [`expected=${expectedAssetDigest}`, `actual=${actualAssetDigest}`]
          });
        }
      } else if (entry.assetPath) {
        checks.push({ id: `asset:${entry.name}@${entry.version}:asset-yaml`, status: "FAIL", evidence: [`missing=${entry.assetPath}`] });
      }
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
  const strict = Boolean(args.options.strict);
  const checks = packs.flatMap((pack) => validateHarnessTemplateContract(pack.template, {
    name: pack.id,
    version: pack.version,
    layer: pack.template.harnessLayer ?? pack.template.runtimePatterns?.harnessLayer,
    domain: pack.template.domain ?? pack.template.runtimePatterns?.domain
  }, { strict }));
  for (const pack of packs) {
    checks.unshift({ id: `pack:${pack.id}@${pack.version}:template`, status: "PASS", evidence: [path.relative(process.cwd(), pack.templatePath)] });
  }
  const quality = packs.map((pack) => templateQualitySummary(pack.template, pack.id));
  const blockers = checks.filter((check) => check.status === "FAIL").map((check) => `${check.id}:${check.evidence.join(",")}`);
  const result = {
    schema: "evopilot-harness-validation-result/v1",
    status: blockers.length === 0 ? "VALIDATED" : "FAILED",
    source,
    harnessCount: packs.length,
    strict,
    quality,
    checks,
    blockers
  };
  printResult(args, result, `status=${result.status} harnesses=${packs.length}`);
  return blockers.length === 0 ? 0 : 2;
}

function inspectHarnessAsset(args, idArg) {
  const source = path.resolve(stringOption(args, "source") ?? "harnesses");
  const id = safeId(idArg ?? requiredOption(args, "name"));
  const pack = findHarnessPack(source, id);
  if (!pack) throw usage(`Harness ${id} not found in ${source}.`);
  const asset = pack.asset ?? toHarnessAssetV2(pack, {
    sourceRoot: source,
    phase: pack.template.lifecycle?.status === "deprecated" ? "deprecated" : "source"
  });
  const result = {
    schema: "evopilot-harness-asset-inspect/v2",
    status: "FOUND",
    source,
    asset,
    assetDigest: digestText(stringifyYaml(asset)),
    checks: validateHarnessAssetContract(asset, packSummary(pack))
  };
  printResult(args, result, `asset=${pack.id}@${pack.version}`);
  return 0;
}

function validateHarnessAssets(args, idArg) {
  const source = path.resolve(stringOption(args, "source") ?? "harnesses");
  const ids = idArg ? [safeId(idArg)] : stringListOption(args, "name");
  const packs = listHarnessPacks(source).filter((pack) => ids.length === 0 || ids.includes(pack.id));
  if (packs.length === 0) throw usage(`No Harness packs found in ${source}.`);
  const checks = packs.flatMap((pack) => {
    const asset = pack.asset ?? toHarnessAssetV2(pack, {
      sourceRoot: source,
      phase: pack.template.lifecycle?.status === "deprecated" ? "deprecated" : "source"
    });
    return validateHarnessAssetContract(asset, packSummary(pack));
  });
  const blockers = checks.filter((check) => check.status === "FAIL").map((check) => `${check.id}:${check.evidence.join(",")}`);
  const result = {
    schema: "evopilot-harness-asset-validation-result/v2",
    status: blockers.length === 0 ? "VALIDATED" : "FAILED",
    source,
    assetCount: packs.length,
    checks,
    blockers
  };
  printResult(args, result, `asset-status=${result.status} assets=${packs.length}`);
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

function detectSources(args) {
  const sources = collectSourceInputs(args);
  if (sources.length === 0) throw usage("Supply at least one source with --source-project, --github-repo, --file, --attachment, --production-log, or --note.");
  const goal = stringOption(args, "goal") ?? stringOption(args, "intent") ?? "Detect the best Harness target for this source.";
  const result = detectHarnessForSources(args, sources, goal);
  printResult(args, publicDetectResult(result), `detect=${result.autoMatch.targetHarnessId} decision=${result.autoMatch.decision} confidence=${result.autoMatch.confidence}`);
  return 0;
}

function detectBatch(args) {
  const sourceRoot = path.resolve(requiredOption(args, "source-root"));
  if (!fs.existsSync(sourceRoot)) throw usage(`source-root not found: ${sourceRoot}`);
  const goal = stringOption(args, "goal") ?? stringOption(args, "intent") ?? "Detect the best Harness target for this source project.";
  const { projects, detections, limit } = detectProjectsUnderRoot(args, sourceRoot, goal);
  const result = {
    schema: "evopilot-harness-detect-batch-result/v1",
    status: "READY",
    sourceRoot,
    discoveredCount: projects.length,
    evaluatedCount: detections.length,
    detections,
    nextAction: "review-detections-and-run-evolve-for-selected-source-projects"
  };
  printResult(args, result, `detect-batch=${detections.length} sourceRoot=${sourceRoot}`);
  return 0;
}

function detectProjectsUnderRoot(args, sourceRoot, goal) {
  const limit = numberOption(args, "limit", 50);
  const projects = discoverSourceProjects(sourceRoot, {
    maxDepth: numberOption(args, "max-depth", 5),
    includeModules: Boolean(args.options["include-modules"]),
    limit
  });
  const detections = projects.slice(0, limit).map((project) => detectOneSourceProject(args, sourceRoot, project, goal));
  return { projects, detections, limit };
}

function detectOneSourceProject(args, sourceRoot, project, goal) {
  const source = sourceProjectSource(project.path);
  const detected = detectHarnessForSources(args, [source], goal);
  return {
    path: project.path,
    relativePath: path.relative(sourceRoot, project.path) || ".",
    rootType: project.rootType,
    markers: project.markers,
    status: detected.status,
    primaryRole: detected.sourceProfile.primaryRole,
    recommendedHarnessId: detected.sourceProfile.recommendedHarness?.id,
    recommendedHarness: detected.sourceProfile.recommendedHarness,
    decision: detected.autoMatch.decision,
    targetHarnessId: detected.autoMatch.targetHarnessId,
    targetDomain: detected.autoMatch.targetDomain,
    targetVersion: detected.autoMatch.targetVersion,
    confidence: detected.autoMatch.confidence,
    parentCandidates: detected.autoMatch.parentCandidates,
    topCandidates: detected.autoMatch.candidates.slice(0, 3).map((candidate) => ({
      harnessId: candidate.harnessId,
      score: candidate.score,
      boundaryFit: candidate.boundaryFit,
      roleFit: candidate.roleFit
    }))
  };
}

function listCorpora(args) {
  const dataRoot = evolutionDataRoot(args);
  const runs = listCorpusRuns(dataRoot);
  const result = {
    schema: "evopilot-harness-corpus-list/v1",
    status: "READY",
    dataRoot,
    count: runs.length,
    corpora: runs.map(corpusSummary)
  };
  printResult(args, result, `corpora=${runs.length}`);
  return 0;
}

function scanCorpus(args) {
  const sourceRoot = path.resolve(requiredOption(args, "source-root"));
  if (!fs.existsSync(sourceRoot)) throw usage(`source-root not found: ${sourceRoot}`);
  const goal = stringOption(args, "goal") ?? stringOption(args, "intent") ?? "Detect and group source projects for Harness evolution.";
  const { projects, detections } = detectProjectsUnderRoot(args, sourceRoot, goal);
  const grouping = groupCorpusDetections(args, sourceRoot, detections);
  const result = {
    schema: "evopilot-harness-corpus-scan-result/v1",
    status: "READY",
    sourceRoot,
    discoveredCount: projects.length,
    evaluatedCount: detections.length,
    groupCount: grouping.groups.length,
    duplicateCount: grouping.duplicateCount,
    detections,
    groups: grouping.groups.map((group) => corpusGroupScanSummary(group)),
    nextAction: "run-corpus-plan-to-generate-reviewable-drafts"
  };
  printResult(args, result, `corpus-scan=${detections.length} groups=${grouping.groups.length} duplicates=${grouping.duplicateCount}`);
  return 0;
}

async function planCorpus(args) {
  const run = await createCorpusRunFromArgs(args);
  printResult(args, corpusDetail(run), `corpus=${run.corpusId} status=${run.status} groups=${run.groups.length}`);
  return run.status === "BLOCKED" ? 2 : 0;
}

function inspectCorpus(args, idArg) {
  const run = readRequiredCorpus(args, idArg);
  printResult(args, corpusDetail(run), `corpus=${run.corpusId} status=${run.status}`);
  return 0;
}

function approveCorpus(args, idArg) {
  const run = readRequiredCorpus(args, idArg);
  const next = approveCorpusRun(args, run);
  printResult(args, corpusDetail(next), `corpus=${next.corpusId} status=${next.status}`);
  return 0;
}

function publishCorpus(args, idArg) {
  const run = readRequiredCorpus(args, idArg);
  const next = publishCorpusRun(args, run);
  printResult(args, corpusDetail(next), `corpus=${next.corpusId} status=${next.status}`);
  return 0;
}

async function oneClickCorpusEvolve(args) {
  const planned = await createCorpusRunFromArgs(args);
  let result = planned;
  if (args.options["approve-and-publish"]) {
    result = approveCorpusRun(args, result);
    result = publishCorpusRun(args, result);
  }
  printResult(args, corpusEvolveResult(result), `corpus=${result.corpusId} status=${result.status} groups=${result.groups.length}`);
  return result.status === "BLOCKED" ? 2 : 0;
}

async function createCorpusRunFromArgs(args) {
  const sourceRoot = path.resolve(requiredOption(args, "source-root"));
  if (!fs.existsSync(sourceRoot)) throw usage(`source-root not found: ${sourceRoot}`);
  const now = new Date().toISOString();
  const goal = stringOption(args, "goal") ?? stringOption(args, "intent") ?? "Batch evolve Harness definitions from this source project corpus.";
  const { projects, detections, limit } = detectProjectsUnderRoot(args, sourceRoot, goal);
  if (detections.length === 0) throw usage(`No valid source projects found under ${sourceRoot}.`);
  const corpusId = safeId(stringOption(args, "id") ?? `corpus-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${digestText(JSON.stringify({ sourceRoot, goal, detections: detections.map((item) => item.path) })).slice(7, 15)}`);
  const grouping = groupCorpusDetections(args, sourceRoot, detections);
  const baseRun = {
    schema: CORPUS_SCHEMA,
    corpusId,
    status: "PLANNING",
    goal,
    sourceRoot,
    createdAt: now,
    updatedAt: now,
    discovery: {
      sourceRoot,
      includeModules: Boolean(args.options["include-modules"]),
      maxDepth: numberOption(args, "max-depth", 5),
      limit,
      discoveredCount: projects.length,
      evaluatedCount: detections.length
    },
    detections,
    duplicateCount: grouping.duplicateCount,
    groups: [],
    validation: undefined,
    approval: undefined,
    publication: undefined,
    nextAction: "generate-corpus-drafts"
  };
  writeCorpusRun(args, baseRun);
  const groups = [];
  for (const group of grouping.groups) groups.push(await buildCorpusGroupDraft(args, baseRun, group));
  const validation = validateCorpusPlan(groups);
  const advisorBlocking = groups.some((group) => isLlmAdvisorBlocking(group.llmAdvisor));
  const status = advisorBlocking || validation.blockers.length > 0 ? "BLOCKED" : "REVIEW_REQUIRED";
  const run = {
    ...baseRun,
    status,
    updatedAt: new Date().toISOString(),
    groups,
    validation,
    workflow: {
      steps: [
        { id: "scan-source-root", status: "COMPLETED" },
        { id: "auto-match-projects", status: "COMPLETED" },
        { id: "group-and-dedupe", status: "COMPLETED" },
        { id: "generate-group-drafts", status: "COMPLETED" },
        { id: "validate-group-drafts", status: validation.blockers.length === 0 ? "COMPLETED" : "BLOCKED" }
      ]
    },
    nextAction: status === "BLOCKED" ? "repair-corpus-plan-validation" : "review-approve-corpus-plan"
  };
  writeCorpusRun(args, run);
  return run;
}

function groupCorpusDetections(args, sourceRoot, detections) {
  const maxProjectsPerGroup = Math.max(1, numberOption(args, "max-projects-per-group", DEFAULT_CORPUS_GROUP_LIMIT));
  const byTarget = new Map();
  for (const detection of detections) {
    const targetHarnessId = safeId(detection.targetHarnessId || detection.recommendedHarnessId || "domain-harness");
    if (!byTarget.has(targetHarnessId)) byTarget.set(targetHarnessId, []);
    byTarget.get(targetHarnessId).push(detection);
  }
  const groups = [];
  let duplicateCount = 0;
  for (const [targetHarnessId, items] of byTarget.entries()) {
    const sorted = [...items].sort(compareCorpusDetectionPriority);
    const selected = [];
    const duplicates = [];
    for (const detection of sorted) {
      const nestedParent = selected.find((item) => isNestedPath(detection.path, item.path));
      if (nestedParent) {
        duplicateCount += 1;
        duplicates.push({ ...detection, duplicateReason: `nested-module-of:${nestedParent.relativePath}` });
        continue;
      }
      if (selected.length >= maxProjectsPerGroup) {
        duplicateCount += 1;
        duplicates.push({ ...detection, duplicateReason: `same-target-over-limit:${maxProjectsPerGroup}` });
        continue;
      }
      selected.push(detection);
    }
    if (selected.length === 0 && sorted.length > 0) selected.push(sorted[0]);
    const representative = selected[0] ?? sorted[0] ?? {};
    groups.push({
      groupId: targetHarnessId,
      targetHarnessId,
      targetDomain: representative.targetDomain ?? representative.recommendedHarness?.domain ?? targetHarnessId.replace(/-harness$/, ""),
      decision: inferCorpusGroupDecision(selected.length ? selected : sorted),
      primaryRole: representative.primaryRole ?? "unknown",
      selectedProjects: selected.map((item) => corpusProjectRef(sourceRoot, item)),
      duplicateProjects: duplicates.map((item) => corpusProjectRef(sourceRoot, item, item.duplicateReason)),
      detections: sorted.map((item) => corpusProjectRef(sourceRoot, item))
    });
  }
  groups.sort((left, right) => {
    if (right.selectedProjects.length !== left.selectedProjects.length) return right.selectedProjects.length - left.selectedProjects.length;
    return left.targetHarnessId.localeCompare(right.targetHarnessId);
  });
  return { groups, duplicateCount };
}

async function buildCorpusGroupDraft(args, run, group) {
  const sourceRoot = path.resolve(stringOption(args, "source") ?? "harnesses");
  const sources = group.selectedProjects.map((project) => sourceProjectSource(project.path));
  const groupGoal = `${run.goal}\n\nCorpus group: ${group.targetHarnessId}\nSelected projects:\n${group.selectedProjects.map((project) => `- ${project.relativePath}`).join("\n")}`;
  const detection = detectHarnessForSources(args, sources, groupGoal, sourceRoot);
  const packs = detection.packs;
  const deterministicAutoMatch = forceCorpusTargetMatch(detection.autoMatch, group, packs);
  const syntheticRun = {
    evolutionId: `${run.corpusId}-${group.targetHarnessId}`,
    goal: groupGoal,
    sources
  };
  const llmAdvisor = await adviseHarnessEvolution(args, {
    run: syntheticRun,
    sourceCoverage: detection.sourceCoverage,
    sourceProfile: detection.sourceProfile,
    corpus: detection.corpus,
    packs,
    autoMatch: deterministicAutoMatch
  });
  const autoMatch = forceCorpusTargetMatch(applyLlmAdvisorToMatch(deterministicAutoMatch, llmAdvisor, packs, args), group, packs);
  const draft = createDraftPack(syntheticRun, autoMatch, detection.corpus, args, detection.sourceProfile);
  const validation = validateDraftPack(draft);
  writeCorpusDraftFiles(evolutionDataRoot(args), run.corpusId, group.groupId, draft);
  return {
    ...group,
    status: isLlmAdvisorBlocking(llmAdvisor) || validation.blockers.length > 0 ? "BLOCKED" : "REVIEW_REQUIRED",
    sourceCoverage: detection.sourceCoverage,
    sourceProfile: detection.sourceProfile,
    autoMatch,
    llmAdvisor,
    draft,
    validation,
    nextAction: validation.blockers.length === 0 ? "review-group-draft" : "repair-group-draft"
  };
}

function forceCorpusTargetMatch(autoMatch, group, packs) {
  const targetHarnessId = safeId(group.targetHarnessId);
  const pack = packs.find((item) => item.id === targetHarnessId);
  const candidate = autoMatch.candidates?.find((item) => item.harnessId === targetHarnessId);
  const decision = pack
    ? "EVOLVE_EXISTING"
    : group.decision === "CREATE_NEW_WITH_PARENT_REFERENCE" || group.duplicateProjects.length > 0
      ? "CREATE_NEW_WITH_PARENT_REFERENCE"
      : "CREATE_NEW";
  const parentCandidates = uniqueParentCandidates([
    ...(Array.isArray(autoMatch.parentCandidates) ? autoMatch.parentCandidates : []),
    ...group.detections.flatMap((item) => item.parentCandidates ?? [])
  ]);
  return {
    ...autoMatch,
    decision,
    targetHarnessId,
    targetVersion: pack ? bumpPatch(pack.version) : "0.1.0",
    targetDomain: safeId(group.targetDomain || autoMatch.targetDomain || targetHarnessId.replace(/-harness$/, "")),
    confidence: Number(Math.max(autoMatch.confidence ?? 0, candidate?.score ?? 0, ...group.detections.map((item) => item.confidence ?? 0)).toFixed(3)),
    baseHarnessRef: pack ? { id: pack.id, version: pack.version, digest: digestText(pack.templateText) } : undefined,
    parentCandidates,
    reasons: uniqueStrings([`corpus-group=${group.groupId}`, `selected-projects=${group.selectedProjects.length}`, ...(autoMatch.reasons ?? [])]).slice(0, 12),
    nextAction: "review-generated-corpus-draft"
  };
}

function validateCorpusPlan(groups) {
  const checks = [];
  for (const group of groups) {
    checks.push({
      id: `group:${group.groupId}:selected-projects`,
      status: group.selectedProjects.length > 0 ? "PASS" : "FAIL",
      evidence: [`count=${group.selectedProjects.length}`]
    });
    checks.push({
      id: `group:${group.groupId}:draft-validation`,
      status: group.validation?.status === "VALIDATED" ? "PASS" : "FAIL",
      evidence: [`status=${group.validation?.status ?? "missing"}`]
    });
    for (const blocker of group.validation?.blockers ?? []) {
      checks.push({ id: `group:${group.groupId}:blocker`, status: "FAIL", evidence: [blocker] });
    }
    if (isLlmAdvisorBlocking(group.llmAdvisor)) {
      checks.push({ id: `group:${group.groupId}:llm-advisor`, status: "FAIL", evidence: [`status=${group.llmAdvisor?.status ?? "missing"}`] });
    }
  }
  const blockers = checks.filter((check) => check.status === "FAIL").map((check) => `${check.id}:${check.evidence.join(",")}`);
  return {
    schema: "evopilot-harness-corpus-validation/v1",
    status: blockers.length === 0 ? "VALIDATED" : "FAILED",
    groupCount: groups.length,
    checks,
    blockers
  };
}

function approveCorpusRun(args, run) {
  if (run.status !== "REVIEW_REQUIRED") throw usage(`Only REVIEW_REQUIRED corpus runs can be approved. Current status=${run.status}.`);
  if (run.validation?.blockers?.length > 0) throw usage("Cannot approve corpus run with validation blockers.");
  const confirmedBy = stringOption(args, "confirmed-by");
  const confirmation = stringOption(args, "confirmation");
  if (!confirmedBy || !confirmation) throw usage("Approval requires --confirmed-by and --confirmation.");
  const next = {
    ...run,
    status: "APPROVED",
    updatedAt: new Date().toISOString(),
    approval: { confirmedBy, confirmation, approvedAt: new Date().toISOString() },
    nextAction: "publish-corpus-harnesses"
  };
  writeCorpusRun(args, next);
  return next;
}

function publishCorpusRun(args, run) {
  if (run.status !== "APPROVED") throw usage(`Only APPROVED corpus runs can be published. Current status=${run.status}.`);
  const harnessRoot = path.resolve(stringOption(args, "source") ?? "harnesses");
  const out = path.resolve(stringOption(args, "out") ?? "published");
  const publications = [];
  for (const group of run.groups) {
    const draft = group.draft;
    if (!draft?.templateYaml) throw usage(`Corpus group ${group.groupId} has no draft template.`);
    if (group.validation?.blockers?.length > 0) throw usage(`Corpus group ${group.groupId} has validation blockers.`);
    const targetRoot = path.join(harnessRoot, safeId(draft.harnessId));
    fs.mkdirSync(path.join(targetRoot, "examples"), { recursive: true });
    fs.writeFileSync(path.join(targetRoot, "template.yaml"), draft.templateYaml, "utf8");
    if (draft.assetYaml) fs.writeFileSync(path.join(targetRoot, "asset.yaml"), draft.assetYaml, "utf8");
    fs.writeFileSync(path.join(targetRoot, "README.md"), draft.readme, "utf8");
    fs.writeFileSync(path.join(targetRoot, "CHANGELOG.md"), draft.changelog, "utf8");
    fs.writeFileSync(path.join(targetRoot, "examples", "selected-harness-binding.yaml"), draft.exampleProfile, "utf8");
    publications.push({
      groupId: group.groupId,
      harnessId: draft.harnessId,
      version: draft.version,
      harnessRoot: targetRoot,
      selectedProjectCount: group.selectedProjects.length,
      duplicateProjectCount: group.duplicateProjects.length
    });
  }
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
  const catalogPath = path.join(out, "CATALOG.md");
  const next = {
    ...run,
    status: "PUBLISHED",
    updatedAt: new Date().toISOString(),
    publication: {
      publishedAt: new Date().toISOString(),
      harnessRoot,
      catalogRoot: out,
      catalogDigest: fs.existsSync(catalogPath) ? digestText(fs.readFileSync(catalogPath, "utf8")) : undefined,
      groups: publications
    },
    nextAction: "publish-registry-and-configure-evopilot"
  };
  writeCorpusRun(args, next);
  return next;
}

function corpusGroupScanSummary(group) {
  return {
    groupId: group.groupId,
    targetHarnessId: group.targetHarnessId,
    targetDomain: group.targetDomain,
    decision: group.decision,
    primaryRole: group.primaryRole,
    selectedProjectCount: group.selectedProjects.length,
    duplicateProjectCount: group.duplicateProjects.length,
    selectedProjects: group.selectedProjects,
    duplicateProjects: group.duplicateProjects
  };
}

function corpusProjectRef(sourceRoot, detection, duplicateReason) {
  return {
    path: detection.path,
    relativePath: detection.relativePath ?? (path.relative(sourceRoot, detection.path) || "."),
    rootType: detection.rootType,
    markers: detection.markers,
    primaryRole: detection.primaryRole,
    decision: detection.decision,
    targetHarnessId: detection.targetHarnessId,
    targetDomain: detection.targetDomain,
    confidence: detection.confidence,
    parentCandidates: detection.parentCandidates,
    topCandidates: detection.topCandidates,
    duplicateReason
  };
}

function compareCorpusDetectionPriority(left, right) {
  const leftDepth = pathDepth(left.relativePath);
  const rightDepth = pathDepth(right.relativePath);
  if (leftDepth !== rightDepth) return leftDepth - rightDepth;
  if ((right.confidence ?? 0) !== (left.confidence ?? 0)) return (right.confidence ?? 0) - (left.confidence ?? 0);
  return String(left.relativePath).localeCompare(String(right.relativePath));
}

function inferCorpusGroupDecision(detections) {
  if (detections.some((item) => item.decision === "EVOLVE_EXISTING")) return "EVOLVE_EXISTING";
  if (detections.some((item) => item.decision === "CREATE_NEW_WITH_PARENT_REFERENCE")) return "CREATE_NEW_WITH_PARENT_REFERENCE";
  if (detections.some((item) => item.decision === "FORK_FROM_MATCH")) return "FORK_FROM_MATCH";
  if (detections.some((item) => item.decision === "REVIEW_REQUIRED")) return "REVIEW_REQUIRED";
  return "CREATE_NEW";
}

function uniqueParentCandidates(candidates) {
  const seen = new Set();
  const refs = [];
  for (const candidate of candidates) {
    const id = safeId(candidate?.id ?? candidate?.harnessId ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    refs.push({ id, version: candidate.version, score: candidate.score, reason: candidate.reason ?? "corpus-parent-candidate" });
  }
  return refs.slice(0, 6);
}

function isNestedPath(child, parent) {
  const relative = path.relative(parent, child);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function pathDepth(relativePath) {
  const normalized = String(relativePath ?? ".").replace(/^\.$/, "");
  if (!normalized) return 0;
  return normalized.split(path.sep).filter(Boolean).length;
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

async function oneClickEvolve(args) {
  const run = createEvolutionRunFromArgs(args);
  const advanced = await advanceRunToReview(args, run);
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

async function advanceEvolution(args, idArg) {
  const run = readRequiredEvolution(args, idArg);
  const next = await advanceRunToReview(args, run);
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
        registryPath: hubRegistryPath(args),
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
  const registry = readHubRegistry(args);
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
    llmAdvisorStatus: run.llmAdvisor?.status,
    llmAdvisorRecommendation: run.llmAdvisor?.recommendation,
    validationStatus: run.validation?.status,
    publication: run.publication
  }));
  const corpora = listCorpusRuns(dataRoot).slice(0, 20).map((run) => ({
    ...corpusSummary(run),
    updatedAt: run.updatedAt,
    validationStatus: run.validation?.status,
    publication: run.publication
  }));
  return {
    schema: "evopilot-harness-hub-snapshot/v1",
    status: catalog.status === "READY" ? "READY" : "ATTENTION",
    generatedAt: generatedTimestamp(args),
    project: {
      name: "evopilot-harness",
      version: readPackageVersion(),
      compatibleEvopilot: DEFAULT_COMPATIBLE_EVOPILOT,
      boundary: "Harness lifecycle is managed here; EvoPilot reads the Harness registry and published Catalog directories at goal-plan time."
    },
    registry,
    catalog,
    harnesses,
    evolutions,
    corpora,
    sourceTypes: hubSourceTypes(),
    lifecycleCommands: lifecycleCommandModel(),
    nextAction: catalog.status === "READY" ? "use-hub-review-evolve-or-publish-registry" : "run-catalog-publish-and-validate"
  };
}

function readHubRegistry(args) {
  const registryPath = hubRegistryPath(args);
  if (!registryPath) {
    return {
      status: "NOT_CONFIGURED",
      registryPath: undefined,
      catalogCount: 0,
      enabledCount: 0,
      catalogs: [],
      blockers: []
    };
  }
  const result = validateRegistryResult(registryPath);
  return {
    status: result.status,
    registryPath,
    registryDigest: result.registryDigest,
    catalogCount: result.catalogCount,
    enabledCount: result.enabledCount,
    catalogs: result.catalogs,
    blockers: result.blockers
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
    assetPath: entry.assetPath,
    assetDigest: entry.assetDigest,
    assetApiVersion: entry.apiVersion,
    assetKind: entry.kind,
    qualityScore: entry.qualityScore,
    qualityStatus: entry.qualityStatus,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    matchSummary: entry.matchSummary,
    contract
  };
}

function templateContractSummary(template) {
  const domainExecution = isRecord(template.runtimePatterns?.domainExecution) ? template.runtimePatterns.domainExecution : {};
  const quality = templateQualitySummary(template);
  return {
    requiredActionCount: Array.isArray(domainExecution.requiredActions) ? domainExecution.requiredActions.length : 0,
    evidenceAdapterCount: Array.isArray(domainExecution.evidenceAdapters) ? domainExecution.evidenceAdapters.length : 0,
    releaseBlockerCount: Array.isArray(domainExecution.releaseBlockers) ? domainExecution.releaseBlockers.length : 0,
    requiredActions: labels(domainExecution.requiredActions, "id").slice(0, 6),
    evidenceAdapters: labels(domainExecution.evidenceAdapters, "id").slice(0, 6),
    releaseBlockers: Array.isArray(domainExecution.releaseBlockers) ? domainExecution.releaseBlockers.slice(0, 6).map(String) : [],
    quality
  };
}

function lifecycleCommands(harnessId) {
  return {
    detect: `evopilot-harness detect --source-project /path/to/source-project --goal "Match ${harnessId}" --json`,
    detectGithub: `evopilot-harness detect --github-repo owner/repo --goal "Match ${harnessId}" --json`,
    inspect: `evopilot-harness harness inspect ${harnessId} --json`,
    validate: `evopilot-harness harness validate ${harnessId} --strict --json`,
    publish: `evopilot-harness harness publish ${harnessId} --source harnesses --out published --json`,
    evolve: `evopilot-harness evolve --source-project /path/to/source-project --goal "Evolve ${harnessId}" --json`,
    evolveGithub: `evopilot-harness evolve --github-repo owner/repo --goal "Evolve ${harnessId}" --json`
  };
}

function lifecycleCommandModel() {
  return [
    { id: "detect", label: "Detect source profile and Harness target", command: "evopilot-harness detect --source-project /path/to/source-project --goal \"...\" --json" },
    { id: "detect-github", label: "Detect a GitHub repository Harness target", command: "evopilot-harness detect --github-repo owner/repo --goal \"...\" --json" },
    { id: "corpus-scan", label: "Scan and group a source corpus", command: "evopilot-harness corpus scan --source-root /path/to/project-root --json" },
    { id: "corpus-plan", label: "Generate reviewable corpus Harness drafts", command: "evopilot-harness corpus plan --source-root /path/to/project-root --include-modules --json" },
    { id: "corpus-evolve", label: "One-command corpus evolution", command: "evopilot-harness evolve corpus --source-root /path/to/project-root --json" },
    { id: "llm-models", label: "Inspect local EvoPilot GLM config", command: "evopilot-harness llm models --json" },
    { id: "asset-validate", label: "Validate Harness Asset v2 envelopes", command: "evopilot-harness asset validate --source published --json" },
    { id: "unknown-source-eval", label: "Run unknown-source matching evals", command: "evopilot-harness eval run --json" },
    { id: "llm-replay", label: "Replay LLM Advisor fixtures", command: "evopilot-harness llm replay --json" },
    { id: "scan-auto-match", label: "Scan and auto-match", command: "evopilot-harness evolve --source-project /path/to/source-project --goal \"...\" --json" },
    { id: "github-evolve", label: "One-command GitHub repository evolution", command: "evopilot-harness evolve --github-repo owner/repo --github-ref main --goal \"...\" --json" },
    { id: "review-draft", label: "Review draft", command: "evopilot-harness evolution review <evolution-id> --json" },
    { id: "approve", label: "Approve", command: "evopilot-harness evolution approve <evolution-id> --confirmed-by <actor> --confirmation <text> --json" },
    { id: "publish", label: "Publish usable Harness", command: "evopilot-harness evolution publish <evolution-id> --json" },
    { id: "strict-validate", label: "Strict template quality validation", command: "evopilot-harness harness validate --strict --json" },
    { id: "validate-catalog", label: "Validate Catalog", command: "evopilot-harness catalog validate --source published --json" },
    { id: "publish-registry", label: "Publish Registry", command: "evopilot-harness registry publish --catalog published --registry harness-registry.yaml --json" },
    { id: "validate-registry", label: "Validate Registry", command: "evopilot-harness registry validate --registry harness-registry.yaml --json" }
  ];
}

function hubSourceTypes() {
  return [
    { id: "source-project", label: "Source Project", description: "Local code, architecture docs, tests, manifests, and runbooks." },
    { id: "github-repository", label: "GitHub Repository", description: "GitHub URL, SSH remote, owner/repo shorthand, or git URL cloned into the local source cache." },
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

function hubRegistryPath(args) {
  const configured = stringOption(args, "registry") ?? process.env.EVOPILOT_HARNESS_REGISTRY_CONFIG;
  if (configured) return path.resolve(configured);
  const defaultPath = path.resolve("harness-registry.yaml");
  return fs.existsSync(defaultPath) ? defaultPath : undefined;
}

function hubSourceRoot(args) {
  return path.resolve(stringOption(args, "source") ?? process.env.EVOPILOT_HARNESS_SOURCE_ROOT ?? "harnesses");
}

function createEvolutionRunFromArgs(args) {
  const sources = collectSourceInputs(args);
  if (sources.length === 0) throw usage("Supply at least one source with --source-project, --github-repo, --file, --production-log, or --note.");
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
    sourceProfile: undefined,
    autoMatch: undefined,
    llmAdvisor: undefined,
    draft: undefined,
    validation: undefined,
    approval: undefined,
    publication: undefined,
    nextAction: "advance-evolution"
  };
  writeEvolutionRun(args, run);
  return run;
}

async function advanceRunToReview(args, run) {
  if (run.status === "APPROVED" || run.status === "PUBLISHED") return run;
  const source = path.resolve(stringOption(args, "source") ?? "harnesses");
  const dataRoot = evolutionDataRoot(args);
  const detection = detectHarnessForSources(args, run.sources, run.goal, source);
  const { sourceCoverage, sourceProfile, corpus, packs } = detection;
  const deterministicAutoMatch = detection.autoMatch;
  const llmAdvisor = await adviseHarnessEvolution(args, { run, sourceCoverage, sourceProfile, corpus, packs, autoMatch: deterministicAutoMatch });
  const autoMatch = applyLlmAdvisorToMatch(deterministicAutoMatch, llmAdvisor, packs, args);
  const draft = createDraftPack(run, autoMatch, corpus, args, sourceProfile);
  const validation = validateDraftPack(draft);
  const advisorBlocking = isLlmAdvisorBlocking(llmAdvisor);
  const nextStatus = advisorBlocking || validation.blockers.length > 0 ? "BLOCKED" : "REVIEW_REQUIRED";
  writeDraftFiles(dataRoot, run.evolutionId, draft);
  const next = {
    ...run,
    status: nextStatus,
    updatedAt: new Date().toISOString(),
    sourceCoverage,
    sourceProfile,
    autoMatch,
    llmAdvisor,
    draft,
    validation,
    workflow: {
      steps: [
        { id: "collect-sources", status: "COMPLETED" },
        { id: "auto-match", status: "COMPLETED" },
        { id: "llm-advisor", status: advisorWorkflowStatus(llmAdvisor) },
        { id: "generate-draft", status: "COMPLETED" },
        { id: "validate-draft", status: validation.blockers.length === 0 ? "COMPLETED" : "BLOCKED" }
      ]
    },
    nextAction: advisorBlocking ? llmAdvisor.nextAction : validation.blockers.length === 0 ? "review-approve-harness" : "repair-draft-validation"
  };
  writeEvolutionRun(args, next);
  return next;
}

function detectHarnessForSources(args, sources, goal, sourceRootOverride) {
  const source = path.resolve(sourceRootOverride ?? stringOption(args, "source") ?? "harnesses");
  const sourceCoverage = buildSourceCoverage(sources);
  const corpus = buildCorpus(sources);
  const sourceProfile = buildSourceProfile(sources, corpus, goal);
  const packs = listHarnessPacks(source);
  const autoMatch = autoMatchHarness(packs, sourceProfile, corpus, goal, args);
  return {
    schema: DETECT_SCHEMA,
    status: "READY",
    sourceRoot: source,
    sourceCoverage,
    sourceProfile,
    autoMatch,
    nextAction: autoMatch.decision === "REVIEW_REQUIRED" ? "review-candidate-match" : "run-evolve-or-review-draft",
    corpus,
    packs
  };
}

function publicDetectResult(result) {
  return {
    schema: result.schema,
    status: result.status,
    sourceRoot: result.sourceRoot,
    sourceCoverage: result.sourceCoverage,
    sourceProfile: result.sourceProfile,
    autoMatch: result.autoMatch,
    nextAction: result.nextAction
  };
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
  if (draft.assetYaml) fs.writeFileSync(path.join(targetRoot, "asset.yaml"), draft.assetYaml, "utf8");
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
  const githubRepos = stringListRaw(args, "github-repo");
  for (let index = 0; index < githubRepos.length; index += 1) sources.push(githubRepositorySource(args, githubRepos[index], index));
  const files = [...stringListRaw(args, "file"), ...stringListRaw(args, "attachment")];
  for (const file of files) sources.push(fileSource(file, "attachment"));
  for (const file of stringListRaw(args, "production-log")) sources.push(fileSource(file, "production-log"));
  for (const note of stringListRaw(args, "note")) sources.push(noteSource(note));
  return sources;
}

function sourceProjectSource(projectPath) {
  const absolute = path.resolve(projectPath);
  if (!fs.existsSync(absolute)) throw usage(`source-project not found: ${projectPath}`);
  return scannedProjectSource({
    root: absolute,
    type: "source-project",
    name: path.basename(absolute),
    uri: absolute,
    idPrefix: "source"
  });
}

function githubRepositorySource(args, repoInput, index) {
  const repo = normalizeGithubRepositoryInput(repoInput);
  const ref = stringOption(args, "github-ref");
  const cacheRoot = path.resolve(stringOption(args, "github-cache-root") ?? path.join(evolutionDataRoot(args), "github-sources"));
  const cacheId = `${safeId(repo.repository)}-${digestText(`${repo.cloneUrl}\n${ref ?? ""}\n${index}`).slice(7, 15)}`;
  const repoPath = path.join(cacheRoot, cacheId, "repo");
  const checkout = checkoutGitRepository(repo.cloneUrl, repoPath, ref, numberOption(args, "github-depth", DEFAULT_GITHUB_CLONE_DEPTH));
  return scannedProjectSource({
    root: repoPath,
    type: "github-repository",
    name: repo.repository,
    uri: repo.displayUrl,
    idPrefix: "github",
    metadata: {
      github: {
        repository: repo.repository,
        input: maskSecretText(repoInput),
        upstreamUrl: repo.displayUrl,
        ref: ref ?? checkout.ref,
        resolvedCommit: checkout.resolvedCommit,
        cachePath: repoPath
      }
    }
  });
}

function scannedProjectSource({ root, type, name, uri, idPrefix, metadata = {} }) {
  const scan = scanSourceProject(root);
  const rawText = scan.extractedText;
  const redactedText = redactSensitiveText(scan.extractedText);
  const sensitiveMaterialFindings = detectSensitiveMaterial(scan.extractedText);
  scan.extractedText = redactedText;
  scan.sensitiveMaterialFindings = sensitiveMaterialFindings;
  return {
    id: `${idPrefix}-${safeId(name)}-${digestText(`${uri}\n${root}`).slice(7, 15)}`,
    type,
    name,
    uri: maskSecretText(uri),
    digest: digestText(JSON.stringify({ scan, metadata })),
    scan,
    redactionApplied: redactedText !== rawText || sensitiveMaterialFindings.length > 0,
    contentText: scan.extractedText,
    ...metadata
  };
}

function normalizeGithubRepositoryInput(repoInput) {
  const input = String(repoInput ?? "").trim();
  if (!input) throw usage("Missing --github-repo value.");
  const shorthand = input.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shorthand) {
    const repository = `${shorthand[1]}/${shorthand[2].replace(/\.git$/i, "")}`;
    return {
      repository,
      cloneUrl: `https://github.com/${repository}.git`,
      displayUrl: `https://github.com/${repository}`
    };
  }
  const sshGithub = input.match(/^git@github\.com:([^/\s]+)\/(.+?)(?:\.git)?$/i);
  if (sshGithub) {
    const repository = `${sshGithub[1]}/${sshGithub[2].replace(/\.git$/i, "")}`;
    return {
      repository,
      cloneUrl: input,
      displayUrl: `git@github.com:${repository}.git`
    };
  }
  if (/^https?:\/\/github\.com\//i.test(input)) {
    try {
      const url = new URL(input);
      if (url.username || url.password) throw usage("Do not include credentials in --github-repo. Use local Git credentials or SSH.");
      const [owner, repoName] = url.pathname.split("/").filter(Boolean);
      if (owner && repoName) {
        const repository = `${owner}/${repoName.replace(/\.git$/i, "")}`;
        return {
          repository,
          cloneUrl: `https://github.com/${repository}.git`,
          displayUrl: `https://github.com/${repository}`
        };
      }
    } catch (error) {
      if (error?.name === "UsageError") throw error;
      throw usage(`Invalid --github-repo URL: ${maskSecretText(input)}`);
    }
  }
  if (input.startsWith("file://")) {
    const fileUrl = new URL(input);
    const repository = `local/${path.basename(fileUrl.pathname).replace(/\.git$/i, "") || "repository"}`;
    return {
      repository,
      cloneUrl: input,
      displayUrl: maskSecretText(input)
    };
  }
  if (fs.existsSync(input)) {
    const absolute = path.resolve(input);
    return {
      repository: `local/${path.basename(absolute).replace(/\.git$/i, "") || "repository"}`,
      cloneUrl: absolute,
      displayUrl: absolute
    };
  }
  if (/^(ssh|git|https?):\/\//i.test(input)) {
    try {
      const url = new URL(input);
      if (["http:", "https:"].includes(url.protocol) && (url.username || url.password)) {
        throw usage("Do not include credentials in --github-repo. Use local Git credentials or SSH.");
      }
    } catch (error) {
      if (error?.name === "UsageError") throw error;
    }
    return {
      repository: inferRepositoryName(input),
      cloneUrl: input,
      displayUrl: maskSecretText(input)
    };
  }
  throw usage("github-repo must be a GitHub URL, git@github.com:owner/repo.git, owner/repo, or a git URL.");
}

function checkoutGitRepository(cloneUrl, repoPath, ref, depth) {
  const cloneDepth = Math.max(0, Number(depth) || 0);
  fs.mkdirSync(path.dirname(repoPath), { recursive: true });
  const gitDir = path.join(repoPath, ".git");
  try {
    if (!fs.existsSync(gitDir)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
      const cloneArgs = ["clone", "--no-tags"];
      if (cloneDepth > 0) cloneArgs.push("--depth", String(cloneDepth));
      if (ref && !looksLikeCommitSha(ref)) cloneArgs.push("--branch", ref);
      cloneArgs.push(cloneUrl, repoPath);
      try {
        gitExec(cloneArgs);
      } catch (error) {
        if (!ref || looksLikeCommitSha(ref)) throw error;
        fs.rmSync(repoPath, { recursive: true, force: true });
        const fallbackArgs = ["clone", "--no-tags"];
        if (cloneDepth > 0) fallbackArgs.push("--depth", String(cloneDepth));
        fallbackArgs.push(cloneUrl, repoPath);
        gitExec(fallbackArgs);
      }
    } else {
      gitExec(["-C", repoPath, "remote", "set-url", "origin", cloneUrl]);
      gitExec(["-C", repoPath, "fetch", "--prune", "--tags", "origin"]);
    }
    if (ref) checkoutGitRef(repoPath, ref, cloneDepth);
    const resolvedCommit = gitExec(["-C", repoPath, "rev-parse", "HEAD"]).trim();
    const branch = gitExec(["-C", repoPath, "branch", "--show-current"]).trim();
    return {
      ref: ref ?? (branch || "HEAD"),
      resolvedCommit
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw usage(`GitHub repository checkout failed for ${maskSecretText(cloneUrl)}: ${maskSecretText(message)}`);
  }
}

function checkoutGitRef(repoPath, ref, depth) {
  const fetchDepth = Math.max(0, Number(depth) || 0);
  const attempts = [
    () => gitExec(["-C", repoPath, "checkout", "--detach", ref]),
    () => gitExec(["-C", repoPath, "checkout", "--detach", `origin/${ref}`]),
    () => {
      const fetchArgs = ["-C", repoPath, "fetch", "origin"];
      if (fetchDepth > 0) fetchArgs.push("--depth", String(fetchDepth));
      fetchArgs.push(ref);
      gitExec(fetchArgs);
      return gitExec(["-C", repoPath, "checkout", "--detach", "FETCH_HEAD"]);
    }
  ];
  let lastError;
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Unable to checkout ref ${ref}.`);
}

function gitExec(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr) : "";
    const stdout = error?.stdout ? String(error.stdout) : "";
    const message = [stderr, stdout, error instanceof Error ? error.message : ""].filter(Boolean).join("\n").trim();
    throw new Error(maskSecretText(message || `git ${args.join(" ")} failed`));
  }
}

function looksLikeCommitSha(value) {
  return /^[0-9a-f]{7,40}$/i.test(String(value ?? "").trim());
}

function inferRepositoryName(input) {
  const text = String(input ?? "").replace(/[#?].*$/, "").replace(/\.git$/i, "");
  const parts = text.split(/[/:]/).filter(Boolean);
  const repo = parts.pop() ?? "repository";
  const owner = parts.pop() ?? "remote";
  return `${safeId(owner)}/${safeId(repo)}`;
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
    files: files.map((file) => path.relative(root, file)).slice(0, 260),
    selectedFiles: selected.map((file) => path.relative(root, file)),
    extractedText: excerpts.join("\n\n").slice(0, 120_000)
  };
}

function walk(dir, files, limit) {
  if (files.length >= limit) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (files.length >= limit) return;
    if ([".git", ".svn", ".hg", ".idea", ".settings", "node_modules", "dist", "build", "target", ".next", "coverage", ".evopilot-harness"].includes(entry.name)) continue;
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
      uri: source.uri,
      github: source.github,
      redactionApplied: Boolean(source.redactionApplied),
      sensitiveMaterialFindings: source.scan?.sensitiveMaterialFindings ?? detectSensitiveMaterial(source.contentText ?? ""),
      knowledgeCategory: source.type === "production-log" ? "runtime-operations" : isProjectCodeSource(source) ? "source-architecture" : "supporting-material",
      projectActions: projectActionsForSource(source),
      scan: source.scan ? {
        fileCount: source.scan.fileCount,
        selectedFileCount: source.scan.selectedFileCount,
        topExtensions: source.scan.topExtensions,
        selectedFiles: source.scan.selectedFiles?.slice(0, 80)
      } : undefined
    }))
  };
}

function projectActionsForSource(source) {
  if (source.type === "production-log") return ["extract failure modes", "add diagnostics and observability evidence"];
  if (isProjectCodeSource(source)) return ["extract domain capabilities", "match or create Harness", "generate draft pack"];
  return ["review source material", "map reusable Harness guidance"];
}

function isProjectCodeSource(source) {
  return ["source-project", "github-repository"].includes(source.type);
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

function buildSourceProfile(sources, corpus, goal) {
  const allFiles = uniqueStrings(sources.flatMap((source) => source.scan?.files ?? source.scan?.selectedFiles ?? []));
  const selectedFiles = uniqueStrings(sources.flatMap((source) => source.scan?.selectedFiles ?? []));
  const dependencies = extractDependencies(corpus.text, allFiles);
  const imports = extractJavaImports(corpus.text);
  const symbols = extractSymbols(corpus.text);
  const languages = detectLanguages(sources, allFiles, corpus.text);
  const buildTools = detectBuildTools(allFiles, corpus.text);
  const frameworks = detectFrameworks(dependencies, imports, symbols, corpus.text);
  const architectureSignals = inferArchitectureSignals({ dependencies, imports, symbols, selectedFiles, allFiles, text: corpus.text, goal });
  const roles = inferSourceRoles({ dependencies, imports, symbols, selectedFiles, allFiles, architectureSignals, text: corpus.text, goal });
  const primaryRole = roles[0]?.id ?? "unknown";
  const recommendedHarness = recommendHarnessForRole(primaryRole, { dependencies, imports, symbols, architectureSignals, text: corpus.text, goal });
  const negativeSignals = inferNegativeSignals({ roles, dependencies, imports, symbols, architectureSignals, text: corpus.text });
  const scannerEvidence = buildScannerEvidence({ sources, allFiles, selectedFiles, dependencies, imports, symbols, languages, buildTools, frameworks, architectureSignals, roles, text: corpus.text, goal });
  const uncertainty = sourceProfileUncertainty({ roles, recommendedHarness, scannerEvidence, negativeSignals, sources });
  const positiveSignals = uniqueStrings([
    ...dependencies.slice(0, 20),
    ...frameworks,
    ...symbols.slice(0, 20),
    ...architectureSignals,
    primaryRole
  ]);
  return {
    schema: SOURCE_PROFILE_SCHEMA,
    digest: corpus.digest,
    sourceCount: sources.length,
    sourceTypes: uniqueStrings(sources.map((source) => source.type)),
    projectRoots: sources.filter(isProjectCodeSource).map((source) => source.scan?.root ?? source.uri),
    githubRepositories: sources.filter((source) => source.type === "github-repository").map((source) => source.github).filter(Boolean),
    languages,
    buildTools,
    frameworks,
    dependencies,
    imports: imports.slice(0, 80),
    symbols: symbols.slice(0, 80),
    selectedFiles: selectedFiles.slice(0, 120),
    architectureSignals,
    roles,
    primaryRole,
    recommendedHarness,
    scannerVersion: "unknown-source-scanner/v2",
    scanners: scannerEvidence,
    scannerSummary: scannerSummary(scannerEvidence),
    positiveSignals,
    negativeSignals,
    uncertainty,
    sensitiveMaterialFindings: uniqueStrings(sources.flatMap((source) => source.scan?.sensitiveMaterialFindings ?? detectSensitiveMaterial(source.contentText ?? ""))),
    goalDigest: digestText(goal)
  };
}

function buildScannerEvidence(context) {
  const text = normalizeForMatch([context.text, context.goal].join("\n"));
  const evidence = [];
  const add = (id, type, signals, confidence, rawEvidence = signals) => {
    const normalizedSignals = uniqueStrings(signals).slice(0, 16);
    evidence.push({
      id,
      type,
      status: normalizedSignals.length > 0 ? "MATCHED" : "SKIPPED",
      confidence: Number(clamp(confidence, 0, 1).toFixed(2)),
      signals: normalizedSignals,
      evidence: uniqueStrings(rawEvidence).slice(0, 16)
    });
  };
  add("file-extension", "filesystem", context.allFiles.map((file) => path.extname(file).toLowerCase()).filter(Boolean), context.allFiles.length > 0 ? 0.55 : 0);
  add("manifest", "manifest", context.buildTools, context.buildTools.length > 0 ? 0.82 : 0, context.selectedFiles.filter((file) => /pom\.xml|package\.json|go\.mod|pyproject\.toml|Cargo\.toml/i.test(file)));
  add("dependency", "dependency", context.dependencies.slice(0, 20), context.dependencies.length > 0 ? 0.86 : 0);
  add("import", "source-code", context.imports.slice(0, 20), context.imports.length > 0 ? 0.72 : 0);
  add("symbol", "source-code", context.symbols.slice(0, 20), context.symbols.length > 0 ? 0.78 : 0);
  add("architecture-text", "semantic", context.architectureSignals, context.architectureSignals.length > 0 ? 0.88 : 0);
  add("role-inference", "semantic", context.roles.map((role) => role.id), context.roles[0]?.confidence ?? 0, context.roles.flatMap((role) => role.evidence ?? []));
  if (context.sources.some((source) => source.type === "production-log")) {
    add("runtime-log", "runtime-log", runtimeLogSignals(text), 0.76);
  }
  if (context.sources.some((source) => source.redactionApplied)) {
    add("sensitive-material", "governance", ["redaction-applied"], 0.7);
  }
  return evidence;
}

function runtimeLogSignals(text) {
  const signals = [];
  if (/timeout|connection refused|reset|unavailable|failover|error|exception/.test(text)) signals.push("failure-mode");
  if (/requestid|traceid|spanid|correlation/.test(text)) signals.push("correlation-context");
  if (/latency|p99|qps|throughput|slow/.test(text)) signals.push("performance-signal");
  return signals;
}

function scannerSummary(scannerEvidence) {
  const matched = scannerEvidence.filter((scanner) => scanner.status === "MATCHED");
  return {
    matchedCount: matched.length,
    totalCount: scannerEvidence.length,
    topSignals: uniqueStrings(matched.flatMap((scanner) => scanner.signals)).slice(0, 24),
    confidence: Number((matched.reduce((sum, scanner) => sum + scanner.confidence, 0) / Math.max(matched.length, 1)).toFixed(2))
  };
}

function sourceProfileUncertainty({ roles, recommendedHarness, scannerEvidence, negativeSignals, sources }) {
  const reasons = [];
  const topRole = roles[0];
  const secondRole = roles[1];
  if (!topRole) reasons.push("no-source-role-detected");
  if (topRole && secondRole && Math.abs(topRole.confidence - secondRole.confidence) < 0.12) reasons.push("close-role-confidence");
  if ((recommendedHarness?.confidence ?? 0) < 0.6) reasons.push("low-recommended-harness-confidence");
  if (scannerEvidence.filter((scanner) => scanner.status === "MATCHED").length < 3) reasons.push("low-scanner-coverage");
  if (negativeSignals.length > 0) reasons.push("negative-boundary-signals-present");
  if (sources.some((source) => !isProjectCodeSource(source))) reasons.push("non-code-source-material-present");
  return {
    status: reasons.length > 0 ? "REVIEWABLE" : "LOW",
    reasons: uniqueStrings(reasons),
    confidence: Number(clamp(1 - reasons.length * 0.14, 0.2, 0.95).toFixed(2))
  };
}

function autoMatchHarness(packs, sourceProfile, corpus, goal, args) {
  const explicitTarget = stringOption(args, "target-id");
  const recommended = sourceProfile.recommendedHarness;
  const candidates = packs.map((pack) => scoreHarnessCandidate(pack, sourceProfile, corpus, goal)).sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return right.priority - left.priority;
  });
  const best = candidates[0];
  const second = candidates[1];
  const matchThreshold = numberOption(args, "match-threshold", DEFAULT_MATCH_THRESHOLD);
  const ambiguous = Boolean(best && second && best.score >= 0.25 && Math.abs(best.score - second.score) < AMBIGUOUS_MATCH_DELTA);
  const existingRecommended = recommended?.id ? packs.find((pack) => pack.id === recommended.id) : undefined;
  const recommendedCandidate = existingRecommended ? candidates.find((candidate) => candidate.harnessId === existingRecommended.id) : undefined;
  const parentCandidates = parentCandidateRefs(packs, candidates, recommended);
  let targetHarnessId = safeId(explicitTarget ?? recommended?.id ?? (best && best.score >= matchThreshold ? best.harnessId : inferHarnessId(goal, corpus)));
  let decision = "CREATE_NEW";
  let confidence = best?.score ?? 0;
  let basePack;
  let targetVersion = "0.1.0";
  let reasons = [];

  if (explicitTarget) {
    const explicitPack = packs.find((pack) => pack.id === targetHarnessId);
    const explicitCandidate = candidates.find((candidate) => candidate.harnessId === targetHarnessId);
    const matched = explicitCandidate && explicitCandidate.score >= matchThreshold && explicitCandidate.boundaryFit !== "mismatch";
    decision = explicitPack && matched ? "EVOLVE_EXISTING" : best && best.score >= 0.25 ? "FORK_FROM_MATCH" : "CREATE_NEW";
    basePack = decision === "EVOLVE_EXISTING" ? explicitPack : decision === "FORK_FROM_MATCH" ? best?.basePack : undefined;
    targetVersion = basePack ? bumpPatch(basePack.version) : "0.1.0";
    confidence = Number((explicitCandidate?.score ?? best?.score ?? 0).toFixed(3));
    reasons = [`explicit-target=${targetHarnessId}`, ...(explicitCandidate?.matchedEvidence ?? best?.matchedEvidence ?? [])];
  } else if (existingRecommended && recommendedCandidate && recommendedCandidate.boundaryFit !== "mismatch" && (
    recommendedCandidate.score >= matchThreshold
    || (recommendedCandidate.roleFit === "strong" && Number(recommended?.confidence ?? 0) >= 0.75 && recommendedCandidate.score >= 0.25)
  )) {
    decision = ambiguous && recommendedCandidate.harnessId !== best?.harnessId ? "REVIEW_REQUIRED" : "EVOLVE_EXISTING";
    targetHarnessId = existingRecommended.id;
    basePack = existingRecommended;
    targetVersion = bumpPatch(existingRecommended.version);
    confidence = Math.max(recommendedCandidate.score, Number(recommended?.confidence ?? 0));
    reasons = [`source-role=${sourceProfile.primaryRole}`, ...(recommendedCandidate.matchedEvidence ?? [])];
  } else if (recommended?.id && !existingRecommended && parentCandidates.length > 0) {
    decision = "CREATE_NEW_WITH_PARENT_REFERENCE";
    targetHarnessId = safeId(recommended.id);
    targetVersion = "0.1.0";
    confidence = Number(Math.max(recommended.confidence ?? 0, best?.score ?? 0).toFixed(3));
    reasons = uniqueStrings([`source-role=${sourceProfile.primaryRole}`, ...(recommended.evidence ?? []), `parent=${parentCandidates[0].id}`]).slice(0, 12);
  } else if (ambiguous) {
    decision = "REVIEW_REQUIRED";
    targetHarnessId = safeId(recommended?.id ?? best?.harnessId ?? inferHarnessId(goal, corpus));
    targetVersion = existingRecommended ? bumpPatch(existingRecommended.version) : "0.1.0";
    confidence = Number((best?.score ?? 0).toFixed(3));
    reasons = [`ambiguous-candidates-delta<${AMBIGUOUS_MATCH_DELTA}`, ...(best?.matchedEvidence ?? [])];
  } else if (best && best.score >= matchThreshold && best.boundaryFit !== "mismatch" && best.roleFit !== "mismatch") {
    decision = "EVOLVE_EXISTING";
    targetHarnessId = best.harnessId;
    basePack = best.basePack;
    targetVersion = bumpPatch(best.version);
    confidence = best.score;
    reasons = best.matchedEvidence.slice(0, 12);
  } else {
    decision = "CREATE_NEW";
    targetHarnessId = safeId(recommended?.id ?? inferHarnessId(goal, corpus));
    targetVersion = "0.1.0";
    confidence = Number((recommended?.confidence ?? 0).toFixed(3));
    reasons = uniqueStrings([`source-role=${sourceProfile.primaryRole}`, ...(recommended?.evidence ?? []), "no-confident-existing-harness-match"]).slice(0, 12);
  }

  const decisionContext = buildDecisionContext({
    decision,
    confidence,
    matchThreshold,
    candidates,
    best,
    second,
    ambiguous,
    sourceProfile,
    parentCandidates,
    reasons
  });
  return {
    schema: AUTO_MATCH_SCHEMA,
    algorithmVersion: "unknown-source-decision-aggregator/v2",
    decision,
    confidence: Number(confidence.toFixed(3)),
    matchThreshold,
    targetHarnessId,
    targetVersion,
    targetDomain: safeId(recommended?.domain ?? inferDomain(targetHarnessId, goal, corpus)),
    sourceProfileDigest: sourceProfile.digest,
    primaryRole: sourceProfile.primaryRole,
    recommendedHarness: recommended,
    baseHarnessRef: basePack ? { id: basePack.id, version: basePack.version, digest: digestText(basePack.templateText) } : undefined,
    parentCandidates,
    candidates: candidates.map(({ basePack, ...candidate }) => candidate).slice(0, 8),
    reasons,
    candidateRetrieval: decisionContext.candidateRetrieval,
    conflicts: decisionContext.conflicts,
    uncertainty: decisionContext.uncertainty,
    reviewGate: decisionContext.reviewGate,
    decisionEvidence: decisionContext.decisionEvidence,
    nextAction: "review-generated-draft"
  };
}

function buildDecisionContext({ decision, confidence, matchThreshold, candidates, best, second, ambiguous, sourceProfile, parentCandidates, reasons }) {
  const conflicts = [];
  if (ambiguous && best && second) conflicts.push(`ambiguous-top-candidates:${best.harnessId}:${second.harnessId}`);
  if (sourceProfile.negativeSignals.length > 0) conflicts.push(...sourceProfile.negativeSignals.slice(0, 6).map((signal) => `negative:${signal}`));
  const reviewReasons = [];
  if (decision === "REVIEW_REQUIRED") reviewReasons.push("decision-review-required");
  if (Number(confidence ?? 0) < matchThreshold) reviewReasons.push(`confidence<${matchThreshold}`);
  if (conflicts.length > 0) reviewReasons.push("conflict-or-negative-signal");
  if (sourceProfile.uncertainty?.status === "REVIEWABLE") reviewReasons.push(...(sourceProfile.uncertainty.reasons ?? []));
  const reviewGate = {
    required: reviewReasons.length > 0 || ["CREATE_NEW", "CREATE_NEW_WITH_PARENT_REFERENCE", "FORK_FROM_MATCH"].includes(decision),
    reasons: uniqueStrings(reviewReasons).slice(0, 12),
    stopAction: reviewReasons.length > 0 ? "review-candidate-evidence-before-approval" : "review-generated-draft"
  };
  return {
    candidateRetrieval: {
      schema: "evopilot-harness-candidate-retrieval/v2",
      source: "published-or-source-harness-packs",
      candidateCount: candidates.length,
      topCandidate: best ? { harnessId: best.harnessId, score: best.score, boundaryFit: best.boundaryFit, roleFit: best.roleFit } : undefined,
      secondCandidate: second ? { harnessId: second.harnessId, score: second.score, boundaryFit: second.boundaryFit, roleFit: second.roleFit } : undefined
    },
    conflicts: uniqueStrings(conflicts).slice(0, 12),
    uncertainty: {
      status: reviewGate.required ? "REVIEWABLE" : "LOW",
      confidence: Number(clamp(confidence, 0, 1).toFixed(3)),
      sourceProfile: sourceProfile.uncertainty
    },
    reviewGate,
    decisionEvidence: uniqueStrings([
      ...reasons,
      `primaryRole=${sourceProfile.primaryRole}`,
      `scannerConfidence=${sourceProfile.scannerSummary?.confidence ?? 0}`,
      `topCandidate=${best?.harnessId ?? "none"}:${best?.score ?? 0}`
    ]).slice(0, 16)
  };
}

function scoreHarnessCandidate(pack, sourceProfile, corpus, goal) {
  const policy = templateMatchPolicy(pack.template);
  const requiredMatches = matchEvidenceTerms(sourceProfile, corpus, goal, policy.requiredAny);
  const dependencyMatches = matchValueTerms(sourceProfile.dependencies, policy.positive.dependencies);
  const importMatches = matchValueTerms(sourceProfile.imports, policy.positive.imports);
  const fileMatches = matchValueTerms(sourceProfile.selectedFiles, policy.positive.files);
  const symbolMatches = matchValueTerms(sourceProfile.symbols, policy.positive.symbols);
  const architectureMatches = matchValueTerms(
    [...sourceProfile.architectureSignals, ...sourceProfile.roles.map((role) => role.id), ...sourceProfile.frameworks],
    policy.positive.architectureSignals
  );
  const signalMatches = matchEvidenceTerms(sourceProfile, corpus, goal, harnessSignals(pack).filter(isStrongMatchSignal));
  const goalMatches = matchEvidenceTerms(sourceProfile, { ...corpus, text: goal, normalizedText: goal.toLowerCase() }, goal, [
    pack.id,
    pack.template.domain,
    pack.template.runtimePatterns?.domain,
    pack.template.description
  ].filter(Boolean));
  const negativeTerms = uniqueStrings([
    ...policy.negative.productBoundaryExcludes,
    ...policy.negative.signals,
    ...(Array.isArray(pack.template.matchSignals?.exclude) ? pack.template.matchSignals.exclude : []),
    ...(Array.isArray(pack.template.productBoundary?.excludes) ? pack.template.productBoundary.excludes : [])
  ]);
  const negativeMatches = matchEvidenceTerms(sourceProfile, corpus, goal, negativeTerms);
  const roleFit = roleFitForHarness(pack, sourceProfile);
  const boundaryFit = boundaryFitForHarness(pack, sourceProfile, negativeMatches);
  const componentScores = {
    dependency: ratioScore(dependencyMatches.length, policy.positive.dependencies.length),
    import: ratioScore(importMatches.length, policy.positive.imports.length),
    file: ratioScore(fileMatches.length, policy.positive.files.length),
    symbol: ratioScore(symbolMatches.length, policy.positive.symbols.length),
    architecture: ratioScore(architectureMatches.length, policy.positive.architectureSignals.length),
    matchSignal: ratioScore(signalMatches.length, Math.min(harnessSignals(pack).filter(isStrongMatchSignal).length, 18)),
    goal: ratioScore(goalMatches.length, 4),
    required: policy.requiredAny.length === 0 ? 1 : ratioScore(requiredMatches.length, policy.requiredAny.length)
  };
  let score =
    componentScores.dependency * 0.18 +
    componentScores.import * 0.14 +
    componentScores.file * 0.08 +
    componentScores.symbol * 0.14 +
    componentScores.architecture * 0.18 +
    componentScores.matchSignal * 0.18 +
    componentScores.goal * 0.05 +
    componentScores.required * 0.05;
  if (roleFit === "strong") score += 0.18;
  else if (roleFit === "partial") score += 0.08;
  else if (roleFit === "mismatch") score -= 0.35;
  if (boundaryFit === "strong") score += 0.08;
  else if (boundaryFit === "partial") score -= 0.08;
  else if (boundaryFit === "mismatch") score -= 0.35;
  if (policy.requiredAny.length > 0 && requiredMatches.length === 0) score *= 0.55;
  score -= Math.min(0.45, negativeMatches.length * 0.08);
  const matchedEvidence = uniqueStrings([
    ...dependencyMatches.map((term) => `dependency:${term}`),
    ...importMatches.map((term) => `import:${term}`),
    ...fileMatches.map((term) => `file:${term}`),
    ...symbolMatches.map((term) => `symbol:${term}`),
    ...architectureMatches.map((term) => `architecture:${term}`),
    ...signalMatches.slice(0, 8).map((term) => `signal:${term}`),
    roleFit !== "none" ? `roleFit:${roleFit}` : "",
    boundaryFit !== "unknown" ? `boundaryFit:${boundaryFit}` : ""
  ].filter(Boolean));
  return {
    harnessId: pack.id,
    version: pack.version,
    domain: pack.template.domain ?? pack.template.runtimePatterns?.domain,
    score: Number(clamp(score, 0, 1).toFixed(3)),
    componentScores: Object.fromEntries(Object.entries(componentScores).map(([key, value]) => [key, Number(value.toFixed(3))])),
    roleFit,
    boundaryFit,
    matchedEvidence: matchedEvidence.slice(0, 20),
    negativeEvidence: negativeMatches.slice(0, 20),
    templatePath: pack.templatePath,
    priority: harnessSelectionPriority(pack, sourceProfile),
    basePack: pack
  };
}

function templateMatchPolicy(template) {
  const policy = isRecord(template.matchPolicy) ? template.matchPolicy : {};
  const positive = isRecord(policy.positive) ? policy.positive : {};
  const negative = isRecord(policy.negative) ? policy.negative : {};
  return {
    requiredAny: normalizeStrings(policy.requiredAny),
    positive: {
      dependencies: normalizeStrings(positive.dependencies),
      imports: normalizeStrings(positive.imports),
      files: normalizeStrings(positive.files),
      symbols: normalizeStrings(positive.symbols),
      architectureSignals: normalizeStrings(positive.architectureSignals)
    },
    negative: {
      productBoundaryExcludes: normalizeStrings(negative.productBoundaryExcludes),
      signals: normalizeStrings(negative.signals)
    }
  };
}

function roleFitForHarness(pack, sourceProfile) {
  const recommendation = sourceProfile.recommendedHarness;
  if (recommendation?.id === pack.id) return "strong";
  if (Array.isArray(recommendation?.parentHarnessIds) && recommendation.parentHarnessIds.includes(pack.id)) return "partial";
  const id = pack.id;
  const role = sourceProfile.primaryRole;
  if (role === "enterprise-admin-software" && id === "generic-management-software-harness") return "strong";
  if (role === "java-service" && id === "java-ddd-service-harness") return "strong";
  if (role === "node-saas-control-plane" && id === "node-saas-control-plane-harness") return "strong";
  if (role === "distributed-cache-product" && id === "distributed-cache-harness") return "strong";
  if (role === "database-product" && id === "database-product-harness") return "strong";
  if (role === "api-gateway-product" && id === "api-gateway-harness") return "strong";
  if (role === "redis-client-library" && ["api-gateway-harness", "database-product-harness"].includes(id)) return "mismatch";
  if (role === "cache-proxy-monitor" && ["api-gateway-harness", "database-product-harness"].includes(id)) return "mismatch";
  if (role === "logging-sdk" && ["api-gateway-harness", "database-product-harness", "distributed-cache-harness"].includes(id)) return "mismatch";
  if (role === "rpc-framework" && ["api-gateway-harness", "database-product-harness", "distributed-cache-harness"].includes(id)) return "mismatch";
  if (role === "frontend-admin-app" && ["api-gateway-harness", "database-product-harness", "distributed-cache-harness"].includes(id)) return "mismatch";
  return "none";
}

function boundaryFitForHarness(pack, sourceProfile, negativeMatches) {
  if (roleFitForHarness(pack, sourceProfile) === "mismatch") return "mismatch";
  const boundary = isRecord(pack.template.productBoundary) ? pack.template.productBoundary : {};
  const includeMatches = matchValueTerms(
    [...sourceProfile.positiveSignals, ...sourceProfile.architectureSignals, ...sourceProfile.roles.map((role) => role.id)],
    normalizeStrings(boundary.includes)
  );
  const excludeMatches = uniqueStrings([...negativeMatches, ...matchValueTerms(sourceProfile.negativeSignals, normalizeStrings(boundary.excludes))]);
  if (excludeMatches.length > 0 && includeMatches.length === 0) return "mismatch";
  if (includeMatches.length > 0 && excludeMatches.length === 0) return "strong";
  if (includeMatches.length > 0 && excludeMatches.length > 0) return "partial";
  return "unknown";
}

function parentCandidateRefs(packs, candidates, recommendation) {
  const parentIds = Array.isArray(recommendation?.parentHarnessIds) ? recommendation.parentHarnessIds : [];
  const refs = [];
  for (const parentId of parentIds) {
    const pack = packs.find((item) => item.id === parentId);
    const candidate = candidates.find((item) => item.harnessId === parentId);
    if (pack) refs.push({ id: pack.id, version: pack.version, score: candidate?.score ?? 0, reason: `parent-for-${recommendation.id}` });
  }
  if (refs.length > 0) return refs;
  return candidates
    .filter((candidate) => candidate.score >= 0.25 && candidate.boundaryFit !== "mismatch")
    .slice(0, 2)
    .map((candidate) => ({ id: candidate.harnessId, version: candidate.version, score: candidate.score, reason: "closest-existing-candidate" }));
}

function harnessSelectionPriority(pack, sourceProfile) {
  if (sourceProfile.recommendedHarness?.id === pack.id) return 100;
  if (sourceProfile.recommendedHarness?.parentHarnessIds?.includes(pack.id)) return 50;
  if ((pack.template.harnessLayer ?? pack.template.runtimePatterns?.harnessLayer) === "domain") return 20;
  return 0;
}

function matchEvidenceTerms(sourceProfile, corpus, goal, terms) {
  const evidenceText = [
    corpus.text,
    goal,
    ...sourceProfile.dependencies,
    ...sourceProfile.imports,
    ...sourceProfile.symbols,
    ...sourceProfile.selectedFiles,
    ...sourceProfile.architectureSignals,
    ...sourceProfile.roles.map((role) => role.id),
    ...sourceProfile.positiveSignals
  ].join("\n");
  return normalizeStrings(terms)
    .filter(isStrongMatchSignal)
    .filter((term) => normalizedIncludes(evidenceText, stripSignalPrefix(term)));
}

function matchValueTerms(values, terms) {
  const normalizedValues = normalizeStrings(values);
  return normalizeStrings(terms).filter((term) => {
    const needle = stripSignalPrefix(term);
    return normalizedValues.some((value) => normalizedTermMatch(value, needle));
  });
}

function ratioScore(matches, possible) {
  if (possible <= 0) return 0;
  return clamp(matches / Math.min(possible, 10), 0, 1);
}

function stripSignalPrefix(term) {
  return String(term).replace(/^(dependency|import|file|symbol|architecture|signal):/i, "").trim();
}

function normalizedTermMatch(value, term) {
  const left = normalizeForMatch(value);
  const right = normalizeForMatch(term);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

function normalizedIncludes(text, term) {
  const normalizedText = normalizeForMatch(text);
  const normalizedTerm = normalizeForMatch(term);
  return Boolean(normalizedTerm) && normalizedText.includes(normalizedTerm);
}

function normalizeForMatch(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ").replace(/\s+/g, " ").trim();
}

function isStrongMatchSignal(signal) {
  const normalized = normalizeForMatch(signal);
  if (normalized.length < 4) return false;
  return !new Set(["java", "node", "go", "rust", "generic", "domain", "runtime", "project", "service", "source", "platform", "product", "system"]).has(normalized);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function extractDependencies(text, files) {
  const dependencies = new Set();
  for (const block of String(text).matchAll(/<dependency\b[\s\S]*?<\/dependency>/gi)) {
    const groupId = block[0].match(/<groupId>\s*([^<]+?)\s*<\/groupId>/i)?.[1]?.trim();
    const artifactId = block[0].match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/i)?.[1]?.trim();
    if (artifactId) dependencies.add(artifactId);
    if (groupId && artifactId) dependencies.add(`${groupId}:${artifactId}`);
  }
  for (const file of files) {
    const base = path.basename(file).toLowerCase();
    if (base.endsWith(".jar")) dependencies.add(base.replace(/-\d[\w.-]*\.jar$/, "").replace(/\.jar$/, ""));
    if (base === "package.json" || base.endsWith("package-lock.json")) {
      for (const match of String(text).matchAll(/"(@?[\w./-]+)"\s*:\s*"[~^<>=*\w .-]+"/g)) dependencies.add(match[1]);
    }
  }
  return uniqueStrings([...dependencies]).sort();
}

function extractJavaImports(text) {
  return uniqueStrings([...String(text).matchAll(/^\s*import\s+([a-zA-Z0-9_.*]+)\s*;/gm)].map((match) => match[1])).sort();
}

function extractSymbols(text) {
  const symbols = [
    "RedisTemplate",
    "JedisConnectionFactory",
    "JedisShardInfo",
    "RedisSerializer",
    "RedisAtomicInteger",
    "RedisAtomicLong",
    "RedisOps",
    "DruidDataSource",
    "SqlSessionFactory",
    "RestController",
    "Controller",
    "ServiceDiscovery",
    "ScheduledExecutorService",
    "RpcContext",
    "Invoker",
    "Invocation",
    "Filter",
    "LoggerFactory",
    "ClassicConverter",
    "ILoggingEvent",
    "Vue",
    "VueRouter",
    "iView",
    "Workflow",
    "TaskStatus",
    "TaskSerialStatus",
    "Plugin",
    "Flow"
  ];
  return symbols.filter((symbol) => new RegExp(`\\b${escapeRegExp(symbol)}\\b`, "i").test(text));
}

function detectLanguages(sources, files, text) {
  const languages = new Set();
  const extensions = files.map((file) => path.extname(file).toLowerCase());
  if (extensions.includes(".java") || /pom\.xml|<artifactId>|<groupId>/.test(text)) languages.add("java");
  if (extensions.includes(".go") || files.some((file) => path.basename(file) === "go.mod")) languages.add("go");
  if (extensions.includes(".py") || files.some((file) => ["pyproject.toml", "requirements.txt"].includes(path.basename(file)))) languages.add("python");
  if (extensions.includes(".rs") || files.some((file) => path.basename(file) === "Cargo.toml")) languages.add("rust");
  if (extensions.includes(".vue") || extensions.includes(".ts") || extensions.includes(".js") || files.some((file) => path.basename(file) === "package.json")) languages.add("node");
  if (sources.some((source) => source.type === "production-log")) languages.add("runtime-log");
  return [...languages].sort();
}

function detectBuildTools(files, text) {
  const tools = new Set();
  if (files.some((file) => path.basename(file) === "pom.xml") || /<project\b[^>]*xmlns=.*maven/i.test(text)) tools.add("maven");
  if (files.some((file) => ["build.gradle", "settings.gradle"].includes(path.basename(file)))) tools.add("gradle");
  if (files.some((file) => path.basename(file) === "package.json")) tools.add("npm");
  if (files.some((file) => path.basename(file) === "go.mod")) tools.add("go-modules");
  if (files.some((file) => path.basename(file) === "pyproject.toml")) tools.add("pyproject");
  return [...tools].sort();
}

function detectFrameworks(dependencies, imports, symbols, text) {
  const combined = normalizeForMatch([...dependencies, ...imports, ...symbols, text].join("\n"));
  const frameworks = [];
  if (combined.includes("spring data redis")) frameworks.push("spring-data-redis");
  if (combined.includes("jedis")) frameworks.push("jedis");
  if (combined.includes("lettuce")) frameworks.push("lettuce");
  if (combined.includes("spring boot")) frameworks.push("spring-boot");
  if (combined.includes("spring framework") || combined.includes("spring context")) frameworks.push("spring-framework");
  if (combined.includes("mybatis")) frameworks.push("mybatis");
  if (combined.includes("mysql connector")) frameworks.push("mysql-jdbc");
  if (combined.includes("druid")) frameworks.push("druid");
  if (combined.includes("dubbo")) frameworks.push("dubbo");
  if (combined.includes("logback")) frameworks.push("logback");
  if (combined.includes("slf4j")) frameworks.push("slf4j");
  if (combined.includes("quartz")) frameworks.push("quartz");
  if (combined.includes("vue")) frameworks.push("vue");
  if (combined.includes("iview")) frameworks.push("iview");
  return uniqueStrings(frameworks);
}

function inferArchitectureSignals(context) {
  const text = normalizeForMatch([context.text, context.goal, ...context.dependencies, ...context.imports, ...context.symbols, ...context.selectedFiles].join("\n"));
  const signals = [];
  if (/spring data redis|jedis|redis template|redisserializer|jedisconnectionfactory/.test(text)) signals.push("redis-client-library", "cache-client-library", "connection-factory", "serializer");
  if (/proxycheck|proxy check|redisops/.test(text)) signals.push("cache-proxy-monitor", "runtime-health-check", "service-discovery");
  if (/replica|failover|slot migration|hash slot|eviction|storage engine|protocol engine|cluster membership|key value store|kv store/.test(text)) signals.push("distributed-cache-product");
  if (/sql engine|query optimizer|transaction engine|storage engine|dbms|database kernel|数据库内核|查询优化器|事务引擎/.test(text)) signals.push("database-product");
  if (/api gateway|ingress controller|upstream selection|route matching|filter chain|service mesh gateway|envoy|kong|apisix/.test(text)) signals.push("api-gateway-product");
  if (/dubbo|rpccontext|remoting|registry zookeeper|hessian|protocol|consumer|provider/.test(text)) signals.push("rpc-framework", "middleware-framework");
  if (/\bworkflow\b|\bflow\b|taskstatus|taskserialstatus|noodel|orchestration|调度/.test(text)) signals.push("workflow-engine", "orchestration-engine");
  if (/logback|slf4j|loggerfactory|iloggingevent|classicconverter|mdc|traceid|requestid|logging filter/.test(text)) signals.push("logging-sdk", "observability-adapter");
  if (/spring boot|starter web|mybatis|swagger|admin console|housekeeper|butler|rbac|permission system|audit report|management software/.test(text)) signals.push("enterprise-admin-software");
  if (/vue|iview|vue router|vuex|webpack|wangeditor|echarts|admin frontend/.test(text)) signals.push("frontend-admin-app");
  if (/facade|sdk|client api|resource api/.test(text)) signals.push("api-facade-library");
  if (/jdbc|datasource|mysql connector|druiddatasource/.test(text)) signals.push("database-client");
  return uniqueStrings(signals);
}

function inferSourceRoles(context) {
  const text = normalizeForMatch([context.text, context.goal, ...context.dependencies, ...context.imports, ...context.symbols, ...context.architectureSignals, ...context.allFiles].join("\n"));
  const roles = [];
  const add = (id, confidence, evidence) => roles.push({ id, confidence: Number(confidence.toFixed(2)), evidence: uniqueStrings(evidence).slice(0, 8) });
  if (/spring data redis|jedis|redis template|jedisconnectionfactory|redisserializer/.test(text)) {
    add("redis-client-library", 0.92, ["spring-data-redis-or-jedis", "redis-template-wrapper", "client-library-boundary"]);
  }
  if (/proxycheck|proxy check|redisops/.test(text)) {
    add("cache-proxy-monitor", 0.94, ["proxy-check-runtime", "cache-health-probe", "service-discovery"]);
  }
  if (/replica|failover|slot migration|hash slot|eviction|storage engine|protocol engine|cluster membership/.test(text) && !/redis template|jedisconnectionfactory/.test(text)) {
    add("distributed-cache-product", 0.84, ["cluster-or-replication-signals", "cache-product-kernel-signals"]);
  }
  if (/sql engine|query optimizer|transaction engine|database kernel|dbms|查询优化器|事务引擎/.test(text)) {
    add("database-product", 0.84, ["database-kernel-signals"]);
  }
  if (/api gateway|ingress controller|upstream selection|route matching|filter chain|service mesh gateway|envoy|kong|apisix/.test(text)) {
    add("api-gateway-product", 0.84, ["gateway-routing-policy-signals"]);
  }
  if (/dubbo|rpccontext|hessian|remoting|rpc protocol|registry zookeeper|consumer|provider/.test(text)) {
    add("rpc-framework", 0.95, ["rpc-framework-modules", "registry-remoting-protocol"]);
  }
  if (/\bworkflow\b|\bflow\b|taskstatus|taskserialstatus|orchestration|noodel/.test(text)) {
    const workflowConfidence = /noodel|taskstatus|taskserialstatus|workflow engine|orchestration engine/.test(text) ? 0.97 : 0.76;
    add("workflow-engine", workflowConfidence, ["workflow-orchestration-signals", "task-state-signals"]);
  }
  if (/logback|slf4j|loggerfactory|iloggingevent|classicconverter|requestid|traceid/.test(text)) {
    const logConfidence = /logunified|unified logger|unifiedlog|logger adapter|classicconverter/.test(text) ? 0.96 : 0.9;
    add("logging-sdk", logConfidence, ["logging-framework-adapter", "correlation-context"]);
  }
  if (/spring boot|starter web|mybatis|swagger|housekeeper|butler|admin/.test(text)) {
    add("enterprise-admin-software", 0.94, ["spring-web-admin", "database-backed-management"]);
  }
  if (/vue|iview|vue router|vuex|webpack|admin frontend/.test(text)) {
    add("frontend-admin-app", 0.98, ["vue-admin-frontend"]);
  }
  if (/facade|resource api|client sdk|api wrapper/.test(text)) {
    add("api-facade-library", 0.74, ["api-facade-or-sdk"]);
  }
  if (roles.length === 0 && /pom xml|spring|java/.test(text)) add("java-service", 0.55, ["java-maven-source"]);
  if (roles.length === 0 && /package json|node|vue/.test(text)) add("node-saas-control-plane", 0.5, ["node-package-source"]);
  return roles.sort((left, right) => right.confidence - left.confidence);
}

function recommendHarnessForRole(role, context) {
  const map = {
    "redis-client-library": {
      id: "redis-client-harness",
      domain: "redis-client",
      confidence: 0.92,
      parentHarnessIds: ["distributed-cache-harness"],
      evidence: ["redis-client-library", "narrower-than-distributed-cache-product"]
    },
    "cache-proxy-monitor": {
      id: "cache-proxy-monitor-harness",
      domain: "cache-proxy-monitor",
      confidence: 0.94,
      parentHarnessIds: ["distributed-cache-harness", "observability-apm-harness"],
      evidence: ["cache-proxy-monitor", "runtime-health-check"]
    },
    "distributed-cache-product": {
      id: "distributed-cache-harness",
      domain: "distributed-cache",
      confidence: 0.84,
      parentHarnessIds: [],
      evidence: ["cache-product-kernel"]
    },
    "database-product": {
      id: "database-product-harness",
      domain: "database-product",
      confidence: 0.84,
      parentHarnessIds: [],
      evidence: ["database-product-kernel"]
    },
    "api-gateway-product": {
      id: "api-gateway-harness",
      domain: "api-gateway",
      confidence: 0.84,
      parentHarnessIds: [],
      evidence: ["gateway-routing-policy"]
    },
    "rpc-framework": {
      id: "rpc-framework-harness",
      domain: "rpc-framework",
      confidence: 0.95,
      parentHarnessIds: ["go-middleware-harness", "java-ddd-service-harness"],
      evidence: ["rpc-framework", "registry-remoting-protocol"]
    },
    "workflow-engine": {
      id: "workflow-engine-harness",
      domain: "workflow-engine",
      confidence: 0.97,
      parentHarnessIds: ["generic-management-software-harness"],
      evidence: ["workflow-orchestration-engine"]
    },
    "logging-sdk": {
      id: "logging-sdk-harness",
      domain: "logging-sdk",
      confidence: 0.9,
      parentHarnessIds: ["observability-apm-harness"],
      evidence: ["logging-sdk", "observability-adapter"]
    },
    "enterprise-admin-software": {
      id: "generic-management-software-harness",
      domain: "management-software",
      confidence: 0.94,
      parentHarnessIds: [],
      evidence: ["management-admin-software"]
    },
    "frontend-admin-app": {
      id: "frontend-admin-app-harness",
      domain: "frontend-admin-app",
      confidence: 0.98,
      parentHarnessIds: ["node-saas-control-plane-harness"],
      evidence: ["vue-admin-frontend"]
    },
    "api-facade-library": {
      id: "api-facade-harness",
      domain: "api-facade",
      confidence: 0.74,
      parentHarnessIds: ["java-ddd-service-harness"],
      evidence: ["api-facade-library"]
    },
    "java-service": {
      id: "java-ddd-service-harness",
      domain: "java-service",
      confidence: 0.55,
      parentHarnessIds: [],
      evidence: ["java-maven-source"]
    },
    "node-saas-control-plane": {
      id: "node-saas-control-plane-harness",
      domain: "node-saas-control-plane",
      confidence: 0.5,
      parentHarnessIds: [],
      evidence: ["node-package-source"]
    }
  };
  return map[role] ?? {
    id: inferHarnessId(context.goal ?? "", { normalizedText: normalizeForMatch(context.text ?? ""), keywords: topKeywords(context.text ?? "") }),
    domain: "domain",
    confidence: 0.4,
    parentHarnessIds: [],
    evidence: ["fallback-keyword-inference"]
  };
}

function inferNegativeSignals(context) {
  const text = normalizeForMatch([context.text, ...context.dependencies, ...context.imports, ...context.symbols, ...context.architectureSignals].join("\n"));
  const roleIds = context.roles.map((role) => role.id);
  const signals = [];
  if (roleIds.includes("redis-client-library") && !roleIds.includes("distributed-cache-product")) {
    signals.push("no-cache-product-kernel", "client-library-not-cache-engine", "no-replication-or-failover-controller");
  }
  if (roleIds.includes("cache-proxy-monitor")) signals.push("operational-monitor-not-cache-kernel", "not-api-gateway-product");
  if (roleIds.includes("logging-sdk")) signals.push("library-not-observability-platform", "not-api-gateway-product");
  if (roleIds.includes("rpc-framework")) signals.push("rpc-framework-not-api-gateway-product");
  if (roleIds.includes("frontend-admin-app")) signals.push("frontend-app-not-gateway-product");
  if (/jdbc|mysql connector|datasource|druiddatasource/.test(text) && !roleIds.includes("database-product")) {
    signals.push("database-client-not-database-product");
  }
  if (/proxy|client wrapper|sdk|adapter/.test(text) && !roleIds.includes("api-gateway-product")) {
    signals.push("client-or-adapter-not-gateway-product");
  }
  return uniqueStrings(signals);
}

function detectSensitiveMaterial(text) {
  const findings = [];
  const value = String(text ?? "");
  if (/(password|passwd|pwd)\s*[:=]\s*["']?[^"'\s<&]+/i.test(value) || /\.setPassword\s*\(\s*["'][^"']+["']\s*\)/i.test(value)) findings.push("credential-like-value");
  if (/(api[_-]?key|token|authorization)\s*[:=]\s*["']?[^"'\s<&]+/i.test(value)) findings.push("api-key-or-token-like-value");
  if (/\b(?:10|172\.(?:1[6-9]|2\d|3[0-1])|192\.168)\.\d{1,3}\.\d{1,3}(?::\d{2,5})?\b/.test(value)) findings.push("internal-endpoint");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) findings.push("email-address");
  return uniqueStrings(findings);
}

function discoverSourceProjects(root, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 5;
  const includeModules = Boolean(options.includeModules);
  const limit = Number.isFinite(options.limit) ? options.limit : 50;
  const results = [];
  const visit = (dir, depth) => {
    if (results.length >= limit || depth > maxDepth) return;
    const marker = sourceProjectMarker(dir);
    if (marker) {
      results.push({ path: dir, ...marker });
      if (!includeModules) return;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if ([".git", ".svn", ".hg", ".idea", ".settings", "node_modules", "target", "dist", "build", ".next", "coverage"].includes(entry.name)) continue;
      visit(path.join(dir, entry.name), depth + 1);
    }
  };
  visit(root, 0);
  return results.sort((left, right) => left.path.localeCompare(right.path));
}

function sourceProjectMarker(dir) {
  const markers = [];
  const has = (name) => fs.existsSync(path.join(dir, name));
  if (has("pom.xml")) markers.push("pom.xml");
  if (has("package.json")) markers.push("package.json");
  if (has("go.mod")) markers.push("go.mod");
  if (has("pyproject.toml")) markers.push("pyproject.toml");
  if (has("Cargo.toml")) markers.push("Cargo.toml");
  const hasSrc = fs.existsSync(path.join(dir, "src")) && fs.statSync(path.join(dir, "src")).isDirectory();
  const hasLib = fs.existsSync(path.join(dir, "lib")) && fs.statSync(path.join(dir, "lib")).isDirectory();
  if (hasSrc && hasLib) markers.push("legacy-java-lib");
  if (markers.length === 0) return undefined;
  const pomText = has("pom.xml") ? safeReadText(path.join(dir, "pom.xml"), 80_000) : "";
  const rootType = /<modules>[\s\S]*?<\/modules>/i.test(pomText)
    ? "maven-multi-module-root"
    : markers.includes("package.json")
      ? "node-package-root"
      : markers.includes("legacy-java-lib")
        ? "legacy-java-lib-root"
        : "manifest-root";
  return { rootType, markers };
}

function inspectLlmModels(args) {
  const config = loadLlmModelsConfig(args);
  const selected = selectLlmProfile(args, config);
  const apiKeyConfigured = Boolean(selected.apiKey || (selected.apiKeyEnv && process.env[selected.apiKeyEnv]));
  const result = {
    schema: LLM_MODELS_SCHEMA,
    status: apiKeyConfigured ? "READY" : "CONFIG_REQUIRED",
    source: {
      path: config.path,
      exists: config.exists,
      sourceType: config.sourceType,
      error: config.error
    },
    defaultProfileId: DEFAULT_LLM_PROFILE_ID,
    selectedProfile: safeLlmProfile(selected),
    models: config.models.map(safeLlmProfile),
    nextAction: apiKeyConfigured ? "run-harness-evolution" : "open-models-json-and-configure-api-key"
  };
  printResult(args, result, `llmModels=${result.models.length} selected=${selected.id} status=${result.status}`);
}

function replayLlmAdvisor(args) {
  const fixtureRoot = path.resolve(stringOption(args, "fixture-root") ?? stringOption(args, "fixtures") ?? DEFAULT_LLM_REPLAY_FIXTURE_ROOT);
  const fixtures = readFixtureFiles(fixtureRoot);
  const cases = fixtures.map((fixturePath) => evaluateLlmReplayFixture(fixturePath));
  const failed = cases.filter((item) => item.status !== "PASS");
  const result = {
    schema: "evopilot-harness-llm-replay-report/v2",
    status: failed.length === 0 ? "PASSED" : "FAILED",
    fixtureRoot,
    caseCount: cases.length,
    passedCount: cases.length - failed.length,
    failedCount: failed.length,
    cases,
    nextAction: failed.length === 0 ? "run-unknown-source-eval" : "repair-llm-replay-fixtures-or-advisor-schema"
  };
  printResult(args, result, `llm-replay=${result.status} cases=${cases.length}`);
  return failed.length === 0 ? 0 : 2;
}

function evaluateLlmReplayFixture(fixturePath) {
  const fixture = parseFixtureFile(fixturePath);
  const parsed = isRecord(fixture.advisorResponse) ? fixture.advisorResponse : {};
  const expected = isRecord(fixture.expect) ? fixture.expect : {};
  const recommendation = isRecord(parsed.recommendation) ? parsed.recommendation : {};
  const checks = [];
  if (expected.sourceClassification) {
    checks.push({
      id: "sourceClassification",
      status: String(parsed.sourceClassification ?? "") === String(expected.sourceClassification) ? "PASS" : "FAIL",
      evidence: [`expected=${expected.sourceClassification}`, `actual=${String(parsed.sourceClassification ?? "missing")}`]
    });
  }
  if (expected.action) {
    checks.push({
      id: "recommendation.action",
      status: normalizeAdvisorAction(recommendation.action) === normalizeAdvisorAction(expected.action) ? "PASS" : "FAIL",
      evidence: [`expected=${expected.action}`, `actual=${String(recommendation.action ?? "missing")}`]
    });
  }
  if (expected.targetHarnessId) {
    checks.push({
      id: "recommendation.targetHarnessId",
      status: safeId(recommendation.targetHarnessId ?? "") === safeId(expected.targetHarnessId) ? "PASS" : "FAIL",
      evidence: [`expected=${expected.targetHarnessId}`, `actual=${String(recommendation.targetHarnessId ?? "missing")}`]
    });
  }
  if (expected.minConfidence !== undefined) {
    checks.push({
      id: "recommendation.confidence",
      status: Number(recommendation.confidence ?? 0) >= Number(expected.minConfidence) ? "PASS" : "FAIL",
      evidence: [`min=${expected.minConfidence}`, `actual=${Number(recommendation.confidence ?? 0)}`]
    });
  }
  const blockers = checks.filter((check) => check.status === "FAIL").map((check) => `${check.id}:${check.evidence.join(",")}`);
  return {
    name: fixture.name ?? path.basename(fixturePath),
    fixturePath,
    status: blockers.length === 0 ? "PASS" : "FAIL",
    checks,
    blockers
  };
}

function runUnknownSourceEval(args) {
  const fixtureRoot = path.resolve(stringOption(args, "fixture-root") ?? stringOption(args, "fixtures") ?? DEFAULT_EVAL_FIXTURE_ROOT);
  const fixtures = readFixtureFiles(fixtureRoot);
  const cases = fixtures.map((fixturePath) => evaluateUnknownSourceFixture(args, fixtureRoot, fixturePath));
  const failed = cases.filter((item) => item.status !== "PASS");
  const matrix = evalDecisionMatrix(cases);
  const result = {
    schema: "evopilot-harness-unknown-source-eval-report/v2",
    status: failed.length === 0 ? "PASSED" : "FAILED",
    fixtureRoot,
    caseCount: cases.length,
    passedCount: cases.length - failed.length,
    failedCount: failed.length,
    matrix,
    cases,
    nextAction: failed.length === 0 ? "publish-harness-assets" : "repair-matching-algorithm-or-fixtures"
  };
  printResult(args, result, `unknown-source-eval=${result.status} cases=${cases.length}`);
  return failed.length === 0 ? 0 : 2;
}

function evaluateUnknownSourceFixture(args, fixtureRoot, fixturePath) {
  const fixture = parseFixtureFile(fixturePath);
  const goal = String(fixture.goal ?? "Generate or evolve a reusable Harness from this unknown source.");
  const source = path.resolve(path.dirname(fixturePath), String(fixture.sourceProject ?? fixture.sourceRoot ?? ""));
  const evalArgs = {
    ...args,
    options: {
      ...args.options,
      "no-llm-advisor": true,
      source: stringOption(args, "source") ?? "harnesses"
    }
  };
  let detection;
  let groupResult;
  if (fixture.sourceRoot) {
    const { detections } = detectProjectsUnderRoot(evalArgs, source, goal);
    groupResult = groupCorpusDetections(evalArgs, source, detections);
    detection = { detections, groups: groupResult.groups };
  } else {
    detection = publicDetectResult(detectHarnessForSources(evalArgs, [sourceProjectSource(source)], goal));
  }
  const checks = evaluateUnknownSourceExpectations(fixture, detection);
  const blockers = checks.filter((check) => check.status === "FAIL").map((check) => `${check.id}:${check.evidence.join(",")}`);
  return {
    name: fixture.name ?? path.relative(fixtureRoot, fixturePath),
    fixturePath,
    source,
    mode: fixture.sourceRoot ? "source-root" : "source-project",
    status: blockers.length === 0 ? "PASS" : "FAIL",
    actual: summarizeEvalActual(detection, Boolean(fixture.sourceRoot)),
    checks,
    blockers
  };
}

function evaluateUnknownSourceExpectations(fixture, detection) {
  const expect = isRecord(fixture.expect) ? fixture.expect : {};
  const checks = [];
  if (Array.isArray(detection.detections)) {
    const groups = Array.isArray(detection.groups) ? detection.groups : [];
    if (expect.minGroups !== undefined) {
      checks.push({
        id: "groups.minGroups",
        status: groups.length >= Number(expect.minGroups) ? "PASS" : "FAIL",
        evidence: [`min=${expect.minGroups}`, `actual=${groups.length}`]
      });
    }
    for (const target of normalizeStrings(expect.mustIncludeTargets)) {
      checks.push({
        id: `groups.mustInclude:${target}`,
        status: groups.some((group) => group.targetHarnessId === target) ? "PASS" : "FAIL",
        evidence: [`targets=${groups.map((group) => group.targetHarnessId).join("|")}`]
      });
    }
    return checks;
  }
  const autoMatch = detection.autoMatch ?? {};
  if (expect.decision) {
    checks.push({
      id: "decision",
      status: autoMatch.decision === expect.decision ? "PASS" : "FAIL",
      evidence: [`expected=${expect.decision}`, `actual=${autoMatch.decision ?? "missing"}`]
    });
  }
  if (expect.targetHarnessId) {
    checks.push({
      id: "targetHarnessId",
      status: autoMatch.targetHarnessId === expect.targetHarnessId ? "PASS" : "FAIL",
      evidence: [`expected=${expect.targetHarnessId}`, `actual=${autoMatch.targetHarnessId ?? "missing"}`]
    });
  }
  for (const forbidden of normalizeStrings(expect.mustNotTargetHarnessIds)) {
    checks.push({
      id: `mustNotTarget:${forbidden}`,
      status: autoMatch.targetHarnessId !== forbidden ? "PASS" : "FAIL",
      evidence: [`actual=${autoMatch.targetHarnessId ?? "missing"}`]
    });
  }
  if (expect.reviewGateRequired !== undefined) {
    checks.push({
      id: "reviewGate.required",
      status: Boolean(autoMatch.reviewGate?.required) === Boolean(expect.reviewGateRequired) ? "PASS" : "FAIL",
      evidence: [`expected=${Boolean(expect.reviewGateRequired)}`, `actual=${Boolean(autoMatch.reviewGate?.required)}`]
    });
  }
  return checks;
}

function summarizeEvalActual(detection, isRoot) {
  if (isRoot) {
    return {
      evaluatedCount: detection.detections.length,
      groupCount: detection.groups.length,
      targets: detection.groups.map((group) => group.targetHarnessId)
    };
  }
  return {
    primaryRole: detection.sourceProfile?.primaryRole,
    decision: detection.autoMatch?.decision,
    targetHarnessId: detection.autoMatch?.targetHarnessId,
    confidence: detection.autoMatch?.confidence,
    reviewGate: detection.autoMatch?.reviewGate,
    topCandidates: detection.autoMatch?.candidates?.slice(0, 3)
  };
}

function evalDecisionMatrix(cases) {
  const matrix = {};
  for (const item of cases) {
    const decision = item.actual?.decision ?? (item.actual?.targets ? "CORPUS_GROUPED" : "UNKNOWN");
    matrix[decision] = (matrix[decision] ?? 0) + 1;
  }
  return matrix;
}

function readFixtureFiles(root) {
  if (!fs.existsSync(root)) throw usage(`Fixture root not found: ${root}`);
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(ya?ml|json)$/i.test(entry.name)) files.push(full);
    }
  };
  visit(root);
  return files.sort();
}

function parseFixtureFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return filePath.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
}

function loadLlmModelsConfig(args) {
  const explicitPath = stringOption(args, "llm-models-file") ?? process.env.EVOPILOT_HARNESS_LLM_MODELS_FILE;
  const filePath = path.resolve(explicitPath ?? DEFAULT_LLM_MODELS_FILE);
  if (!fs.existsSync(filePath)) {
    return {
      path: filePath,
      exists: false,
      sourceType: explicitPath ? "explicit-file" : "default-project-file",
      models: []
    };
  }
  try {
    const text = fs.readFileSync(filePath, "utf8");
    const root = JSON.parse(text);
    const models = Array.isArray(root.models) ? root.models.map((item, index) => normalizeCodeBuddyModel(item, index, filePath)).filter(Boolean) : [];
    return {
      path: filePath,
      exists: true,
      sourceType: explicitPath ? "explicit-file" : "default-project-file",
      models
    };
  } catch (error) {
    return {
      path: filePath,
      exists: true,
      sourceType: explicitPath ? "explicit-file" : "default-project-file",
      models: [],
      error: error instanceof Error ? maskSecretText(error.message) : maskSecretText(String(error))
    };
  }
}

function normalizeCodeBuddyModel(value, index, filePath) {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id, "");
  const name = stringValue(value.name, id || `model-${index + 1}`);
  const vendor = stringValue(value.vendor, stringValue(value.providerName, "openai-compatible"));
  const url = stringValue(value.url, stringValue(value.baseUrl, ""));
  const modelName = stringValue(value.modelName, id || name);
  if (!id && !modelName) return undefined;
  return {
    id: id || safeId(modelName),
    name,
    providerPreset: normalizeLlmPreset(`${vendor} ${modelName}`),
    providerName: vendor,
    vendor,
    baseUrl: url,
    modelName,
    apiKey: typeof value.apiKey === "string" ? value.apiKey.trim() : "",
    apiKeyEnv: typeof value.apiKeyEnv === "string" && value.apiKeyEnv.trim() ? value.apiKeyEnv.trim() : undefined,
    supportsToolCall: Boolean(value.supportsToolCall),
    supportsReasoning: Boolean(value.supportsReasoning),
    source: filePath
  };
}

function selectLlmProfile(args, config) {
  const requested = stringOption(args, "llm-profile")
    ?? stringOption(args, "llm-profile-id")
    ?? stringOption(args, "llm-model-id")
    ?? process.env.EVOPILOT_HARNESS_LLM_PROFILE
    ?? process.env.EVOPILOT_HARNESS_LLM_PROFILE_ID
    ?? process.env.EVOPILOT_HARNESS_LLM_MODEL_ID;
  const models = Array.isArray(config.models) ? config.models : [];
  const matched = requested ? models.find((model) => sameModelSelector(model, requested)) : undefined;
  if (matched) return matched;
  const preferred = preferredGlmProfile(models);
  return preferred ?? models[0] ?? builtinGlmProfile();
}

function sameModelSelector(model, requested) {
  const target = String(requested ?? "").trim().toLowerCase();
  return [model.id, model.name, model.modelName].some((value) => String(value ?? "").trim().toLowerCase() === target);
}

function preferredGlmProfile(models) {
  const glmModels = models.filter((model) => normalizeLlmPreset(`${model.vendor} ${model.providerName} ${model.id} ${model.modelName}`) === "glm");
  return glmModels.find((model) => /glm[-_ ]?5\.?2/i.test(`${model.id} ${model.name} ${model.modelName}`))
    ?? glmModels.find((model) => /glm[-_ ]?5/i.test(`${model.id} ${model.name} ${model.modelName}`))
    ?? glmModels[0];
}

function builtinGlmProfile() {
  return {
    id: DEFAULT_LLM_PROFILE_ID,
    name: "EvoPilot GLM",
    providerPreset: "glm",
    providerName: "zhipu",
    vendor: "zhipu",
    baseUrl: DEFAULT_GLM_BASE_URL,
    modelName: DEFAULT_GLM_MODEL,
    apiKey: "",
    apiKeyEnv: "EVOPILOT_HARNESS_LLM_API_KEY",
    supportsToolCall: true,
    supportsReasoning: true,
    source: "builtin"
  };
}

function normalizeLlmPreset(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text.includes("zhipu") || text.includes("glm")) return "glm";
  if (text.includes("moonshot") || text.includes("kimi")) return "kimi";
  if (text.includes("qwen") || text.includes("dashscope")) return "qwen";
  if (text.includes("gemma")) return "gemma";
  return "custom";
}

function safeLlmProfile(model) {
  return {
    id: model.id,
    name: model.name,
    vendor: model.vendor,
    providerPreset: model.providerPreset,
    providerName: model.providerName,
    url: model.baseUrl,
    modelName: model.modelName,
    apiKeyConfigured: Boolean(model.apiKey || (model.apiKeyEnv && process.env[model.apiKeyEnv])),
    apiKeyEnv: model.apiKey ? undefined : model.apiKeyEnv,
    supportsToolCall: Boolean(model.supportsToolCall),
    supportsReasoning: Boolean(model.supportsReasoning),
    source: model.source
  };
}

async function adviseHarnessEvolution(args, context) {
  const control = llmAdvisorControl(args);
  if (control.mode === "disabled") {
    return {
      schema: LLM_ADVISOR_SCHEMA,
      status: "DISABLED",
      mode: control.mode,
      nextAction: "continue-deterministic-auto-match"
    };
  }
  const config = llmAdvisorConfig(args);
  if (!config.ready) {
    return {
      schema: LLM_ADVISOR_SCHEMA,
      status: control.mode === "required" ? "FAILED" : "SKIPPED",
      mode: control.mode,
      errorCode: "LLM_ADVISOR_CONFIG_MISSING",
      errorMessage: config.missing.join(", "),
      llmProfileId: config.profileId,
      llmProfileName: config.profileName,
      modelsFile: config.modelsFile,
      modelsFileExists: config.modelsFileExists,
      provider: config.providerName,
      model: config.modelName,
      apiKeyConfigured: config.apiKeyConfigured,
      nextAction: control.mode === "required" ? "repair-llm-advisor-config" : "continue-deterministic-auto-match"
    };
  }
  const prompt = harnessAdvisorPrompt(context);
  const requestId = `llm-advisor-${context.run.evolutionId}-${Date.now()}`;
  const startedAt = Date.now();
  try {
    const response = await callOpenAiCompatibleJson({
      requestId,
      config,
      prompt,
      caller: "evopilot-harness-llm-advisor",
      intent: "harness.evolution.advice"
    });
    const parsed = parseJsonObject(response.text);
    return normalizeLlmAdvisorResult({
      control,
      config,
      response,
      parsed,
      durationMs: Date.now() - startedAt,
      prompt,
      context
    });
  } catch (error) {
    return {
      schema: LLM_ADVISOR_SCHEMA,
      status: "FAILED",
      mode: control.mode,
      requestId,
      llmProfileId: config.profileId,
      llmProfileName: config.profileName,
      modelsFile: config.modelsFile,
      modelsFileExists: config.modelsFileExists,
      provider: config.providerName,
      model: config.modelName,
      apiKeyConfigured: config.apiKeyConfigured,
      durationMs: Date.now() - startedAt,
      errorCode: error.code ?? "LLM_ADVISOR_FAILED",
      errorMessage: error instanceof Error ? maskSecretText(error.message) : maskSecretText(String(error)),
      nextAction: control.mode === "required" ? "repair-llm-advisor" : "continue-deterministic-auto-match"
    };
  }
}

function llmAdvisorControl(args) {
  if (args.options["no-llm-advisor"]) return { mode: "disabled" };
  if (args.options["require-llm-advisor"]) return { mode: "required" };
  const value = stringOption(args, "llm-advisor") ?? process.env.EVOPILOT_HARNESS_LLM_ADVISOR;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return { mode: "optional" };
  if (["0", "false", "off", "no", "disabled"].includes(normalized)) return { mode: "disabled" };
  if (["required", "require", "strict"].includes(normalized)) return { mode: "required" };
  return { mode: "optional" };
}

function llmAdvisorConfig(args) {
  const modelsConfig = loadLlmModelsConfig(args);
  const selectedProfile = selectLlmProfile(args, modelsConfig);
  const preset = (stringOption(args, "llm-provider-preset") ?? process.env.EVOPILOT_HARNESS_LLM_PROVIDER_PRESET ?? selectedProfile.providerPreset ?? "glm").toLowerCase();
  const providerName = stringOption(args, "llm-provider-name") ?? process.env.EVOPILOT_HARNESS_LLM_PROVIDER_NAME ?? selectedProfile.providerName ?? (preset === "glm" ? "zhipu" : "openai-compatible");
  const baseUrl = stringOption(args, "llm-base-url") ?? process.env.EVOPILOT_HARNESS_LLM_BASE_URL ?? process.env.EVOPILOT_LLM_BASE_URL ?? selectedProfile.baseUrl ?? (preset === "glm" ? DEFAULT_GLM_BASE_URL : "");
  const modelName = stringOption(args, "llm-model") ?? stringOption(args, "llm-model-name") ?? process.env.EVOPILOT_HARNESS_LLM_MODEL_NAME ?? process.env.EVOPILOT_LLM_MODEL_NAME ?? selectedProfile.modelName ?? (preset === "glm" ? DEFAULT_GLM_MODEL : "");
  const apiKeyEnv = stringOption(args, "llm-api-key-env") ?? process.env.EVOPILOT_HARNESS_LLM_API_KEY_ENV ?? selectedProfile.apiKeyEnv ?? "EVOPILOT_HARNESS_LLM_API_KEY";
  const apiKey = process.env[apiKeyEnv] ?? process.env.EVOPILOT_HARNESS_LLM_API_KEY ?? process.env.EVOPILOT_LLM_API_KEY ?? selectedProfile.apiKey ?? "";
  const missing = [];
  if (!baseUrl) missing.push("llm-base-url");
  if (!modelName) missing.push("llm-model");
  if (!apiKey) missing.push(`env:${apiKeyEnv}`);
  return {
    preset,
    profileId: selectedProfile.id,
    profileName: selectedProfile.name,
    modelsFile: modelsConfig.path,
    modelsFileExists: modelsConfig.exists,
    providerName,
    baseUrl,
    modelName,
    apiKey,
    apiKeyEnv,
    apiKeyConfigured: Boolean(apiKey),
    timeoutSeconds: numberOption(args, "llm-timeout-seconds", Number(process.env.EVOPILOT_HARNESS_LLM_TIMEOUT_SECONDS ?? 90)),
    maxRetries: numberOption(args, "llm-max-retries", Number(process.env.EVOPILOT_HARNESS_LLM_MAX_RETRIES ?? 1)),
    maxOutputTokens: numberOption(args, "llm-max-output-tokens", Number(process.env.EVOPILOT_HARNESS_LLM_MAX_OUTPUT_TOKENS ?? 2048)),
    temperature: numberOption(args, "llm-temperature", Number(process.env.EVOPILOT_HARNESS_LLM_TEMPERATURE ?? 0.1)),
    ready: missing.length === 0,
    missing
  };
}

function harnessAdvisorPrompt({ run, sourceCoverage, sourceProfile, corpus, packs, autoMatch }) {
  const catalog = packs.map((pack) => ({
    id: pack.id,
    version: pack.version,
    name: pack.template.name,
    domain: pack.template.domain ?? pack.template.runtimePatterns?.domain,
    layer: pack.template.harnessLayer ?? pack.template.runtimePatterns?.harnessLayer,
    description: pack.template.description,
    matchSignals: Array.isArray(pack.template.matchSignals?.include) ? pack.template.matchSignals.include.slice(0, 20) : []
  }));
  const sourceSummary = sourceCoverage.sources.map((source) => ({
    name: source.name,
    type: source.type,
    digest: source.digest,
    github: source.github,
    redactionApplied: source.redactionApplied,
    knowledgeCategory: source.knowledgeCategory,
    projectActions: source.projectActions,
    scan: source.scan ? {
      fileCount: source.scan.fileCount,
      selectedFileCount: source.scan.selectedFileCount,
      topExtensions: source.scan.topExtensions,
      selectedFiles: source.scan.selectedFiles?.slice(0, 60)
    } : undefined
  }));
  const redactedCorpus = redactSensitiveText(corpus.text).slice(0, 20_000);
  return [
    "You are the EvoPilot Harness LLM Advisor. Return one JSON object only. Do not return Markdown.",
    "Your job is to review deterministic Harness auto-match results before a Harness draft is approved.",
    "Do not approve or publish. Give advice for a human administrator.",
    `The next evolution target is definition quality: ${DEFINITION_QUALITY_TARGET.objective}.`,
    `Focus on: ${DEFINITION_QUALITY_TARGET.focusAreas.join(", ")}.`,
    `Do not optimize for these non-goals unless the user explicitly supplies evidence and asks for them: ${DEFINITION_QUALITY_TARGET.nonGoals.join(", ")}.`,
    "Prefer the narrowest evidence-supported task boundary. A client SDK, adapter, plugin, operator, service, framework, and product kernel are different roles even when they share technology terms.",
    "Every classification and recommendation must be grounded in the supplied source coverage. Unknown or conflicting boundaries require review rather than a forced domain match.",
    "Return JSON fields exactly compatible with this schema:",
    JSON.stringify({
      sourceClassification: "evidence-supported role or unknown",
      rationale: "short reason",
      domainFit: [{ harnessId: "candidate-harness", fit: "strong|partial|weak|none", reason: "short reason" }],
      recommendation: {
        action: "KEEP_AUTO_MATCH | EVOLVE_EXISTING | CREATE_NEW | CREATE_NEW_WITH_PARENT_REFERENCE | FORK_FROM_MATCH",
        targetHarnessId: "candidate-or-proposed-harness",
        targetDomain: "evidence-supported-domain",
        confidence: 0.9,
        reason: "short reason"
      },
      alternatives: [{ action: "EVOLVE_EXISTING", targetHarnessId: "alternative-harness", condition: "when cited evidence proves that task boundary" }],
      reviewWarnings: ["check hardcoded credentials before publication"],
      definitionQualityAdvice: {
        requiredImprovements: ["add negative signals that separate adjacent engineering roles"],
        nonGoals: ["do not add large-scale performance optimization unless requested with source evidence"]
      },
      sensitiveMaterialFindings: ["hardcoded credential or internal endpoint suspected"],
      commandRecommendations: [
        "node src/index.mjs evolve --source-project <path> --target-id <reviewed-harness-id> --match-threshold 1.1 --goal \"...\" --json"
      ]
    }, null, 2),
    "",
    "Evolution goal:",
    run.goal,
    "",
    "Source coverage:",
    JSON.stringify(sourceSummary, null, 2),
    "",
    "Deterministic source profile:",
    JSON.stringify({
      primaryRole: sourceProfile?.primaryRole,
      roles: sourceProfile?.roles,
      recommendedHarness: sourceProfile?.recommendedHarness,
      languages: sourceProfile?.languages,
      buildTools: sourceProfile?.buildTools,
      frameworks: sourceProfile?.frameworks,
      scannerSummary: sourceProfile?.scannerSummary,
      scanners: sourceProfile?.scanners,
      githubRepositories: sourceProfile?.githubRepositories,
      dependencies: sourceProfile?.dependencies?.slice(0, 60),
      symbols: sourceProfile?.symbols?.slice(0, 60),
      architectureSignals: sourceProfile?.architectureSignals,
      negativeSignals: sourceProfile?.negativeSignals,
      sensitiveMaterialFindings: sourceProfile?.sensitiveMaterialFindings
    }, null, 2),
    "",
    "Deterministic auto-match:",
    JSON.stringify(autoMatch, null, 2),
    "",
    "Available Harness catalog:",
    JSON.stringify(catalog, null, 2),
    "",
    "Top keywords:",
    JSON.stringify(corpus.keywords.slice(0, 40)),
    "",
    "Redacted source excerpts:",
    redactedCorpus
  ].join("\n");
}

async function callOpenAiCompatibleJson({ requestId, config, prompt, caller, intent }) {
  let lastError;
  const attempts = Math.max(1, Number(config.maxRetries ?? 1));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await callOpenAiCompatibleJsonOnce({ requestId, config, prompt, caller, intent });
    } catch (error) {
      lastError = error;
      if (!isAdvisorRetryable(error) || attempt >= attempts) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("LLM Advisor provider call failed.");
}

async function callOpenAiCompatibleJsonOnce({ requestId, config, prompt, caller, intent }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(config.timeoutSeconds ?? 90)) * 1000);
  const startedAt = Date.now();
  try {
    const response = await fetch(openAiCompatibleEndpoint(config.baseUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        model: config.modelName,
        temperature: Number(config.temperature ?? 0.1),
        max_tokens: Number(config.maxOutputTokens ?? 2048),
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`LLM Advisor provider call failed: status=${response.status}, body=${maskSecretText(text)}`);
      error.code = response.status === 429 ? "LLM_ADVISOR_RATE_LIMITED" : response.status >= 500 ? "LLM_ADVISOR_PROVIDER_UNAVAILABLE" : `LLM_ADVISOR_HTTP_${response.status}`;
      throw error;
    }
    const root = JSON.parse(text || "{}");
    const choice = Array.isArray(root.choices) ? root.choices[0] ?? {} : {};
    return {
      requestId,
      text: providerMessageContent(choice.message?.content),
      provider: config.providerName,
      model: config.modelName,
      durationMs: Date.now() - startedAt,
      finishReason: String(choice.finish_reason ?? ""),
      usage: providerUsage(root.usage)
    };
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("LLM Advisor provider call timed out.");
      timeoutError.code = "LLM_ADVISOR_TIMEOUT";
      throw timeoutError;
    }
    if (error instanceof SyntaxError) {
      const parseError = new Error("LLM Advisor provider response was not valid JSON.");
      parseError.code = "LLM_ADVISOR_RESPONSE_INVALID";
      throw parseError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeLlmAdvisorResult({ control, config, response, parsed, durationMs, prompt, context }) {
  const recommendationRecord = isRecord(parsed.recommendation) ? parsed.recommendation : {};
  const action = normalizeAdvisorAction(recommendationRecord.action);
  const targetHarnessId = optionalSafeId(recommendationRecord.targetHarnessId) ?? context.autoMatch.targetHarnessId;
  const targetDomain = safeId(String(recommendationRecord.targetDomain ?? targetHarnessId.replace(/-harness$/, "")));
  return {
    schema: LLM_ADVISOR_SCHEMA,
    status: "SUCCEEDED",
    mode: control.mode,
    requestId: response.requestId,
    llmProfileId: config.profileId,
    llmProfileName: config.profileName,
    modelsFile: config.modelsFile,
    modelsFileExists: config.modelsFileExists,
    provider: response.provider,
    model: response.model,
    durationMs,
    finishReason: response.finishReason,
    usage: response.usage,
    promptDigest: digestText(prompt),
    sourceDigest: context.corpus.digest,
    sourceClassification: stringValue(parsed.sourceClassification, "unknown"),
    rationale: stringValue(parsed.rationale, ""),
    domainFit: normalizeDomainFit(parsed.domainFit),
      recommendation: {
        action,
        targetHarnessId,
        targetDomain,
        confidence: normalizedConfidence(recommendationRecord.confidence),
        reason: stringValue(recommendationRecord.reason, "")
      },
      alternatives: normalizeAdvisorAlternatives(parsed.alternatives),
      reviewWarnings: normalizeStrings(parsed.reviewWarnings).slice(0, 12),
      definitionQualityAdvice: normalizeDefinitionQualityAdvice(parsed.definitionQualityAdvice),
      sensitiveMaterialFindings: normalizeStrings(parsed.sensitiveMaterialFindings).slice(0, 12),
      commandRecommendations: normalizeStrings(parsed.commandRecommendations).slice(0, 6).map(maskSecretText),
    nextAction: "review-llm-advisor-and-draft"
  };
}

function applyLlmAdvisorToMatch(autoMatch, llmAdvisor, packs, args) {
  if (!args.options["apply-llm-advisor"]) return autoMatch;
  if (stringOption(args, "target-id")) {
    return { ...autoMatch, llmAdvisorApplied: false, llmAdvisorApplyReason: "explicit-target-id-wins" };
  }
  if (!llmAdvisor || llmAdvisor.status !== "SUCCEEDED") {
    return { ...autoMatch, llmAdvisorApplied: false, llmAdvisorApplyReason: `advisor-status=${llmAdvisor?.status ?? "missing"}` };
  }
  const recommendation = llmAdvisor.recommendation ?? {};
  if (recommendation.action === "KEEP_AUTO_MATCH") {
    return { ...autoMatch, llmAdvisorApplied: false, llmAdvisorApplyReason: "advisor-kept-auto-match" };
  }
  const threshold = numberOption(args, "llm-advisor-apply-threshold", Number(process.env.EVOPILOT_HARNESS_LLM_ADVISOR_APPLY_THRESHOLD ?? 0.7));
  if (Number(recommendation.confidence ?? 0) < threshold) {
    return { ...autoMatch, llmAdvisorApplied: false, llmAdvisorApplyReason: `advisor-confidence<${threshold}` };
  }
  const targetHarnessId = safeId(recommendation.targetHarnessId ?? autoMatch.targetHarnessId);
  const pack = packs.find((item) => item.id === targetHarnessId);
  const action = normalizeAdvisorAction(recommendation.action);
  const shouldUseExisting = ["EVOLVE_EXISTING", "FORK_FROM_MATCH"].includes(action) && Boolean(pack);
  return {
    ...autoMatch,
    decision: shouldUseExisting ? "EVOLVE_EXISTING" : action === "CREATE_NEW_WITH_PARENT_REFERENCE" ? "CREATE_NEW_WITH_PARENT_REFERENCE" : "CREATE_NEW",
    confidence: Number(recommendation.confidence ?? autoMatch.confidence ?? 0),
    targetHarnessId,
    targetVersion: shouldUseExisting ? bumpPatch(pack.version) : String(recommendation.targetVersion ?? "0.1.0"),
    targetDomain: safeId(recommendation.targetDomain ?? targetHarnessId.replace(/-harness$/, "")),
    baseHarnessRef: shouldUseExisting ? { id: pack.id, version: pack.version, digest: digestText(pack.templateText) } : undefined,
    reasons: uniqueStrings([
      `llmAdvisor=${llmAdvisor.sourceClassification}`,
      `llmAdvisorAction=${action}`,
      recommendation.reason,
      ...autoMatch.reasons
    ]).slice(0, 12),
    deterministicAutoMatch: {
      decision: autoMatch.decision,
      targetHarnessId: autoMatch.targetHarnessId,
      targetVersion: autoMatch.targetVersion,
      confidence: autoMatch.confidence,
      reasons: autoMatch.reasons
    },
    llmAdvisorApplied: true,
    llmAdvisorRequestId: llmAdvisor.requestId,
    nextAction: "review-generated-draft"
  };
}

function isLlmAdvisorBlocking(llmAdvisor) {
  return llmAdvisor?.mode === "required" && llmAdvisor.status !== "SUCCEEDED";
}

function advisorWorkflowStatus(llmAdvisor) {
  if (!llmAdvisor || llmAdvisor.status === "DISABLED" || llmAdvisor.status === "SKIPPED") return "SKIPPED";
  if (llmAdvisor.status === "SUCCEEDED") return "COMPLETED";
  return "BLOCKED";
}

function normalizeAdvisorAction(value) {
  const action = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (["KEEP_AUTO_MATCH", "EVOLVE_EXISTING", "CREATE_NEW", "CREATE_NEW_WITH_PARENT_REFERENCE", "FORK_FROM_MATCH"].includes(action)) return action;
  return "KEEP_AUTO_MATCH";
}

function normalizeDomainFit(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    harnessId: safeId(item.harnessId ?? item.id ?? "harness"),
    fit: stringValue(item.fit, "unknown"),
    reason: stringValue(item.reason, "")
  })).slice(0, 12);
}

function normalizeAdvisorAlternatives(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    action: normalizeAdvisorAction(item.action),
    targetHarnessId: optionalSafeId(item.targetHarnessId),
    condition: stringValue(item.condition, "")
  })).slice(0, 8);
}

function openAiCompatibleEndpoint(baseUrl) {
  let normalized = String(baseUrl ?? "").trim();
  while (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

function providerMessageContent(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((part) => typeof part === "string" ? part : isRecord(part) ? String(part.text ?? part.content ?? "") : "").join("");
  }
  return value == null ? "" : String(value);
}

function providerUsage(value) {
  const inputTokens = Number(value?.prompt_tokens ?? value?.input_tokens ?? 0);
  const outputTokens = Number(value?.completion_tokens ?? value?.output_tokens ?? 0);
  const totalTokens = Number(value?.total_tokens ?? inputTokens + outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    creditsConsumed: totalTokens,
    creditUnit: "token"
  };
}

function parseJsonObject(text) {
  const value = String(text ?? "").trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  const json = start >= 0 && end > start ? value.slice(start, end + 1) : value;
  return JSON.parse(json);
}

function isAdvisorRetryable(error) {
  return error?.code === "LLM_ADVISOR_RATE_LIMITED" || error?.code === "LLM_ADVISOR_PROVIDER_UNAVAILABLE" || error?.code === "LLM_ADVISOR_TIMEOUT";
}

function createDraftPack(run, match, corpus, args, sourceProfile) {
  const source = path.resolve(stringOption(args, "source") ?? "harnesses");
  const basePack = match.baseHarnessRef ? findHarnessPack(source, match.baseHarnessRef.id) : undefined;
  const template = basePack ? structuredCloneJson(basePack.template) : createGenericDomainTemplate(match.targetHarnessId, match.targetDomain, sourceProfile, match);
  template.schema = HARNESS_TEMPLATE_SCHEMA_V2;
  template.id = match.targetHarnessId;
  template.version = match.targetVersion;
  template.name = humanName(match.targetHarnessId);
  template.description = `Generated Harness draft for ${match.targetDomain} from ${run.sources.length} source(s).`;
  template.harnessLayer = template.harnessLayer ?? "domain";
  template.domain = match.targetDomain;
  template.matchSignals = {
    ...(isRecord(template.matchSignals) ? template.matchSignals : {}),
    include: uniqueStrings([...(Array.isArray(template.matchSignals?.include) ? template.matchSignals.include : []), ...corpus.keywords.slice(0, 20), ...(sourceProfile?.positiveSignals ?? []).slice(0, 20), match.targetDomain, match.targetHarnessId]),
    exclude: uniqueStrings([...(Array.isArray(template.matchSignals?.exclude) ? template.matchSignals.exclude : []), ...(sourceProfile?.negativeSignals ?? []).slice(0, 12)])
  };
  template.sourceReferences = [
    ...(Array.isArray(template.sourceReferences) ? template.sourceReferences : []),
    ...run.sources.map((source) => ({
      name: source.name,
      type: source.type,
      uri: source.uri,
      github: source.github,
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
  ensureTemplateQualityModel(template, match, sourceProfile);
  ensureDefinitionQualityTarget(template, match, sourceProfile);
  ensureHarnessTemplateV2Metadata(template, match, sourceProfile);
  const templateYaml = stringifyYaml(template);
  const readme = renderDraftReadme(run, template, match);
  const changelog = renderDraftChangelog(run, template, match);
  const exampleProfile = renderExampleProfile(template);
  const asset = draftAssetV2({ harnessId: template.id, version: String(template.version), template, templateYaml }, sourceProfile, match);
  const assetYaml = stringifyYaml(asset);
  return {
    schema: "evopilot-harness-draft-pack/v1",
    harnessId: template.id,
    version: String(template.version),
    domain: String(template.domain),
    digest: digestText(templateYaml),
    template,
    templateYaml,
    asset,
    assetYaml,
      readme,
      changelog,
      exampleProfile,
      diffFromBase: {
        baseHarnessRef: match.baseHarnessRef,
        changedSections: ["metadata", "matchSignals", "sourceReferences", "domainExecution", "definitionQuality", "changelog"]
      }
    };
  }

function normalizeDefinitionQualityAdvice(value) {
  const record = isRecord(value) ? value : {};
  return {
    objective: stringValue(record.objective, DEFINITION_QUALITY_TARGET.objective),
    requiredImprovements: normalizeStrings(record.requiredImprovements).slice(0, 12),
    nonGoals: uniqueStrings([...normalizeStrings(record.nonGoals), ...DEFINITION_QUALITY_TARGET.nonGoals]).slice(0, 12)
  };
}

function createGenericDomainTemplate(id, domain, sourceProfile, match) {
  const boundary = defaultProductBoundary(id, domain, sourceProfile);
  const policy = defaultMatchPolicy(id, domain, sourceProfile, boundary);
  return {
    schema: HARNESS_TEMPLATE_SCHEMA_V2,
    apiVersion: HARNESS_ASSET_API_VERSION,
    kind: "HarnessTemplate",
    id,
    version: "0.1.0",
    name: humanName(id),
    description: `Domain baseline for ${domain}.`,
    scope: "platform",
    languageFamily: "generic",
    harnessLayer: "domain",
    domain,
    productBoundary: boundary,
    matchPolicy: policy,
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
    executionModel: defaultExecutionModel(sourceProfile),
    validationBaseline: { requiredCommandGroups: ["install", "test", "smoke"], commandEvidenceRequired: true, realBoundaryEvidenceRequired: true, noMockEvidenceForReleaseClaims: true },
    evidenceContract: { format: "json", requiredArtifacts: ["runtime-log", "test-report"], correlationFields: ["requestId", "traceId"] },
    failureTaxonomy: { categories: ["runtime", "dependency", "data", "observability", "governance"] },
    diagnosticsBaseline: { requiredSignals: ["command", "log-excerpt", "root-cause", "next-action"] },
      observabilityBaseline: { requiredSignals: ["health", "readiness", "logs", "metrics"] },
      governanceRules: { noSilentProfileMutation: true, promotionRequiresReleaseDecision: true },
      qualityGate: defaultQualityGate(),
      definitionQuality: defaultDefinitionQualityTarget(match, sourceProfile),
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

function ensureTemplateQualityModel(template, match, sourceProfile) {
  template.productBoundary = isRecord(template.productBoundary) ? template.productBoundary : defaultProductBoundary(match.targetHarnessId, match.targetDomain, sourceProfile);
  template.productBoundary.includes = normalizeStrings(template.productBoundary.includes).length > 0 ? normalizeStrings(template.productBoundary.includes) : defaultProductBoundary(match.targetHarnessId, match.targetDomain, sourceProfile).includes;
  template.productBoundary.excludes = normalizeStrings(template.productBoundary.excludes).length > 0 ? normalizeStrings(template.productBoundary.excludes) : defaultProductBoundary(match.targetHarnessId, match.targetDomain, sourceProfile).excludes;
  template.matchPolicy = isRecord(template.matchPolicy) ? template.matchPolicy : defaultMatchPolicy(match.targetHarnessId, match.targetDomain, sourceProfile, template.productBoundary);
  template.matchPolicy.requiredAny = normalizeStrings(template.matchPolicy.requiredAny).length > 0 ? normalizeStrings(template.matchPolicy.requiredAny) : defaultMatchPolicy(match.targetHarnessId, match.targetDomain, sourceProfile, template.productBoundary).requiredAny;
  template.matchPolicy.positive = isRecord(template.matchPolicy.positive) ? template.matchPolicy.positive : {};
  const defaultPolicy = defaultMatchPolicy(match.targetHarnessId, match.targetDomain, sourceProfile, template.productBoundary);
  for (const key of ["dependencies", "imports", "files", "symbols", "architectureSignals"]) {
    template.matchPolicy.positive[key] = normalizeStrings(template.matchPolicy.positive[key]).length > 0 ? normalizeStrings(template.matchPolicy.positive[key]) : defaultPolicy.positive[key];
  }
  template.matchPolicy.negative = isRecord(template.matchPolicy.negative) ? template.matchPolicy.negative : {};
  template.matchPolicy.negative.productBoundaryExcludes = normalizeStrings(template.matchPolicy.negative.productBoundaryExcludes).length > 0 ? normalizeStrings(template.matchPolicy.negative.productBoundaryExcludes) : defaultPolicy.negative.productBoundaryExcludes;
  template.matchPolicy.negative.signals = normalizeStrings(template.matchPolicy.negative.signals).length > 0 ? normalizeStrings(template.matchPolicy.negative.signals) : defaultPolicy.negative.signals;
  template.executionModel = isRecord(template.executionModel) ? template.executionModel : defaultExecutionModel(sourceProfile);
  template.executionModel.phases = normalizeStrings(template.executionModel.phases).length > 0 ? normalizeStrings(template.executionModel.phases) : defaultExecutionModel(sourceProfile).phases;
  template.executionModel.requiredCommands = isRecord(template.executionModel.requiredCommands) ? template.executionModel.requiredCommands : defaultExecutionModel(sourceProfile).requiredCommands;
  template.qualityGate = isRecord(template.qualityGate) ? template.qualityGate : defaultQualityGate();
}

function ensureDefinitionQualityTarget(template, match, sourceProfile) {
  const existing = isRecord(template.definitionQuality) ? template.definitionQuality : {};
  const defaults = defaultDefinitionQualityTarget(match, sourceProfile);
  template.definitionQuality = {
    schema: "evopilot-harness-definition-quality/v1",
    objective: stringValue(existing.objective, defaults.objective),
    focusAreas: uniqueStrings([...normalizeStrings(existing.focusAreas), ...defaults.focusAreas]),
    requiredImprovements: uniqueStrings([...normalizeStrings(existing.requiredImprovements), ...defaults.requiredImprovements]),
    reviewQuestions: uniqueStrings([...normalizeStrings(existing.reviewQuestions), ...defaults.reviewQuestions]),
    nonGoals: uniqueStrings([...normalizeStrings(existing.nonGoals), ...defaults.nonGoals])
  };
}

function defaultDefinitionQualityTarget(match, sourceProfile) {
  const role = sourceProfile?.primaryRole ?? "unknown-source";
  const domain = match?.targetDomain ?? "domain";
  return {
    ...DEFINITION_QUALITY_TARGET,
    requiredImprovements: [
      `separate ${role} from adjacent product, framework, and runtime boundaries`,
      `declare specific positive and negative match evidence for ${domain}`,
      "make source evidence requirements concrete enough for administrator review",
      "turn domain execution into checkable actions with named artifacts"
    ],
    reviewQuestions: [
      "Does the Harness describe the project-owned domain rather than a third-party product clone?",
      "Are client libraries, adapters, tools, and product kernels separated by negative signals?",
      "Can an EvoPilot executor know which evidence to collect without reading hidden context?",
      "Are review blockers tied to missing evidence rather than generic maturity claims?"
    ]
  };
}

function ensureHarnessTemplateV2Metadata(template, match, sourceProfile) {
  template.schema = HARNESS_TEMPLATE_SCHEMA_V2;
  template.apiVersion = HARNESS_ASSET_API_VERSION;
  template.kind = "HarnessTemplate";
  template.metadata = {
    ...(isRecord(template.metadata) ? template.metadata : {}),
    id: template.id ?? match.targetHarnessId,
    name: template.name ?? humanName(match.targetHarnessId),
    version: String(template.version ?? match.targetVersion ?? "0.1.0"),
    domain: template.domain ?? match.targetDomain,
    layer: template.harnessLayer ?? template.runtimePatterns?.harnessLayer ?? "domain",
    sourceProfileDigest: sourceProfile?.digest
  };
  template.status = {
    ...(isRecord(template.status) ? template.status : {}),
    phase: template.lifecycle?.status ?? "draft",
    conditions: Array.isArray(template.status?.conditions) && template.status.conditions.length > 0
      ? template.status.conditions
      : [
          { type: "TemplateQualityModeled", status: "True", reason: "RequiredSectionsPresent" },
          { type: "HumanReviewRequired", status: "True", reason: "HarnessPublicationGate" }
        ]
  };
}

function defaultProductBoundary(id, domain, sourceProfile) {
  const role = sourceProfile?.primaryRole ?? "domain";
  const includesByRole = {
    "redis-client-library": ["Redis client wrapper", "cache client SDK", "RedisTemplate/Jedis adapter", "serializer and connection factory", "read/write routing helper"],
    "cache-proxy-monitor": ["cache proxy health check", "Redis operation probe", "service discovery monitor", "runtime diagnostic command"],
    "distributed-cache-product": ["self-developed distributed cache runtime", "Redis-compatible or Memcached-compatible protocol", "replication/failover/slot migration", "eviction and TTL engine"],
    "database-product": ["self-developed database product", "SQL or storage engine", "query optimizer", "transaction/recovery engine"],
    "api-gateway-product": ["API gateway runtime", "listener/route/upstream/policy control", "plugin/filter lifecycle", "protocol and load evidence"],
    "rpc-framework": ["RPC framework runtime", "registry/remoting/protocol modules", "consumer/provider compatibility", "transport failure handling"],
    "workflow-engine": ["workflow/orchestration engine", "task state model", "agent/plugin execution", "metadata and runtime control"],
    "logging-sdk": ["logging SDK", "logback/slf4j adapter", "correlation context propagation", "request/trace field enrichment"],
    "enterprise-admin-software": ["enterprise admin product", "business workflow", "RBAC/audit/reporting", "database-backed service"],
    "frontend-admin-app": ["admin frontend application", "Vue/route/state management", "browser build and smoke", "API integration surface"],
    "api-facade-library": ["API facade or SDK", "typed contract wrapper", "client integration boundary"],
    "java-service": ["Java service", "Maven/Gradle build", "service runtime and tests"]
  };
  const excludesByRole = {
    "redis-client-library": ["distributed cache server kernel", "cluster membership", "failover controller", "eviction engine", "storage engine"],
    "cache-proxy-monitor": ["API gateway product", "distributed cache server kernel", "database product"],
    "logging-sdk": ["observability platform backend", "API gateway product", "distributed cache product"],
    "rpc-framework": ["API gateway product", "business management app", "distributed cache product"],
    "frontend-admin-app": ["backend control plane", "API gateway runtime", "database product"],
    "enterprise-admin-software": ["database product kernel", "API gateway runtime", "distributed cache engine"]
  };
  return {
    includes: uniqueStrings(includesByRole[role] ?? [`${domain} owned domain boundary`, `${id} reusable Harness target`, "source-driven execution evidence"]),
    excludes: uniqueStrings(excludesByRole[role] ?? ["unrelated framework sample", "external product fork", "mock-only evidence"])
  };
}

function defaultMatchPolicy(id, domain, sourceProfile, boundary) {
  const dependencies = sourceProfile?.dependencies?.slice(0, 16) ?? [];
  const imports = sourceProfile?.imports?.slice(0, 16) ?? [];
  const symbols = sourceProfile?.symbols?.slice(0, 16) ?? [];
  const files = sourceProfile?.selectedFiles?.filter((file) => /(^|\/)(pom\.xml|package\.json|go\.mod|pyproject\.toml|Cargo\.toml|README|src\/)/i.test(file)).slice(0, 16) ?? [];
  const architectureSignals = uniqueStrings([...(sourceProfile?.architectureSignals ?? []), sourceProfile?.primaryRole, domain, id].filter(Boolean)).slice(0, 18);
  return {
    requiredAny: uniqueStrings([
      ...dependencies.slice(0, 4).map((item) => `dependency:${item}`),
      ...imports.slice(0, 4).map((item) => `import:${item}`),
      ...symbols.slice(0, 4).map((item) => `symbol:${item}`),
      ...architectureSignals.slice(0, 4).map((item) => `architecture:${item}`)
    ]).slice(0, 10),
    positive: {
      dependencies,
      imports,
      files,
      symbols,
      architectureSignals
    },
    negative: {
      productBoundaryExcludes: normalizeStrings(boundary?.excludes),
      signals: sourceProfile?.negativeSignals?.slice(0, 12) ?? []
    }
  };
}

function defaultExecutionModel(sourceProfile) {
  const primaryLanguage = sourceProfile?.languages?.[0] ?? "generic";
  const requiredCommands = primaryLanguage === "node"
    ? { install: ["npm ci"], test: ["npm test"], smoke: ["npm run build --if-present"] }
    : primaryLanguage === "go"
      ? { install: ["go mod download"], test: ["go test ./..."], smoke: ["go test ./... -run TestNonExistent"] }
      : primaryLanguage === "python"
        ? { install: ["uv sync || pip install -e ."], test: ["pytest"], smoke: ["pytest -q"] }
        : primaryLanguage === "java"
          ? { install: ["mvn -q -DskipTests package"], test: ["mvn test"], smoke: ["mvn -q -DskipTests verify"] }
          : { install: ["make deps"], test: ["make test"], smoke: ["make smoke"] };
  return {
    phases: ["scan", "build", "unit", "integration", "diagnostics", "release-review"],
    requiredCommands,
    optionalCommands: {
      profile: ["evopilot-harness detect --source-project <path> --json"],
      strictValidate: ["evopilot-harness harness validate <harness-id> --strict --json"]
    }
  };
}

function defaultQualityGate() {
  return {
    minTemplateScore: 0.8,
    requireProductBoundary: true,
    requireMatchPolicy: true,
    requireExecutionModel: true,
    requireEvidenceContract: true,
    requireExamples: true,
    requireHumanApproval: true
  };
}

function validateDraftPack(draft) {
  const checks = [
    { id: "draft-template", status: draft.templateYaml ? "PASS" : "FAIL", evidence: [`digest=${draft.digest}`] },
    { id: "draft-asset", status: draft.assetYaml ? "PASS" : "FAIL", evidence: [`digest=${draft.assetYaml ? digestText(draft.assetYaml) : "missing"}`] },
    { id: "draft-readme", status: draft.readme ? "PASS" : "FAIL", evidence: [`bytes=${draft.readme?.length ?? 0}`] },
    ...validateHarnessTemplateContract(draft.template, { name: draft.harnessId, version: draft.version, layer: "domain", domain: draft.domain }, { strict: true }),
    ...validateHarnessAssetContract(draft.asset, { name: draft.harnessId, version: draft.version, layer: "domain", domain: draft.domain })
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
  if (draft.assetYaml) fs.writeFileSync(path.join(draftRoot, "asset.yaml"), draft.assetYaml, "utf8");
  fs.writeFileSync(path.join(draftRoot, "README.md"), draft.readme, "utf8");
  fs.writeFileSync(path.join(draftRoot, "CHANGELOG.md"), draft.changelog, "utf8");
  fs.writeFileSync(path.join(draftRoot, "examples", "selected-harness-binding.yaml"), draft.exampleProfile, "utf8");
}

function writeCorpusDraftFiles(dataRoot, corpusId, groupId, draft) {
  const draftRoot = path.join(dataRoot, "corpora", safeId(corpusId), "drafts", safeId(groupId));
  fs.mkdirSync(path.join(draftRoot, "examples"), { recursive: true });
  fs.writeFileSync(path.join(draftRoot, "template.yaml"), draft.templateYaml, "utf8");
  if (draft.assetYaml) fs.writeFileSync(path.join(draftRoot, "asset.yaml"), draft.assetYaml, "utf8");
  fs.writeFileSync(path.join(draftRoot, "README.md"), draft.readme, "utf8");
  fs.writeFileSync(path.join(draftRoot, "CHANGELOG.md"), draft.changelog, "utf8");
  fs.writeFileSync(path.join(draftRoot, "examples", "selected-harness-binding.yaml"), draft.exampleProfile, "utf8");
}

function listHarnessPacks(source) {
  if (!fs.existsSync(source)) return [];
  const packRoots = [];
  for (const entry of fs.readdirSync(source)) {
    const entryPath = path.join(source, entry);
    if (!fs.statSync(entryPath).isDirectory()) continue;
    if (readHarnessPack(entryPath)) {
      packRoots.push(entryPath);
      continue;
    }
    for (const nested of fs.readdirSync(entryPath)) {
      const nestedPath = path.join(entryPath, nested);
      if (fs.statSync(nestedPath).isDirectory() && readHarnessPack(nestedPath)) packRoots.push(nestedPath);
    }
  }
  return packRoots
    .map(readHarnessPack)
    .filter(Boolean)
    .sort(compareHarnessPacks);
}

function readHarnessPack(packRoot) {
  const assetPath = path.join(packRoot, "asset.yaml");
  const rawAsset = fs.existsSync(assetPath) ? parseYaml(fs.readFileSync(assetPath, "utf8")) : undefined;
  const templatePath = ["template.yaml", "harness.yaml"].map((file) => path.join(packRoot, file)).find((file) => fs.existsSync(file));
  if (!templatePath && !rawAsset?.spec?.template) return undefined;
  const templateText = templatePath ? fs.readFileSync(templatePath, "utf8") : stringifyYaml(rawAsset.spec.template);
  const parsed = parseYaml(templateText);
  const template = normalizeHarnessTemplateRoot(parsed, rawAsset);
  const id = safeId(String(template.id ?? path.basename(packRoot)));
  const version = String(template.version ?? "0.1.0");
  return {
    id,
    version,
    root: packRoot,
    templatePath,
    templateText,
    template,
    assetPath: fs.existsSync(assetPath) ? assetPath : undefined,
    asset: rawAsset,
    readmePath: path.join(packRoot, "README.md"),
    changelogPath: path.join(packRoot, "CHANGELOG.md"),
    examplesPath: path.join(packRoot, "examples")
  };
}

function normalizeHarnessTemplateRoot(template, asset) {
  if (isRecord(template) && template.apiVersion === HARNESS_ASSET_API_VERSION && template.kind === HARNESS_ASSET_KIND && isRecord(template.spec?.template)) {
    return template.spec.template;
  }
  if (isRecord(asset?.spec?.template) && (!isRecord(template) || !template.id)) return asset.spec.template;
  return isRecord(template) ? template : {};
}

function findHarnessPack(source, id) {
  return listHarnessPacks(source).find((pack) => pack.id === id);
}

function compareHarnessPacks(left, right) {
  const byId = left.id.localeCompare(right.id);
  if (byId !== 0) return byId;
  return compareVersionsDesc(left.version, right.version);
}

function compareVersionsDesc(left, right) {
  const leftParts = String(left).split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = String(right).split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightPart = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (leftPart !== rightPart) return rightPart - leftPart;
  }
  return 0;
}

function packSummary(pack) {
  return {
    id: pack.id,
    version: pack.version,
    name: pack.template.name ?? humanName(pack.id),
    domain: pack.template.domain ?? pack.template.runtimePatterns?.domain,
    layer: pack.template.harnessLayer ?? pack.template.runtimePatterns?.harnessLayer ?? "runtime",
    digest: digestText(pack.templateText),
    assetApiVersion: HARNESS_ASSET_API_VERSION,
    assetDigest: pack.asset ? digestText(stringifyYaml(pack.asset)) : undefined,
    description: pack.template.description
  };
}

function publishPack(pack, out, context = {}) {
  const targetRoot = path.join(out, pack.id, pack.version);
  fs.rmSync(targetRoot, { recursive: true, force: true });
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.copyFileSync(pack.templatePath, path.join(targetRoot, path.basename(pack.templatePath)));
  if (fs.existsSync(pack.readmePath)) fs.copyFileSync(pack.readmePath, path.join(targetRoot, "README.md"));
  if (fs.existsSync(pack.changelogPath)) fs.copyFileSync(pack.changelogPath, path.join(targetRoot, "CHANGELOG.md"));
  if (fs.existsSync(pack.examplesPath)) fs.cpSync(pack.examplesPath, path.join(targetRoot, "examples"), { recursive: true });
  const templateFile = path.basename(pack.templatePath);
  const relativePath = `./${pack.id}/${pack.version}/${templateFile}`;
  const sourceRoot = path.relative(PACKAGE_ROOT, pack.root).split(path.sep).join("/") || ".";
  const asset = toHarnessAssetV2(pack, { sourceRoot, phase: pack.template.lifecycle?.status === "deprecated" ? "deprecated" : "published", generatedAt: context.generatedAt });
  const assetText = stringifyYaml(asset);
  fs.writeFileSync(path.join(targetRoot, "asset.yaml"), assetText, "utf8");
  const assetPath = `./${pack.id}/${pack.version}/asset.yaml`;
  const quality = templateQualitySummary(pack.template, pack.id);
  return {
    name: pack.id,
    version: pack.version,
    apiVersion: HARNESS_ASSET_API_VERSION,
    kind: HARNESS_ASSET_KIND,
    layer: pack.template.harnessLayer ?? pack.template.runtimePatterns?.harnessLayer ?? "runtime",
    domain: pack.template.domain ?? pack.template.runtimePatterns?.domain,
    status: pack.template.lifecycle?.status === "deprecated" ? "deprecated" : "published",
    path: relativePath,
    digest: digestText(pack.templateText),
    assetPath,
    assetDigest: digestText(assetText),
    qualityScore: quality.score,
    qualityStatus: quality.score >= Number(pack.template.qualityGate?.minTemplateScore ?? 0.8) ? "PASS" : "FAIL",
    tags: catalogTags(pack.template),
    matchSummary: pack.template.description ?? pack.template.name ?? pack.id,
    provenance: {
      generatedBy: "evopilot-harness",
      generatedAt: asset.status?.observedAt,
      templateDigest: digestText(pack.templateText)
    }
  };
}

function toHarnessAssetV2(pack, context = {}) {
  const template = structuredCloneJson(pack.template);
  ensureHarnessTemplateV2Metadata(template, {
    targetHarnessId: pack.id,
    targetVersion: pack.version,
    targetDomain: template.domain ?? template.runtimePatterns?.domain ?? pack.id.replace(/-harness$/, "")
  });
  const quality = templateQualitySummary(template, pack.id);
  const templateText = stringifyYaml(template);
  const templateDigest = digestText(templateText);
  const phase = context.phase ?? (template.lifecycle?.status === "deprecated" ? "deprecated" : "published");
  const generatedAt = context.generatedAt ?? new Date().toISOString();
  const sourceReferences = Array.isArray(template.sourceReferences) ? template.sourceReferences : [];
  return compactRecord({
    apiVersion: HARNESS_ASSET_API_VERSION,
    kind: HARNESS_ASSET_KIND,
    metadata: {
      id: pack.id,
      name: template.name ?? humanName(pack.id),
      version: String(pack.version),
      domain: template.domain ?? template.runtimePatterns?.domain,
      layer: template.harnessLayer ?? template.runtimePatterns?.harnessLayer ?? "runtime",
      labels: {
        languageFamily: template.languageFamily ?? "generic",
        scope: template.scope ?? "platform"
      },
      annotations: {
        "evopilot-harness/templateDigest": templateDigest,
        "evopilot-harness/sourceRoot": context.sourceRoot
      }
    },
    spec: {
      templateSchema: template.schema ?? HARNESS_TEMPLATE_SCHEMA_V2,
      template,
      match: {
        productBoundary: template.productBoundary,
        matchPolicy: template.matchPolicy,
        matchSignals: template.matchSignals
      },
      execution: template.executionModel,
      evidence: template.evidenceContract,
      qualityGate: template.qualityGate,
      lifecycle: template.lifecycle ?? { status: phase }
    },
    relations: {
      parents: normalizeStrings(template.parentHarnessIds),
      sourceReferences: sourceReferences.map((source) => compactRecord({
        name: source.name,
        type: source.type,
        digest: source.digest,
        description: source.description
      }))
    },
    status: {
      phase,
      observedAt: generatedAt,
      conditions: [
        {
          type: "TemplateQualityValidated",
          status: quality.score >= Number(template.qualityGate?.minTemplateScore ?? 0.8) ? "True" : "False",
          reason: quality.missing.length === 0 ? "TemplateQualityComplete" : "TemplateQualityMissingSections",
          message: `score=${quality.score};missing=${quality.missing.join("|") || "none"}`
        },
        {
          type: "AssetEnvelopeReady",
          status: "True",
          reason: "HarnessAssetV2Generated",
          message: `${HARNESS_ASSET_API_VERSION}/${HARNESS_ASSET_KIND}`
        }
      ],
      quality,
      provenance: {
        generatedBy: "evopilot-harness",
        generatedAt,
        sourceTemplateDigest: digestText(pack.templateText),
        assetTemplateDigest: templateDigest,
        sourceReferenceCount: sourceReferences.length
      }
    }
  });
}

function draftAssetV2(draft, sourceProfile, match) {
  return toHarnessAssetV2({
    id: draft.harnessId,
    version: draft.version,
    root: "",
    templatePath: "",
    templateText: draft.templateYaml,
    template: draft.template
  }, {
    phase: "draft",
    sourceRoot: sourceProfile?.projectRoots?.[0],
    match
  });
}

function validateHarnessAssetContract(asset, entry = {}) {
  const metadata = isRecord(asset?.metadata) ? asset.metadata : {};
  const spec = isRecord(asset?.spec) ? asset.spec : {};
  const status = isRecord(asset?.status) ? asset.status : {};
  const conditions = Array.isArray(status.conditions) ? status.conditions : [];
  const checks = [];
  const name = entry.name ?? metadata.id ?? "harness";
  const version = entry.version ?? metadata.version ?? "0.1.0";
  checks.push({
    id: `asset:${name}@${version}:apiVersion`,
    status: asset?.apiVersion === HARNESS_ASSET_API_VERSION ? "PASS" : "FAIL",
    evidence: [`apiVersion=${String(asset?.apiVersion ?? "missing")}`]
  });
  checks.push({
    id: `asset:${name}@${version}:kind`,
    status: asset?.kind === HARNESS_ASSET_KIND ? "PASS" : "FAIL",
    evidence: [`kind=${String(asset?.kind ?? "missing")}`]
  });
  checks.push({
    id: `asset:${name}@${version}:metadata`,
    status: metadata.id && metadata.version && metadata.name ? "PASS" : "FAIL",
    evidence: [`id=${String(metadata.id ?? "missing")}`, `version=${String(metadata.version ?? "missing")}`]
  });
  checks.push({
    id: `asset:${name}@${version}:spec-template`,
    status: isRecord(spec.template) && spec.template.id ? "PASS" : "FAIL",
    evidence: [`template=${spec.template?.id ?? "missing"}`]
  });
  checks.push({
    id: `asset:${name}@${version}:status-conditions`,
    status: conditions.length > 0 && conditions.every(isRecord) ? "PASS" : "FAIL",
    evidence: [`count=${conditions.length}`]
  });
  checks.push({
    id: `asset:${name}@${version}:provenance`,
    status: isRecord(status.provenance) && status.provenance.generatedBy === "evopilot-harness" ? "PASS" : "FAIL",
    evidence: [`generatedBy=${String(status.provenance?.generatedBy ?? "missing")}`]
  });
  return checks;
}

function catalogQualityReport(entries) {
  const scores = entries.map((entry) => Number(entry.qualityScore ?? 0));
  const minScore = scores.length ? Math.min(...scores) : 0;
  const averageScore = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  return {
    schema: "evopilot-harness-catalog-quality/v2",
    assetCount: entries.length,
    minScore: Number(minScore.toFixed(2)),
    averageScore: Number(averageScore.toFixed(2)),
    failedAssets: entries.filter((entry) => entry.qualityStatus === "FAIL").map((entry) => `${entry.name}@${entry.version}`)
  };
}

function validateHarnessTemplateContract(template, entry, options = {}) {
  const runtimePatterns = isRecord(template.runtimePatterns) ? template.runtimePatterns : {};
  const domainExecution = isRecord(runtimePatterns.domainExecution) ? runtimePatterns.domainExecution : {};
  const harnessLayer = String(template.harnessLayer ?? runtimePatterns.harnessLayer ?? entry.layer ?? "").trim();
  const domain = String(template.domain ?? runtimePatterns.domain ?? entry.domain ?? "").trim();
  const checks = [];
  if (!template.id) checks.push({ id: `template:${entry.name}:id`, status: "FAIL", evidence: ["missing id"] });
  if (!template.version) checks.push({ id: `template:${entry.name}:version`, status: "FAIL", evidence: ["missing version"] });
  if (options.strict) checks.push(...validateTemplateQualityContract(template, entry, options));
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

function validateTemplateQualityContract(template, entry, options = {}) {
  const strict = Boolean(options.strict);
  const summary = templateQualitySummary(template, entry.name);
  const minScore = Number(template.qualityGate?.minTemplateScore ?? 0.8);
  const checks = [{
    id: `quality:${entry.name}@${entry.version}:score`,
    status: summary.score >= minScore ? "PASS" : strict ? "FAIL" : "WARN",
    evidence: [`score=${summary.score}`, `min=${minScore}`, `missing=${summary.missing.join("|") || "none"}`]
  }];
  for (const section of ["productBoundary", "matchPolicy", "executionModel", "evidenceContract", "qualityGate"]) {
    const ok = summary.present.includes(section);
    checks.push({
      id: `quality:${entry.name}@${entry.version}:${section}`,
      status: ok ? "PASS" : strict ? "FAIL" : "WARN",
      evidence: [ok ? "present" : "missing"]
    });
  }
  return checks;
}

function templateQualitySummary(template, harnessId = String(template.id ?? "harness")) {
  const sections = [
    ["productBoundary", hasProductBoundary(template)],
    ["matchPolicy", hasMatchPolicy(template)],
    ["executionModel", hasExecutionModel(template)],
    ["evidenceContract", hasEvidenceContract(template)],
    ["qualityGate", hasQualityGate(template)],
    ["domainExecution", hasDomainExecution(template)],
    ["validationBaseline", isRecord(template.validationBaseline)],
    ["failureTaxonomy", isRecord(template.failureTaxonomy)],
    ["observabilityBaseline", isRecord(template.observabilityBaseline)],
    ["governanceRules", isRecord(template.governanceRules)]
  ];
  const present = sections.filter(([, ok]) => ok).map(([name]) => name);
  const missing = sections.filter(([, ok]) => !ok).map(([name]) => name);
  return {
    harnessId,
    schema: "evopilot-harness-template-quality/v1",
    score: Number((present.length / sections.length).toFixed(2)),
    present,
    missing
  };
}

function hasProductBoundary(template) {
  return normalizeStrings(template.productBoundary?.includes).length > 0 && normalizeStrings(template.productBoundary?.excludes).length > 0;
}

function hasMatchPolicy(template) {
  const policy = templateMatchPolicy(template);
  return policy.requiredAny.length > 0
    && (policy.positive.dependencies.length + policy.positive.imports.length + policy.positive.files.length + policy.positive.symbols.length + policy.positive.architectureSignals.length) > 0
    && (policy.negative.productBoundaryExcludes.length + policy.negative.signals.length) > 0;
}

function hasExecutionModel(template) {
  return normalizeStrings(template.executionModel?.phases).length > 0 && isRecord(template.executionModel?.requiredCommands);
}

function hasEvidenceContract(template) {
  return isRecord(template.evidenceContract) && normalizeStrings(template.evidenceContract.requiredArtifacts).length > 0 && normalizeStrings(template.evidenceContract.correlationFields).length > 0;
}

function hasQualityGate(template) {
  return isRecord(template.qualityGate) && Number(template.qualityGate.minTemplateScore) > 0;
}

function hasDomainExecution(template) {
  const execution = template.runtimePatterns?.domainExecution;
  return isRecord(execution)
    && Array.isArray(execution.requiredActions) && execution.requiredActions.length > 0
    && Array.isArray(execution.evidenceAdapters) && execution.evidenceAdapters.length > 0
    && Array.isArray(execution.releaseBlockers) && execution.releaseBlockers.length > 0;
}

function renderCatalogMarkdown(catalog, entries) {
  const block = stringifyYaml({
    catalogVersion: catalog.catalogVersion,
    catalogId: catalog.catalogId,
    generatedAt: catalog.generatedAt,
    generatedBy: catalog.generatedBy,
    release: catalog.release,
    assetApiVersion: catalog.assetApiVersion,
    assetKind: catalog.assetKind,
    compatibleEvopilot: catalog.compatibleEvopilot,
    qualityReport: catalog.qualityReport,
    entries
  });
  const lines = [
    "# Harness Catalog",
    "",
    "This catalog is published by evopilot-harness. Each entry has a legacy-compatible template path and a Harness Asset v2 envelope for professional review, provenance, and quality evidence.",
    "",
    `Published Harness count: ${entries.length}`,
    `Harness Asset API: ${catalog.assetApiVersion}`,
    `Minimum quality score: ${catalog.qualityReport.minScore}`,
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

function registryFilePath(args) {
  return path.resolve(stringOption(args, "registry") ?? stringOption(args, "out") ?? "harness-registry.yaml");
}

function readRegistryFileIfExists(registryPath) {
  if (!fs.existsSync(registryPath)) return {};
  const parsed = parseYaml(fs.readFileSync(registryPath, "utf8"));
  return isRecord(parsed) ? parsed : {};
}

function portableCatalogRoot(registryPath, catalogRoot) {
  const relative = path.relative(path.dirname(registryPath), catalogRoot) || ".";
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return relative === "." ? "." : `./${relative}`;
  return catalogRoot;
}

function resolveRegistryCatalogRoot(registryPath, rootValue) {
  return path.isAbsolute(rootValue) ? path.resolve(rootValue) : path.resolve(path.dirname(registryPath), rootValue);
}

function compareRegistryCatalogRefs(left, right) {
  const leftPriority = Number(left.priority ?? 0);
  const rightPriority = Number(right.priority ?? 0);
  if (rightPriority !== leftPriority) return rightPriority - leftPriority;
  return String(left.id ?? "").localeCompare(String(right.id ?? ""));
}

function compactRecord(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== ""));
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

function corpusPath(dataRoot, corpusId) {
  return path.join(dataRoot, "corpora", safeId(corpusId), "run.json");
}

function writeEvolutionRun(args, run) {
  const dataRoot = evolutionDataRoot(args);
  const file = evolutionPath(dataRoot, run.evolutionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

function writeCorpusRun(args, run) {
  const dataRoot = evolutionDataRoot(args);
  const file = corpusPath(dataRoot, run.corpusId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

function readEvolutionRun(args, evolutionId) {
  const file = evolutionPath(evolutionDataRoot(args), evolutionId);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readCorpusRun(args, corpusId) {
  const file = corpusPath(evolutionDataRoot(args), corpusId);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readRequiredEvolution(args, idArg) {
  const evolutionId = safeId(idArg ?? requiredOption(args, "id"));
  const run = readEvolutionRun(args, evolutionId);
  if (!run) throw usage(`Evolution ${evolutionId} not found.`);
  return run;
}

function readRequiredCorpus(args, idArg) {
  const corpusId = safeId(idArg ?? requiredOption(args, "id"));
  const run = readCorpusRun(args, corpusId);
  if (!run) throw usage(`Corpus ${corpusId} not found.`);
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

function listCorpusRuns(dataRoot) {
  const root = path.join(dataRoot, "corpora");
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
    primaryRole: run.sourceProfile?.primaryRole,
    targetHarnessId: run.autoMatch?.targetHarnessId,
    targetVersion: run.autoMatch?.targetVersion,
    llmAdvisorStatus: run.llmAdvisor?.status,
    llmAdvisorRecommendation: run.llmAdvisor?.recommendation,
    nextAction: run.nextAction
  };
}

function corpusSummary(run) {
  return {
    corpusId: run.corpusId,
    status: run.status,
    goal: run.goal,
    sourceRoot: run.sourceRoot,
    discoveredCount: run.discovery?.discoveredCount ?? run.detections?.length ?? 0,
    evaluatedCount: run.discovery?.evaluatedCount ?? run.detections?.length ?? 0,
    groupCount: run.groups?.length ?? 0,
    duplicateCount: run.duplicateCount ?? 0,
    targetHarnessIds: (run.groups ?? []).map((group) => group.targetHarnessId),
    nextAction: run.nextAction
  };
}

function evolutionDetail(run) {
  return { schema: "evopilot-harness-evolution-detail/v1", ...run };
}

function corpusDetail(run) {
  return { ...run, schema: "evopilot-harness-corpus-detail/v1" };
}

function evolveResult(run) {
  return {
    schema: "evopilot-harness-evolve-result/v1",
    evolutionId: run.evolutionId,
    status: run.status,
    autoMatch: run.autoMatch,
    llmAdvisor: run.llmAdvisor,
    sourceCoverage: run.sourceCoverage,
    sourceProfile: run.sourceProfile,
    validation: run.validation,
    draft: run.draft,
    publication: run.publication,
    nextAction: run.nextAction
  };
}

function corpusEvolveResult(run) {
  return {
    schema: "evopilot-harness-corpus-evolve-result/v1",
    corpusId: run.corpusId,
    status: run.status,
    sourceRoot: run.sourceRoot,
    discovery: run.discovery,
    duplicateCount: run.duplicateCount,
    validation: run.validation,
    groups: run.groups,
    approval: run.approval,
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
    llmAdvisor: run.llmAdvisor ? {
      status: run.llmAdvisor.status,
      sourceClassification: run.llmAdvisor.sourceClassification,
      recommendation: run.llmAdvisor.recommendation,
      reviewWarnings: run.llmAdvisor.reviewWarnings
    } : undefined,
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
  evopilot-harness workspace init|status [--workspace <dir>] [--json]
  evopilot-harness produce --source-project <path>|--source-root <path>|--github-repo <repo> [--attachment <file>] [--production-log <file>] [--goal <text>] [--workspace <dir>] [--json]
  evopilot-harness proposal review|approve|publish <proposal-id> [--workspace <dir>] [--json]
  evopilot-harness asset v3-inspect|v3-validate|v3-test|v3-sign|v3-verify [asset-id] [--workspace <dir>] [--json]
  evopilot-harness catalog v3-publish|v3-validate|v3-diff|v3-sign|v3-verify [--workspace <dir>] [--json]
  evopilot-harness registry v3-validate|v3-sign|v3-verify [--workspace <dir>] [--json]
  evopilot-harness ontology inspect|validate|diff|publish [--workspace <dir>] [--json]
  evopilot-harness policy inspect|validate|diff|publish [--type matcher|advisor] [--workspace <dir>] [--json]
  evopilot-harness migrate v2-to-v3|rollback [migration-id] [--workspace <dir>] [--json]
  evopilot-harness llm v3-models|v3-doctor [--models-file models.json] [--workspace <dir>] [--json]
  evopilot-harness eval v3-run [--workspace <dir>] [--json]
  evopilot-harness hub v3-snapshot|v3-serve [--workspace <dir>] [--json]
  evopilot-harness keys generate [--workspace <dir>] [--json]

Legacy v2 compatibility:
  evopilot-harness catalog publish --source harnesses --out published [--catalog-id <id>] [--json]
  evopilot-harness catalog validate --source published [--json]
  evopilot-harness registry publish --catalog published --registry harness-registry.yaml [--id <catalog-id>] [--priority 100] [--json]
  evopilot-harness registry validate --registry harness-registry.yaml [--json]
  evopilot-harness harness list|inspect|validate|publish|deprecate [harness-id] [--strict] [--json]
  evopilot-harness asset inspect|validate [harness-id] [--source harnesses] [--json]
  evopilot-harness detect --source-project <path> --goal <text> [--json]
  evopilot-harness detect --github-repo <url-or-owner/repo> [--github-ref <ref>] --goal <text> [--json]
  evopilot-harness detect batch --source-root <path> [--include-modules] [--limit 50] [--json]
  evopilot-harness corpus scan --source-root <path> [--include-modules] [--limit 50] [--json]
  evopilot-harness corpus plan --source-root <path> [--include-modules] [--max-projects-per-group 5] [--json]
  evopilot-harness corpus list|review|approve|publish [corpus-id] [--json]
  evopilot-harness evolution create --source-project <path>|--github-repo <repo> --goal <text> [--json]
  evopilot-harness evolution sources <evolution-id> --source-project <path>|--github-repo <repo> [--json]
  evopilot-harness evolution advance|review|approve|publish|impact <evolution-id> [--json]
  evopilot-harness evolve --source-project <path> --goal <text> [--llm-advisor optional|required] [--apply-llm-advisor] [--approve-and-publish --confirmed-by <actor> --confirmation <text>] [--json]
  evopilot-harness evolve --github-repo <url-or-owner/repo> [--github-ref <ref>] --goal <text> [--llm-advisor optional|required] [--apply-llm-advisor] [--json]
  evopilot-harness evolve corpus --source-root <path> [--include-modules] [--approve-and-publish --confirmed-by <actor> --confirmation <text>] [--json]
  evopilot-harness llm models [--llm-models-file models.json] [--llm-profile <id>] [--json]
  evopilot-harness llm replay [--fixture-root eval/llm-replay/cases] [--json]
  evopilot-harness eval run [--fixture-root eval/unknown-source/cases] [--json]
  evopilot-harness hub snapshot [--catalog published] [--registry harness-registry.yaml] [--source harnesses] [--out ui/harness-hub/catalog-snapshot.json] [--json]
  evopilot-harness hub serve [--host 127.0.0.1] [--port 4176] [--catalog published] [--registry harness-registry.yaml] [--source harnesses]

LLM Advisor:
  --llm-advisor [optional|required]      Run semantic review after deterministic auto-match. Default: optional.
  --require-llm-advisor                 Require a successful Advisor call before review.
  --no-llm-advisor                      Disable Advisor and use deterministic auto-match only.
  --apply-llm-advisor                   Use a high-confidence Advisor target for draft generation.
  --llm-models-file <file>              CodeBuddy-style JSON file: {"models":[{"id","name","vendor","apiKey","url"}]}.
  --llm-profile <id>                    Select a model entry by id, name, or modelName.
  --llm-provider-preset glm             Override provider preset. Defaults to EvoPilot GLM when no file exists.
  --llm-base-url <url> --llm-model <id>  Override OpenAI-compatible chat/completions endpoint and model.
  --llm-api-key-env <env>               Environment variable containing the API key when models.json does not hold one.

Detect and quality:
  --match-threshold <number>            Override deterministic detect threshold. Default: ${DEFAULT_MATCH_THRESHOLD}.
  --source-root <path>                  Root directory for batch detect or corpus evolution.
  --github-repo <url-or-owner/repo>     GitHub repository source. Uses local git credentials; do not pass raw tokens.
  --github-ref <branch|tag|sha>         Optional branch, tag, or commit checked out before scanning.
  --github-cache-root <path>            Cache for cloned repository sources. Default: <data-root>/github-sources.
  --github-depth <number>               Clone/fetch depth for GitHub repository sources. Default: ${DEFAULT_GITHUB_CLONE_DEPTH}.
  --include-modules                     Include nested module roots, then dedupe during corpus planning.
  --max-depth <number>                  Maximum source-root discovery depth. Default: 5.
  --limit <number>                      Maximum discovered projects evaluated. Default: 50.
  --max-projects-per-group <number>     Representative projects per Harness group. Default: ${DEFAULT_CORPUS_GROUP_LIMIT}.
  --strict                              Enforce Template Quality Standard v1 during validation/publish.

Definition quality target:
  Generated drafts optimize for accurate, professional, and fine-grained Harness definitions.
  Non-goals by default: large-scale performance optimization, throughput expansion, runtime performance tuning.
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

function numberOption(args, name, fallback) {
  const value = args.options[name];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function safeReadText(file, limit = 120_000) {
  try {
    return fs.readFileSync(file, "utf8").slice(0, limit);
  } catch {
    return "";
  }
}

function safeId(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "harness";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function normalizeStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function stringValue(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalSafeId(value) {
  const text = value == null ? "" : String(value).trim();
  return text ? safeId(text) : undefined;
}

function normalizedConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
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
  return maskSecretText(text)
    .replace(/(authorization|token|password|api[_-]?key|secret)([=:\s]+)([^\s"',}]+)/gi, "$1$2[REDACTED]")
    .replace(/(setPassword\s*\(\s*["'])([^"']+)(["']\s*\))/gi, "$1[REDACTED]$3")
    .replace(/\b(?:10|172\.(?:1[6-9]|2\d|3[0-1])|192\.168)\.\d{1,3}\.\d{1,3}:\d{2,5}\b/g, "[REDACTED_ENDPOINT]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .slice(0, 80_000);
}

function maskSecretText(text) {
  return String(text ?? "")
    .replace(/(https?:\/\/)([^/@\s]+)@/gi, "$1[REDACTED]@")
    .replace(/([?&](?:access_token|token|api_key|apikey|password|secret)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
    .replace(/([A-Za-z0-9]{8,}\.[A-Za-z0-9._-]{8,})/g, "[REDACTED]")
    .replace(/(api(?:[_-]?key|Key)[\"']?\s*[:=]\s*[\"']?)[^\"',}\s]+/g, "$1[REDACTED]")
    .replace(/(authorization|token|password|secret)([=:\s]+)([^\s"',}]+)/gi, "$1$2[REDACTED]");
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
