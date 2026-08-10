import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "src/index.mjs");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-v3-check-"));
const checks = [];

try {
  run("workspace-init", ["workspace", "init", "--workspace", home, "--json"]);
  run("asset-validation", ["asset", "v3-validate", "--workspace", home, "--json"]);
  run("asset-tests", ["asset", "v3-test", "--workspace", home, "--json"]);
  run("builtin-catalog", ["catalog", "v3-validate", "--workspace", home, "--source", path.join(home, "catalogs/builtin"), "--json"]);
  run("registry", ["registry", "v3-validate", "--workspace", home, "--json"]);
  run("migration-dry-run", ["migrate", "v2-to-v3", "--workspace", home, "--source", path.join(root, "harnesses"), "--json"]);
  run("hub-snapshot", ["hub", "v3-snapshot", "--workspace", home, "--out", path.join(home, "hub.json"), "--json"]);
  process.stdout.write(`${JSON.stringify({ schema: "evopilot-harness-v3-acceptance/v1", status: "PASSED", checkCount: checks.length, checks }, null, 2)}\n`);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

function run(id, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${id} failed:\n${result.stderr || result.stdout}`);
  const output = JSON.parse(result.stdout);
  checks.push({ id, status: output.status ?? "READY", schema: output.schema });
}
