#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const skillRoot = path.join(root, ".agents/skills/evopilot-agent-host-production-simulator");
const required = [
  "SKILL.md",
  "agents/openai.yaml",
  "profiles/profile-contract.md",
  "profiles/workbuddy.md",
  "references/simulation-contract.md",
  "references/evidence-contract.md",
  "references/failure-recovery.md",
  "references/security-and-redaction.md"
];

for (const relative of required) assert.ok(fs.statSync(path.join(skillRoot, relative)).isFile(), `missing ${relative}`);

const entry = read("SKILL.md");
assert.match(entry, /^---\nname: evopilot-agent-host-production-simulator\n/m);
for (const relative of required.filter((value) => value.endsWith(".md") && value !== "SKILL.md")) {
  const link = relative.replaceAll(path.sep, "/");
  assert.match(entry, new RegExp(escapeRegExp(link)), `SKILL.md must route to ${link}`);
}
for (const invariant of [
  "never Plan confirmation",
  "Never read, transcribe, paste, store, screenshot, or return API keys",
  "Do not perform GHCR publication, deployment, GitHub Release, npm publication",
  "Never report 100% pass",
  "desktop control is unavailable, stop with `BLOCKED`"
]) assert.ok(entry.includes(invariant), `missing authority invariant: ${invariant}`);

const profileContract = read("profiles/profile-contract.md");
assert.ok(!/WorkBuddy/.test(profileContract), "host-neutral profile contract contains WorkBuddy-private behavior");
const workbuddy = read("profiles/workbuddy.md");
for (const invariant of ["npm view @evopilot/harness@<version> version", "Harness全生命周期数字专家", "bypassPermissions", "models.json"]) {
  assert.ok(workbuddy.includes(invariant), `WorkBuddy profile missing ${invariant}`);
}

const evidence = read("references/evidence-contract.md");
for (const status of ["PASS", "FAIL", "BLOCKED", "NOT_RUN"]) assert.ok(evidence.includes(status));
assert.ok(evidence.includes("sourceCheckoutUsed"));
assert.ok(read("references/failure-recovery.md").includes("resolve_interrupted_operation"));
assert.ok(read("references/security-and-redaction.md").includes("untrusted Evidence Sources"));

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert.ok(!packageJson.files.includes(".agents/skills/evopilot-agent-host-production-simulator"), "simulator must not enter the Harness runtime package");

process.stdout.write(`${JSON.stringify({
  schema: "evopilot-agent-host-production-simulator-skill-validation/v1",
  status: "PASSED",
  skillRoot,
  hostProfiles: ["workbuddy"],
  packageRuntimeIncluded: false,
  checkedFiles: required.length
}, null, 2)}\n`);

function read(relative) {
  return fs.readFileSync(path.join(skillRoot, relative), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
