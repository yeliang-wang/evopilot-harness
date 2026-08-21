#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const root = path.resolve(import.meta.dirname, "..");
const expertRoot = path.join(root, "digital-expert");
const manifest = parseYaml(fs.readFileSync(path.join(expertRoot, "expert-manifest.yaml"), "utf8"));
const check = process.argv.includes("--check");
const coreFiles = ["core/instructions.md", "core/conversation.yaml", "core/workflows.yaml", "core/policies.yaml", "core/renderers.yaml"];
const corePayload = coreFiles.map((file) => `--- ${file} ---\n${fs.readFileSync(path.join(expertRoot, file), "utf8").trim()}\n`).join("\n");
const coreDigest = sha256(Buffer.from(corePayload));

const adapters = {
  codex: {
    relative: "adapters/codex/SKILL.md",
    projectCopy: ".agents/skills/evopilot-harness-digital-expert/SKILL.md",
    header: `---\nname: evopilot-harness-digital-expert\ndescription: Question-driven ordinary human entry for evopilot-harness v4. Uses local stdio MCP and the deterministic Engine; never treats conversation as approval or publication.\n---\n\n# Codex Adapter\n`
  },
  workbuddy: {
    relative: "adapters/workbuddy/WORKBUDDY.md",
    header: `# WorkBuddy Adapter

## Installed Package Startup

1. Run \`evopilot-harness agent bootstrap --host workbuddy --workspace /absolute/external/workspace --json\` from the installed package.
2. Load the returned \`adapter.path\` as WorkBuddy instructions and configure the project MCP server from the returned exact package command. Bootstrap does not edit WorkBuddy configuration.
3. Approve the project MCP server through WorkBuddy's supported project approval setting, then call \`inspect_capabilities\` before Workspace mutation and compare its compatibility result with this Adapter.

For a least-privilege headless startup check, allow only WorkBuddy's \`DeferExecuteTool\` dispatcher and \`mcp__evopilot-harness__inspect_capabilities\`. Do not use \`bypassPermissions\` as conformance evidence. Public npm availability must be verified separately with \`npm view @evopilot/harness@${manifest.artifact.version} version\`.
`
  },
  "claude-code": { relative: "adapters/claude-code/CLAUDE.md", header: "# Claude Code Adapter\n" },
  mcp: { relative: "adapters/mcp/MCP.md", header: "# MCP Client Adapter\n" },
  generic: { relative: "adapters/generic/AGENT.md", header: "# Generic Agent Adapter\n" }
};

const common = `\nAdapter metadata:\n\n- Schema: \`evopilot-harness-digital-expert-adapter/v1\`\n- Expert version: \`${manifest.artifact.version}\`\n- Core digest: \`${coreDigest}\`\n- Agent protocol: \`${manifest.compatibility.agentProtocol}\`\n- Engine API: \`${manifest.compatibility.engineApi.min}\`\n- MCP command: \`${manifest.entrypoints.mcpCommand}\`\n- Required capabilities: ${manifest.requiredHostCapabilities.allOf.join(", ")}\n\nLoad and obey the Core below. Host-specific features may transport questions and MCP calls, but must not change stop rules, Engine results, or human decision tokens.\n\n`;
const expected = new Map();
for (const [id, config] of Object.entries(adapters)) {
  const content = `${config.header}${common}${corePayload}`;
  expected.set(path.join(expertRoot, config.relative), content);
  if (config.projectCopy) expected.set(path.join(root, config.projectCopy), content);
}
const workbuddyAdapter = expected.get(path.join(expertRoot, adapters.workbuddy.relative));
expected.set(
  path.join(expertRoot, "installers/workbuddy/expert/skills/evopilot-harness-digital-expert/SKILL.md"),
  `---\nname: evopilot-harness-digital-expert\ndescription: Operate evopilot-harness through its complete generated WorkBuddy Adapter and local stdio MCP.\n---\n\n${workbuddyAdapter}`
);

const copiedSchemas = ["agent-operation-session-v1.schema.json", "operation-plan-v1.schema.json"];
for (const file of copiedSchemas) expected.set(path.join(expertRoot, "schemas", file), fs.readFileSync(path.join(root, "schemas", file), "utf8"));

const lockEntries = [...expected.entries()]
  .filter(([file]) => file.startsWith(expertRoot))
  .map(([file, content]) => ({ path: path.relative(expertRoot, file), sha256: sha256(Buffer.from(content)), bytes: Buffer.byteLength(content) }))
  .concat(["expert-manifest.yaml", ...coreFiles, "conformance/host-profiles.yaml", "conformance/scenario-matrix.yaml", "conformance/generic-host.mjs", "schemas/adapter-envelope-v1.schema.json"].map((relative) => {
    const content = fs.readFileSync(path.join(expertRoot, relative));
    return { path: relative, sha256: sha256(content), bytes: content.length };
  }))
  .sort((left, right) => left.path.localeCompare(right.path));
const lock = `${JSON.stringify({ schema: "evopilot-harness-digital-expert-lock/v1", expertVersion: manifest.artifact.version, coreDigest, files: lockEntries }, null, 2)}\n`;
expected.set(path.join(expertRoot, "manifest.lock.json"), lock);

const differences = [];
for (const [file, content] of expected) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (current !== content) differences.push(path.relative(root, file));
  if (!check) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
}
if (check && differences.length) {
  console.error(`Digital Expert generated artifacts are stale:\n${differences.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}
console.log(check ? `Digital Expert adapters validated (${expected.size} artifacts, core ${coreDigest}).` : `Digital Expert adapters generated (${expected.size} artifacts, core ${coreDigest}).`);

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
