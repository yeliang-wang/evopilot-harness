import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listPublicSources, readPublicSource } from '@evopilot-next/harness/sources';

const root = new URL('../../', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
function frozen(value) {
  if (value && typeof value === 'object') {
    assert(Object.isFrozen(value));
    for (const child of Object.values(value)) frozen(child);
  }
}
test('complete deterministic owned inventory preserves exact bytes and no authority', () => {
  const list = listPublicSources();
  assert.equal(list.count, 101);
  assert.equal(list.status, 'PRESERVED_SOURCE');
  assert.deepEqual(list, listPublicSources());
  frozen(list);
  const archive = JSON.parse(readFileSync(new URL('assets/legacy-sources.json', root)));
  const provenance = JSON.parse(readFileSync(new URL('provenance/public-assets.json', root)));
  assert.equal(provenance.destinationSha256, hash(readFileSync(new URL('assets/legacy-sources.json', root))));
  assert.equal(new Set(list.sources.map(s => s.sourcePath)).size, list.count);
  for (const summary of list.sources) {
    const report = readPublicSource(summary.sourcePath);
    frozen(report);
    assert.deepEqual(report, readPublicSource(summary.sourcePath));
    assert.equal(report.owner, 'harness');
    for (const key of ['authority', 'businessConfirmed', 'released']) assert.equal(report[key], false);
    assert.equal(report.status, 'PRESERVED_SOURCE');
    assert.equal(hash(report.raw), summary.sha256);
    assert.equal(Buffer.byteLength(report.raw), summary.bytes);
    assert.equal(report.raw, archive.entries[summary.sourcePath].raw);
    assert.equal(summary.sha256, provenance.sources[summary.sourcePath].sha256);
    assert.equal(report.observed.kind, report.document.kind ?? null);
    assert.equal(report.observed.version, report.document.metadata?.version ?? report.document.version ?? null);
    assert.equal(report.sourceReference.digest, report.document.metadata?.digest ?? report.document.digest ?? null);
    assert.doesNotMatch(report.raw, /\/Users\/|\/home\/|\.env\b|BEGIN (?:RSA )?PRIVATE KEY/);
    assert.equal(Object.hasOwn(report, 'specVersion'), false);
  }
});
test('known original hashes and owner boundary', () => {
  assert.equal(readPublicSource('assets/v3/bundles/api-gateway/2.3.0/asset.yaml').sha256, 'ad6349ab7512e83050c3a26460a99ad7fa05d5f70959fa2ff5082953d0da64d0');
  assert.equal(readPublicSource('ontology/examples/example-finance-harness-guidance.yaml').classification, 'guidance');
  assert.equal(readPublicSource('harnesses/api-gateway-harness/template.yaml').classification, 'template');
  assert.equal(readPublicSource('harnesses/api-gateway-harness/examples/selected-harness-binding.yaml').observed.version, null);
  assert.throws(() => readPublicSource('ontology/builtin/software-engineering.yaml'));
});
test('only exact own keys and bounded public exports', async () => {
  for (const key of ['../manifest.yaml', '/etc/passwd', 'a/../b.yaml', 'a//b.yaml', 'a/./b.yaml', 'file:///x.yaml', '__proto__', 'constructor', 'unknown.yaml', '', null, {}, 'a\\\\b.yaml']) {
    assert.throws(() => readPublicSource(key), TypeError);
  }
  const api = await import('@evopilot-next/harness/sources');
  assert.deepEqual(Object.keys(api).sort(), ['listPublicSources', 'readPublicSource']);
  const main = await import('@evopilot-next/harness');
  assert.equal(main.readPublicSource, undefined);
  assert.equal(main.listPublicSources, undefined);
  await assert.rejects(import('@evopilot-next/harness/assets/legacy-sources.json'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});
test('isolated real archive tampering fails closed, including after successful access', async t => {
  let directory;
  try { directory = mkdtempSync(join(tmpdir(), 'public-source-test-')); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ERR_ACCESS_DENIED'].includes(error.code)) { t.skip('Sandbox denies temporary writes; run in independent verification'); return; }
    throw error;
  }
  try {
    mkdirSync(join(directory, 'src'));
    mkdirSync(join(directory, 'assets'));
    mkdirSync(join(directory, 'node_modules'));
    cpSync(new URL('src/asset-sources.mjs', root), join(directory, 'src/asset-sources.mjs'));
    cpSync(new URL('node_modules/yaml', root), join(directory, 'node_modules/yaml'), { recursive: true });
    const original = readFileSync(new URL('assets/legacy-sources.json', root), 'utf8');
    const target = join(directory, 'assets/legacy-sources.json');
    writeFileSync(target, original);
    const isolated = await import(pathToFileURL(join(directory, 'src/asset-sources.mjs')).href);
    assert.equal(isolated.listPublicSources().count, 101);
    const mutations = [
      a => { a.owner = 'foreign'; },
      a => { delete a.entries[Object.keys(a.entries)[0]]; },
      a => { a.entries[Object.keys(a.entries)[0]].raw += '\\n'; },
      a => { a.entries[Object.keys(a.entries)[0]].classification = 'unknown'; },
      a => { a.entries[Object.keys(a.entries)[0]].observed.version = 'invented'; },
      a => { const e = a.entries[Object.keys(a.entries)[0]]; e.raw = 'x: 1\\nx: 2\\n'; e.sha256 = hash(e.raw); e.bytes = Buffer.byteLength(e.raw); },
      a => { const e = a.entries[Object.keys(a.entries)[0]]; e.raw = 'x: !!js/function foo\\n'; e.sha256 = hash(e.raw); e.bytes = Buffer.byteLength(e.raw); },
    ];
    for (const mutate of mutations) {
      const archive = JSON.parse(original); mutate(archive);
      writeFileSync(target, JSON.stringify(archive));
      assert.throws(() => isolated.listPublicSources(), /integrity/);
      assert.throws(() => isolated.readPublicSource(listPublicSources().sources[0].sourcePath), /integrity/);
    }
    writeFileSync(target, original.replace('"version": 1', '"version": 1, "version": 1'));
    assert.throws(() => isolated.listPublicSources(), /integrity/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

