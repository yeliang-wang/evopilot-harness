interface ArchiveDocument { [key: string]: unknown; kind?: unknown; schema?: unknown; apiVersion?: unknown; id?: unknown; version?: unknown; digest?: unknown; metadata?: { id?: unknown; version?: unknown; digest?: unknown } }
interface Archive { schema: string; version: number; owner: string; sourceCommit: string; entries: Record<string, { raw: string; bytes: number; sha256: string; classification: string; observed: ReturnType<typeof identity> }> }
export interface PublicSourceReport { schema: string; status: string; owner: string; sourcePath: string; sourceCommit: string; classification: string; observed: ReturnType<typeof identity>; sourceReference: ReturnType<typeof identity> & { sourcePath: string; sourceCommit: string; rawDigest: string }; sha256: string; bytes: number; raw: string; document: ArchiveDocument; authority: boolean; businessConfirmed: boolean; released: boolean }
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';

const OWNER: string = 'harness';
const COMMIT = '372733fd7b67ec3bee9efe6322f0229db77b160d';
const ARCHIVE_HASH = 'feb8df8a9588e043dc8c3e4b398b82626b57c55b8448592a9c477dbf4b6cefd4';
const MAPPING = [["HarnessBundle",null,"harness.evopilot.io/v3","harness","definition"],["HarnessComponent",null,"harness.evopilot.io/v3","harness","definition"],["HarnessProfile",null,"harness.evopilot.io/v3","harness","definition"],[null,"evopilot-harness-template/v1",null,"harness","template"],[null,"evopilot-harness-template/v2",null,"harness","template"],[null,"evopilot-harness-export/v1",null,"harness","export-mapping"],[null,"evopilot-selected-harness-example/v1",null,"harness","binding-example"],["DomainHarnessPack",null,"semantics.evopilot.io/v1","harness","guidance"],["AdvisorPolicyPack",null,"harness.evopilot.io/v1","harness","policy"],["ComparisonPolicyPack",null,"comparison.evopilot.io/v1","harness","policy"],["ProfessionalCompletenessPolicyPack",null,"learning.evopilot.io/v1","harness","policy"],["MatchPolicyPack",null,"harness.evopilot.io/v1","harness","policy"],["HarnessAsset",null,"evopilot.dev/v2","harness","definition"]];
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const authority = { authority: false, businessConfirmed: false, released: false };
function identity(d: ArchiveDocument) {
  return { kind: d.kind ?? null, schema: d.schema ?? null, apiVersion: d.apiVersion ?? null,
    id: d.metadata?.id ?? d.id ?? null, version: d.metadata?.version ?? d.version ?? null,
    digest: d.metadata?.digest ?? d.digest ?? null };
}

function freeze<T>(value: T, seen = new Set<unknown>()): T {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) freeze(child, seen);
    Object.freeze(value);
  }
  return value;
}
function sourceKey(key: unknown): key is string {
  return typeof key === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9/_.@-]*\.yaml$/.test(key)
    && !key.split('/').some(part => !part || part === '.' || part === '..');
}
function parse(raw: string): ArchiveDocument {
  const yaml = parseDocument(raw, { uniqueKeys: true, schema: 'core', customTags: [] });
  if (yaml.errors.length || yaml.warnings.length) throw new TypeError('Invalid preserved YAML');
  const document = yaml.toJS({ maxAliasCount: 100 });
  // Reject cycles and non-JSON values; the report is a JSON data object.
  const json = JSON.stringify(document, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Non-JSON YAML');
    return value;
  });
  if (!document || Array.isArray(document) || typeof document !== 'object') throw new TypeError('Expected YAML mapping');
  return JSON.parse(json);
}
function load() {
  // The pinned whole-file hash also rejects duplicate JSON keys before JSON.parse.
  // Read on every access so changes after an earlier successful read fail closed.
  const bytes = readFileSync(new URL('../assets/legacy-sources.json', import.meta.url));
  if (hash(bytes) !== ARCHIVE_HASH) throw new TypeError('Public source archive integrity failure');
  const archive = JSON.parse(bytes.toString('utf8')) as Archive;
  if (archive.schema !== 'evopilot-public-source-archive/v1' || archive.version !== 1
    || archive.owner !== OWNER || archive.sourceCommit !== COMMIT
    || Object.keys(archive.entries).length !== 101) throw new TypeError('Invalid archive ownership');
  const reports: Record<string, PublicSourceReport> = {};
  for (const [sourcePath, entry] of Object.entries(archive.entries)) {
    if (!sourceKey(sourcePath) || Object.hasOwn(reports, sourcePath)
      || typeof entry.raw !== 'string' || Buffer.byteLength(entry.raw, 'utf8') !== entry.bytes
      || hash(entry.raw) !== entry.sha256) throw new TypeError('Invalid source integrity');
    const document = parse(entry.raw), observed = identity(document);
    const mapping = MAPPING.find(row => row[0] === observed.kind && row[1] === observed.schema && row[2] === observed.apiVersion);
    if (!mapping || mapping[3] !== OWNER || mapping[4] !== entry.classification
      || JSON.stringify(observed) !== JSON.stringify(entry.observed)
      || OWNER === 'ontology' && !sourcePath.startsWith('ontology/')) throw new TypeError('Invalid source classification or identity');
    reports[sourcePath] = freeze({ schema: 'evopilot-preserved-public-source-report/v1',
      status: 'PRESERVED_SOURCE', owner: OWNER, sourcePath, sourceCommit: COMMIT,
      classification: entry.classification, observed,
      sourceReference: { sourcePath, sourceCommit: COMMIT, ...observed, rawDigest: 'sha256:' + entry.sha256 },
      sha256: entry.sha256, bytes: entry.bytes, raw: entry.raw, document, ...authority });
  }
  return reports;
}

/** Enumerate only this package's preserved sources; no native asset validation is implied. */
export function listPublicSources() {
  const reports = load();
  return freeze({ schema: 'evopilot-preserved-public-source-list/v1', status: 'PRESERVED_SOURCE',
    owner: OWNER, sourceCommit: COMMIT, count: Object.keys(reports).length,
    sources: Object.values(reports).map(({ raw, document, ...summary }) => summary), ...authority });
}

/** Exact manifest key lookup. Archived paths, bindings and recipes are never resolved or executed. */
export function readPublicSource(sourcePath: string) {
  if (!sourceKey(sourcePath)) throw new TypeError('Unknown public source key');
  const reports = load();
  if (!Object.hasOwn(reports, sourcePath)) throw new TypeError('Unknown public source key');
  return reports[sourcePath];
}

