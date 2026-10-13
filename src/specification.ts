import type { NamedRow, Parameter, Rule, SourceMapping } from './types.js';
import type { Scope, State, Store, AssetRecord, HarnessAsset, Evidence, Providers, Closure, Reference, OntologyResponse, DispatchRequest, DispatchInput, JSONValue, ServiceRequest, WorkspaceOptions, SourceRecord, SourceOrigin, SemanticInput, SemanticRequirementsInput, GroundingResult, ConceptInput, RelationRequirement } from './types.js';
import { assertJSON, exactFields, textField, validateEnvelope, ENVELOPE_FIELDS, frozenClone } from '../vendor/compatibility/v1/reference.mjs';

export const MODEL_FIELDS = ['kind', 'applicability', 'objectives', 'preconditions', 'inputs', 'parameters', 'deliverables', 'rules', 'sourceMappings'];
export const TYPES = ['string', 'number', 'integer', 'boolean', 'array'];
export function typed(v: unknown, type: string) {
  return type === 'array' ? Array.isArray(v) : type === 'integer' ? Number.isInteger(v)
    : typeof v === type && (type !== 'number' || Number.isFinite(v));
}
export function failure(error: unknown) {
  return frozenClone({ valid: false, status: 'REJECTED', errors: [{ code: 'INVALID_DATA', path: '$', message: error instanceof Error ? error.message : 'Invalid data' }], authority: false, released: false });
}
export function comparisonType(inputType: string, operator: string, expected: unknown) {
  const primitive = expected !== null && ['string', 'number', 'boolean'].includes(typeof expected);
  if (!primitive) throw new TypeError('Expected primitive comparison value');
  if (['lte', 'gte'].includes(operator)) {
    if (!['number', 'integer'].includes(inputType) || typeof expected !== 'number' || !Number.isFinite(expected)) throw new TypeError('Bounds require numbers');
  } else if (operator === 'contains') {
    if (!(inputType === 'string' && typeof expected === 'string') && inputType !== 'array') throw new TypeError('Contains requires string or primitive array');
  } else if (operator !== 'eq' || inputType === 'array' || !typed(expected, inputType)) throw new TypeError('Equality type mismatch');
}
export function configurationFor(asset: HarnessAsset, supplied: Record<string, JSONValue> = {}) {
  assertJSON(supplied);
  exactFields(supplied, [], asset.parameters.map(p => p.id));
  const result = Object.fromEntries(asset.parameters.map(p => {
    const value = Object.hasOwn(supplied, p.id) ? supplied[p.id] : p.default;
    if (!typed(value, p.type)) throw new TypeError('Configuration type mismatch');
    return [p.id, value];
  }));
  for (const r of asset.rules) comparisonType(asset.inputs.find(i => i.id === r.evidenceKey)!.type, r.operator, Object.hasOwn(r, 'parameterRef') ? result[r.parameterRef!] : r.expected);
  return frozenClone(result);
}
export function validateHarness(asset: HarnessAsset) {
  try {
    assertJSON(asset);
    exactFields(asset, [...ENVELOPE_FIELDS, ...MODEL_FIELDS]);
    const envelope = validateEnvelope(asset);
    if (asset.product !== 'harness' || !['HarnessComponent', 'HarnessProfile', 'HarnessBundle', 'EvaluationPack'].includes(asset.kind)) throw new TypeError('Invalid Harness product/kind');
    exactFields(asset.applicability, ['enabled', 'domains']);
    if (typeof asset.applicability.enabled !== 'boolean' || !Array.isArray(asset.applicability.domains) || !asset.applicability.domains.length) throw new TypeError('Invalid applicability');
    asset.applicability.domains.forEach(textField);
    if (new Set(asset.applicability.domains).size !== asset.applicability.domains.length) throw new TypeError('Duplicate domain');
    const rowShape = {} as NamedRow & Parameter & Rule & SourceMapping;
    const ids = new Set(asset.provenance.sources.map(s => s.id));
    const semantic = new Set();
    const rows = (name: "objectives" | "deliverables" | "inputs" | "parameters" | "preconditions" | "rules" | "sourceMappings", required: string[], optional: string[] = []) => {
      if (!Array.isArray(asset[name])) throw new TypeError('Expected array');
      for (const row of asset[name]) {
        exactFields(row, required, optional); textField(row.id);
        if (ids.has(row.id)) throw new TypeError('Globally duplicate row id');
        ids.add(row.id); if (name !== 'sourceMappings') semantic.add(row.id);
      }
      return new Map(asset[name].map(r => [r.id, r as typeof rowShape]));
    };
    for (const name of ['objectives', 'deliverables'] as const) {
      const declared = rows(name, ['id', 'description']);
      if (!declared.size) throw new TypeError(`${name} requires at least one row`);
      for (const row of declared.values()) textField(row.description);
    }
    const inputs = rows('inputs', ['id', 'type']);
    const parameters = rows('parameters', ['id', 'type', 'default']);
    for (const row of [...inputs.values(), ...parameters.values()]) if (!TYPES.includes(row.type)) throw new TypeError('Unknown type');
    for (const p of parameters.values()) if (!typed(p.default, p.type)) throw new TypeError('Default type mismatch');
    for (const p of rows('preconditions', ['id', 'description', 'evidenceKey']).values()) {
      textField(p.description);
      if (inputs.get(p.evidenceKey)?.type !== 'boolean') throw new TypeError('Precondition needs boolean input');
    }
    for (const r of rows('rules', ['id', 'target', 'evidenceKey', 'operator', 'severity', 'blocking'], ['expected', 'parameterRef']).values()) {
      textField(r.target);
      if (!inputs.has(r.evidenceKey) || !['eq', 'lte', 'gte', 'contains'].includes(r.operator) || !['info', 'warning', 'error', 'critical'].includes(r.severity) || typeof r.blocking !== 'boolean') throw new TypeError('Invalid rule');
      if (Object.hasOwn(r, 'expected') === Object.hasOwn(r, 'parameterRef')) throw new TypeError('Exactly one expected or parameterRef required');
      if (Object.hasOwn(r, 'parameterRef') && !parameters.has(r.parameterRef!)) throw new TypeError('Dangling parameter');
      const p = parameters.get(r.parameterRef!);
      if (p && (p.type === 'array' || (r.operator === 'eq' && p.type !== inputs.get(r.evidenceKey)!.type && !(inputs.get(r.evidenceKey)!.type === 'number' && p.type === 'integer')))) throw new TypeError('Parameter declaration type mismatch');
      comparisonType(inputs.get(r.evidenceKey)!.type, r.operator, p ? p.default : r.expected);
    }
    const harnessPins = asset.dependencies.filter(d => d.product === 'harness');
    if (['HarnessProfile', 'HarnessBundle'].includes(asset.kind) && (asset.rules.length || asset.preconditions.length || asset.inputs.length || asset.parameters.length || !harnessPins.length)) throw new TypeError('Grouping kind requires Harness pins and cannot declare checks');
    if (asset.kind === 'HarnessComponent' && harnessPins.length) throw new TypeError('Component cannot group Harness pins');
    if (asset.kind === 'EvaluationPack' && !harnessPins.length) throw new TypeError('EvaluationPack requires applicable Harness pins');
    const sources = new Map(asset.provenance.sources.map(s => [s.id, s]));
    const covered = new Set(), bindings = new Set();
    for (const m of rows('sourceMappings', ['id', 'targetRef', 'sourceRef', 'sourceLocator', 'sourceRevision', 'status']).values()) {
      const s = sources.get(m.sourceRef), key = JSON.stringify([m.targetRef, m.sourceRef]);
      if (!semantic.has(m.targetRef) || !s || m.sourceLocator !== s.locator || m.sourceRevision !== s.revision || m.status !== s.status || bindings.has(key)) throw new TypeError('Invalid source mapping');
      bindings.add(key); covered.add(m.targetRef);
    }
    if ([...semantic].some(id => !covered.has(id))) throw new TypeError('Missing semantic source coverage');
    configurationFor(asset);
    return frozenClone({ valid: true, status: 'VALID', errors: [], extensions: envelope.extensions, authority: false, released: false });
  } catch (error) { return failure(error); }
}
