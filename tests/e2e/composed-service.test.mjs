import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHarnessService } from '@evopilot-next/harness/service';
import { validateHarness, evaluateHarness } from '@evopilot-next/harness';
import { sha256, stableSerialize } from '../../vendor/compatibility/v1/reference.mjs';
import { operate } from '../../src/operations.mjs';

const scope = { visibility: 'public', projectId: 'alpha' };
const shared = { ...scope, projectId: 'shared' };
const source = { id: 'source', kind: 'synthetic', locator: 'synthetic:composed', revision: 'r1', digest: sha256('model'), status: 'synthetic' };
function model(id, kind = 'HarnessComponent', dependencies = [], enabled = true) {
  const runnable = ['HarnessComponent', 'EvaluationPack'].includes(kind);
  const a = { id, version: '0.1.0', product: 'harness', specVersion: 'v1', visibility: 'public',
    provenance: { direction: 'forward', sources: [source] }, extensions: [], dependencies, kind,
    applicability: { enabled, domains: ['synthetic'] }, objectives: [{ id: 'objective', description: 'Synthetic check' }],
    preconditions: [], inputs: runnable ? [{ id: 'score', type: 'number' }] : [],
    parameters: runnable ? [{ id: 'minimum', type: 'number', default: 10 }] : [],
    deliverables: [{ id: 'report', description: 'Synthetic report' }],
    rules: runnable ? [{ id: 'quality', target: 'Synthetic score', evidenceKey: 'score', operator: 'gte', parameterRef: 'minimum', severity: 'warning', blocking: false }] : [] };
  a.sourceMappings = [...a.objectives, ...a.preconditions, ...a.inputs, ...a.parameters, ...a.deliverables, ...a.rules].map(x => ({
    id: 'mapping-' + x.id, targetRef: x.id, sourceRef: source.id, sourceLocator: source.locator, sourceRevision: source.revision, status: 'synthetic' }));
  return a;
}
const evidence = score => ({ id: 'observation', version: '0.1.0', source: { locator: 'synthetic:observation', revision: 'r1', digest: sha256(score) }, values: { score } });
const read = (s, operation, input = {}, selected = scope) => s.execute({ operation, input, scope: selected });
let serial = 0;
const write = (s, operation, input, selected = scope) => s.execute({ operation, input, scope: selected, requestId: 'composed-' + ++serial, expectedRevision: read(s, 'workspace.inspect').revision });
function setup(t, providers = {}) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'harness-composed-'));
  const options = { workspaceRoot: join(parent, 'workspace'), workspaceId: 'composed' };
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const service = createHarnessService(options, providers); service.initialize(); t.after(() => service.close());
  return { service, options };
}
function publish(s, asset, selected = scope) {
  write(s, 'asset.put', { asset }, selected);
  const input = { id: asset.id, version: asset.version };
  const reviewDigest = write(s, 'asset.review', input, selected).result.reviewDigest;
  write(s, 'asset.decide', { ...input, reviewDigest, decision: 'APPROVE', humanEvidenceRef: 'human:synthetic-test' }, selected);
  return write(s, 'asset.publish', input, selected).result;
}
function graph(s, enabled = true, leafEnabled = true) {
  const component = publish(s, model('component', 'HarnessComponent', [], leafEnabled), shared);
  const second = publish(s, model('second', 'HarnessComponent', [], leafEnabled));
  const p1 = publish(s, model('profile-one', 'HarnessProfile', [component.reference, second.reference]));
  const p2 = publish(s, model('profile-two', 'HarnessProfile', [component.reference]));
  const bundle = publish(s, model('bundle', 'HarnessBundle', [p1.reference, p2.reference], enabled));
  return { component, second, bundle };
}
const evaluate = (s, published, inputs, configuration = {}) => write(s, 'asset.evaluate', { id: published.reference.id, version: published.reference.version, evidence: inputs, configuration });

test('synthetic composed models validate with proper source mappings and core warning semantics', () => {
  for (const kind of ['HarnessComponent', 'HarnessProfile', 'HarnessBundle', 'EvaluationPack']) {
    const dependencies = kind !== 'HarnessComponent' ? [{ product: 'harness', id: 'dependency', version: '0.1.0', specVersion: 'v1', visibility: 'public', digest: sha256('dependency') }] : [];
    const validation = validateHarness(model('synthetic', kind, dependencies));
    assert.equal(validation.valid, true, JSON.stringify(validation));
  }
  assert.equal(evaluateHarness(model('synthetic'), evidence(12), {}).status, 'PASS');
  assert.equal(evaluateHarness(model('synthetic'), evidence(1), {}).status, 'FAIL');
});

test('in-memory source integration verifies composed publication, missing input and status precedence', () => {
  const blobs = new Map(), state = { assets: [] };
  const store = { identity: { id: 'memory', canonicalRoot: '/synthetic' }, uid: 1,
    blob(scope, value) { const digest = sha256(value); blobs.set(stableSerialize(scope) + digest, stableSerialize(value)); return digest; },
    verifyBlob(scope, value) { assert.equal(blobs.get(stableSerialize(scope) + sha256(value)), stableSerialize(value)); } };
  let revision = 0;
  const s = { execute(r) {
    if (r.operation === 'workspace.inspect') return { revision };
    const result = operate(store, state, r, {}); revision++; return { result };
  } };
  const { component, second, bundle } = graph(s);
  const pack = publish(s, model('pack', 'EvaluationPack', [bundle.reference, component.reference]));
  const a = stableSerialize(component.reference), b = stableSerialize(second.reference), p = stableSerialize(pack.reference);
  const pass = evaluate(s, pack, { [a]: evidence(12), [b]: evidence(12), [p]: evidence(12) }).result.report;
  assert.equal(pass.status, 'PASS'); assert.equal(pass.evaluation.results.length, 3);
  const noncanonical = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(a)).reverse()));
  assert.notEqual(noncanonical, a);
  assert.throws(() => evaluate(s, pack, { [noncanonical]: evidence(12) }), { code: 'INVALID_REQUEST' });
  assert.deepEqual(pass.reference, pack.reference); assert.equal(pass.closureDigest, pack.resolution.closureDigest);
  assert.equal(evaluate(s, pack, { [a]: evidence(12), [p]: evidence(12) }).result.report.status, 'INDETERMINATE');
  assert.equal(evaluate(s, pack, { [a]: evidence(1) }).result.report.status, 'FAIL');
  assert.equal(evaluate(s, pack, { [a]: evidence(1), [b]: null }).result.report.status, 'ERROR');
  const disabled = publish(s, model('disabled', 'HarnessBundle', bundle.delivery.definition.dependencies, false));
  assert.equal(evaluate(s, disabled, {}).result.report.status, 'N/A');
  assert.equal(evaluate(s, disabled, { [a]: null }).result.report.status, 'ERROR');
  assert.throws(() => evaluate(s, disabled, { arbitrary: null }), { code: 'INVALID_REQUEST' });
});

test('published Bundle and EvaluationPack bind exact unique leaves, inputs and persisted receipts', t => {
  const { service: s, options } = setup(t);
  const { component, second, bundle } = graph(s);
  const pack = publish(s, model('pack', 'EvaluationPack', [bundle.reference, component.reference]));
  const keys = [component, second, pack].map(p => stableSerialize(p.reference));
  const inputs = Object.fromEntries(keys.map(k => [k, evidence(12)]));
  const configuration = Object.fromEntries(keys.map(k => [k, { minimum: 11 }]));
  const receipt = evaluate(s, pack, inputs, configuration), report = receipt.result.report;
  assert.equal(report.status, 'PASS'); assert.equal(report.evaluation.results.length, 3);
  assert.deepEqual(report.reference, pack.reference); assert.equal(report.closureDigest, pack.resolution.closureDigest);
  assert.equal(report.evaluationDigest, sha256(report.evaluation)); assert.equal(receipt.result.reportDigest, sha256(report));
  assert.equal(new Set(report.evaluation.results.map(r => stableSerialize(r.reference))).size, 3);
  for (const leaf of report.evaluation.results) {
    const key = stableSerialize(leaf.reference);
    assert.deepEqual(leaf.rootReference, pack.reference); assert.equal(leaf.closureDigest, report.closureDigest);
    assert.equal(leaf.evidenceDigest, sha256(inputs[key])); assert.equal(leaf.configurationDigest, sha256(configuration[key]));
    assert.equal(leaf.evaluationDigest, sha256(leaf.evaluation)); assert.equal(leaf.evaluation.rules.length, 1);
    assert.equal(leaf.scope.projectId, leaf.reference.id === 'component' ? 'shared' : 'alpha');
  }
  const before = read(s, 'workspace.inspect').revision;
  assert.deepEqual(read(s, 'evaluation.inspect', { requestId: receipt.requestId }), receipt);
  assert.equal(read(s, 'workspace.inspect').revision, before);
  assert.throws(() => read(s, 'evaluation.inspect', { requestId: receipt.requestId }, shared), { code: 'NOT_FOUND' });
  s.close(); const reopened = createHarnessService(options); reopened.initialize(); t.after(() => reopened.close());
  assert.deepEqual(read(reopened, 'evaluation.inspect', { requestId: receipt.requestId }), receipt);
  assert.deepEqual(reopened.execute({ operation: 'asset.evaluate', scope, input: { id: 'pack', version: '0.1.0', evidence: inputs, configuration }, requestId: receipt.requestId, expectedRevision: 0 }), receipt);
});

test('missing evidence, warning failure, ERROR priority and exact dictionary rejection', t => {
  const { service: s } = setup(t), { component, second, bundle } = graph(s);
  const a = stableSerialize(component.reference), b = stableSerialize(second.reference);
  const cases = [
    [{ [a]: evidence(12), [b]: evidence(12) }, 'PASS'],
    [{ [a]: evidence(12) }, 'INDETERMINATE'],
    [{ [a]: evidence(1) }, 'FAIL'],
    [{ [a]: evidence(1), [b]: {} }, 'ERROR'],
  ];
  for (const [inputs, status] of cases) {
    const report = evaluate(s, bundle, inputs).result.report;
    assert.equal(report.status, status); assert.equal(report.evaluation.results.length, 2); assert.deepEqual(report.actions, []);
    if (!Object.hasOwn(inputs, b)) {
      const missing = report.evaluation.results.find(r => r.reference.id === 'second');
      assert.equal(missing.evidenceDigest, null); assert.equal(missing.configurationDigest, null);
      assert.equal(missing.evaluation.reason, 'MISSING_EVIDENCE');
    }
  }
  assert.equal(JSON.stringify(component.reference), a);
  assert.equal(evaluate(s, bundle, { [a]: evidence(12), [b]: evidence(12) }).result.report.status, 'PASS');
  const noncanonical = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(a)).reverse()));
  assert.notEqual(noncanonical, a);
  for (const input of [{ component: evidence(12) }, { [noncanonical]: evidence(12) }]) assert.throws(() => evaluate(s, bundle, input), { code: 'INVALID_REQUEST' });
  assert.throws(() => evaluate(s, bundle, {}, { arbitrary: {} }), { code: 'INVALID_REQUEST' });
  assert.equal(read(s, 'asset.inspect', { id: 'bundle', version: '0.1.0' }).delivery.digest, bundle.reference.digest);
});

test('explicit disabled roots and all disabled leaves yield N/A while malformed inputs remain ERROR', t => {
  for (const [rootEnabled, leafEnabled] of [[false, true], [true, false]]) {
    const { service: s } = setup(t), { component, second, bundle } = graph(s, rootEnabled, leafEnabled);
    const a = stableSerialize(component.reference), b = stableSerialize(second.reference);
    assert.equal(evaluate(s, bundle, {}).result.report.status, 'N/A');
    assert.equal(evaluate(s, bundle, { [a]: evidence(1), [b]: evidence(12) }).result.report.status, 'N/A');
    assert.equal(evaluate(s, bundle, { [a]: null }).result.report.status, 'ERROR');
    assert.throws(() => evaluate(s, bundle, { unknown: null }), { code: 'INVALID_REQUEST' });
  }
});

test('published closure revalidation blocks changed providers and referenced resolution blob drift', t => {
  const ref = { product: 'ontology', id: 'semantic', version: '1.0.0', specVersion: 'v1', visibility: 'public', digest: sha256('ontology') };
  let projectId = 'alpha';
  const { service: s, options } = setup(t, { resolveOntology: () => ({ reference: ref, published: true, workspaceId: 'composed', projectId }) });
  const leaf = publish(s, model('leaf', 'HarnessComponent', [ref]));
  const profile = publish(s, model('profile', 'HarnessProfile', [leaf.reference]));
  const inputs = { [stableSerialize(leaf.reference)]: evidence(12) };
  projectId = 'shared';
  assert.throws(() => evaluate(s, profile, inputs), { code: 'DEPENDENCY_MISMATCH' });
  projectId = 'alpha';
  assert.equal(evaluate(s, profile, inputs).result.report.status, 'PASS');
  writeFileSync(join(options.workspaceRoot, 'public/harness', sha256(leaf.resolution).slice(7) + '.json'), '{}');
  assert.throws(() => evaluate(s, profile, inputs), { code: 'CORRUPT_BLOB' });
  assert.throws(() => createHarnessService(options, { unknown: () => {} }), { code: 'INVALID_PROVIDER' });
});
