import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, readFileSync, existsSync, mkdirSync, writeFileSync, symlinkSync, linkSync, rmSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createHarnessService } from '@evopilot-next/harness/service';
import { sha256, stableSerialize } from '../../vendor/compatibility/v1/reference.mjs';

const samples = JSON.parse(readFileSync(new URL('../../examples/synthetic-harnesses.json', import.meta.url)));
const fixtures = { assets: samples.map(s => s.asset) };
const scope = { visibility: 'public', projectId: 'alpha' };
const clone = value => JSON.parse(JSON.stringify(value));
function group(base, id, kind, dependencies) {
  const asset = { ...clone(base), id, kind, dependencies, inputs: [], parameters: [], rules: [], preconditions: [] };
  const targets = new Set([...asset.objectives, ...asset.deliverables].map(x => x.id));
  asset.sourceMappings = asset.sourceMappings.filter(m => targets.has(m.targetRef));
  return asset;
}
test('review invalidation, immutable publication and scoped persisted evaluation', t => {
  const { service, options } = setup(t); service.initialize();
  const asset = clone(fixtures.assets[0]), input = { id: asset.id, version: asset.version };
  write(service, 'asset.put', { asset });
  assert.throws(() => write(service, 'asset.publish', input), { code: 'REVIEW_REQUIRED' });
  const review = write(service, 'asset.review', input).result;
  assert.throws(() => write(service, 'asset.publish', input), { code: 'APPROVAL_REQUIRED' });
  asset.objectives[0].description += ' revised';
  write(service, 'asset.put', { asset });
  assert.throws(() => write(service, 'asset.decide', { ...input, reviewDigest: review.reviewDigest, decision: 'APPROVE', humanEvidenceRef: 'local:test' }), { code: 'REVIEW_REQUIRED' });
  approve(service, asset);
  const request = { operation: 'asset.publish', scope, input, requestId: 'publication', expectedRevision: read(service, 'workspace.inspect').revision };
  const receipt = service.execute(request);
  assert.deepEqual(service.execute({ ...request, expectedRevision: 999 }), receipt);
  assert.throws(() => write(service, 'asset.publish', input), { code: 'IMMUTABLE_VERSION' });
  for (const [values, expected] of [[{}, 'INDETERMINATE'], [{ ready: true, score: 1 }, 'FAIL'], [samples[0].evidence.values, 'PASS']]) {
    const evaluation = write(service, 'asset.evaluate', { ...input, evidence: { ...samples[0].evidence, values }, configuration: {} });
    assert.equal(evaluation.result.report.status, expected);
    assert.deepEqual(evaluation.result.report.actions, []);
    assert.deepEqual(read(service, 'evaluation.inspect', { requestId: evaluation.requestId }), evaluation);
    assert.throws(() => read(service, 'evaluation.inspect', { requestId: evaluation.requestId }, { ...scope, projectId: 'beta' }), { code: 'NOT_FOUND' });
  }
  assert.throws(() => read(service, 'evaluation.inspect', { requestId: 'publication' }), { code: 'NOT_FOUND' });
  service.close(); const reopened = createHarnessService(options); reopened.initialize(); t.after(() => reopened.close());
  assert.deepEqual(read(reopened, 'receipt.inspect', { requestId: 'publication' }), receipt);
  for (const operation of ['ontology.put', 'legacy.derive', 'shell.execute', 'unknown']) assert.throws(() => read(reopened, operation), { code: 'UNSUPPORTED_OPERATION' });
});

test('composed publication exact roles, scope ambiguity and missing evaluation evidence', t => {
  const { service } = setup(t); service.initialize();
  const asset = fixtures.assets[0]; write(service, 'asset.put', { asset });
  const ref = write(service, 'asset.publish', approve(service, asset)).result.reference;
  const profile = group(asset, 'profile', 'HarnessProfile', [ref]);
  write(service, 'asset.put', { asset: profile });
  const p = write(service, 'asset.publish', approve(service, profile)).result;
  assert.equal(p.resolution.status, 'RESOLVED'); assert.equal(p.delivery.dependencyReport.status, 'NOT_RESOLVED');
  const missing = write(service, 'asset.evaluate', { id: profile.id, version: profile.version, evidence: {}, configuration: {} }).result.report;
  assert.equal(missing.status, 'INDETERMINATE');
  assert.equal(missing.evaluation.results[0].evaluation.reason, 'MISSING_EVIDENCE');
  for (const [id, kind, pins, code] of [
    ['wrong', 'HarnessBundle', [ref], 'DEPENDENCY_KIND'],
    ['drift', 'HarnessProfile', [{ ...ref, digest: 'sha256:' + '0'.repeat(64) }], 'DEPENDENCY_MISMATCH'],
    ['missing', 'HarnessProfile', [{ ...ref, id: 'missing' }], 'UNAVAILABLE_DEPENDENCY'],
  ]) {
    const a = group(asset, id, kind, pins); write(service, 'asset.put', { asset: a });
    assert.throws(() => write(service, 'asset.review', { id, version: a.version }), { code });
  }
  const shared = { ...scope, projectId: 'shared' };
  write(service, 'asset.put', { asset }, shared); write(service, 'asset.publish', approve(service, asset, shared), shared);
  const ambiguous = group(asset, 'ambiguous', 'HarnessProfile', [ref]); write(service, 'asset.put', { asset: ambiguous });
  assert.throws(() => write(service, 'asset.review', { id: ambiguous.id, version: ambiguous.version }), { code: 'UNAVAILABLE_DEPENDENCY' });
});

test('host resolver is closed, synchronous, exact and cannot be request configured', async t => {
  const { options } = setup(t);
  assert.throws(() => createHarnessService(options, { unknown: () => {} }), { code: 'INVALID_PROVIDER' });
  assert.throws(() => createHarnessService(options, { resolveOntology: 'code' }), { code: 'INVALID_PROVIDER' });
  const ref = { product: 'ontology', id: 'semantic', version: '1.0.0', specVersion: 'v1', visibility: 'public', digest: 'sha256:' + 'a'.repeat(64) };
  let observed = { reference: ref, published: true, workspaceId: options.workspaceId, projectId: scope.projectId };
  const service = createHarnessService(options, { resolveOntology: () => observed }); service.initialize(); t.after(() => service.close());
  const asset = { ...clone(fixtures.assets[0]), dependencies: [ref] }, input = { id: asset.id, version: asset.version };
  write(service, 'asset.put', { asset }); approve(service, asset);
  observed = { ...observed, projectId: 'foreign' };
  assert.throws(() => write(service, 'asset.publish', input), { code: 'DEPENDENCY_MISMATCH' });
  observed = Promise.reject(Error('async unavailable'));
  assert.throws(() => write(service, 'asset.review', input), { code: 'ASYNC_PROVIDER' });
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => service.execute({ operation: 'asset.inspect', scope, input, trustedProviders: {} }));
});
function setup(t) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'harness-service-'));
  const options = { workspaceRoot: join(parent, 'workspace'), workspaceId: 'test' };
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const service = createHarnessService(options); t.after(() => service.close());
  return { parent, options, service };
}
const read = (s, operation, input = {}, selected = scope) => s.execute({ operation, input, scope: selected });
let serial = 0;
function write(s, operation, input, selected = scope, extra = {}) {
  return s.execute({ operation, input, scope: selected, requestId: 'request-' + ++serial, expectedRevision: read(s, 'workspace.inspect', {}, selected).revision, ...extra });
}
function approve(s, model, selected = scope) {
  const input = { id: model.id, version: model.version };
  const review = write(s, 'asset.review', input, selected);
  write(s, 'asset.decide', { ...input, reviewDigest: review.result.reviewDigest, decision: 'APPROVE', humanEvidenceRef: 'human:test-review' }, selected);
  return input;
}
function worker(options, request, killBeforeCommit = false) {
  const child = fork(new URL('../fixtures/service-worker.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const response = Promise.race([
    once(child, 'message').then(([message]) => message),
    once(child, 'exit').then(([code]) => { throw Error('Worker exited before response: ' + code); }),
  ]);
  child.send({ options, request, killBeforeCommit });
  return { child, response };
}

test('discovery/construction pure; explicit identity, restart and closed API', t => {
  const { service, options } = setup(t);
  assert(service.capabilities().operations.includes('asset.publish'));
  assert.equal(existsSync(options.workspaceRoot), false);
  assert.throws(() => read(service, 'workspace.inspect'), { code: 'NOT_INITIALIZED' });
  service.initialize();
  assert.deepEqual(JSON.parse(readFileSync(join(options.workspaceRoot, 'workspace.json'))), { schema: 'evopilot-workspace/v1', id: 'test', canonicalRoot: options.workspaceRoot, ownerUid: process.getuid() });
  assert.deepEqual(readdirSync(options.workspaceRoot).sort(), ['state', 'workspace.json']);
  service.close(); assert.throws(() => service.initialize(), { code: 'CLOSED' });
  const reopened = createHarnessService(options); reopened.initialize();
  assert.equal(read(reopened, 'workspace.inspect').revision, 0); reopened.close();
});

test('forward/reverse models publish with separate exact review and human decision', t => {
  const { service } = setup(t); service.initialize();
  assert.deepEqual(new Set(fixtures.assets.map(a => a.provenance.direction)), new Set(['forward', 'reverse']));
  for (const model of fixtures.assets) {
    const selected = { ...scope, visibility: model.visibility };
    write(service, 'asset.put', { asset: model }, selected);
    const input = approve(service, model, selected);
    const receipt = write(service, 'asset.publish', input, selected);
    assert.equal(receipt.result.delivery.definition.id, model.id);
    assert.equal(receipt.uid, process.getuid());
    assert.throws(() => write(service, 'asset.put', { asset: model }, selected), { code: 'IMMUTABLE_VERSION' });
  }
});

test('scope isolation, exact idempotency, stale revision, closed bounded JSON', t => {
  const { service } = setup(t); service.initialize();
  const model = fixtures.assets[0];
  const request = { operation: 'asset.put', input: { asset: model }, scope, requestId: 'same', expectedRevision: 0 };
  const receipt = service.execute(request);
  assert.deepEqual(service.execute({ ...request, expectedRevision: 999 }), receipt);
  assert.throws(() => service.execute({ ...request, input: { asset: { ...model, id: 'changed' } } }), { code: 'REQUEST_CONFLICT' });
  assert.throws(() => service.execute({ ...request, requestId: 'new' }), { code: 'REVISION_CONFLICT' });
  for (const selected of [{ ...scope, projectId: 'beta' }, { ...scope, visibility: 'private' }]) {
    assert.deepEqual(read(service, 'asset.list', {}, selected), []);
    assert.throws(() => read(service, 'receipt.inspect', { requestId: 'same' }, selected), { code: 'NOT_FOUND' });
    assert.throws(() => read(service, 'asset.inspect', { id: model.id, version: model.version }, selected), { code: 'NOT_FOUND' });
  }
  let accessed = false;
  const bad = Object.defineProperty({}, 'operation', { enumerable: true, get() { accessed = true; } });
  assert.throws(() => service.execute(bad)); assert.equal(accessed, false);
  assert.throws(() => service.execute({ ...request, actor: 0 }));
  assert.throws(() => service.execute({ ...request, input: { asset: 'a'.repeat(600000) } }), { code: 'LIMIT' });
  assert.throws(() => service.execute({ ...request, expectedRevision: Infinity }));
});

test('review subject binds both workspace identity fields and project scope', t => {
  const first = setup(t), second = setup(t);
  first.service.initialize(); second.service.initialize();
  const model = fixtures.assets[0], input = { id: model.id, version: model.version };
  const beta = { ...scope, projectId: 'beta' };
  const reviews = [];
  for (const [service, selected] of [[first.service, scope], [first.service, beta], [second.service, scope]]) {
    write(service, 'asset.put', { asset: model }, selected);
    reviews.push(write(service, 'asset.review', input, selected).result);
  }
  assert.equal(new Set(reviews.map(r => r.reviewDigest)).size, 3);
  assert.equal(reviews[0].workspace.id, first.options.workspaceId);
  assert.equal(reviews[0].workspace.canonicalRoot, first.options.workspaceRoot);
  for (const [service, selected] of [[first.service, beta], [second.service, scope]]) {
    assert.throws(() => write(service, 'asset.decide', { ...input, reviewDigest: reviews[0].reviewDigest, decision: 'APPROVE', humanEvidenceRef: 'human:test' }, selected), { code: 'REVIEW_MISMATCH' });
  }
});

test('real competing writers, committed restart, killed transaction rolls back state/receipt/audit', { timeout: 20000 }, async t => {
  const { service, options } = setup(t); service.initialize(); service.close();
  const request = { operation: 'asset.put', input: { asset: fixtures.assets[0] }, scope, requestId: 'writer-a', expectedRevision: 0 };
  const a = worker(options, request), b = worker(options, { ...request, requestId: 'writer-b' });
  t.after(() => { a.child.kill(); b.child.kill(); });
  const replies = await Promise.all([a.response, b.response]);
  assert.equal(replies.filter(r => r.result).length, 1);
  assert.equal(replies.find(r => r.error).error, 'REVISION_CONFLICT');
  const killed = worker(options, { ...request, requestId: 'killed', expectedRevision: 1, input: { asset: { ...fixtures.assets[0], id: 'uncommitted' } } }, true);
  t.after(() => killed.child.kill());
  assert.equal((await killed.response).precommit, true);
  const exit = once(killed.child, 'exit'); killed.child.kill('SIGKILL'); await exit;
  const reopened = createHarnessService(options); t.after(() => reopened.close()); reopened.initialize();
  assert.equal(read(reopened, 'workspace.inspect').revision, 1);
  assert.equal(read(reopened, 'asset.list').length, 1);
  assert.throws(() => read(reopened, 'receipt.inspect', { requestId: 'killed' }), { code: 'NOT_FOUND' });
  assert.deepEqual(read(reopened, 'receipt.inspect', { requestId: replies.find(r => r.result).result.requestId }), replies.find(r => r.result).result);
  const db = new DatabaseSync(join(options.workspaceRoot, 'state/harness/harness.db'), { readOnly: true });
  assert.equal(db.prepare('SELECT count(*) AS n FROM audit').get().n, 1);
  assert.throws(() => db.exec('DELETE FROM audit')); db.close();
});

test('unknown/identity/symlink workspaces and corrupt database reject without recreation', t => {
  const { parent, options, service } = setup(t);
  mkdirSync(options.workspaceRoot, { mode: 0o700 });
  writeFileSync(join(options.workspaceRoot, 'unknown'), 'retained');
  assert.throws(() => service.initialize(), { code: 'UNKNOWN_WORKSPACE' });
  assert.deepEqual(readdirSync(options.workspaceRoot), ['unknown']);
  const safe = { ...options, workspaceRoot: join(parent, 'safe') };
  const initialized = createHarnessService(safe); initialized.initialize(); initialized.close();
  assert.throws(() => createHarnessService({ ...safe, workspaceId: 'wrong' }).initialize(), { code: 'IDENTITY_MISMATCH' });
  symlinkSync(safe.workspaceRoot, join(parent, 'link'));
  assert.throws(() => createHarnessService({ ...safe, workspaceRoot: join(parent, 'link') }).initialize(), { code: 'UNSAFE_WORKSPACE' });
  const db = join(safe.workspaceRoot, 'state/harness/harness.db');
  writeFileSync(db, 'corrupt');
  assert.throws(() => createHarnessService(safe).initialize(), { code: 'CORRUPT_STATE' });
  assert.equal(readFileSync(db, 'utf8'), 'corrupt');
  const identity = join(safe.workspaceRoot, 'workspace.json');
  writeFileSync(identity, JSON.stringify({ schema: 'evopilot-workspace/v1', id: 'test', canonicalRoot: safe.workspaceRoot, ownerUid: process.getuid() + 1 }));
  assert.throws(() => createHarnessService(safe).initialize(), { code: 'IDENTITY_MISMATCH' });
  writeFileSync(identity, '{');
  assert.throws(() => createHarnessService(safe).initialize(), { code: 'IDENTITY_MISMATCH' });
});

test('linked sidecars and mismatched immutable blob bytes cannot be adopted', t => {
  const { service, options, parent } = setup(t); service.initialize();
  const model = fixtures.assets[0]; write(service, 'asset.put', { asset: model });
  const blob = join(options.workspaceRoot, 'public/harness', sha256(model).slice(7) + '.json');
  writeFileSync(blob, stableSerialize({ tampered: true }));
  assert.throws(() => write(service, 'asset.review', { id: model.id, version: model.version }), { code: 'CORRUPT_BLOB' });
  assert.throws(() => write(service, 'asset.put', { asset: model }), { code: 'CORRUPT_BLOB' });
  service.close();
  const target = join(parent, 'sidecar'); writeFileSync(target, 'retained', { mode: 0o600 });
  const sidecar = join(options.workspaceRoot, 'state/harness/harness.db-wal');
  rmSync(sidecar, { force: true }); symlinkSync(target, sidecar);
  assert.throws(() => createHarnessService(options).initialize(), { code: 'UNSAFE_WORKSPACE' });
  assert.equal(readFileSync(target, 'utf8'), 'retained');
});

test('shared identity coexists with untouched sibling state; hardlinked own database denied', t => {
  const { service, options, parent } = setup(t); service.initialize(); service.close();
  const sibling = join(options.workspaceRoot, 'state/ontology'); mkdirSync(sibling, { mode: 0o700 });
  const sentinel = join(sibling, 'retained'); writeFileSync(sentinel, 'untouched', { mode: 0o600 });
  const reopened = createHarnessService(options); reopened.initialize(); reopened.close();
  assert.equal(readFileSync(sentinel, 'utf8'), 'untouched');
  linkSync(join(options.workspaceRoot, 'state/harness/harness.db'), join(parent, 'hardlink'));
  assert.throws(() => createHarnessService(options).initialize(), { code: 'UNSAFE_WORKSPACE' });
});
