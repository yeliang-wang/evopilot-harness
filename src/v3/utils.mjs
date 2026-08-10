import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export function parseCli(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const key = value.slice(2);
    if (key.startsWith("no-")) {
      options[key.slice(3)] = false;
      continue;
    }
    const next = argv[index + 1];
    if (next != null && !next.startsWith("--")) {
      if (options[key] == null) options[key] = next;
      else options[key] = Array.isArray(options[key]) ? [...options[key], next] : [options[key], next];
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { positionals, options };
}

export function option(args, name, fallback) {
  const value = args.options[name];
  if (Array.isArray(value)) return value.at(-1) ?? fallback;
  if (value === true || value === false || value == null) return fallback;
  return String(value);
}

export function options(args, name) {
  const value = args.options[name];
  if (value == null || value === false) return [];
  return (Array.isArray(value) ? value : [value]).filter((item) => item !== true).map(String);
}

export function numberOption(args, name, fallback) {
  const value = Number(option(args, name, fallback));
  return Number.isFinite(value) ? value : fallback;
}

export function booleanOption(args, name, fallback = false) {
  const value = args.options[name];
  return value == null ? fallback : value !== false && value !== "false";
}

export function readYaml(file) {
  return parseYaml(fs.readFileSync(file, "utf8"));
}

export function writeYaml(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stringifyYaml(value, { lineWidth: 120 }), "utf8");
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digest(value) {
  const payload = Buffer.isBuffer(value) ? value : typeof value === "string" ? value : canonicalJson(value);
  return `sha256:${crypto.createHash("sha256").update(payload).digest("hex")}`;
}

export function safeId(value, fallback = "asset") {
  return String(value ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

export function walkFiles(root, predicate = () => true) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const stack = [path.resolve(root)];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if ([".git", "node_modules", "dist", "target", "build", ".gradle", ".idea"].includes(entry.name)) continue;
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(resolved);
      else if (entry.isFile() && predicate(resolved)) result.push(resolved);
    }
  }
  return result.sort();
}

export function copyTree(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: false });
}

export function redact(text) {
  return String(text ?? "")
    .replace(/(https?:\/\/)([^/@\s]+)@/gi, "$1[REDACTED]@")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
    .replace(/(authorization|token|password|api[_-]?key|secret)([=:"'\s]+)([^\s"',}]+)/gi, "$1$2[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\b(?:10|172\.(?:1[6-9]|2\d|3[0-1])|192\.168)\.\d{1,3}\.\d{1,3}(?::\d{2,5})?\b/g, "[REDACTED_ENDPOINT]");
}

export function bumpPatch(version) {
  const match = String(version ?? "0.0.0").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : "0.1.0";
}

export function print(value, json = true) {
  process.stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : `${formatHuman(value)}\n`);
}

function formatHuman(value) {
  if (!value || typeof value !== "object") return String(value);
  return Object.entries(value).filter(([, item]) => ["string", "number", "boolean"].includes(typeof item)).map(([key, item]) => `${key}: ${item}`).join("\n");
}

export function usage(message) {
  const error = new Error(message);
  error.name = "UsageError";
  throw error;
}

export function ensureRelative(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Path escapes root: ${target}`);
  return relative;
}

export function unique(values) {
  return [...new Set(values.filter((value) => value != null && String(value).trim()).map((value) => String(value).trim()))];
}
