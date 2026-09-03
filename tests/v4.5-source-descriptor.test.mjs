import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { buildSourceConceptHypothesis } from "../src/v4/classification/source-concept.mjs";
import { normalizeSourceDescriptor, resolveSourceDescriptor, sourceDescriptorDigest } from "../src/v4/classification/source-descriptor.mjs";
import { initializeWorkspace } from "../src/v3/workspace.mjs";

test("SourceDescriptor/v1 canonicalizes all six evidence-only Source types and validates its public schema", () => {
  const home = workspace();
  const file = path.join(home, "source.txt");
  const directory = path.join(home, "directory");
  const repository = path.join(home, "repository");
  fs.writeFileSync(file, "static evidence\n");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "README.md"), "directory evidence\n");
  initRepository(repository);
  const descriptors = [
    normalizeSourceDescriptor({ type: "LOCAL_FILE", path: file }),
    normalizeSourceDescriptor({ type: "LOCAL_DIRECTORY", path: directory }),
    normalizeSourceDescriptor({ type: "LOCAL_GIT_REPOSITORY", path: repository }),
    normalizeSourceDescriptor({ type: "GITHUB_REPOSITORY", repository: "openai/openai-node", requestedRef: "main" }),
    normalizeSourceDescriptor({ type: "CONTROLLED_FIXTURE", path: file }),
    normalizeSourceDescriptor({ type: "ORDERED_ATTACHMENT_SET", members: [{ sourceId: "first-member", path: file }, { sourceId: "second-member", path: path.join(directory, "README.md") }] })
  ];
  const schema = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../schemas/source-descriptor-v1.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  for (const descriptor of descriptors) {
    assert.equal(validate(descriptor), true, JSON.stringify(validate.errors));
    assert.equal(descriptor.sourceExecutionAllowed, false);
    assert.equal(descriptor.acquisitionPolicy.submodulesAllowed, false);
    assert.equal(descriptor.acquisitionPolicy.gitLfsAllowed, false);
  }
  assert.deepEqual(descriptors.map((item) => item.type), ["LOCAL_FILE", "LOCAL_DIRECTORY", "LOCAL_GIT_REPOSITORY", "GITHUB_REPOSITORY", "CONTROLLED_FIXTURE", "ORDERED_ATTACHMENT_SET"]);
});

test("GitHub locator vectors share one canonical repository identity and reject embedded credentials", () => {
  const shorthand = normalizeSourceDescriptor({ type: "GITHUB_REPOSITORY", repository: "openai/openai-node", requestedRef: "main" });
  const https = normalizeSourceDescriptor({ type: "GITHUB_REPOSITORY", repository: "https://github.com/openai/openai-node.git", requestedRef: "main" });
  const ssh = normalizeSourceDescriptor({ type: "GITHUB_REPOSITORY", repository: "git@github.com:openai/openai-node.git", requestedRef: "main" });
  assert.equal(shorthand.locator.repository, "openai/openai-node");
  assert.equal(https.locator.repository, shorthand.locator.repository);
  assert.equal(ssh.locator.repository, shorthand.locator.repository);
  assert.equal(https.sourceId, shorthand.sourceId);
  assert.equal(ssh.sourceId, shorthand.sourceId);
  assert.equal(ssh.locator.transport, "SSH");
  assert.throws(() => normalizeSourceDescriptor({ type: "GITHUB_REPOSITORY", repository: "https://user:secret@github.com/openai/openai-node.git" }), (error) => error.code === "SOURCE_EMBEDDED_CREDENTIALS_REJECTED");
});

test("local Source resolution is read-only and acquisition time is outside deterministic Source bindings", () => {
  const home = workspace();
  const source = path.join(home, "source");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "README.md"), "distributed cache replication failover\n");
  const descriptor = normalizeSourceDescriptor({ sourceId: "cache-source", type: "LOCAL_DIRECTORY", path: source });
  const before = fileState(source);
  const first = resolveSourceDescriptor({ descriptor, workspace: home, now: "2026-08-28T01:00:00.000Z" });
  const second = resolveSourceDescriptor({ descriptor, workspace: home, now: "2026-08-28T02:00:00.000Z" });
  assert.notEqual(first.acquiredAt, second.acquiredAt);
  assert.equal(first.sourceResolutionDigest, second.sourceResolutionDigest);
  assert.equal(buildSourceConceptHypothesis(first).sourceSnapshotDigest, buildSourceConceptHypothesis(second).sourceSnapshotDigest);
  assert.deepEqual(fileState(source), before);
});

test("ordered attachment membership and order are exact deterministic bindings", () => {
  const home = workspace();
  const firstFile = path.join(home, "first.md");
  const secondFile = path.join(home, "second.md");
  fs.writeFileSync(firstFile, "first cache architecture\n");
  fs.writeFileSync(secondFile, "second gateway design\n");
  const firstOrder = { type: "ORDERED_ATTACHMENT_SET", members: [{ sourceId: "first-source", path: firstFile }, { sourceId: "second-source", path: secondFile }] };
  const reversed = { type: "ORDERED_ATTACHMENT_SET", members: [{ sourceId: "second-source", path: secondFile }, { sourceId: "first-source", path: firstFile }] };
  assert.notEqual(sourceDescriptorDigest(firstOrder), sourceDescriptorDigest(reversed));
  const firstSnapshot = buildSourceConceptHypothesis(resolveSourceDescriptor({ descriptor: firstOrder, workspace: home }));
  const reversedSnapshot = buildSourceConceptHypothesis(resolveSourceDescriptor({ descriptor: reversed, workspace: home }));
  assert.notEqual(firstSnapshot.sourceSnapshotDigest, reversedSnapshot.sourceSnapshotDigest);
  assert.deepEqual(firstSnapshot.sourceSnapshot.sourceBinding.members.map((item) => item.sourceId), ["first-source", "second-source"]);
  assert.deepEqual(reversedSnapshot.sourceSnapshot.sourceBinding.members.map((item) => item.sourceId), ["second-source", "first-source"]);
});

test("local Git Source binds its current full commit without executing repository content", () => {
  const home = workspace();
  const repository = path.join(home, "repository");
  const commit = initRepository(repository);
  const sentinel = path.join(home, "must-not-exist");
  fs.writeFileSync(path.join(repository, "run-me.sh"), `touch ${sentinel}\n`);
  const resolved = resolveSourceDescriptor({ descriptor: { sourceId: "local-git-source", type: "LOCAL_GIT_REPOSITORY", path: repository }, workspace: home });
  assert.equal(resolved.resolvedCommit, commit);
  buildSourceConceptHypothesis(resolved);
  assert.equal(fs.existsSync(sentinel), false);
});

test("Git Source rejects submodules and Git LFS before classification", () => {
  const home = workspace();
  const submoduleRepository = path.join(home, "submodule-repository");
  initRepository(submoduleRepository);
  fs.writeFileSync(path.join(submoduleRepository, ".gitmodules"), "[submodule \"nested\"]\n\tpath = nested\n\turl = https://github.com/example/nested.git\n");
  assert.throws(() => resolveSourceDescriptor({ descriptor: { type: "LOCAL_GIT_REPOSITORY", path: submoduleRepository }, workspace: home }), (error) => error.code === "SOURCE_GIT_SUBMODULE_UNSUPPORTED");

  const lfsRepository = path.join(home, "lfs-repository");
  initRepository(lfsRepository);
  fs.writeFileSync(path.join(lfsRepository, ".gitattributes"), "*.bin filter=lfs diff=lfs merge=lfs -text\n");
  assert.throws(() => resolveSourceDescriptor({ descriptor: { type: "LOCAL_GIT_REPOSITORY", path: lfsRepository }, workspace: home }), (error) => error.code === "SOURCE_GIT_LFS_UNSUPPORTED");
});

test("GitHub acquisition failures map to finite typed blockers without credential collection", () => {
  const home = workspace();
  const fakeBin = path.join(home, "fake-bin");
  fs.mkdirSync(fakeBin);
  const fakeGit = path.join(fakeBin, "git");
  fs.writeFileSync(fakeGit, "#!/bin/sh\necho \"$EVOPILOT_FAKE_GIT_ERROR\" >&2\nexit 128\n", { mode: 0o700 });
  const priorPath = process.env.PATH;
  process.env.PATH = `${fakeBin}${path.delimiter}${priorPath}`;
  try {
    for (const vector of [
      { message: "fatal: unable to access: Could not resolve host: github.com", descriptor: { type: "GITHUB_REPOSITORY", repository: "example/network" }, code: "SOURCE_GITHUB_NETWORK_UNAVAILABLE" },
      { message: "fatal: repository not found", descriptor: { type: "GITHUB_REPOSITORY", repository: "example/private", privateRepository: true }, code: "SOURCE_GITHUB_AMBIENT_AUTH_REQUIRED" },
      { message: "fatal: couldn't find remote ref missing", descriptor: { type: "GITHUB_REPOSITORY", repository: "example/ref", requestedRef: "missing" }, code: "SOURCE_GITHUB_REF_NOT_FOUND" },
      { message: "fatal: repository not found", descriptor: { type: "GITHUB_REPOSITORY", repository: "example/missing" }, code: "SOURCE_GITHUB_REPOSITORY_NOT_FOUND" }
    ]) {
      process.env.EVOPILOT_FAKE_GIT_ERROR = vector.message;
      assert.throws(() => resolveSourceDescriptor({ descriptor: vector.descriptor, workspace: home }), (error) => error.code === vector.code && !JSON.stringify(error).includes("credential"));
    }
  } finally {
    process.env.PATH = priorPath;
    delete process.env.EVOPILOT_FAKE_GIT_ERROR;
  }
});

function workspace() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-source-descriptor-"));
  initializeWorkspace(home);
  return home;
}

function initRepository(repository) {
  fs.mkdirSync(repository, { recursive: true });
  execFileSync("git", ["init", "-q", repository]);
  fs.writeFileSync(path.join(repository, "README.md"), "static repository evidence\n");
  execFileSync("git", ["-C", repository, "add", "README.md"]);
  execFileSync("git", ["-C", repository, "-c", "user.name=EvoPilot Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"]);
  return execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function fileState(root) {
  return fs.readdirSync(root).sort().map((name) => ({ name, bytes: fs.readFileSync(path.join(root, name)).toString("hex") }));
}
