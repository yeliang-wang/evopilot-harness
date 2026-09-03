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
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const expectedVersion = manifest.version;
const expectedPackage = `${manifest.name}@${expectedVersion}`;

test("Agent Bootstrap binds the exact package, adapter, stdio MCP command, and external Workspace", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-bootstrap-"));
  const result = agentBootstrap(["--host", "workbuddy", "--workspace", workspace]);

  assert.equal(result.schema, BOOTSTRAP_SCHEMA);
  assert.equal(result.status, "READY");
  assert.deepEqual(result.package, {
    name: "@evopilot/harness",
    version: expectedVersion,
    spec: expectedPackage,
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
    args: ["--yes", "--package", expectedPackage, "evopilot-harness", "mcp", "serve", "--transport", "stdio", "--workspace", canonicalWorkspace]
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
  const publishedVersionCheck = steps.find((item) => item.name === "Detect already-published exact version");
  const publish = steps.find((item) => item.name === "Publish with npm Trusted Publishing");
  const publicInstall = steps.find((item) => item.name === "Verify exact public package install");

  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.permissions["id-token"], "write");
  assert.equal(workflow.jobs.publish.environment, "npm");
  assert.equal(Object.hasOwn(setupNode.with, "registry-url"), false);
  assert.equal(Object.hasOwn(setupNode.with, "always-auth"), false);
  assert.match(runtimeCheck.run, /^set -euo pipefail\nnode scripts\/verify-npm-trusted-publishing-runtime\.mjs\n/);
  assert.match(publishedVersionCheck.run, /npm view "\$PACKAGE_NAME@\$VERSION" version --json/);
  assert.match(publishedVersionCheck.run, /PACKAGE_ALREADY_PUBLISHED=true/);
  assert.equal(publish.if, "env.PACKAGE_ALREADY_PUBLISHED != 'true'");
  assert.equal(publish.run, "npm publish --access public --provenance --tag \"$DIST_TAG\"");
  assert.match(workflowText, /npm install --global npm@11\.5\.1/);
  assert.match(workflowText, /Tag .* does not match package version/);
  assert.match(workflowText, /\*-alpha\.\*\) DIST_TAG=alpha/);
  assert.match(workflowText, /\*\) DIST_TAG=latest/);
  assert.match(workflowText, /npm audit signatures/);
  assert.match(publicInstall.run, /for attempt in \$\(seq 1 20\)/);
  assert.match(publicInstall.run, /signatures or provenance did not become available after bounded retries/);
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

test("release artifact workflow restores a clean tag checkout and reuses only a CI-passed check", () => {
  const workflowText = fs.readFileSync(path.join(root, ".github/workflows/release-artifacts.yml"), "utf8");
  const buildScript = fs.readFileSync(path.join(root, "scripts/build-release-artifacts.mjs"), "utf8");
  assert.match(workflowText, /git restore --worktree --staged \./);
  assert.match(workflowText, /git status --porcelain/);
  assert.match(workflowText, /EVOPILOT_RELEASE_CHECK_ALREADY_PASSED: "true"/);
  assert.doesNotMatch(workflowText, /CI: "false"/);
  assert.match(buildScript, /EVOPILOT_RELEASE_CHECK_ALREADY_PASSED === "true"/);
  assert.match(buildScript, /process\.env\.CI !== "true"/);
});

test("WorkBuddy acceptance grants only the MCP tools required by the selected scenario", () => {
  const script = fs.readFileSync(path.join(root, "scripts/validate-workbuddy-package.mjs"), "utf8");
  assert.match(script, /const allowedTools = exerciseLlmInitialization/);
  assert.match(script, /: \["DeferExecuteTool", "mcp__evopilot-harness__inspect_capabilities"\];/);
  for (const tool of ["prepare_workspace", "initialize_model_configuration", "run_engine_diagnostic"]) {
    assert.match(script, new RegExp(`mcp__evopilot-harness__${tool}`));
  }
  assert.match(script, /permissions: \{ allow: allowedTools \}/);
  assert.match(script, /WorkBuddy must complete exactly one inspect_capabilities call/);
  assert.match(script, /option\("package-spec"\)/);
  assert.match(script, /process\.argv\.includes\("--exercise-llm-initialization"\)/);
  assert.match(script, /distributionMode: packageDistributionMode\(packageSpec\)/);
  assert.match(script, /value\.endsWith\("\.tgz"\).*"local-package-candidate"/s);
  assert.match(script, /host: \{ id: "workbuddy", version: hostVersion, cliVersion/);
  assert.doesNotMatch(script, /permission-mode["', ]+bypassPermissions|\s-y(?:\s|["'])/);
});
