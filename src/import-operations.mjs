import { parseDocument, visit } from 'yaml';
import { createHash } from 'node:crypto';
import { sha256, stableSerialize } from '../vendor/compatibility/v1/reference.mjs';
import { listPublicSources, readPublicSource } from './asset-sources.mjs';
import { bounded, fail, LIMITS } from './state.mjs';

export const importFields = Object.freeze({
  'source.install': ['sourcePath'], 'source.inspect': ['sourceId'], 'source.list': [],
  'source.reinspect': ['sourceId', 'expectedInspectionDigest'],
  'legacy.import': ['raw', 'format', 'sourceLocator', 'sourceRevision', 'sourceVisibility'],
});
export const importOperations = Object.freeze(Object.keys(importFields));
export const importMutations = Object.freeze(['source.install', 'legacy.import', 'source.reinspect']);
const origin = s => ({ sourceLocator: s.sourceLocator, sourceRevision: s.sourceRevision, sourceVisibility: s.sourceVisibility });
const sourceKey = s => sha256({ scope: s.scope, rawDigest: s.rawDigest, format: s.format, ...origin(s) });

function parseRaw(raw, format) {
  if (typeof raw !== 'string' || !raw.isWellFormed()) fail('INVALID_ENCODING', 'Source must be a well-formed UTF-8 string; caller retains original');
  if (Buffer.byteLength(raw) > LIMITS.requestBytes) fail('LIMIT', 'Source exceeds byte limit; caller retains original');
  if (!['json', 'yaml', 'text'].includes(format)) fail('INVALID_FORMAT', 'Source format must be json, yaml or text');
  let document;
  try {
    if (format === 'text') document = { text: raw };
    else if (format === 'json') document = JSON.parse(raw);
    else {
      const parsed = parseDocument(raw, { uniqueKeys: true, customTags: [] });
      if (parsed.errors.length || parsed.warnings.length) fail('INVALID_SOURCE', 'YAML errors or warnings');
      visit(parsed, (_key, node) => {
        if (node?.tag && !['tag:yaml.org,2002:str', 'tag:yaml.org,2002:int', 'tag:yaml.org,2002:float', 'tag:yaml.org,2002:bool', 'tag:yaml.org,2002:null', 'tag:yaml.org,2002:map', 'tag:yaml.org,2002:seq'].includes(node.tag)) fail('INVALID_SOURCE', 'Custom YAML tags forbidden');
      });
      document = parsed.toJS({ maxAliasCount: 100 });
    }
    bounded(document);
  } catch (e) {
    if (e.code === 'LIMIT') throw e;
    fail('INVALID_SOURCE', 'Malformed or unsafe source; caller retains original bytes');
  }
  return document;
}

function classify(document, format, packagedSource) {
  const foreign = ['OntologyPack', 'DomainOntologyPack', 'ProjectOntologyOverlay'].includes(document?.kind)
    || ['product', 'producer', 'schema', 'apiVersion', 'kind'].some(key => typeof document?.[key] === 'string' && /ontology/i.test(document[key]));
  const knownRecord = ['Catalog', 'HarnessCatalog', 'HarnessLock', 'HarnessProposal'].includes(document?.kind);
  const historical = document?.apiVersion === 'harness.evopilot.io/v3'
    && ['HarnessBundle', 'HarnessProfile', 'HarnessComponent', 'AssetDeltaProposal'].includes(document?.kind)
    || ['evopilot-harness-template/v1', 'evopilot-harness-export/v1', 'evopilot-harness-catalog/v3'].includes(document?.schema);
  const structuralIssues = [];
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const string = (parent, field, label = field) => {
    if (typeof parent?.[field] !== 'string' || !parent[field].trim()) structuralIssues.push('MISSING_OR_INVALID_' + label.toUpperCase());
  };
  if (historical) {
    if (document.apiVersion === 'harness.evopilot.io/v3') {
      if (!object(document.metadata)) structuralIssues.push('INVALID_IDENTITY_METADATA');
      for (const field of ['id', 'version']) string(document.metadata, field);
    } else if (document.schema === 'evopilot-harness-template/v1') {
      for (const field of ['id', 'version']) string(document, field);
    } else if (document.schema === 'evopilot-harness-export/v1') {
      if (!object(document.sourceAsset)) structuralIssues.push('INVALID_SOURCE_ASSET');
      for (const field of ['id', 'version']) string(document.sourceAsset, field, 'sourceAsset_' + field);
      for (const field of ['kind', 'digest', 'apiVersion']) {
        if (Object.hasOwn(document.sourceAsset ?? {}, field)) string(document.sourceAsset, field, 'sourceAsset_' + field);
      }
      string(document, 'adapter');
      if (!object(document.mapping)) structuralIssues.push('INVALID_MAPPING');
    } else if (Object.hasOwn(document, 'catalogId')) {
      string(document, 'catalogId');
      if (!Array.isArray(document.entries)) structuralIssues.push('INVALID_ENTRIES');
    } else {
      for (const field of ['id', 'lifecycle', 'source', 'sourceDigest']) string(document, field);
    }
  }
  const recognized = !foreign && (packagedSource || format === 'text' || knownRecord || historical);
  const inspection = { recognized, valid: packagedSource && !foreign && !structuralIssues.length,
    schemaValidation: 'NOT_EVALUATED', structuralIssues,
    reason: foreign ? 'FOREIGN_PRODUCER' : packagedSource ? 'PINNED_ARCHIVE' : historical ? 'HISTORICAL_SOURCE' : format === 'text' || knownRecord ? 'INERT_HISTORICAL_RECORD' : 'UNKNOWN_SCHEMA', authority: false };
  return { inspection, status: recognized && !structuralIssues.length ? 'PRESERVED_SOURCE' : 'QUARANTINED' };
}

export function operateImport(store, state, r) {
  const own = s => stableSerialize(s.scope) === stableSerialize(r.scope);
  const sources = state.sources ?? [];
  const inspect = source => {
    if (sourceKey(source) !== source.sourceId || sha256(source.document) !== source.documentDigest) fail('CORRUPT_STATE', 'Source identity differs');
    const raw = store.verifyRawBlob(source.scope, source.rawDigest);
    if (sha256(parseRaw(raw, source.format)) !== source.documentDigest) fail('CORRUPT_BLOB', 'Source document differs');
    return { ...source, raw };
  };
  if (r.operation === 'source.list') return sources.filter(own).map(s => {
    const verified = inspect(s);
    return { sourceId: verified.sourceId, rawDigest: verified.rawDigest, observed: verified.observed, status: verified.status, ...origin(verified) };
  });
  if (r.operation === 'source.inspect') {
    const source = sources.find(s => own(s) && s.sourceId === r.input.sourceId);
    if (!source) fail('NOT_FOUND', 'Source not found in scope');
    return inspect(source);
  }
  if (r.operation === 'source.reinspect') {
    const source = sources.find(s => own(s) && s.sourceId === r.input.sourceId);
    if (!source) fail('NOT_FOUND', 'Source not found in scope');
    const verified = inspect(source);
    const beforeDigest = sha256(source.inspection);
    if (r.input.expectedInspectionDigest !== beforeDigest) fail('INSPECTION_CONFLICT', 'Current inspection digest required');
    // Verify provenance against the owned manifest, never a caller flag.
    let packagedSource = false;
    if (source.sourceVisibility === 'public') {
      const listed = listPublicSources().sources.find(s => s.owner === 'harness' && s.sourcePath === source.sourceLocator
        && s.sourceCommit === source.sourceRevision && 'sha256:' + s.sha256 === source.rawDigest);
      if (listed) {
        const packaged = readPublicSource(listed.sourcePath);
        if (packaged.raw !== verified.raw || 'sha256:' + createHash('sha256').update(packaged.raw).digest('hex') !== source.rawDigest) fail('CORRUPT_BLOB', 'Packaged original bytes differ');
        packagedSource = true;
      }
    }
    const next = classify(source.document, source.format, packagedSource);
    if (source.status === 'QUARANTINED' && next.status === 'PRESERVED_SOURCE') {
      const issues = source.inspection.structuralIssues;
      if (!source.inspection.recognized || !['HISTORICAL_SOURCE', 'PINNED_ARCHIVE'].includes(source.inspection.reason)
        || !Array.isArray(issues) || !issues.length
        || issues.some(issue => !['MISSING_OR_INVALID_ID', 'MISSING_OR_INVALID_VERSION', 'INVALID_IDENTITY_METADATA'].includes(issue))) {
        fail('REINSPECTION_NOT_REPAIRABLE', 'Only the known historical identity-shape mismatch can leave quarantine');
      }
    }
    const afterDigest = sha256(next.inspection);
    if (beforeDigest === afterDigest && source.status === next.status) return { ...source, authority: false };
    const history = source.inspectionHistory ?? [];
    if (!Array.isArray(history)) fail('CORRUPT_STATE', 'Invalid inspection history');
    if (history.length >= 16) fail('LIMIT', 'Inspection history limit; retained entries cannot be removed');
    source.inspectionHistory = [...history, {
      before: { inspection: source.inspection, status: source.status },
      after: next, beforeInspectionDigest: beforeDigest, afterInspectionDigest: afterDigest,
      uid: store.uid, time: new Date().toISOString(), requestId: r.requestId,
    }];
    source.inspection = next.inspection;
    source.status = next.status;
    source.authority = false;
    return source;
  }
  let input = r.input, packagedSource = false;
  if (r.operation === 'source.install') {
    const listed = listPublicSources().sources.find(s => s.owner === 'harness' && s.sourcePath === input.sourcePath);
    if (!listed) fail('UNKNOWN_SOURCE', 'Exact packaged Harness source path key required');
    const packaged = readPublicSource(listed.sourcePath); packagedSource = true;
    input = { raw: packaged.raw, format: 'yaml', sourceLocator: packaged.sourcePath, sourceRevision: packaged.sourceCommit, sourceVisibility: 'public' };
    if (createHash('sha256').update(input.raw).digest('hex') !== packaged.sha256) fail('CORRUPT_BLOB', 'Packaged original bytes differ');
  }
  if (!['public', 'private'].includes(input.sourceVisibility)) fail('INVALID_REQUEST', 'Explicit source visibility required');
  if (input.sourceVisibility === 'private' && r.scope.visibility === 'public') fail('SCOPE_MISMATCH', 'Private source cannot enter public scope');
  const document = parseRaw(input.raw, input.format);
  const { inspection, status } = classify(document, input.format, packagedSource);
  const metadata = document && typeof document === 'object' ? document.metadata : null;
  const observed = {
    id: metadata?.id ?? document?.id ?? null, version: metadata?.version ?? document?.version ?? null,
    lifecycle: metadata?.lifecycle ?? document?.lifecycle ?? null, status: metadata?.status ?? document?.status ?? null,
    catalogId: document?.catalogId ?? null,
    kind: document?.kind ?? null, schema: document?.schema ?? null, apiVersion: document?.apiVersion ?? null,
  };
  const record = { scope: r.scope, ...origin(input), format: input.format, rawDigest: 'sha256:' + createHash('sha256').update(input.raw).digest('hex'), documentDigest: sha256(document), document, inspection, observed, status, authority: false };
  record.sourceId = sourceKey(record);
  const prior = sources.find(s => own(s) && s.sourceId === record.sourceId);
  if (prior) { inspect(prior); return prior; }
  if (sources.length >= LIMITS.sources) fail('LIMIT', 'Source count limit');
  store.rawBlob(r.scope, input.raw);
  state.sources ??= [];
  state.sources.push(record);
  return record;
}
