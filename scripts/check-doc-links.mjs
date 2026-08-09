#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const rootsToScan = ["README.md", "docs"];
const failures = [];

for (const entry of rootsToScan) {
  const absolute = path.join(root, entry);
  if (!fs.existsSync(absolute)) continue;
  for (const file of listMarkdownFiles(absolute)) checkLinks(file);
}

if (failures.length > 0) {
  console.error(["Markdown link check failed:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  process.exitCode = 2;
} else {
  console.log("Markdown link check passed.");
}

function listMarkdownFiles(target) {
  if (fs.statSync(target).isFile()) return target.endsWith(".md") ? [target] : [];
  const files = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const absolute = path.join(target, entry.name);
    if (entry.isDirectory()) files.push(...listMarkdownFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolute);
  }
  return files;
}

function checkLinks(file) {
  const text = fs.readFileSync(file, "utf8");
  const withoutFences = text.replace(/```[\s\S]*?```/g, "");
  const pattern = /!?\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of withoutFences.matchAll(pattern)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    if (!raw || raw.startsWith("#")) continue;
    if (/^(https?:|mailto:|tel:)/i.test(raw)) continue;
    const [target] = raw.split("#");
    if (!target) continue;
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      failures.push(`${path.relative(root, file)} links outside repository: ${raw}`);
      continue;
    }
    if (!fs.existsSync(resolved)) failures.push(`${path.relative(root, file)} missing link target: ${raw}`);
  }
}
