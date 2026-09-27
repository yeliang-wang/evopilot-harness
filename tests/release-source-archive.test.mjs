import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {RELEASE_SOURCE_INPUTS, releaseSourceManifest} from "../scripts/release-source-manifest.mjs";

test("fresh source archive initializes an external Workspace with its shipped model template", t => {
  const root = path.resolve(import.meta.dirname, "..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-source-archive-"));
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  const archive = path.join(temp, "source.tgz"), extracted = path.join(temp, "release");
  fs.mkdirSync(extracted);
  execFileSync("tar", ["--exclude", "node_modules", "--exclude", ".git", "--exclude", "dist/release",
    "-czf", archive, ...RELEASE_SOURCE_INPUTS], {cwd: root, env: {...process.env, COPYFILE_DISABLE: "1"}});
  execFileSync("tar", ["-xzf", archive, "-C", extracted]);
  assert.deepEqual(releaseSourceManifest(extracted), releaseSourceManifest(root));
  // Only dependency bytes come from the test environment; application code and
  // its template must resolve from the independently extracted release archive.
  fs.cpSync(path.join(root, "node_modules"), path.join(extracted, "node_modules"), {recursive: true});
  const workspace = path.join(temp, "workspace");
  execFileSync(process.execPath, ["--input-type=module", "-e",
    "import {initializeWorkspace} from './src/v3/workspace.mjs'; initializeWorkspace(process.argv[1]);", workspace],
    {cwd: extracted, timeout: 15000, stdio: "pipe"});
  assert.deepEqual(fs.readFileSync(path.join(workspace, "models.example.json")), fs.readFileSync(path.join(root, "models.example.json")));
  assert.equal(fs.existsSync(path.join(workspace, "models.json")), false);
  assert.equal(fs.existsSync(path.join(workspace, "model-readiness.json")), false);
});
