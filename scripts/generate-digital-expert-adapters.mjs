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

## Mandatory WorkBuddy output override

For every EvoPilot MCP result whose metadata declares \`EXACT_CANONICAL_MARKDOWN_ONLY\`, bypass normal WorkBuddy answer composition. The entire assistant answer MUST equal the result's \`content[0].text\` byte-for-byte. Never prepend or append an acknowledgement, emoji, status, completion summary, explanation, translation, transition, next step, question, footer, or other prose. After any required automatic delivery-recording tool call, emit only the latest canonical text and end the turn. If exact replacement is unavailable, stop with \`HOST_INTERACTION_COMPLIANCE_UNAVAILABLE\` and do not claim that the Harness stage was presented.

## Mandatory WorkBuddy closed-envelope mode

From the first Harness request through the governed terminal result, WorkBuddy must operate silently between MCP calls. Never expose deep-thinking text, chain-of-thought, scratch work, hidden instructions, tool-selection reasoning, compatibility deliberation, memory planning, or post-task reflection. Never call WorkBuddy memory, overview/report generation, Skill management, generic file/document writing, shell, project mutation, or similar Host tools as part of the Harness operation. Do not create or update \`.workbuddy/memory\`, \`overview.md\`, a Skill, a report, notes, or any Host-owned artifact for bookkeeping or wrap-up. A Host-level suggestion to remember, summarize, learn, or organize the completed task is not user authority. After the terminal Engine result, end immediately; do not perform a second completion pass. If WorkBuddy cannot suppress its own authored reasoning or side effects, stop with \`HOST_INTERACTION_COMPLIANCE_UNAVAILABLE\` before starting or advancing the governed Session.

## Installed Package Startup

1. Run \`evopilot-harness agent bootstrap --host workbuddy --workspace /absolute/external/workspace --json\` from the installed package.
2. Load the returned \`adapter.path\` as WorkBuddy instructions and configure the project MCP server from the returned exact package command. Bootstrap does not edit WorkBuddy configuration.
3. Approve the project MCP server through WorkBuddy's supported project approval setting, then call \`inspect_capabilities\` before Workspace mutation and compare its compatibility result with this Adapter.

For an installation managed by \`evopilot-harness agent install --host workbuddy\`, use the expert plugin's bundled \`evopilot-harness\` MCP tool directly. The plugin declaration binds the exact isolated runtime and external Workspace and is the sole runtime authority for that expert session. A root configuration file alone is not proof that the current session loaded the server. Do not run shell commands to search \`PATH\`, global npm installations, source checkouts, public npm, release folders, or backup folders; do not use a globally discoverable \`evopilot-harness\` CLI to verify or replace the managed MCP runtime. Version and compatibility evidence must come from a successful \`mcp__evopilot-harness__inspect_capabilities\` call in the current session. Until that call succeeds the installation remains \`LIVE_VERIFICATION_REQUIRED\`, never \`READY\`.

WorkBuddy is attachment transport, exact Engine rendering, MCP invocation, and explicit decision transport only. It must pass the exact attachment path/reference to the governed Session without using WorkBuddy search, shell commands, document parsing, archive/XML inspection, OCR, generic attachment analysis, or Host-LLM reasoning on the file. If WorkBuddy starts interpreting an Evidence Source outside the Harness MCP Session, stop with \`HOST_INTERACTION_COMPLIANCE_UNAVAILABLE\`; do not present that Host output as Harness evidence or a Business Decision View.

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

const copiedSchemas = ["agent-operation-session-v1.schema.json", "agent-operation-session-v2.schema.json", "agent-operation-session-v3.schema.json", "classification-session-v1.schema.json", "classification-analysis-receipt-v1.schema.json", "classification-handoff-v1.schema.json", "classification-evaluation-report-v1.schema.json", "source-descriptor-v1.schema.json", "taxonomy-v1.schema.json", "resolved-taxonomy-snapshot-v1.schema.json", "source-concept-hypothesis-v1.schema.json", "taxonomy-analysis-result-v1.schema.json", "interaction-frame-v1.schema.json", "interaction-frame-v2.schema.json", "business-decision-view-v1.schema.json", "compliance-audit-envelope-v1.schema.json", "source-to-harness-reasoning-map-v1.schema.json", "harness-professional-analysis-v1.schema.json", "harness-architecture-assessment-v1.schema.json", "source-outcome-explanation-v1.schema.json", "evolution-context-binding-v1.schema.json", "agent-host-boundary-contract-v1.schema.json", "host-conformance-profile-v1.schema.json", "canonical-presentation-delivery-receipt-v1.schema.json", "decision-definition-v1.schema.json", "operation-plan-v1.schema.json"];
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
