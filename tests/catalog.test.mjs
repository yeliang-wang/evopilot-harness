import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "src/index.mjs");

test("publishes and validates a Harness Catalog", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-"));
  const publish = spawnSync(process.execPath, [cli, "catalog", "publish", "--source", path.join(root, "harnesses"), "--out", tmp, "--json"], {
    encoding: "utf8"
  });
  assert.equal(publish.status, 0, publish.stderr);
  const result = JSON.parse(publish.stdout);
  assert.equal(result.status, "PUBLISHED");
  assert.ok(result.templateCount >= 2);
  const catalogPath = path.join(tmp, "CATALOG.md");
  assert.ok(fs.existsSync(catalogPath));
  const catalogMarkdown = fs.readFileSync(catalogPath, "utf8");
  assert.match(catalogMarkdown, /```yaml evopilot-harness-catalog/);
  assert.match(catalogMarkdown, /compatibleEvopilot: ">=2.5.0"/);
  assert.match(catalogMarkdown, /distributed-cache-harness/);

  const validate = spawnSync(process.execPath, [cli, "catalog", "validate", "--source", tmp, "--json"], {
    encoding: "utf8"
  });
  assert.equal(validate.status, 0, validate.stderr);
  const validation = JSON.parse(validate.stdout);
  assert.equal(validation.status, "VALIDATED");
});
