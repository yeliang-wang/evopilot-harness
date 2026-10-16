import assert from 'node:assert/strict';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isBuiltin } from 'node:module';
import { spawnSync } from 'node:child_process';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PRODUCT = 'harness';
const PIN = 'df4f7246ae35ef9114e2b93663d520e7ff4f44f14f886ac8ba43e9fc080ddc9a';
const expected = {
  "name": "@evopilot-next/harness",
  "version": "0.3.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24.14.0"
  },
  "files": [
    "dist",
    "src",
    "vendor",
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CHANGELOG.md",
    "specifications",
    "examples",
    "assets",
    "docs",
    "provenance",
    "LICENSE",
    "NOTICE"
  ],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./sources": {
      "types": "./dist/asset-sources.d.ts",
      "import": "./dist/asset-sources.js"
    },
    "./service": {
      "types": "./dist/service.d.ts",
      "import": "./dist/service.js"
    }
  },
  "scripts": {
    "build": "node scripts/build.mjs",
    "check": "node scripts/check.mjs",
    "test": "node --test tests/e2e/*.test.mjs"
  },
  "dependencies": {
    "yaml": "2.9.0"
  },
  "devDependencies": {
    "typescript": "5.9.3",
    "@types/node": "24.19.2"
  }
};
expected.exports['./native'] = { types: './dist/native.d.ts', import: './dist/native.js' };
expected.exports['./workspace-migration'] = { types: './dist/workspace-migration.d.ts', import: './dist/workspace-migration.js' };
const specifiers = source => [...source.matchAll(/^[\t ]*(?:import\s+(?:(?:[\w$]+(?:\s*,\s*)?)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+)?\s*from\s*)?|export\s+(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s+from\s*)['"]([^'"]+)['"]/gm)].map(match => match[1]);

async function files(directory) {
  assert((await lstat(directory)).isDirectory(), 'Owned tree must be a regular directory');
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    assert(!entry.isSymbolicLink(), 'Symlink forbidden: ' + path);
    if (entry.isDirectory()) result.push(...await files(path));
    else { assert(entry.isFile()); result.push(path); }
  }
  return result;
}

export async function checkSource() {
  const typecheck = spawnSync(process.execPath, [resolve(ROOT, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: ROOT, encoding: 'utf8' });
  assert.ifError(typecheck.error); assert.equal(typecheck.status, 0, typecheck.stdout + typecheck.stderr);
  // Resolve consumer types through real compiled package exports; build first.
  const contracts = spawnSync(process.execPath, [resolve(ROOT, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2023', '--lib', 'ES2024', '--module', 'NodeNext', 'tests/types/contracts.ts'], { cwd: ROOT, encoding: 'utf8' });
  assert.ifError(contracts.error); assert.equal(contracts.status, 0, contracts.stdout + contracts.stderr);
  const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(pkg[key], value, key);
  for (const key of ['peerDependencies', 'optionalDependencies']) assert.deepEqual(pkg[key] ?? {}, {});
  assert.deepEqual(pkg.bin, { 'evopilot-next-harness': 'dist/cli.js' });
  const lock = JSON.parse(await readFile(resolve(ROOT, 'package-lock.json'), 'utf8'));
  assert.deepEqual(lock.packages[''].bin, pkg.bin);
  assert((await lstat(resolve(ROOT, 'dist/cli.js'))).mode & 0o111);
  assert((await readFile(resolve(ROOT, 'dist/cli.js'), 'utf8')).startsWith('#!/usr/bin/env node\n'));
  const vendor = resolve(ROOT, 'vendor/compatibility/v1');
  const manifest = JSON.parse(await readFile(resolve(vendor, 'manifest.json'), 'utf8'));
  assert.equal(manifest.contractRevision, '1.1.0');
  assert.equal(manifest.module,'native.mjs');
  assert.equal(manifest.legacyModule,'reference.mjs');
  assert.equal(manifest.legacySha256,PIN);
  assert.deepEqual(manifest.children,['projects/evopilot-runtime','projects/evopilot-harness','projects/evopilot-ontology']);
  for (const [name,digest] of Object.entries({...manifest.files,[manifest.module]:manifest.sha256,[manifest.legacyModule]:PIN})) {
    assert.match(digest,/^[a-f0-9]{64}$/);
    assert.equal(createHash('sha256').update(await readFile(resolve(vendor,name))).digest('hex'),digest);
  }
  const generatedRoot = resolve(vendor, 'toolchain');
  const generated = JSON.parse(await readFile(resolve(generatedRoot, 'manifest.json'), 'utf8'));
  assert.equal(generated.schema, 'evopilot-generated-toolchain/v1');
  for (const entry of generated.files) {
    assert(/^[a-zA-Z0-9_./-]+$/.test(entry.path) && !entry.path.split('/').includes('..'));
    assert.equal(createHash('sha256').update(await readFile(resolve(generatedRoot, entry.path))).digest('hex'), entry.sha256);
  }
  const sources = [...await files(resolve(ROOT, 'src')), ...await files(resolve(ROOT, 'vendor'))];
  for (const path of sources) {
    if (!path.endsWith('.mjs') && !path.endsWith('.ts') && !path.startsWith(generatedRoot + sep)) continue;
    if (path.startsWith(generatedRoot + sep) && !/\.(js|ts)$/.test(path)) continue;
    const source = await readFile(path, 'utf8');
    if (path.endsWith('.mjs') || path.endsWith('.js')) {
      const syntax = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      assert.ifError(syntax.error); assert.equal(syntax.status, 0, syntax.stderr);
    }
    assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(|\beval\s*\(|\/Users\/|\/home\/|EVOPILOT_HARNESS_HOME|defaultHarnessHome|\.evopilot-harness|\bprocess\s*(?:\.\s*(?:env|cwd|chdir)|\[)|\bglobalThis\s*(?:\.|\[)|\bm0\//);
    for (const specifier of specifiers(source.replace(/^import type[\s\S]*?;[\t ]*$/gm, ""))) {
      if (isBuiltin(specifier)) continue;
      if (specifier === 'yaml' && (path === resolve(ROOT, 'src/asset-sources.ts') || path === resolve(ROOT, 'src/import-operations.ts') || PRODUCT === 'ontology' && path.includes('/src/compat/'))) continue;
      if (PRODUCT === 'ontology' && path.includes('/src/compat/') && specifier === 'ajv/dist/2020.js') continue;
      assert(specifier.startsWith('.'), 'Undeclared import: ' + specifier);
      const resolved = resolve(dirname(path), specifier);
      const target = path.endsWith(".ts") && resolved.endsWith(".js") ? resolved.slice(0, -3) + ".ts" : resolved;
      assert(target.startsWith(resolve(ROOT, 'src') + sep) || path.startsWith(generatedRoot + sep) && target.startsWith(generatedRoot + sep) || [resolve(vendor,'reference.mjs'),resolve(vendor,'native.mjs')].includes(target), 'Foreign source import');
      assert((await lstat(target)).isFile(), 'Import must be an owned regular file');
    }
  }
  const code = [
    "import assert from 'node:assert/strict';",
    'const api = await import(' + JSON.stringify(pathToFileURL(resolve(ROOT, 'dist/index.js')).href) + ');',
    'assert.equal(api.PRODUCT, ' + JSON.stringify(PRODUCT) + ');',
    "assert.equal(api.VERSION, '0.3.0');",
    'assert.equal(api.capabilities().authority, false);',
    'assert.equal(api.capabilities().businessOperationsReady, true);',
    'const serviceAPI = await import(' + JSON.stringify(pathToFileURL(resolve(ROOT, 'dist/service.js')).href) + ');',
    'const service = serviceAPI.createHarnessService({workspaceRoot: ' + JSON.stringify(resolve(ROOT, 'discovery-must-not-create')) + ', workspaceId: "discovery"});',
    'assert.equal(service.capabilities().authority, false);',
    'assert.equal(service.capabilities().composedEvaluation, true);',
    'assert(service.capabilities().nativeOperations.includes("native.package.validate"));',
    'service.close();',
    'const cli = await import(' + JSON.stringify(pathToFileURL(resolve(ROOT, 'dist/cli.js')).href) + ');',
    'assert.equal(typeof cli.main, "function");',
  ].join('\n');
  const result = spawnSync(process.execPath, ['--permission', '--allow-fs-read=' + ROOT, '--input-type=module', '-e', code], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', OPENSSL_CONF: '/dev/null' },
  });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '', 'Read-only import must not execute CLI');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert.equal(process.argv.length, 2, 'Usage: node scripts/check.mjs');
    await checkSource();
    console.log(PRODUCT + ': strict TypeScript, compiled exports, owned sources and pinned vendor verified; no acceptance inferred');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

