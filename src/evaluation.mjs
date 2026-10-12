import { assertJSON, exactFields, textField, validateReference, sha256, frozenClone } from '../vendor/compatibility/v1/reference.mjs';
import { validateHarness, configurationFor, typed } from './specification.mjs';

const aggregate = states => ['ERROR', 'FAIL', 'INDETERMINATE', 'PASS'].find(s => states.includes(s)) ?? 'INDETERMINATE';
export function evaluateHarness(asset, evidence, configuration = {}) {
  let binding = { assetDigest: null, rulesDigest: null, configurationDigest: null, evidenceDigest: null, evidence: null };
  let rules = [], preconditions = [];
  try {
    if (!validateHarness(asset).valid) throw new TypeError('Invalid Harness');
    const config = configurationFor(asset, configuration);
    binding = { ...binding, assetDigest: sha256(asset), rulesDigest: sha256(asset.rules), configurationDigest: sha256(config) };
    rules = asset.rules.map(r => ({ id: r.id, ruleDigest: sha256(r), status: 'ERROR', severity: r.severity, blocking: r.blocking }));
    assertJSON(evidence); exactFields(evidence, ['id', 'version', 'source', 'values']);
    textField(evidence.id);
    exactFields(evidence.source, ['locator', 'revision', 'digest']);
    textField(evidence.source.locator); textField(evidence.source.revision);
    validateReference({ product: 'harness', id: evidence.id, version: evidence.version, specVersion: 'v1', visibility: asset.visibility, digest: evidence.source.digest });
    exactFields(evidence.values, [], asset.inputs.map(i => i.id));
    binding = { ...binding, evidenceDigest: sha256(evidence), evidence: { id: evidence.id, version: evidence.version, source: evidence.source } };
    for (const i of asset.inputs) if (Object.hasOwn(evidence.values, i.id) && !typed(evidence.values[i.id], i.type)) throw new TypeError('Evidence type mismatch');
    const observations = evidence.values;
    preconditions = asset.preconditions.map(p => ({ id: p.id, status: !asset.applicability.enabled ? 'N/A' : !Object.hasOwn(observations, p.evidenceKey) ? 'INDETERMINATE' : observations[p.evidenceKey] ? 'PASS' : 'FAIL' }));
    const gate = aggregate(preconditions.map(p => p.status));
    rules = asset.rules.map(r => {
      let status, reason;
      if (!asset.applicability.enabled) { status = 'N/A'; reason = 'EXPLICITLY_DISABLED'; }
      else if (preconditions.length && gate !== 'PASS') { status = 'INDETERMINATE'; reason = 'PRECONDITION_BLOCKED'; }
      else if (!Object.hasOwn(observations, r.evidenceKey)) { status = 'INDETERMINATE'; reason = 'MISSING_EVIDENCE'; }
      else {
        const actual = observations[r.evidenceKey], expected = Object.hasOwn(r, 'parameterRef') ? config[r.parameterRef] : r.expected;
        try {
          if (r.operator === 'contains' && Array.isArray(actual) && actual.some(v => v === null || typeof v !== typeof expected || !['string', 'number', 'boolean'].includes(typeof v))) throw new TypeError('Array comparison type mismatch');
          const passed = r.operator === 'eq' ? actual === expected : r.operator === 'lte' ? actual <= expected : r.operator === 'gte' ? actual >= expected : actual.includes(expected);
          status = passed ? 'PASS' : 'FAIL'; reason = 'COMPARISON';
        } catch { status = 'ERROR'; reason = 'OPERATOR_ERROR'; }
      }
      return { id: r.id, ruleDigest: sha256(r), status, reason, severity: r.severity, blocking: r.blocking };
    });
    const status = !asset.applicability.enabled ? 'N/A' : aggregate([...preconditions.map(p => p.status), ...rules.map(r => r.status), ...(rules.length ? [] : ['INDETERMINATE'])]);
    return frozenClone({ status, ...binding, preconditions, rules, authority: false, released: false });
  } catch (error) {
    return frozenClone({ status: 'ERROR', ...binding, preconditions, rules, error: error instanceof Error ? error.message : 'Invalid evidence', authority: false, released: false });
  }
}
