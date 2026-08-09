#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const CATALOG_BLOCK = "evopilot-harness-catalog";
const DEFAULT_COMPATIBLE_EVOPILOT = ">=2.5.0";

async function main(argv) {
  const args = parseArgs(argv);
  const [group, action] = args.positionals;
  if (!group || args.options.help || args.options.h) {
    printHelp();
    return 0;
  }
  if (group === "catalog" && action === "publish") return publishCatalog(args);
  if (group === "catalog" && action === "validate") return validateCatalog(args);
  if (group === "harness" && action === "publish") return publishHarness(args);
  throw usage("Use: evopilot-harness catalog <publish|validate> or evopilot-harness harness publish.");
}

function publishCatalog(args) {
  const source = path.resolve(stringOption(args, "source") ?? "harnesses");
  const out = path.resolve(stringOption(args, "out") ?? "published");
  const catalogId = safeId(stringOption(args, "catalog-id") ?? stringOption(args, "id") ?? "evopilot-public-harness-catalog");
  const names = stringListOption(args, "name");
  const packs = listHarnessPacks(source)
    .filter((pack) => names.length === 0 || names.includes(pack.id));
  if (packs.length === 0) throw usage(`No Harness packs found in ${source}.`);
  fs.mkdirSync(out, { recursive: true });
  const entries = packs.map((pack) => publishPack(pack, out));
  const catalog = {
    catalogVersion: 1,
    catalogId,
    generatedAt: new Date().toISOString(),
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

function publishHarness(args) {
  const name = safeId(requiredOption(args, "name"));
  args.options.name = name;
  return publishCatalog(args);
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
  const templatePath = ["template.yaml", "harness.yaml"]
    .map((file) => path.join(packRoot, file))
    .find((file) => fs.existsSync(file));
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

function publishPack(pack, out) {
  const targetRoot = path.join(out, pack.id, pack.version);
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
    status: "published",
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
  if (harnessLayer !== "domain" && !domain) return [];
  const requiredActions = Array.isArray(domainExecution.requiredActions) ? domainExecution.requiredActions : [];
  const evidenceAdapters = Array.isArray(domainExecution.evidenceAdapters) ? domainExecution.evidenceAdapters : [];
  const releaseBlockers = Array.isArray(domainExecution.releaseBlockers) ? domainExecution.releaseBlockers : [];
  const checks = [];
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
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else if (options[key] === undefined) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = Array.isArray(options[key]) ? [...options[key], next] : [options[key], next];
      index += 1;
    }
  }
  return { positionals, options };
}

function printResult(args, data, text) {
  if (args.options.json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  else process.stdout.write(`${text}\n`);
}

function printHelp() {
  process.stdout.write(`EvoPilot Harness CLI

Usage:
  evopilot-harness catalog publish --source harnesses --out published [--catalog-id <id>] [--json]
  evopilot-harness catalog validate --source published [--json]
  evopilot-harness harness publish --name <harness-id> --source harnesses --out published [--json]
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
  const value = args.options[name];
  if (Array.isArray(value)) return value.map(String).map(safeId);
  if (typeof value === "string") return [safeId(value)];
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

function digestText(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
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
