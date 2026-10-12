#!/usr/bin/env node
import { constants, realpathSync } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT, VERSION } from './index.mjs';
import { createHarnessService } from './service.mjs';
import { operations, validateRequest } from './operations.mjs';
import { bounded, fail, LIMITS, slug } from './state.mjs';

const serviceCodes = new Set(('CLOSED NOT_INITIALIZED REQUEST_CONFLICT CORRUPT_STATE REVISION_CONFLICT NOT_FOUND LIMIT INVALID_ENCODING INVALID_FORMAT INVALID_SOURCE CORRUPT_BLOB INSPECTION_CONFLICT REINSPECTION_NOT_REPAIRABLE UNKNOWN_SOURCE INVALID_REQUEST SCOPE_MISMATCH GRAPH_LIMIT DEPENDENCY_CYCLE DEPENDENCY_MISMATCH UNAVAILABLE_DEPENDENCY DEPENDENCY_KIND UNSUPPORTED_OPERATION INVALID_MODEL IMMUTABLE_VERSION NOT_PUBLISHED REVIEW_REQUIRED REVIEW_MISMATCH APPROVAL_REQUIRED PENDING_MODEL INVALID_DELIVERY UNSAFE_WORKSPACE UNSUPPORTED_PLATFORM UNKNOWN_WORKSPACE IDENTITY_MISMATCH STATE_ERROR').split(' '));
const help = {
  usage: ['evopilot-next-harness capabilities', 'evopilot-next-harness help', 'evopilot-next-harness version', 'evopilot-next-harness request --workspace <canonicalAbsoluteRoot> --workspace-id <slug> [--request-file <absoluteJSONpath>]'],
  input: 'One bounded JSON request from stdin or the exact explicit regular file.',
  exitCodes: { success: 0, serviceFailure: 1, invalidInput: 2 },
};
function parseArgs(args) {
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) fail('USAGE', 'Invalid arguments');
  const [raw, ...rest] = args;
  const command = raw === '--help' ? 'help' : raw === '--version' ? 'version' : raw;
  if (['capabilities', 'help', 'version'].includes(command)) {
    if (rest.length) fail('USAGE', 'Unexpected arguments');
    return { command };
  }
  if (command !== 'request') fail('USAGE', 'Expected a supported command');
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i], value = rest[i + 1];
    if (!['--workspace', '--workspace-id', '--request-file'].includes(key) || Object.hasOwn(flags, key) || !value || value.startsWith('--')) fail('USAGE', 'Invalid request flags');
    flags[key] = value;
  }
  const root = flags['--workspace'];
  if (!root || !isAbsolute(root) || resolve(root) !== root || !flags['--workspace-id']) fail('USAGE', 'Explicit canonical workspace and workspace id required');
  slug(flags['--workspace-id']);
  const file = flags['--request-file'];
  if (file && !isAbsolute(file)) fail('USAGE', 'Absolute request file required');
  return { command, root, id: flags['--workspace-id'], file };
}
async function readInput(file, stdin) {
  const chunks = []; let size = 0;
  const add = chunk => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > LIMITS.requestBytes) fail('LIMIT', 'Request byte limit');
    chunks.push(bytes);
  };
  if (file) {
    let handle;
    try {
      const before = await lstat(file);
      if (!before.isFile() || before.isSymbolicLink()) fail('INPUT_FILE', 'Regular request file required');
      if (before.size > LIMITS.requestBytes) fail('LIMIT', 'Request byte limit');
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const actual = await handle.stat();
      if (!actual.isFile() || actual.dev !== before.dev || actual.ino !== before.ino) fail('INPUT_FILE', 'Request file changed');
      if (actual.size > LIMITS.requestBytes) fail('LIMIT', 'Request byte limit');
      while (true) {
        const buffer = Buffer.alloc(Math.min(65536, LIMITS.requestBytes + 1 - size));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        add(buffer.subarray(0, bytesRead));
      }
    } catch (error) {
      if (error.code === 'LIMIT') throw error;
      fail('INPUT_FILE', 'Cannot read regular request file');
    } finally { await handle?.close(); }
  } else {
    for await (const chunk of stdin) add(chunk);
  }
  const bytes = Buffer.concat(chunks), text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) fail('INVALID_ENCODING', 'Invalid UTF-8');
  let request;
  try { request = JSON.parse(text); } catch { fail('INVALID_REQUEST', 'Expected one JSON request'); }
  bounded(request);
  validateRequest(request);
  return request;
}

// Injected streams are trusted test/host code, never request-configurable providers.
export async function main(args, { stdin = process.stdin, stdout = process.stdout } = {}) {
  let response, exitCode = 0, executing = false;
  try {
    const parsed = parseArgs(args);
    let result;
    if (parsed.command === 'help') result = help;
    else if (parsed.command === 'version') result = { product: PRODUCT, version: VERSION };
    else if (parsed.command === 'capabilities') result = {
      product: PRODUCT, version: VERSION, stage: 'M2_STANDALONE_CLI', operations,
      limits: LIMITS, composedEvaluation: true, authority: false, softwareRelease: false,
      pending: ['M3 parent provider wiring', 'plugin/MCP', 'Expert', 'Host acceptance'],
      providers: { resolveOntology: false },
    };
    else {
      const request = await readInput(parsed.file, stdin);
      const service = createHarnessService({ workspaceRoot: parsed.root, workspaceId: parsed.id });
      try {
        executing = true;
        service.initialize();
        result = service.execute(request);
      } finally { service.close(); }
    }
    response = { ok: true, product: PRODUCT, version: VERSION, result, authority: false };
  } catch (error) {
    const code = ['USAGE', 'INPUT_FILE'].includes(error?.code) || serviceCodes.has(error?.code) ? error.code : executing ? 'STATE_ERROR' : 'INVALID_REQUEST';
    // Never echo exception messages, paths, parser excerpts or caller-controlled fields.
    const message = code === 'USAGE' ? 'Invalid command arguments; use help.'
      : code === 'INPUT_FILE' ? 'Cannot read a bounded regular request file.'
      : code === 'UNAVAILABLE_DEPENDENCY' ? 'Required published dependency or external Ontology provider unavailable.'
      : executing ? 'Harness service request failed.' : 'Invalid or oversized request input.';
    response = { ok: false, error: { code, message }, authority: false };
    exitCode = executing ? 1 : 2;
  }
  stdout.write(JSON.stringify(response) + '\n');
  return exitCode;
}

// Resolve the argv entry so an installed package-manager bin symlink also works.
function isEntry() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
}
if (isEntry()) process.exitCode = await main(process.argv.slice(2));
