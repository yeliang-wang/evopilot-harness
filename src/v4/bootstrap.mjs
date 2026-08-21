import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { PACKAGE_ROOT } from "../v3/constants.mjs";
import { MCP_PROTOCOL_VERSIONS, operationCompatibility, assertExternalWorkspace } from "./constants.mjs";
import { resolveWorkspaceModelsFile } from "../v3/workspace.mjs";
import { inspectModelReadiness } from "../v3/model-readiness.mjs";

export const BOOTSTRAP_SCHEMA = "evopilot-harness-agent-bootstrap/v1";

export function agentBootstrap(argv) {
  const options = parseOptions(argv);
  const host = String(options.host ?? "").trim().toLowerCase();
  if (!host) throw bootstrapError("MISSING_HOST", "agent bootstrap requires --host <id>.", "choose-agent-host");

  const packageJson = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
  const expertRoot = path.join(PACKAGE_ROOT, "digital-expert");
  const manifest = parseYaml(fs.readFileSync(path.join(expertRoot, "expert-manifest.yaml"), "utf8"));
  const profiles = parseYaml(fs.readFileSync(path.join(expertRoot, "conformance/host-profiles.yaml"), "utf8"));
  const adapter = manifest.adapters?.find((item) => item.id === host);
  const profile = profiles.profiles?.find((item) => item.id === host);
  if (!adapter || !profile) throw bootstrapError("UNSUPPORTED_HOST", `No packaged Agent adapter exists for ${host}.`, "choose-packaged-agent-host");

  const adapterPath = path.resolve(expertRoot, adapter.path);
  if (!inside(expertRoot, adapterPath) || !fs.existsSync(adapterPath)) {
    throw bootstrapError("ADAPTER_NOT_PACKAGED", `The ${host} adapter is not present in this package.`, "repair-package-content");
  }
  const workspace = assertExternalWorkspace(path.resolve(String(options.workspace ?? path.join(os.homedir(), ".evopilot-harness"))));
  const compatibility = operationCompatibility();
  const packageSpec = `${packageJson.name}@${packageJson.version}`;
  const mcpArgs = ["mcp", "serve", "--transport", "stdio", "--workspace", workspace];
  const installed = PACKAGE_ROOT.split(path.sep).includes("node_modules");
  const llmInitialization = inspectModelReadiness(workspace, resolveWorkspaceModelsFile(workspace));
  return {
    schema: BOOTSTRAP_SCHEMA,
    status: "READY",
    package: {
      name: packageJson.name,
      version: packageJson.version,
      spec: packageSpec,
      root: PACKAGE_ROOT,
      distributionMode: installed ? "installed-package" : "source-checkout",
      sourceCheckoutRequired: false,
      cliBin: "evopilot-harness"
    },
    host: {
      id: host,
      requiredCapabilities: profile.requiredCapabilities ?? [],
      validation: profile.validation
    },
    adapter: {
      id: adapter.id,
      format: adapter.format,
      path: adapterPath,
      packageRelativePath: path.relative(PACKAGE_ROOT, adapterPath).split(path.sep).join("/"),
      sha256: `sha256:${crypto.createHash("sha256").update(fs.readFileSync(adapterPath)).digest("hex")}`
    },
    digitalExpert: {
      schema: manifest.schema,
      compatibility,
      entrypoints: manifest.entrypoints
    },
    mcp: {
      transport: "stdio",
      protocols: MCP_PROTOCOL_VERSIONS,
      installedCommand: { command: "evopilot-harness", args: mcpArgs },
      exactNpxCommand: { command: "npx", args: ["--yes", "--package", packageSpec, "evopilot-harness", ...mcpArgs] },
      networkListening: false
    },
    workspace: {
      path: workspace,
      externalToRelease: true,
      ownsMutableState: true
    },
    llmInitialization,
    authority: {
      engineAuthoritative: true,
      agentMayApprove: false,
      agentMayPublish: false,
      automaticPublication: false
    },
    nextAction: llmInitialization.status === "CONFIGURED_AND_VERIFIED"
      ? "load-packaged-adapter-and-start-exact-package-mcp"
      : "load-packaged-adapter-prepare-workspace-and-complete-llm-initialization"
  };
}

export function renderAgentBootstrap(result, json) {
  if (json) return `${JSON.stringify(result, null, 2)}\n`;
  return [
    `${result.package.spec} -> ${result.host.id}`,
    `Adapter: ${result.adapter.path}`,
    `MCP: ${[result.mcp.exactNpxCommand.command, ...result.mcp.exactNpxCommand.args].join(" ")}`,
    `Workspace: ${result.workspace.path}`,
    `Next action: ${result.nextAction}`,
    ""
  ].join("\n");
}

export function renderAgentBootstrapError(error, json) {
  const result = {
    schema: BOOTSTRAP_SCHEMA,
    status: "FAILED",
    error: {
      code: String(error?.code ?? "AGENT_BOOTSTRAP_FAILED"),
      message: String(error?.message ?? error),
      nextAction: String(error?.nextAction ?? "inspect-package-and-agent-host")
    }
  };
  if (json) return `${JSON.stringify(result, null, 2)}\n`;
  return `${result.error.code}: ${result.error.message}\nNext action: ${result.error.nextAction}\n`;
}

function parseOptions(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const [name, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) result[name] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) result[name] = argv[++index];
    else result[name] = true;
  }
  return result;
}

function inside(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function bootstrapError(code, message, nextAction) {
  const error = new Error(message);
  error.code = code;
  error.nextAction = nextAction;
  return error;
}
