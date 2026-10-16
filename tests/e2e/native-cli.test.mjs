import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticHarnessPackage } from '../../examples/native/package.mjs';
const scope = { visibility: 'private', projectId: 'synthetic' };
test('C01/H01: public CLI performs native validation and publication with pinned tools', () => {
  assert(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN, 'Verified native toolchain required');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'harness-native-cli-')));
  try {
    const args = [fileURLToPath(new URL('../../dist/cli.js', import.meta.url)), 'request', '--workspace', join(root, 'workspace'), '--workspace-id', 'cli', '--toolchain', process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN];
    const call = request => { const p = spawnSync(process.execPath, args, { input: JSON.stringify(request), encoding: 'utf8' }); assert.ifError(p.error); return { exit: p.status, output: JSON.parse(p.stdout) }; };
    let revision = 0;
    const write = (operation, input, requestId) => { const r = call({ operation, scope, input, requestId, expectedRevision: revision }); assert.equal(r.exit, 0, JSON.stringify(r.output)); revision = r.output.result.revision; return r.output.result.result; };
    const pkg = syntheticHarnessPackage(), id = { id: pkg.manifest.id, version: pkg.manifest.version };
    write('native.package.put', { package: pkg }, 'put');
    const valid = write('native.package.validate', id, 'validate');
    assert.equal(valid.qualityStatus, 'PASS'); assert.equal(valid.executionStatus, 'SUCCEEDED');
    const review = write('native.package.review', id, 'review');
    write('native.package.decide', { ...id, reviewDigest: review.reviewDigest, decision: 'APPROVE', humanEvidenceRef: 'synthetic-cli-decision' }, 'decide');
    assert.equal(write('native.package.publish', id, 'publish').published, true);
    assert.equal(call({ operation: 'native.package.readback', scope, input: id }).exit, 0);
    const retired = call({ operation: 'asset.put', scope, input: { asset: {} }, requestId: 'old', expectedRevision: revision });
    assert.equal(retired.exit, 1); assert.equal(retired.output.error.code, 'HISTORICAL_READ_ONLY');
    assert.notEqual(call({ operation: 'native.package.inspect', scope, input: { ...id, executable: '/forbidden' } }).exit, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
