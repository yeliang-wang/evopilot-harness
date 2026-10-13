import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateHarness, evaluateHarness, buildDelivery, verifyDelivery, capabilities } from '../../dist/index.js';
import { sha256 } from '../../vendor/compatibility/v1/reference.mjs';

const cases = JSON.parse(await readFile(new URL('../../examples/synthetic-harnesses.json', import.meta.url), 'utf8'));
const clone = v => structuredClone(v);
const fresh = () => clone(cases[0]);
const mapRows = asset => {
  const s = asset.provenance.sources[0];
  asset.sourceMappings = ['objectives', 'preconditions', 'inputs', 'parameters', 'deliverables', 'rules'].flatMap(k => asset[k]).map(r => ({ id: 'mapping-' + r.id, targetRef: r.id, sourceRef: s.id, sourceLocator: s.locator, sourceRevision: s.revision, status: s.status }));
};
const pin = (product = 'harness') => ({ product, id: 'pinned', version: '0.1.0', specVersion: 'v1', visibility: 'public', digest: 'sha256:' + 'a'.repeat(64) });
const kinds = ['HarnessComponent','HarnessProfile','HarnessBundle','EvaluationPack'];
const forKind = kind => {
  const { asset } = fresh(); asset.kind = kind;
  asset.dependencies = kind === 'HarnessComponent' ? [pin('ontology')] : [pin()];
  if (['HarnessProfile','HarnessBundle'].includes(kind)) for (const k of ['rules','preconditions','inputs','parameters']) asset[k] = [];
  mapRows(asset);
  return asset;
};

for (const kind of kinds) for (const field of ['objectives', 'deliverables']) {
  test(`${kind} rejects empty ${field} with corresponding source mappings removed`, () => {
    const asset = forKind(kind);
    assert.equal(validateHarness(asset).valid, true);
    assert.doesNotThrow(() => buildDelivery(asset));
    const removedIds = new Set(asset[field].map(row => row.id));
    asset[field] = [];
    asset.sourceMappings = asset.sourceMappings.filter(mapping => !removedIds.has(mapping.targetRef));
    assert.equal(validateHarness(asset).valid, false);
    assert.throws(() => buildDelivery(asset));
  });
}

test('eight independent public/private forward/reverse cases share validation', () => {
  assert.equal(cases.length, 8);
  assert.equal(new Set(cases.map(c => c.asset.id)).size, 8);
  assert.equal(new Set(cases.map(c => c.asset.applicability.domains[0])).size, 2);
  for (const c of cases) {
    const before = JSON.stringify(c);
    assert.equal(validateHarness(c.asset).valid, true);
    const result = evaluateHarness(c.asset, c.evidence);
    assert.equal(result.status, c.expected);
    assert(Object.isFrozen(result.rules));
    assert.equal(verifyDelivery(buildDelivery(c.asset)).valid, true);
    assert.equal(JSON.stringify(c), before);
  }
});
test('boolean outcomes and execution errors remain distinct', () => {
  const { asset, evidence } = fresh();
  assert.equal(evaluateHarness(asset, evidence).status, 'PASS');
  evidence.values.score = 1;
  assert.equal(evaluateHarness(asset, evidence).status, 'FAIL');
  evidence.values.score = '1';
  assert.equal(evaluateHarness(asset, evidence).status, 'ERROR');
  asset.rules[0] = { ...asset.rules[0], operator: 'contains', expected: 1 };
  delete asset.rules[0].parameterRef; asset.inputs[1].type = 'array';
  evidence.values.score = [1, 'wrong'];
  assert.equal(validateHarness(asset).valid, true);
  assert.equal(evaluateHarness(asset, evidence).rules[0].status, 'ERROR');
});
test('missing observations and explicit applicability', () => {
  const { asset, evidence } = fresh();
  evidence.values = {};
  assert.equal(evaluateHarness(asset, evidence).status, 'INDETERMINATE');
  assert.equal(evaluateHarness(asset, { ...evidence, source: {} }).status, 'ERROR');
  evidence.values = { ready: false, score: 20 };
  const blocked = evaluateHarness(asset, evidence);
  assert.equal(blocked.status, 'FAIL');
  assert.equal(blocked.rules[0].status, 'INDETERMINATE');
  assert.equal(blocked.rules[0].reason, 'PRECONDITION_BLOCKED');
  asset.applicability.enabled = false;
  assert.equal(evaluateHarness(asset, evidence).status, 'N/A');
  asset.applicability.enabled = true;
  asset.rules = []; asset.preconditions = []; mapRows(asset);
  assert.equal(evaluateHarness(asset, evidence).status, 'INDETERMINATE');
  assert.equal(evaluateHarness(asset, undefined).status, 'ERROR');
});
test('typed rules and exact configuration', () => {
  const { asset, evidence } = fresh();
  assert.equal(evaluateHarness(asset, evidence, { minimum: 13 }).status, 'FAIL');
  for (const config of [{ minimum: '10' }, { unknown: 1 }, []]) assert.equal(evaluateHarness(asset, evidence, config).status, 'ERROR');
  for (const [type, operator, expected, value] of [['number','lte',12,11], ['integer','eq',1,1], ['boolean','eq',true,true], ['string','contains','ok','looks ok'], ['array','contains',false,[true,false]]]) {
    const c = fresh(); c.asset.inputs[1].type = type;
    c.asset.rules[0] = { ...c.asset.rules[0], operator, expected }; delete c.asset.rules[0].parameterRef;
    c.evidence.values.score = value;
    assert.equal(evaluateHarness(c.asset,c.evidence).status, 'PASS');
    c.asset.rules[0].expected = {}; assert.equal(validateHarness(c.asset).valid, false);
  }
  for (const edit of [a => { a.rules[0].expected = 1; }, a => { a.rules[0].parameterRef = 'absent'; }, a => { a.parameters[0].default = '10'; }, a => { a.preconditions[0].evidenceKey = 'score'; }, a => { a.inputs[1].type = 'string'; }, a => { a.rules[0].target = ''; }]) {
    const a = clone(asset); edit(a); assert.equal(validateHarness(a).valid, false);
  }
});
test('nonblocking warning never grants authority or mutates version', () => {
  const { asset, evidence } = fresh(); evidence.values.score = 0;
  const config = { minimum: 10 }, before = JSON.stringify({ asset, evidence, config });
  const r = evaluateHarness(asset, evidence, config);
  assert.equal(r.status, 'FAIL'); assert.equal(r.rules[0].severity, 'warning'); assert.equal(r.rules[0].blocking, false);
  assert.equal(r.authority, false); assert.equal(r.released, false);
  assert.equal(JSON.stringify({ asset, evidence, config }), before);
  assert.equal(capabilities().businessOperationsReady, true);
});
test('closed JSON source coverage and extension conflicts', () => {
  const { asset, evidence } = fresh();
  for (const edit of [
    a => { a.extra = true; }, a => { a.rules[0].extra = 1; }, a => { a.inputs[0].id = a.objectives[0].id; },
    a => { a.sourceMappings.pop(); }, a => { a.sourceMappings[0].sourceRevision = 'wrong'; },
    a => { a.sourceMappings[0].sourceLocator = 'wrong'; }, a => { a.sourceMappings[0].status = 'inferred'; },
    a => { a.sourceMappings[0].targetRef = 'dangling'; }, a => { a.sourceMappings[0].sourceRef = 'dangling'; },
    a => { a.dependencies = [{ ...pin(), specVersion: 'v2' }]; }, a => { a.specVersion = 'v2'; },
    a => { a.dependencies = [{ ...pin(), visibility: 'private' }]; },
    a => { a.dependencies = [pin(), pin()]; }, a => { a.version = '01.0.0'; },
    a => { a.extensions = [{ namespace: 'unknown.extra', version: '1.0.0', required: true, data: {} }]; },
    ...['rules','applicability','kind','inputs','parameters','objectives','preconditions','deliverables'].map(k => a => { a.extensions = [{ namespace: 'unknown.extra', version: '1.0.0', required: false, data: { [k]: [] } }]; }),
  ]) { const a = clone(asset); edit(a); assert.equal(validateHarness(a).valid, false); }
  const extension = { namespace: 'unknown.extra', version: '1.0.0', required: false, data: { note: 'inert' } };
  asset.extensions = [extension];
  assert.equal(validateHarness(asset).extensions[0].status, 'NOT_EVALUATED');
  assert.deepEqual(buildDelivery(asset).definition.extensions, [extension]);
  asset.extensions.push(clone(extension)); assert.equal(validateHarness(asset).valid, false);
  let accessed = false;
  const a = fresh().asset;
  Object.defineProperty(a.rules[0], 'expected', { enumerable: true, get() { accessed = true; return 1; } });
  assert.equal(validateHarness(a).valid, false); assert.equal(accessed, false);
  Object.defineProperty(evidence.values, 'score', { enumerable: true, get() { accessed = true; return 1; } });
  assert.equal(evaluateHarness(fresh().asset, evidence).status, 'ERROR'); assert.equal(accessed, false);
  for (const value of [NaN, Infinity, undefined, new Date(), [,,], () => 1]) {
    const a = fresh().asset; a.parameters[0].default = value; assert.equal(validateHarness(a).valid, false);
  }
});
test('evidence bindings and deterministic package integrity', () => {
  const { asset, evidence } = fresh();
  const r = evaluateHarness(asset,evidence);
  assert.equal(r.assetDigest, sha256(asset)); assert.equal(r.rulesDigest, sha256(asset.rules));
  assert.equal(r.configurationDigest, sha256({ minimum: 10 })); assert.equal(r.evidenceDigest, sha256(evidence));
  assert.deepEqual(r.evidence, { id: evidence.id, version: evidence.version, source: evidence.source });
  const d = buildDelivery(asset);
  assert.equal(d.manifest.productVersion, '0.2.0');
  assert.deepEqual(d, buildDelivery(clone(asset)));
  assert.equal(d.evaluationReport.status, 'NOT_RUN');
  assert.equal(d.manifest.contentDigest, sha256(Object.fromEntries(Object.entries(d).filter(([k]) => !['manifest','digest','authority','released'].includes(k)))));
  for (const edit of [
    d => { d.extra = 1; }, d => { d.manifest.extra = 1; }, d => { d.evaluationReport.status = 'PASS'; },
    d => { d.validationReport.authority = true; }, d => { d.configuration.minimum = 20; },
    d => { d.rules[0].blocking = true; }, d => { d.definition.id = 'changed'; },
    d => { d.manifest.dependencies = [pin()]; }, d => { d.dependencyReport.status = 'COMPLETE'; },
  ]) { const copy = clone(d); edit(copy); assert.equal(verifyDelivery(copy).valid, false); }
  assert(Object.isFrozen(d.definition.rules[0]));
});
test('all kinds retain honest unresolved dependency pins', () => {
  for (const kind of kinds) {
    const asset = forKind(kind);
    assert.equal(validateHarness(asset).valid, true, kind);
    const d = buildDelivery(asset);
    assert.equal(d.dependencyReport.status, 'NOT_RESOLVED');
    assert.equal(d.manifest.dependencyState, 'NOT_RESOLVED');
    assert.equal(verifyDelivery(d).valid, true);
    asset.dependencies[0].digest = 'invalid'; assert.equal(validateHarness(asset).valid, false);
  }
  const { asset } = fresh();
  for (const kind of ['HarnessProfile','HarnessBundle','EvaluationPack']) { asset.kind = kind; assert.equal(validateHarness(asset).valid, false); }
});

test('aggregate priority preserves error fail and missing outcomes independently', () => {
  const { asset, evidence } = fresh();
  asset.inputs.push({ id: 'tags', type: 'array' });
  asset.rules.push({ id: 'tag-check', target: 'Synthetic tags', evidenceKey: 'tags', operator: 'contains', expected: 'ready', severity: 'info', blocking: false });
  mapRows(asset);
  evidence.values.score = 0;
  assert.equal(evaluateHarness(asset, evidence).status, 'FAIL');
  evidence.values.tags = [1];
  let result = evaluateHarness(asset, evidence);
  assert.equal(result.status, 'ERROR');
  assert.deepEqual(result.rules.map(r => r.status), ['FAIL','ERROR']);
  evidence.values.score = 20;
  delete evidence.values.tags;
  assert.equal(evaluateHarness(asset, evidence).status, 'INDETERMINATE');
  evidence.values.tags = ['ready'];
  result = evaluateHarness(asset, evidence);
  assert.equal(result.status, 'PASS');
  assert.equal(result.rules[1].ruleDigest, sha256(asset.rules[1]));
  asset.applicability.enabled = false;
  evidence.values.ready = false;
  result = evaluateHarness(asset, evidence);
  assert.equal(result.status, 'N/A');
  assert.equal(result.preconditions[0].status, 'N/A');
});
