import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyV2Migration } from "../src/v3/migration.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-v3-builtins-"));

try {
  fs.mkdirSync(path.join(temporaryHome, "catalogs/builtin/assets/components"), { recursive: true });
  fs.mkdirSync(path.join(temporaryHome, "catalogs/organization/assets"), { recursive: true });
  fs.mkdirSync(path.join(temporaryHome, "migrations"), { recursive: true });
  fs.cpSync(path.join(root, "assets/v3/components"), path.join(temporaryHome, "catalogs/builtin/assets/components"), { recursive: true });
  const result = applyV2Migration(path.join(root, "harnesses"), temporaryHome);
  if (result.status !== "MIGRATED") throw new Error(`Migration failed: ${JSON.stringify(result)}`);
  const generated = path.join(temporaryHome, "catalogs/organization/assets");
  fs.cpSync(path.join(generated, "profiles"), path.join(root, "assets/v3/profiles"), { recursive: true });
  fs.cpSync(path.join(generated, "bundles"), path.join(root, "assets/v3/bundles"), { recursive: true });
  process.stdout.write(`${JSON.stringify({ status: "GENERATED", templateCount: result.templateCount, assetCount: result.createdAssetCount }, null, 2)}\n`);
} finally {
  fs.rmSync(temporaryHome, { recursive: true, force: true });
}
