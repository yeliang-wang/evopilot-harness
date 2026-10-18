import type {NativeToolchain} from '../vendor/compatibility/v1/native.mjs';
import {nativeAssertJSON,nativeFrozenClone} from '../vendor/compatibility/v1/native.mjs';
import type { Scope, State, Store, AssetRecord, HarnessAsset, Evidence, Providers, Closure, Reference, OntologyResponse, DispatchRequest, DispatchInput, JSONValue, ServiceRequest, WorkspaceOptions, SourceRecord, SourceOrigin, SemanticInput, SemanticRequirementsInput, GroundingResult, ConceptInput, RelationRequirement } from './types.js';
import { exactFields, frozenClone, sha256, stableSerialize, validateReference } from '../vendor/compatibility/v1/reference.mjs';
import { isPromise } from 'node:util/types';
import { verifyDelivery } from './delivery.js';
import { bounded, fail, slug } from './state.js';

export function validateProviders(value: unknown): Providers {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_PROVIDER', 'Expected host provider object');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const d = Reflect.get(descriptors, key) as PropertyDescriptor;
    if (!['resolveOntology','nativeToolchain','resolveNativeDependency','readFeedback','resolveFeedbackMaterial','collectOnline','deliverOnlineFinding','readOnlineRepair','inspectOnlineAlert'].includes(String(key)) || !Object.hasOwn(d,'value')) fail('INVALID_PROVIDER','Unknown host provider');
    if (key !== 'nativeToolchain' && typeof d.value !== 'function') fail('INVALID_PROVIDER','Expected trusted callback');
    if (key === 'nativeToolchain') nativeAssertJSON(d.value);
  }
  return Object.freeze({
    ...(descriptors.collectOnline?{collectOnline:descriptors.collectOnline.value}:{}),
    ...(descriptors.deliverOnlineFinding?{deliverOnlineFinding:descriptors.deliverOnlineFinding.value}:{}),
    ...(descriptors.readOnlineRepair?{readOnlineRepair:descriptors.readOnlineRepair.value}:{}),
    ...(descriptors.inspectOnlineAlert?{inspectOnlineAlert:descriptors.inspectOnlineAlert.value}:{}),
    ...(descriptors.readFeedback?{readFeedback:descriptors.readFeedback.value}:{}),
    ...(descriptors.resolveFeedbackMaterial?{resolveFeedbackMaterial:descriptors.resolveFeedbackMaterial.value}:{}),
    ...(descriptors.resolveOntology ? {resolveOntology:descriptors.resolveOntology.value}:{}),
    ...(descriptors.nativeToolchain ? {nativeToolchain:nativeFrozenClone(descriptors.nativeToolchain.value as NativeToolchain)}:{}),
    ...(descriptors.resolveNativeDependency ? {resolveNativeDependency:descriptors.resolveNativeDependency.value}:{})
  });
}
export const referenceFor = (a: AssetRecord): Reference => ({ product: 'harness', id: a.model.id, version: a.model.version, specVersion: 'v1', visibility: a.scope.visibility, digest: a.delivery!.digest });

export function resolveClosure(store: Store, state: State, root: AssetRecord, providers: Providers, verifyPublished = true): Closure {
  const nodes = new Map<string, Closure["nodes"][number]>(), active = new Set<string>(), external = new Map<string, OntologyResponse>();
  let visits = 0;
  const accessible = (scope: Scope, ref: Reference, projectId: string) => ref.visibility === 'private'
    ? scope.visibility === 'private' && projectId === scope.projectId
    : projectId === scope.projectId || projectId === 'shared';
  function walk(a: AssetRecord, depth: number) {
    if (depth > 64 || ++visits > 1000) fail('GRAPH_LIMIT', 'Dependency closure limit');
    const key = stableSerialize({ scope: a.scope, id: a.model.id, version: a.model.version });
    if (active.has(key)) fail('DEPENDENCY_CYCLE', 'Cyclic dependency closure');
    if (nodes.has(key)) return;
    active.add(key);
    store.verifyBlob(a.scope, a.model);
    if (sha256(a.model) !== a.digest) fail('CORRUPT_STATE', 'Asset digest mismatch');
    if (a.delivery) {
      store.verifyBlob(a.scope, a.delivery);
      if (!verifyDelivery(a.delivery).valid || stableSerialize(a.delivery.definition) !== stableSerialize(a.model)) fail('DEPENDENCY_MISMATCH', 'Published delivery drift');
      if (!a.resolution) fail('CORRUPT_STATE', 'Missing published resolution');
      store.verifyBlob(a.scope, a.resolution);
    }
    for (const ref of a.model.dependencies) {
      validateReference(ref, { visibility: a.scope.visibility });
      if (ref.product === 'ontology') {
        if (!providers.resolveOntology) fail('UNAVAILABLE_DEPENDENCY', 'Host Ontology resolver required');
        const response = providers.resolveOntology(frozenClone({ workspaceId: store.identity.id, scope: a.scope, reference: ref }));
        if (isPromise(response)) { Promise.prototype.then.call(response, () => {}, () => {}); fail('ASYNC_PROVIDER', 'Synchronous resolver required'); }
        bounded(response); exactFields(response, ['reference', 'published', 'workspaceId', 'projectId']);
        validateReference(response.reference, { product: 'ontology' }); slug(response.projectId);
        if (response.published !== true || response.workspaceId !== store.identity.id || stableSerialize(response.reference) !== stableSerialize(ref) || !accessible(a.scope, ref, response.projectId)) fail('DEPENDENCY_MISMATCH', 'Exact published scoped Ontology reference required');
        external.set(stableSerialize({ scope: a.scope, reference: ref }), response as unknown as OntologyResponse);
        continue;
      }
      const matches = state.assets.filter(d => d.scope.visibility === ref.visibility && accessible(a.scope, ref, d.scope.projectId) && d.model.id === ref.id && d.model.version === ref.version);
      if (matches.length !== 1 || !matches[0].delivery) fail('UNAVAILABLE_DEPENDENCY', 'Unique published Harness dependency required');
      const d = matches[0];
      store.verifyBlob(d.scope, d.model); store.verifyBlob(d.scope, d.delivery);
      if (!verifyDelivery(d.delivery).valid || stableSerialize(d.delivery!.definition) !== stableSerialize(d.model) || stableSerialize(referenceFor(d)) !== stableSerialize(ref)) fail('DEPENDENCY_MISMATCH', 'Dependency delivery drift');
      const expected = ({ HarnessProfile: 'HarnessComponent', HarnessBundle: 'HarnessProfile' } as Partial<Record<HarnessAsset['kind'], string>>)[a.model.kind];
      if (a.model.kind === 'HarnessComponent' || expected && d.model.kind !== expected || a.model.kind === 'EvaluationPack' && !a.model.applicability.domains.some(domain => d.model.applicability.domains.includes(domain))) fail('DEPENDENCY_KIND', 'Dependency role or applicability mismatch');
      walk(d, depth + 1);
    }
    active.delete(key);
    nodes.set(key, { scope: a.scope, assetDigest: sha256(a.model), pins: a.model.dependencies, reference: a.delivery ? referenceFor(a) : null });
  }
  walk(root, 0);
  if (verifyPublished) {
    for (const a of state.assets) {
      const key = stableSerialize({ scope: a.scope, id: a.model.id, version: a.model.version });
      if (nodes.has(key) && a.delivery && resolveClosure(store, state, a, providers, false).closureDigest !== a.resolution!.closureDigest) fail('DEPENDENCY_MISMATCH', 'Published closure drift');
    }
  }
  // The draft root has no delivery yet. Its subject stays identical after publication.
  const entries = [...nodes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  const rootEntry = entries.find(e => e.assetDigest === sha256(root.model) && stableSerialize(e.scope) === stableSerialize(root.scope));
  rootEntry!.reference = null;
  const report = { workspaceId: store.identity.id, scope: root.scope, status: 'RESOLVED', nodes: entries, external: [...external.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v), authority: false };
  return { ...report, closureDigest: sha256(report) };
}
