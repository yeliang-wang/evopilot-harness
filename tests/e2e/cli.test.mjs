import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { operations, mutations } from '../../dist/operations.js';
import { NATIVE_OPERATIONS } from '../../dist/native-service.js';
import { LIMITS } from '../../dist/state.js';

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const scope = { visibility: 'public', projectId: 'alpha' };
const asset = JSON.parse(readFileSync(new URL('../../examples/synthetic-harnesses.json', import.meta.url)))[0].asset;
const read = (operation, input = {}, selected = scope) => ({ operation, scope: selected, input });
const put = { ...read('asset.put', { asset }), requestId: 'first', expectedRevision: 0 };
function invoke(args, input = '', status = 0, flags = []) {
  const child = spawnSync(process.execPath, [...flags, cli, ...args], {
    input: typeof input === 'string' || Buffer.isBuffer(input) ? input : JSON.stringify(input),
    encoding: 'utf8', maxBuffer: 4 * LIMITS.requestBytes,
    env: { ...process.env, NODE_OPTIONS: '', OPENSSL_CONF: '/dev/null' },
  });
  assert.ifError(child.error);
  assert.equal(child.status, status, child.stderr + child.stdout);
  const envelope = JSON.parse(child.stdout);
  assert.equal(envelope.ok, status === 0);
  assert.equal(envelope.authority, false);
  assert.deepEqual(Object.keys(envelope).sort(), (status === 0 ? ['ok', 'product', 'version', 'result', 'authority'] : ['ok', 'error', 'authority']).sort());
  if (status === 0) { assert.equal(envelope.product, 'harness'); assert.equal(envelope.version, '0.3.0'); }
  return status === 0 ? envelope.result : envelope.error;
}
function setup(t) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'harness-cli-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const workspace = join(parent, 'workspace');
  const args = ['request', '--workspace', workspace, '--workspace-id', 'cli-test'];
  return { parent, workspace, args, request: (value, status = 0) => invoke(args, value, status) };
}

test('CLI discovery/help/version run without write permission or workspace', () => {
  const flags = ['--permission', '--allow-fs-read=' + root];
  const capabilities = invoke(['capabilities'], '', 0, flags);
  assert.deepEqual(capabilities.operations, [...operations.filter(op => !mutations.includes(op)), ...NATIVE_OPERATIONS]);
  assert.equal(capabilities.providers.resolveOntology, false);
  assert(capabilities.historicalOperationsReadOnly);
  for (const command of ['help', '--help', 'version', '--version']) invoke([command], '', 0, flags);
  for (const args of [[], ['unknown'], ['help', 'extra'], ['capabilities', '--workspace', '/unused'], ['request'], ['request', '--workspace', 'relative', '--workspace-id', 'test']]) {
    assert.equal(invoke(args, '', 2, flags).code, 'USAGE');
  }
});

test('CLI rejects malformed/bounded input and strict flags before initialization', () => {
  const workspace = join(root, 'invalid-input-must-not-create');
  const args = ['request', '--workspace', workspace, '--workspace-id', 'cli-test'];
  for (const value of ['{secret-value', '{}{}', 'null', '{}', ' '.repeat(LIMITS.requestBytes + 1), Buffer.from([0xff]), { ...read('workspace.inspect'), scope: { visibility: 'unknown', projectId: 'alpha' } }, read('shell.execute')]) {
    const error = invoke(args, value, 2);
    assert(!JSON.stringify(error).includes('secret-value'));
    assert.equal(existsSync(workspace), false);
  }
  for (const suffix of [['--unknown', 'value'], ['--workspace-id', 'duplicate'], ['--request-file'], ['extra'], ['--request-file', 'relative.json']]) {
    assert.equal(invoke([...args, ...suffix], put, 2).code, 'USAGE');
    assert.equal(existsSync(workspace), false);
  }
});

test('CLI rejects retired JSON writes without creating assets or new receipts', t => {
  const { request } = setup(t);
  assert.equal(request(put,1).code,'HISTORICAL_READ_ONLY');
  assert.equal(request(read('workspace.inspect')).revision,0);
  assert.deepEqual(request(read('asset.list')),[]);
  assert.equal(request(read('receipt.inspect',{requestId:'first'}),1).code,'NOT_FOUND');
});

test('CLI explicit file accepts regular JSON and rejects missing/directory/symlink/oversize files', t => {
  const { parent, workspace, args } = setup(t);
  const file = join(parent, 'request.json'), link = join(parent, 'linked.json');
  writeFileSync(file, '{bad-secret'); symlinkSync(file, link);
  for (const candidate of [join(parent, 'missing'), parent, link]) {
    assert.equal(invoke([...args, '--request-file', candidate], '', 2).code, 'INPUT_FILE');
    assert.equal(existsSync(workspace), false);
  }
  assert.equal(invoke([...args, '--request-file', file], '', 2).code, 'INVALID_REQUEST');
  assert.equal(existsSync(workspace), false);
  writeFileSync(file, ' '.repeat(LIMITS.requestBytes + 1));
  assert.equal(invoke([...args, '--request-file', file], '', 2).code, 'LIMIT');
  assert.equal(existsSync(workspace), false);
  writeFileSync(file, JSON.stringify(read('workspace.inspect')));
  assert.equal(invoke([...args, '--request-file', file], 'ignored malformed stdin').revision, 0);
  const bin = join(parent, 'evopilot-next-harness'); symlinkSync(cli, bin);
  const child = spawnSync(process.execPath, [bin, 'version'], { encoding: 'utf8', env: { ...process.env, OPENSSL_CONF: '/dev/null', NODE_OPTIONS: '' } });
  assert.equal(child.status, 0, child.stderr); assert.equal(JSON.parse(child.stdout).ok, true);
});

test('CLI source mutation and publication paths cannot bypass historical read-only mode', t => {
  const {request}=setup(t);
  for (const operation of ['asset.review','asset.publish']) assert.equal(request({...read(operation,{id:asset.id,version:asset.version}),requestId:operation.replace('.','-'),expectedRevision:0},1).code,'HISTORICAL_READ_ONLY');
  assert.equal(request({...read('legacy.import',{raw:'{}',format:'json',sourceLocator:'synthetic:test',sourceRevision:'1',sourceVisibility:'public'}),requestId:'source',expectedRevision:0},1).code,'HISTORICAL_READ_ONLY');
  assert.deepEqual(request(read('source.list')),[]);
});
