import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const RELEASE_SOURCE_INPUTS = [
  ".agents", ".dockerignore", ".github", ".gitignore", "AGENTS.md", "CHANGELOG.md",
  "CODE_OF_CONDUCT.md", "CONTRIBUTING.md", "Dockerfile", "LICENSE", "NOTICE", "README.md",
  "SECURITY.md", "assets", "compose.yaml", "docs", "digital-expert", "eval", "harnesses",
  "governance", "ontology", "package-lock.json", "package.json", "policies", "published",
  "schemas", "scripts", "src", "tests", "ui", "llms.txt"
];

export function releaseSourceManifest(root) {
  const entries = RELEASE_SOURCE_INPUTS.flatMap((relative) => walk(path.join(root, relative), root)).sort((left, right) => left.path.localeCompare(right.path));
  const hash = crypto.createHash("sha256");
  for (const entry of entries) hash.update(entry.path).update("\0").update(entry.type).update("\0").update(entry.digest).update("\0");
  return { algorithm: "sha256:path-type-content-v1", fileCount: entries.length, treeDigest: `sha256:${hash.digest("hex")}` };
}

function walk(target, root) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.lstatSync(target);
  if (stat.isDirectory()) return fs.readdirSync(target).flatMap((name) => walk(path.join(target, name), root));
  const relative = path.relative(root, target).split(path.sep).join("/");
  if (stat.isSymbolicLink()) return [{ path: relative, type: "symlink", digest: sha256(Buffer.from(fs.readlinkSync(target))) }];
  if (stat.isFile()) return [{ path: relative, type: "file", digest: sha256(fs.readFileSync(target)) }];
  return [];
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
