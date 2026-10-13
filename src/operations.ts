import type { Scope, State, Store, AssetRecord, HarnessAsset, Evidence, Providers, Closure, Reference, OntologyResponse, DispatchRequest, DispatchInput, JSONValue, ServiceRequest, WorkspaceOptions, SourceRecord, SourceOrigin, SemanticInput, SemanticRequirementsInput, GroundingResult, ConceptInput, RelationRequirement } from './types.js';
import { resolveClosure, referenceFor } from './resolution.js';
import { evaluateHarness } from './evaluation.js';
import { exactFields, textField, sha256, stableSerialize } from '../vendor/compatibility/v1/reference.mjs';
import { validateHarness } from './specification.js';
import { buildDelivery, verifyDelivery } from './delivery.js';
import { fail, LIMITS, slug } from './state.js';
import { importOperations, importMutations, importFields, operateImport } from './import-operations.js';
import { evaluateSemanticCompatibility } from './semantic-consumer.js';

export const operations = Object.freeze([...importOperations, 'semantic.compatibility.inspect', 'workspace.inspect', 'receipt.inspect', 'asset.put', 'asset.inspect', 'asset.list', 'asset.review', 'asset.decide', 'asset.publish', 'asset.evaluate', 'evaluation.inspect']);
export const mutations = Object.freeze([...importMutations, 'asset.put', 'asset.review', 'asset.decide', 'asset.publish', 'asset.evaluate']);

// Dictionary keys serialize all six public reference fields canonically. Scope
// stays explicit in each result; ambiguous public identities fail resolution.
function evaluateComposed(store: Store, state: State, root: AssetRecord, closure: Closure, input: DispatchInput) {
  const members = closure.nodes.map(node => {
    const matches = state.assets.filter(a => stableSerialize(a.scope) === stableSerialize(node.scope) && sha256(a.model) === node.assetDigest);
    if (matches.length !== 1) fail('DEPENDENCY_MISMATCH', 'Exact closure member required');
    return matches[0];
  });
  const leaves = members.filter(a => ['HarnessComponent', 'EvaluationPack'].includes(a.model.kind) && a.model.rules.length > 0);
  const keys = leaves.map(a => stableSerialize(referenceFor(a)));
  if (new Set(keys).size !== keys.length) fail('DEPENDENCY_MISMATCH', 'Ambiguous evaluation identity');
  for (const dictionary of [input.evidence, input.configuration]) {
    if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) fail('INVALID_REQUEST', 'Composed input requires reference dictionaries');
    if (Object.keys(dictionary).some(key => !keys.includes(key))) fail('INVALID_REQUEST', 'Unknown composed input reference');
  }
  const rootReference = referenceFor(root);
  const results = leaves.map(a => {
    const reference = referenceFor(a), key = stableSerialize(reference);
    const supplied = Object.hasOwn(input.evidence, key), configured = Object.hasOwn(input.configuration, key);
    const configuration = configured ? input.configuration[key] : {};
    // Validate supplied data through the unchanged core, including disabled
    // groups. An absent envelope never manufactures an evidence source.
    const evaluation = supplied ? evaluateHarness(a.model, input.evidence[key], configuration)
      : a.model.applicability.enabled === false
        ? { status: 'N/A', reason: 'DISABLED', authority: false, actions: [] }
        : { status: 'INDETERMINATE', reason: 'MISSING_EVIDENCE', authority: false, actions: [] };
    const suppressed = evaluation.status !== 'ERROR' && root.model.applicability.enabled === false;
    return { rootReference, closureDigest: closure.closureDigest, reference, scope: a.scope,
      evidenceDigest: supplied ? sha256(input.evidence[key]) : null,
      configurationDigest: configured ? sha256(configuration) : null,
      evaluation, evaluationDigest: sha256(evaluation), status: suppressed ? 'N/A' : evaluation.status,
      ...(suppressed ? { reason: 'ROOT_DISABLED' } : {}) };
  });
  const statuses = results.map(r => r.status);
  const status = ['ERROR', 'FAIL', 'INDETERMINATE', 'PASS'].find(s => statuses.includes(s))
    ?? (statuses.length || root.model.applicability.enabled === false ? 'N/A' : 'INDETERMINATE');
  const evaluation = { status, results, ...(results.length ? {} : { reason: root.model.applicability.enabled === false ? 'ROOT_DISABLED' : 'NO_RUNNABLE_RULES' }), authority: false, actions: [] };
  return { workspaceId: store.identity.id, scope: root.scope, reference: rootReference, pins: root.model.dependencies,
    closureDigest: closure.closureDigest, evidenceDigest: sha256(input.evidence), configurationDigest: sha256(input.configuration),
    evaluation, evaluationDigest: sha256(evaluation), status, authority: false, actions: [] };
}
export function validateRequest(r: DispatchRequest) {
  if (!operations.includes(r.operation)) fail('UNSUPPORTED_OPERATION', 'Operation is outside this service slice');
  const write = mutations.includes(r.operation);
  exactFields(r, ['operation', 'scope', 'input', ...(write ? ['requestId', 'expectedRevision'] : [])]);
  exactFields(r.scope, ['visibility', 'projectId']); slug(r.scope.projectId);
  if (!['public', 'private'].includes(r.scope.visibility)) fail('INVALID_REQUEST', 'Explicit visibility required');
  if (write) {
    slug(r.requestId);
    if (!Number.isSafeInteger(r.expectedRevision) || r.expectedRevision < 0) fail('INVALID_REQUEST', 'Expected nonnegative revision');
  }
  const fields = { ...importFields,
    'semantic.compatibility.inspect': ['requirements', 'groundingResult', 'eligibility'],
    'workspace.inspect': [], 'receipt.inspect': ['requestId'], 'asset.put': ['asset'],
    'asset.inspect': ['id', 'version'], 'asset.list': [], 'asset.review': ['id', 'version'],
    'asset.decide': ['id', 'version', 'reviewDigest', 'decision', 'humanEvidenceRef'],
    'asset.publish': ['id', 'version'], 'asset.evaluate': ['id', 'version', 'evidence', 'configuration'], 'evaluation.inspect': ['requestId'],
  };
  exactFields(r.input, fields[r.operation]);
  for (const field of fields[r.operation]) if (!['asset', 'raw', 'evidence', 'configuration', 'requirements', 'groundingResult', 'eligibility'].includes(field)) textField(Reflect.get(r.input, field));
  if (r.operation === 'legacy.import' && typeof r.input.raw !== 'string') fail('INVALID_REQUEST', 'Raw input must be a string');
  if (['receipt.inspect', 'evaluation.inspect'].includes(r.operation)) slug(r.input.requestId);
  if (r.operation === 'asset.decide' && (!['APPROVE', 'REJECT'].includes(r.input.decision) || !/^sha256:[a-f0-9]{64}$/.test(r.input.reviewDigest))) fail('INVALID_REQUEST', 'Explicit decision and review digest required');
  return write;
}
export function operate(store: Store, state: State, r: DispatchRequest, providers: Providers) {
  if (r.operation === 'semantic.compatibility.inspect') return { workspaceId: store.identity.id, scope: r.scope, report: evaluateSemanticCompatibility(r.input), authority: false };
  if (importOperations.includes(r.operation)) return operateImport(store, state, r);
  const scopeKey = stableSerialize(r.scope);
  const own = (a: AssetRecord) => stableSerialize(a.scope) === scopeKey;
  const find = () => {
    const a = state.assets.find(a => own(a) && a.model.id === r.input.id && a.model.version === r.input.version);
    if (!a) fail('NOT_FOUND', 'Asset not found in scope');
    store.verifyBlob(a.scope, a.model);
    if (sha256(a.model) !== a.digest) fail('CORRUPT_STATE', 'Asset digest mismatch');
    if (a.delivery) {
      store.verifyBlob(a.scope, a.delivery);
      if (!verifyDelivery(a.delivery).valid || stableSerialize(a.delivery.definition) !== stableSerialize(a.model)) fail('CORRUPT_STATE', 'Invalid current delivery');
      if (!a.resolution) fail('CORRUPT_STATE', 'Missing publication resolution');
      store.verifyBlob(a.scope, a.resolution);
    }
    return a;
  };
  if (r.operation === 'asset.list') return state.assets.filter(own).map(a => ({ id: a.model.id, version: a.model.version, digest: a.digest, published: !!a.delivery }));
  if (r.operation === 'asset.put') {
    const model = r.input.asset;
    const validation = validateHarness(model);
    if (!validation.valid) fail('INVALID_MODEL', 'Harness asset failed validation');
    if (model.visibility !== r.scope.visibility) fail('SCOPE_MISMATCH', 'Model visibility differs from scope');
    const prior = state.assets.find(a => own(a) && a.model.id === model.id && a.model.version === model.version);
    if (prior?.delivery) fail('IMMUTABLE_VERSION', 'Published id/version cannot change');
    if (!prior && state.assets.length >= LIMITS.assets) fail('LIMIT', 'Asset count limit');
    const digest = store.blob(r.scope, model);
    const asset = { scope: r.scope, model, digest, validation, review: null, decision: null, delivery: null };
    if (prior) state.assets[state.assets.indexOf(prior)] = asset; else state.assets.push(asset);
    return { id: model.id, version: model.version, digest, validation };
  }
  const a = find();
  if (r.operation === 'asset.inspect') return a;
  if (r.operation === 'asset.evaluate') {
    if (!a.delivery) fail('NOT_PUBLISHED', 'Evaluation requires a published root');
    const closure = resolveClosure(store, state, a, providers);
    if (closure.closureDigest !== a.resolution!.closureDigest) fail('DEPENDENCY_MISMATCH', 'Published closure drift');
    if (a.model.kind !== 'HarnessComponent') {
      const report = evaluateComposed(store, state, a, closure, r.input);
      return { report, reportDigest: store.blob(a.scope, report) };
    }
    const evaluation = evaluateHarness(a.model, r.input.evidence, r.input.configuration);
    const report = { workspaceId: store.identity.id, scope: a.scope, reference: referenceFor(a), pins: a.model.dependencies,
      closureDigest: closure.closureDigest, evidenceDigest: sha256(r.input.evidence), configurationDigest: sha256(r.input.configuration),
      evaluation, evaluationDigest: sha256(evaluation), status: evaluation.status, authority: false, actions: [] };
    return { report, reportDigest: store.blob(a.scope, report) };
  }
  if (a.delivery) fail('IMMUTABLE_VERSION', 'Published id/version is immutable');
  const reviewSubject = () => ({ workspace: store.identity, scope: a.scope, assetDigest: a.digest, validation: validateHarness(a.model), resolution: resolveClosure(store, state, a, providers), uid: store.uid });
  if (r.operation === 'asset.review') {
    const content = reviewSubject();
    a.review = { ...content, reviewDigest: sha256(content) }; a.decision = null;
    return a.review;
  }
  const currentReview = () => {
    const current = reviewSubject();
    if (!a.review || a.review!.reviewDigest !== sha256(current)) fail('REVIEW_REQUIRED', 'Current exact review required');
  };
  currentReview();
  if (r.operation === 'asset.decide') {
    if (r.input.reviewDigest !== a.review!.reviewDigest) fail('REVIEW_MISMATCH', 'Decision must bind exact review');
    a.decision = { reviewDigest: r.input.reviewDigest, decision: r.input.decision, humanEvidenceRef: r.input.humanEvidenceRef, uid: store.uid };
    return a.decision;
  }
  if (!a.decision || a.decision.decision !== 'APPROVE' || a.decision.reviewDigest !== a.review!.reviewDigest) fail('APPROVAL_REQUIRED', 'Exact human approval required');
  if (validateHarness(a.model).status !== 'VALID') fail('PENDING_MODEL', 'Only VALID models may publish');
  const resolution = resolveClosure(store, state, a, providers);
  if (sha256(reviewSubject()) !== a.review!.reviewDigest) fail('REVIEW_REQUIRED', 'Resolution changed during publication');
  if (resolution.closureDigest !== a.review!.resolution.closureDigest) fail('REVIEW_REQUIRED', 'Exact reviewed closure required');
  store.blob(a.scope, resolution); a.resolution = resolution;
  const delivery = buildDelivery(a.model);
  if (!verifyDelivery(delivery).valid) fail('INVALID_DELIVERY', 'Delivery failed verification');
  const blobDigest = store.blob(a.scope, delivery);
  a.delivery = delivery;
  return { reference: { product: 'harness', id: a.model.id, version: a.model.version, specVersion: 'v1', visibility: a.model.visibility, digest: delivery.digest }, blobDigest, delivery, resolution };
}
