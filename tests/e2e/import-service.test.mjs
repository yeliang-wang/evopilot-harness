import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHarnessService } from '@evopilot-next/harness/service';
import { listPublicSources, readPublicSource } from '../../dist/asset-sources.js';
import { operateImport } from '../../dist/import-operations.js';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { sha256 } from '../../vendor/compatibility/v1/reference.mjs';

const scope = { visibility: 'public', projectId: 'alpha' };
let serial = 0;
const read = (s, operation, input = {}, selected = scope) => s.execute({ operation, input, scope: selected });
const write = (s, operation, input, selected = scope) => s.execute({ operation, input, scope: selected, requestId: 'import-' + ++serial, expectedRevision: read(s, 'workspace.inspect').revision });
const inline = (raw, extra = {}) => ({ raw, format: 'json', sourceLocator: 'inline:retained', sourceRevision: 'r1', sourceVisibility: 'public', ...extra });
function setup(t) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'harness-import-'));
  const options = { workspaceRoot: join(parent, 'workspace'), workspaceId: 'imports' };
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const service = createHarnessService(options); service.initialize(); t.after(() => service.close());
  return { service, options };
}

test('in-memory historical recognition retains raw inputs without native authority', () => {
  const state = { sources: [] }, rawBlobs = new Map();
  const store = {
    rawBlob(selected, raw) { rawBlobs.set(JSON.stringify(selected) + 'sha256:' + createHash('sha256').update(raw).digest('hex'), raw); },
    verifyRawBlob(selected, digest) { const raw = rawBlobs.get(JSON.stringify(selected) + digest); assert.equal(typeof raw, 'string'); return raw; },
  };
  const run = (operation, input) => operateImport(store, state, { operation, scope, input });
  for (const doc of historicalFixtures()) {
    const raw = '\n ' + JSON.stringify(doc) + '\n';
    const record = run('legacy.import', inline(raw));
    assert.equal(record.status, 'PRESERVED_SOURCE'); assert.equal(record.inspection.schemaValidation, 'NOT_EVALUATED');
    assert.equal(record.inspection.valid, false);
    assert.equal(record.observed.id, doc.metadata?.id ?? doc.id ?? null);
    assert.equal(record.observed.version, doc.metadata?.version ?? doc.version ?? null);
    assert.equal(record.observed.catalogId, doc.catalogId ?? null);
    const inspected = run('source.inspect', { sourceId: record.sourceId });
    assert.equal(inspected.raw, raw); assert.deepEqual(inspected.document, doc);
    assert.equal(run('legacy.import', inline(JSON.stringify({ schema: doc.schema ?? null, apiVersion: doc.apiVersion ?? null, kind: doc.kind ?? null }))).status, 'QUARANTINED');
    assert.equal(run('legacy.import', inline(JSON.stringify({ ...doc, producer: 'ontology' }))).inspection.reason, 'FOREIGN_PRODUCER');
  }
  for (const doc of malformedFixtures()) {
    const record = run('legacy.import', inline(JSON.stringify(doc)));
    assert.equal(record.status, 'QUARANTINED'); assert(record.inspection.structuralIssues.length > 0);
  }
  const yaml = 'apiVersion: harness.evopilot.io/v3\nkind: HarnessComponent\nmetadata:\n  id: original\n  version: old\n';
  const record = run('legacy.import', inline(yaml, { format: 'yaml' }));
  assert.equal(record.status, 'PRESERVED_SOURCE'); assert.equal(run('source.inspect', { sourceId: record.sourceId }).raw, yaml);
  assert.throws(() => run('legacy.import', inline('{')), { code: 'INVALID_SOURCE' });
  assert.throws(() => run('legacy.import', inline('kind: [', { format: 'yaml' })), { code: 'INVALID_SOURCE' });
  assert.throws(() => run('legacy.import', inline('{}', { sourceVisibility: 'private' })), { code: 'SCOPE_MISMATCH' });
  assert.equal(state.assets, undefined);
});

test('all 101 own archive keys retain exact raw bytes and observed identity across restart', t => {
  const { service, options } = setup(t), entries = listPublicSources().sources;
  assert.equal(entries.length, 101);
  const installed = entries.map(entry => {
    const original = readPublicSource(entry.sourcePath);
    const receipt = write(service, 'source.install', { sourcePath: entry.sourcePath });
    const record = read(service, 'source.inspect', { sourceId: receipt.result.sourceId });
    assert.equal(record.raw, original.raw); assert.equal(record.rawDigest, 'sha256:' + original.sha256);
    assert.equal(record.observed.id, original.observed.id); assert.equal(record.observed.version, original.observed.version);
    assert.equal(record.status, 'PRESERVED_SOURCE');
    assert.deepEqual(readFileSync(join(options.workspaceRoot, 'public/harness/sources', original.sha256 + '.raw')), Buffer.from(original.raw));
    return receipt;
  });
  assert.equal(read(service, 'asset.list').length, 0);
  service.close(); const reopened = createHarnessService(options); reopened.initialize(); t.after(() => reopened.close());
  assert.equal(read(reopened, 'source.list').length, 101);
  for (const receipt of installed) assert.deepEqual(read(reopened, 'receipt.inspect', { requestId: receipt.requestId }), receipt);
  assert.throws(() => write(reopened, 'source.install', { sourcePath: '/etc/passwd' }), { code: 'UNKNOWN_SOURCE' });
});

test('whitespace, multiline text, identity/lifecycle, origin, quarantine and foreign records', t => {
  const { service } = setup(t);
  const raws = [' \n {"kind":"Catalog","id":"original","version":"old-version","lifecycle":"active"}\n  ', '# Catalog\n\n  inert instructions\n', 'kind: HarnessLock\nmetadata:\n  id: old\n  version: legacy\n  status: approved\n'];
  for (const [i, raw] of raws.entries()) {
    const input = inline(raw, { format: ['json', 'text', 'yaml'][i] });
    const result = write(service, 'legacy.import', input).result;
    assert.equal(read(service, 'source.inspect', { sourceId: result.sourceId }).raw, raw);
    assert.equal(result.status, 'PRESERVED_SOURCE');
    const revised = write(service, 'legacy.import', { ...input, sourceRevision: 'r2' }).result;
    assert.notEqual(result.sourceId, revised.sourceId);
    if (i === 0) { assert.equal(result.observed.id, 'original'); assert.equal(result.observed.version, 'old-version'); assert.equal(result.observed.lifecycle, 'active'); }
  }
  for (const kind of ['OntologyPack', 'DomainOntologyPack', 'ProjectOntologyOverlay', 'Unknown']) {
    const raw = JSON.stringify({ kind, schema: 'unknown/v99', id: 'retained', version: 'original' });
    const record = write(service, 'legacy.import', inline(raw)).result;
    assert.equal(record.status, 'QUARANTINED');
    assert.equal(read(service, 'source.inspect', { sourceId: record.sourceId }).raw, raw);
    if (kind !== 'Unknown') assert.equal(record.inspection.reason, 'FOREIGN_PRODUCER');
  }
  assert.deepEqual(read(service, 'asset.list'), []);
  const privateScope = { ...scope, visibility: 'private' };
  const input = inline('{"kind":"Catalog"}', { sourceVisibility: 'private' });
  assert.throws(() => write(service, 'legacy.import', input), { code: 'SCOPE_MISMATCH' });
  const record = write(service, 'legacy.import', input, privateScope).result;
  assert.throws(() => read(service, 'source.inspect', { sourceId: record.sourceId }), { code: 'NOT_FOUND' });
  assert.throws(() => write(service, 'legacy.import', inline('\ud800')), { code: 'INVALID_ENCODING' });
});

test('raw tampering fails every inspection and source list', t => {
  const { service, options } = setup(t);
  const record = write(service, 'legacy.import', inline(' {"schema":"unknown"}\n')).result;
  writeFileSync(join(options.workspaceRoot, 'public/harness/sources', record.rawDigest.slice(7) + '.raw'), 'tampered');
  assert.throws(() => read(service, 'source.inspect', { sourceId: record.sourceId }), { code: 'CORRUPT_BLOB' });
  assert.throws(() => read(service, 'source.list'), { code: 'CORRUPT_BLOB' });
});

test('configured historical format families preserve identity and bytes without schema or publication authority', t => {
  const { service } = setup(t);
  for (const document of historicalFixtures()) {
    const raw = ' \n' + JSON.stringify(document, null, 2) + '\n';
    const record = write(service, 'legacy.import', inline(raw)).result;
    assert.equal(record.status, 'PRESERVED_SOURCE'); assert.equal(record.inspection.reason, 'HISTORICAL_SOURCE');
    assert.equal(record.inspection.schemaValidation, 'NOT_EVALUATED'); assert.equal(record.inspection.valid, false);
    assert.deepEqual(record.inspection.structuralIssues, []); assert.equal(record.authority, false);
    assert.equal(record.observed.id, document.metadata?.id ?? document.id ?? null);
    assert.equal(record.observed.version, document.metadata?.version ?? document.version ?? null);
    assert.equal(record.observed.lifecycle, document.metadata?.lifecycle ?? document.lifecycle ?? null);
    assert.equal(record.observed.status, document.metadata?.status ?? document.status ?? null);
    const inspected = read(service, 'source.inspect', { sourceId: record.sourceId });
    assert.equal(inspected.raw, raw); assert.deepEqual(inspected.document, document);
    for (const label of [{ producer: 'ontology' }, { product: 'ontology' }, { kind: 'OntologyPack' }]) {
      const foreign = write(service, 'legacy.import', inline(JSON.stringify({ ...document, ...label }))).result;
      assert.equal(foreign.status, 'QUARANTINED'); assert.equal(foreign.inspection.reason, 'FOREIGN_PRODUCER');
    }
  }
  for (const document of malformedFixtures()) {
    const record = write(service, 'legacy.import', inline(JSON.stringify(document))).result;
    assert.equal(record.status, 'QUARANTINED'); assert(record.inspection.structuralIssues.length > 0);
  }
  const yaml = 'apiVersion: harness.evopilot.io/v3\nkind: HarnessProfile\nmetadata:\n  id: retained\n  version: old\n  lifecycle: draft\n';
  const imported = write(service, 'legacy.import', inline(yaml, { format: 'yaml' })).result;
  assert.equal(imported.status, 'PRESERVED_SOURCE');
  assert.equal(read(service, 'source.inspect', { sourceId: imported.sourceId }).raw, yaml);
  for (const [raw, format] of [['{', 'json'], ['kind: [', 'yaml'], ['id: a\nid: b', 'yaml']]) {
    assert.throws(() => write(service, 'legacy.import', inline(raw, { format })), { code: 'INVALID_SOURCE' });
  }
  assert.deepEqual(read(service, 'asset.list'), []);
});

function historicalFixtures() {
  return [
    ...['HarnessBundle', 'HarnessProfile', 'HarnessComponent', 'AssetDeltaProposal'].map(kind => ({
      kind, apiVersion: 'harness.evopilot.io/v3', metadata: { id: 'old', version: 'original', lifecycle: 'active', status: 'approved' },
      history: [{ approval: 'historical' }],
    })),
    { schema: 'evopilot-harness-template/v1', id: 'old', version: 'original', lifecycle: 'active' },
    { schema: 'evopilot-harness-export/v1', adapter: 'evopilot', sourceAsset: { id: 'old', version: 'original' }, mapping: { legacyHarnessId: 'old', templatePath: './template.yaml' } },
    { schema: 'evopilot-harness-catalog/v3', catalogId: 'old-catalog', entries: [], entryCount: 0 },
    { schema: 'evopilot-harness-catalog/v3', id: 'old-catalog', lifecycle: 'active', source: './assets', sourceDigest: 'sha256:' + 'a'.repeat(64) },
  ];
}
function malformedFixtures() {
  const docs = historicalFixtures(), exp = docs[5], lock = docs[6], config = docs[7];
  return [
    { ...docs[0], metadata: [] }, { ...docs[0], metadata: { id: 'old', version: 1 } },
    { ...docs[4], id: null }, { ...docs[4], version: [] },
    ...[null, [], 'asset', { id: 1, version: 'old' }, { id: 'old' }, { id: 'old', version: 'v', digest: 2 }].map(sourceAsset => ({ ...exp, sourceAsset })),
    { ...exp, adapter: {} }, { ...exp, mapping: [] },
    ...[null, 1, {}, ''].map(catalogId => ({ ...lock, catalogId })),
    ...[null, {}, 'entries'].map(entries => ({ ...lock, entries })),
    { schema: lock.schema, catalogId: 'missing-entries' },
    { ...config, source: [] }, { ...config, sourceDigest: null }, { ...config, lifecycle: 1 },
    { schema: exp.schema, metadata: { id: 'invented', version: 'invented' } },
    { schema: lock.schema, metadata: { id: 'invented', version: 'invented' } },
  ];
}

test('explicit reinspection repairs synthetic prior SQLite classification through public service', t => {
  const { service, options } = setup(t);
  const packaged = listPublicSources().sources.find(s => s.observed.schema === 'evopilot-harness-export/v1');
  const originals = [
    write(service, 'source.install', { sourcePath: packaged.sourcePath }).result,
    ...historicalFixtures().slice(5).map(doc => write(service, 'legacy.import', inline(JSON.stringify(doc))).result),
  ];
  const db = new DatabaseSync(join(options.workspaceRoot, 'state/harness/harness.db'));
  t.after(() => db.close());
  // Synthetic test workspace only: recreate the prior classifier's persisted result.
  const state = JSON.parse(db.prepare('SELECT data FROM state WHERE singleton = 1').get().data);
  for (const source of state.sources) {
    source.inspection.structuralIssues = ['MISSING_OR_INVALID_ID', 'MISSING_OR_INVALID_VERSION'];
    source.status = 'QUARANTINED';
    delete source.observed.catalogId; // Old observations must not be rewritten.
  }
  db.prepare('UPDATE state SET data = ? WHERE singleton = 1').run(JSON.stringify(state));
  for (const original of originals) {
    const before = read(service, 'source.inspect', { sourceId: original.sourceId });
    const input = { sourceId: before.sourceId, expectedInspectionDigest: sha256(before.inspection) };
    const revision = read(service, 'workspace.inspect').revision;
    assert.throws(() => write(service, 'source.reinspect', { ...input, expectedInspectionDigest: sha256('wrong') }), { code: 'INSPECTION_CONFLICT' });
    assert.throws(() => write(service, 'source.reinspect', input, { ...scope, projectId: 'other' }), { code: 'NOT_FOUND' });
    assert.equal(read(service, 'workspace.inspect').revision, revision);
    const receipt = write(service, 'source.reinspect', input), result = receipt.result;
    assert.equal(result.status, 'PRESERVED_SOURCE'); assert.equal(result.authority, false);
    assert.equal(result.sourceId, before.sourceId); assert.equal(result.rawDigest, before.rawDigest);
    assert.deepEqual(result.observed, before.observed); assert.deepEqual(result.document, before.document);
    assert.equal(read(service, 'source.inspect', { sourceId: result.sourceId }).raw, before.raw);
    assert.equal(result.inspectionHistory.length, 1);
    const history = result.inspectionHistory[0];
    assert.deepEqual(history.before, { inspection: before.inspection, status: before.status });
    assert.deepEqual(history.after, { inspection: result.inspection, status: result.status });
    assert.equal(history.beforeInspectionDigest, input.expectedInspectionDigest);
    assert.equal(history.afterInspectionDigest, sha256(result.inspection));
    assert.equal(history.uid, process.getuid()); assert.equal(history.requestId, receipt.requestId);
    assert.equal(new Date(history.time).toISOString(), history.time);
    assert.equal(result.inspection.reason, original.inspection.reason);
    assert.deepEqual(service.execute({ operation: 'source.reinspect', input, scope, requestId: receipt.requestId, expectedRevision: 0 }), receipt);
    assert.throws(() => write(service, 'source.reinspect', input), { code: 'INSPECTION_CONFLICT' });
    const repeat = write(service, 'source.reinspect', { ...input, expectedInspectionDigest: sha256(result.inspection) });
    assert.deepEqual(repeat.result, result);
    assert.deepEqual(read(service, 'receipt.inspect', { requestId: repeat.requestId }), repeat);
    const audit = db.prepare('SELECT * FROM audit WHERE revision = ?').get(receipt.revision);
    assert.equal(audit.operation, 'source.reinspect'); assert.equal(audit.uid, process.getuid());
    assert.equal(audit.result_digest, sha256(result));
  }
  const target = originals[0];
  writeFileSync(join(options.workspaceRoot, 'public/harness/sources', target.rawDigest.slice(7) + '.raw'), 'tampered');
  const current = state.sources[0];
  assert.throws(() => write(service, 'source.reinspect', { sourceId: current.sourceId, expectedInspectionDigest: sha256(current.inspection) }), { code: 'CORRUPT_BLOB' });
});

test('in-memory reinspection preserves archive bytes, quarantine and bounded history', () => {
  const state = { sources: [] }, blobs = new Map();
  const store = {
    uid: process.getuid(),
    rawBlob(scope, raw) { blobs.set('sha256:' + createHash('sha256').update(raw).digest('hex'), raw); },
    verifyRawBlob(scope, digest) {
      const raw = blobs.get(digest);
      if ('sha256:' + createHash('sha256').update(raw).digest('hex') !== digest) throw Object.assign(new Error('tampered'), { code: 'CORRUPT_BLOB' });
      return raw;
    },
  };
  const run = (operation, input, selected = scope) => operateImport(store, state, { operation, input, scope: selected, requestId: 'memory-reinspect' });
  const reinspect = source => run('source.reinspect', { sourceId: source.sourceId, expectedInspectionDigest: sha256(source.inspection) });
  for (const entry of listPublicSources().sources) {
    const record = run('source.install', { sourcePath: entry.sourcePath });
    assert.equal(record.status, 'PRESERVED_SOURCE');
    assert.equal(run('source.inspect', { sourceId: record.sourceId }).raw, blobs.get(record.rawDigest));
    if (entry.observed.schema === 'evopilot-harness-export/v1') {
      record.inspection.structuralIssues = ['MISSING_OR_INVALID_ID', 'MISSING_OR_INVALID_VERSION'];
      record.status = 'QUARANTINED';
      const before = structuredClone(record);
      const result = reinspect(record);
      assert.equal(result.status, 'PRESERVED_SOURCE'); assert.equal(result.inspection.reason, 'PINNED_ARCHIVE');
      assert.deepEqual(result.inspectionHistory[0].before.inspection, before.inspection);
      assert.deepEqual(result.observed, before.observed); assert.equal(result.rawDigest, before.rawDigest);
      assert.equal(reinspect(result).inspectionHistory.length, 1);
      assert.throws(() => run('source.reinspect', { sourceId: record.sourceId, expectedInspectionDigest: sha256(before.inspection) }), { code: 'INSPECTION_CONFLICT' });
      assert.throws(() => run('source.reinspect', { sourceId: record.sourceId, expectedInspectionDigest: sha256(record.inspection) }, { ...scope, projectId: 'other' }), { code: 'NOT_FOUND' });
    }
  }
  const packaged = listPublicSources().sources.find(s => s.observed.schema === 'evopilot-harness-export/v1');
  for (const [doc, extra] of [
    [{ schema: 'unknown/v1' }, {}],
    [historicalFixtures()[5], { sourceRevision: 'not-the-pin' }],
    [historicalFixtures()[5], { sourceVisibility: 'private' }],
  ]) {
    const selected = extra.sourceVisibility === 'private' ? { ...scope, visibility: 'private' } : scope;
    const record = run('legacy.import', inline(JSON.stringify(doc), { sourceLocator: packaged.sourcePath, sourceRevision: packaged.sourceCommit, ...extra }), selected);
    const result = run('source.reinspect', { sourceId: record.sourceId, expectedInspectionDigest: sha256(record.inspection) }, selected);
    assert.notEqual(result.inspection.reason, 'PINNED_ARCHIVE'); assert.equal(result.inspection.valid, false);
    assert.equal(result.authority, false);
  }
  const unsupported = run('legacy.import', inline(JSON.stringify(historicalFixtures()[5]), { sourceRevision: 'unsupported-prior' }));
  unsupported.status = 'QUARANTINED';
  unsupported.inspection.reason = 'UNKNOWN_SCHEMA';
  assert.throws(() => reinspect(unsupported), { code: 'REINSPECTION_NOT_REPAIRABLE' });
  for (const doc of [...malformedFixtures(), { kind: 'Unknown' }, { kind: 'OntologyPack' }]) {
    const record = run('legacy.import', inline(JSON.stringify(doc)));
    assert.equal(reinspect(record).status, 'QUARANTINED');
  }
  for (const doc of historicalFixtures().slice(5)) {
    const record = run('legacy.import', inline(JSON.stringify(doc)));
    record.inspection.structuralIssues = ['MISSING_OR_INVALID_ID', 'MISSING_OR_INVALID_VERSION'];
    record.status = 'QUARANTINED';
    const before = structuredClone(record);
    assert.equal(reinspect(record).status, 'PRESERVED_SOURCE');
    assert.deepEqual(record.observed, before.observed); assert.equal(record.authority, false);
    record.inspectionHistory = Array.from({ length: 16 }, () => structuredClone(record.inspectionHistory[0]));
    record.inspection.structuralIssues = before.inspection.structuralIssues;
    record.status = 'QUARANTINED';
    assert.throws(() => reinspect(record), { code: 'LIMIT' });
    assert.equal(record.inspectionHistory.length, 16);
    assert.equal(record.status, 'QUARANTINED');
  }
  const record = state.sources[0], originalId = record.sourceId;
  record.sourceId = sha256('wrong');
  assert.throws(() => reinspect(record), { code: 'CORRUPT_STATE' });
  record.sourceId = originalId;
  const document = record.document;
  record.document = {};
  assert.throws(() => reinspect(record), { code: 'CORRUPT_STATE' });
  record.document = document;
  blobs.set(record.rawDigest, 'tampered');
  assert.throws(() => reinspect(record), { code: 'CORRUPT_BLOB' });
});
