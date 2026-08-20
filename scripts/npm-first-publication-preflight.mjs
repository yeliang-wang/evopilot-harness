#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const registry = "https://registry.npmjs.org";

export function classifyRegistryProbe({ packageName, status, stdout = "", stderr = "" }) {
  if (status === 0) {
    return {
      schema: "evopilot-harness-npm-first-publication-preflight/v1",
      status: "BLOCKED",
      packageName,
      packageState: "EXISTS",
      error: { code: "PACKAGE_ALREADY_EXISTS", message: `${packageName} already exists in the public npm Registry.` },
      nextAction: "use-oidc-trusted-publishing"
    };
  }

  const diagnostic = `${stdout}\n${stderr}`;
  if (/\bE404\b/.test(diagnostic) || /"code"\s*:\s*"E404"/.test(diagnostic)) {
    return {
      schema: "evopilot-harness-npm-first-publication-preflight/v1",
      status: "READY",
      packageName,
      packageState: "ABSENT",
      registry,
      nextAction: "run-separately-authorized-first-publication"
    };
  }

  return {
    schema: "evopilot-harness-npm-first-publication-preflight/v1",
    status: "FAILED",
    packageName,
    packageState: "UNKNOWN",
    error: { code: "REGISTRY_PROBE_FAILED", message: "The public npm Registry did not prove that the package is absent." },
    nextAction: "repair-registry-authentication-or-connectivity"
  };
}

export function runPreflight({ cwd = root, npmCommand = "npm" } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
  const packageName = String(manifest.name ?? "");
  if (packageName !== "@evopilot/harness") {
    return {
      schema: "evopilot-harness-npm-first-publication-preflight/v1",
      status: "FAILED",
      packageName,
      packageState: "UNKNOWN",
      error: { code: "PACKAGE_IDENTITY_MISMATCH", message: `Expected @evopilot/harness, received ${packageName || "<empty>"}.` },
      nextAction: "repair-package-identity"
    };
  }

  const probe = spawnSync(npmCommand, ["view", packageName, "version", "--json", `--registry=${registry}`], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_update_notifier: "false" }
  });
  return classifyRegistryProbe({ packageName, status: probe.status, stdout: probe.stdout, stderr: probe.stderr });
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const result = runPreflight();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "READY") process.exitCode = result.status === "BLOCKED" ? 2 : 1;
}
