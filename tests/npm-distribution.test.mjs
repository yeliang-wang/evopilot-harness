import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import { agentBootstrap, BOOTSTRAP_SCHEMA } from "../src/v4/bootstrap.mjs";
import { classifyRegistryProbe } from "../scripts/npm-first-publication-preflight.mjs";
import { verifyTrustedPublishingEnvironment } from "../scripts/verify-npm-trusted-publishing-runtime.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("Agent Bootstrap binds the exact package, adapter, stdio MCP command, and external Workspace", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-bootstrap-"));
  const result = agentBootstrap(["--host", "workbuddy", "--workspace", workspace]);

  assert.equal(result.schema, BOOTSTRAP_SCHEMA);
  assert.equal(result.status, "READY");
  assert.deepEqual(result.package, {
    name: "@evopilot/harness",
    version: "4.1.1",
    spec: "@evopilot/harness@4.1.1",
    root,
    distributionMode: "source-checkout",
    sourceCheckoutRequired: false,
    cliBin: "evopilot-harness"
  });
  assert.equal(result.host.id, "workbuddy");
  assert.equal(result.host.validation, "actual-workbuddy-host-plus-installed-package-protocol-conformance");
  assert.equal(result.adapter.packageRelativePath, "digital-expert/adapters/workbuddy/WORKBUDDY.md");
  const canonicalWorkspace = fs.realpathSync(workspace);
  assert.deepEqual(result.mcp.exactNpxCommand, {
    command: "npx",
    args: ["--yes", "--package", "@evopilot/harness@4.1.1", "evopilot-harness", "mcp", "serve", "--transport", "stdio", "--workspace", canonicalWorkspace]
  });
  assert.equal(result.mcp.networkListening, false);
  assert.ok(result.mcp.protocols.includes("2025-11-25"));
  assert.equal(result.workspace.externalToRelease, true);
  assert.equal(fs.existsSync(workspace), true);
  assert.equal(fs.readdirSync(workspace).length, 0, "bootstrap must not initialize or mutate the Workspace");
});

test("Agent Bootstrap fails unsupported hosts with a stable machine-readable result", () => {
  const completed = spawnSync(process.execPath, ["src/index.mjs", "agent", "bootstrap", "--host", "unknown-host", "--json"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(completed.status, 1);
  const result = JSON.parse(completed.stdout);
  assert.equal(result.schema, BOOTSTRAP_SCHEMA);
  assert.equal(result.status, "FAILED");
  assert.equal(result.error.code, "UNSUPPORTED_HOST");
  assert.equal(result.error.nextAction, "choose-packaged-agent-host");
});

test("npm Trusted Publishing workflow is OIDC-only and version-bound", () => {
  const workflowText = fs.readFileSync(path.join(root, ".github/workflows/npm-packages.yml"), "utf8");
  const workflow = parseYaml(workflowText);
  const steps = workflow.jobs.publish.steps;
  const setupNode = steps.find((item) => item.uses === "actions/setup-node@v4");
  const runtimeCheck = steps.find((item) => item.name === "Verify Trusted Publishing runtime");
  const publish = steps.find((item) => item.name === "Publish with npm Trusted Publishing");

  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.permissions["id-token"], "write");
  assert.equal(workflow.jobs.publish.environment, "npm");
  assert.equal(Object.hasOwn(setupNode.with, "registry-url"), false);
  assert.equal(Object.hasOwn(setupNode.with, "always-auth"), false);
  assert.match(runtimeCheck.run, /^set -euo pipefail\nnode scripts\/verify-npm-trusted-publishing-runtime\.mjs\n/);
  assert.equal(publish.run, "npm publish --access public --provenance --tag \"$DIST_TAG\"");
  assert.match(workflowText, /npm install --global npm@11\.5\.1/);
  assert.match(workflowText, /Tag .* does not match package version/);
  assert.match(workflowText, /\*-alpha\.\*\) DIST_TAG=alpha/);
  assert.match(workflowText, /\*\) DIST_TAG=latest/);
  assert.match(workflowText, /npm audit signatures/);
  assert.doesNotMatch(workflowText, /secrets\.(?:NPM|NODE_AUTH)|NODE_AUTH_TOKEN:\s*\$\{\{/i);
  assert.doesNotMatch(workflowText, /registry-url|always-auth/i);
  assert.doesNotMatch(workflowText, /docker\/build-push|ghcr\.io/i);
});

test("npm Trusted Publishing runtime fails closed on an explicitly supplied token", () => {
  assert.deepEqual(verifyTrustedPublishingEnvironment({}), {
    schema: "evopilot-harness-npm-trusted-publishing-runtime/v1",
    status: "READY",
    authentication: "OIDC_TRUSTED_PUBLISHING",
    tokenFallback: false
  });
  assert.throws(
    () => verifyTrustedPublishingEnvironment({ NODE_AUTH_TOKEN: "explicit-token" }),
    (error) => error.code === "NODE_AUTH_TOKEN_FORBIDDEN" && !error.message.includes("explicit-token")
  );
});

test("npm first-publication Bootstrap is manual, environment-isolated, and explicit", () => {
  const workflowText = fs.readFileSync(path.join(root, ".github/workflows/npm-first-publication.yml"), "utf8");
  const workflow = parseYaml(workflowText);
  const steps = workflow.jobs.bootstrap.steps;
  const publish = steps.find((item) => item.name === "Verify token identity, package absence, and publish first version");

  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.confirmation.required, true);
  assert.equal(workflow.jobs.bootstrap.environment, "npm-bootstrap");
  assert.equal(workflow.concurrency.group, "npm-first-publication-bootstrap");
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.permissions["id-token"], "write");
  assert.equal(publish.env.NODE_AUTH_TOKEN, "${{ secrets.NPM_BOOTSTRAP_TOKEN }}");
  assert.equal(publish.env.EXPECTED_NPM_IDENTITY, "${{ vars.NPM_BOOTSTRAP_EXPECTED_IDENTITY }}");
  assert.match(publish.run, /npm run package:bootstrap:preflight/);
  assert.match(publish.run, /npm publish --ignore-scripts --access public --provenance/);
  assert.match(publish.run, /ACTUAL_NPM_IDENTITY.*EXPECTED_NPM_IDENTITY/s);
  assert.match(workflowText, /FIRST_PUBLISH @evopilot\/harness/);
  assert.match(workflowText, /Revoke NPM_BOOTSTRAP_TOKEN/);
});

test("npm first-publication preflight fails closed once the package exists", () => {
  const exists = classifyRegistryProbe({ packageName: "@evopilot/harness", status: 0, stdout: '"4.0.2"' });
  assert.equal(exists.status, "BLOCKED");
  assert.equal(exists.packageState, "EXISTS");
  assert.equal(exists.error.code, "PACKAGE_ALREADY_EXISTS");
  assert.equal(exists.nextAction, "use-oidc-trusted-publishing");

  const absent = classifyRegistryProbe({ packageName: "@evopilot/harness", status: 1, stderr: "npm error code E404" });
  assert.equal(absent.status, "READY");
  assert.equal(absent.packageState, "ABSENT");

  const ambiguous = classifyRegistryProbe({ packageName: "@evopilot/harness", status: 1, stderr: "npm error code E401" });
  assert.equal(ambiguous.status, "FAILED");
  assert.equal(ambiguous.packageState, "UNKNOWN");
  assert.equal(ambiguous.error.code, "REGISTRY_PROBE_FAILED");
});

test("GHCR publication remains disabled for tag releases and requires manual authorization input", () => {
  const workflow = parseYaml(fs.readFileSync(path.join(root, ".github/workflows/release-artifacts.yml"), "utf8"));
  assert.equal(workflow.on.workflow_dispatch.inputs.publish_ghcr.default, false);
  for (const name of ["Set up Docker Buildx", "Login to GHCR", "Build and push immutable image"]) {
    const step = workflow.jobs["release-artifacts"].steps.find((item) => item.name === name);
    assert.equal(step.if, "${{ github.event_name == 'workflow_dispatch' && inputs.publish_ghcr }}", name);
  }
});

test("WorkBuddy acceptance grants only the target MCP tool and its deferred dispatcher", () => {
  const script = fs.readFileSync(path.join(root, "scripts/validate-workbuddy-package.mjs"), "utf8");
  assert.match(script, /permissions: \{ allow: \["DeferExecuteTool", "mcp__evopilot-harness__inspect_capabilities"\] \}/);
  assert.match(script, /WorkBuddy must complete exactly one inspect_capabilities call/);
  assert.doesNotMatch(script, /permission-mode["', ]+bypassPermissions|\s-y(?:\s|["'])/);
});
