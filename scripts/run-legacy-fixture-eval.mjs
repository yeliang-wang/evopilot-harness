import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { initializeLegacyProfessionalFixture } from "../tests/helpers/professional-supply.mjs";

const root = path.resolve(import.meta.dirname, "..");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-legacy-fixture-eval-"));
try {
  initializeLegacyProfessionalFixture(home);
  const result = spawnSync(process.execPath, ["src/index.mjs", "eval", "run", "--source", path.join(root, "harnesses"), "--workspace", home, "--json"], { cwd: root, stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
