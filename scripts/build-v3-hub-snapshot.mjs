import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { writeHubSnapshot } from "../src/v3/hub.mjs";

const root = path.resolve(import.meta.dirname, "..");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-v3-hub-"));

try {
  initializeWorkspace(home);
  const result = writeHubSnapshot(home, path.join(root, "ui/harness-hub/catalog-snapshot.json"));
  process.stdout.write(`${JSON.stringify({ status: "GENERATED", schema: result.schema, assetCounts: result.assetCounts }, null, 2)}\n`);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
