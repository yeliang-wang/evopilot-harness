// Imported wire vocabulary, not Ontology ownership. See provenance/semantic-consumer.json.
import { sha256, frozenClone, stableSerialize, exactFields, assertJSON } from '../vendor/compatibility/v1/reference.mjs';

const REQUIREMENTS_SCHEMA = 'evopilot-harness-semantic-requirements/v1';
const REPORT_SCHEMA = 'evopilot-harness-semantic-compatibility-report/v1';
const GROUNDING_SCHEMA = 'evopilot-harness-ontology-grounding-result/v1';
const META_TYPES = Object.freeze(['ENTITY', 'ATTRIBUTE', 'RELATIONSHIP', 'RULE', 'EVENT', 'ACTION', 'ACTOR', 'ROLE', 'PERMISSION', 'STATE', 'WORKFLOW', 'CAPABILITY', 'SYSTEM', 'DATA_ASSET']);
const RELATION_TYPES = Object.freeze(['IS_A', 'PART_OF', 'REQUIRES', 'PERFORMS', 'CONSTRAINS', 'TRIGGERS', 'RECOVERS_WITH', 'VALIDATED_BY', 'ALTERNATIVE_TO', 'MITIGATES', 'PRODUCES']);
const OUTCOMES = Object.freeze(['RESOLVED', 'UNRESOLVED_CONCEPT', 'AMBIGUOUS_CONCEPT', 'CONFLICTING_CONCEPT', 'EXTENSION_REQUIRED', 'EVIDENCE_INSUFFICIENT']);
const PRECEDENCE = ['EVIDENCE_INSUFFICIENT', 'CONFLICTING_CONCEPT', 'AMBIGUOUS_CONCEPT', 'RESOLVED', 'EXTENSION_REQUIRED', 'UNRESOLVED_CONCEPT'];
const requirementAuthority = { descriptiveConstraintOnly: true, executable: false, provesEligibility: false, mayApprove: false, mayPublish: false };
const groundingAuthority = { deterministicResolverDecides: true, llmAdviceIsEvidenceOnly: true, llmMayAssignAuthoritativeConceptId: false, provesHarnessEligibility: false, mayCreateProposal: false, mayApprove: false, mayPublish: false, appendOnlyReanalysis: true };
function fail(code, message) { throw Object.assign(new Error(message), { name: 'SemanticCompatibilityError', code }); }
function check(condition) { if (!condition) fail('GROUNDING_RESULT_INVALID', 'Invalid imported grounding evidence'); }
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function digestField(v) { if (typeof v !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(v)) fail('SEMANTIC_DIGEST_REQUIRED', 'Exact sha256 digest required'); return v; }
function text(v) { check(typeof v === 'string' && !!v.trim()); }
function list(v, max = 512) { check(Array.isArray(v) && v.length <= max); return v; }
function strings(v, max = 512) { list(v, max).forEach(text); }
function same(a, b) { return stableSerialize(a) === stableSerialize(b); }

// Bound descriptor traversal before serialization; no getters or coercion hooks.
function boundedData(value) {
  let nodes = 0, bytes = 0;
  const active = new Set();
  function visit(v, depth) {
    if (++nodes > 20000 || depth > 48) fail('LIMIT', 'Semantic input structure limit');
    if (typeof v === 'string') bytes += Buffer.byteLength(v);
    if (bytes > 524288) fail('LIMIT', 'Semantic input byte limit');
    if (!v || typeof v !== 'object') return;
    if (active.has(v)) fail('INVALID_REQUEST', 'Cyclic input');
    active.add(v);
    const ds = Object.getOwnPropertyDescriptors(v);
    for (const k of Reflect.ownKeys(ds)) {
      if (typeof k !== 'string' || !Object.hasOwn(ds[k], 'value')) fail('INVALID_REQUEST', 'Ordinary data required');
      bytes += Buffer.byteLength(k);
      visit(ds[k].value, depth + 1);
    }
    active.delete(v);
  }
  visit(value, 0); assertJSON(value);
  if (Buffer.byteLength(stableSerialize(value)) > 524288) fail('LIMIT', 'Semantic input byte limit');
}
function unique(values = []) {
  list(values);
  return [...new Set(values.map(v => { if (!['string', 'number', 'boolean'].includes(typeof v) && v !== null) fail('SEMANTIC_REQUIREMENTS_INVALID', 'Scalar text required'); return String(v).trim(); }).filter(Boolean))].sort();
}
function concepts(values = []) {
  list(values);
  const normalized = values.map(item => {
    exactFields(item, ['conceptId', 'metaType'], ['rationale', 'evidenceRefs']);
    for (const k of ['conceptId', 'metaType', 'rationale']) if (Object.hasOwn(item, k) && typeof item[k] !== 'string') fail('SEMANTIC_REQUIREMENT_INVALID', 'Text required');
    const conceptId = item.conceptId.trim(), metaType = item.metaType.toUpperCase();
    if (!conceptId || !META_TYPES.includes(metaType)) fail('SEMANTIC_REQUIREMENT_INVALID', 'Concept id and known meta type required');
    return { conceptId, metaType, rationale: (item.rationale ?? '').trim(), evidenceRefs: unique(item.evidenceRefs) };
  });
  return [...new Map(normalized.map(i => [i.conceptId, i])).values()].sort((a, b) => compare(a.conceptId, b.conceptId));
}
export function createHarnessSemanticRequirements(input = {}) {
  boundedData(input);
  exactFields(input, ['foundationDigest'], ['requiredConcepts', 'prohibitedConcepts', 'relationRequirements', 'evidenceRequirements', 'schema', 'authority', 'requirementsDigest']);
  const requiredConcepts = concepts(input.requiredConcepts), prohibitedConcepts = concepts(input.prohibitedConcepts);
  if (requiredConcepts.some(r => prohibitedConcepts.some(p => p.conceptId === r.conceptId))) fail('SEMANTIC_REQUIREMENT_CONFLICT', 'Concept cannot be required and prohibited');
  const relationRequirements = list(input.relationRequirements ?? []).map(item => {
    exactFields(item, ['subjectConceptId', 'relationType', 'objectConceptId']);
    Object.values(item).forEach(text);
    const value = { subjectConceptId: item.subjectConceptId.trim(), relationType: item.relationType.trim(), objectConceptId: item.objectConceptId.trim() };
    if (!RELATION_TYPES.includes(value.relationType)) fail('SEMANTIC_RELATION_INVALID', 'Unknown relation type');
    return value;
  }).sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  const core = { schema: REQUIREMENTS_SCHEMA, foundationDigest: digestField(input.foundationDigest), requiredConcepts, prohibitedConcepts, relationRequirements, evidenceRequirements: unique(input.evidenceRequirements), authority: requirementAuthority };
  core.requirementsDigest = sha256(core);
  for (const field of ['schema', 'authority', 'requirementsDigest']) if (Object.hasOwn(input, field) && !same(input[field], core[field])) fail('SEMANTIC_REQUIREMENTS_INVALID', 'Requirements binding mismatch');
  return frozenClone(core);
}

function validateGrounding(value) {
  exactFields(value, ['schema', 'foundationDigest', 'candidateSetDigest', 'sourceSnapshotDigest', 'evidenceGraphDigest', 'conceptSetDigest', 'results', 'outcomeCounts', 'precedence', 'priorResultDigests', 'presentation', 'authority', 'groundingResultDigest']);
  check(value.schema === GROUNDING_SCHEMA);
  for (const k of ['foundationDigest', 'candidateSetDigest', 'sourceSnapshotDigest', 'evidenceGraphDigest', 'conceptSetDigest', 'groundingResultDigest']) digestField(value[k]);
  const { groundingResultDigest, ...core } = value;
  check(sha256(core) === groundingResultDigest);
  check(same(value.authority, groundingAuthority) && same(value.precedence, PRECEDENCE));
  list(value.priorResultDigests).forEach(digestField);
  const ids = new Set();
  for (const row of list(value.results)) {
    exactFields(row, ['candidateId', 'outcome', 'resolvedConceptId', 'candidateConceptIds', 'conflictConceptIds', 'evidenceIds', 'evidenceFamilies', 'uncertainty', 'explanation', 'userActions', 'proposedExtension', 'decisionSignals']);
    text(row.candidateId); check(!ids.has(row.candidateId)); ids.add(row.candidateId);
    check(OUTCOMES.includes(row.outcome));
    for (const k of ['candidateConceptIds', 'conflictConceptIds', 'userActions']) strings(row[k]);
    strings(row.evidenceIds, 64); strings(row.evidenceFamilies, 64);
    check(['LOW', 'BOUNDED', 'HIGH'].includes(row.uncertainty)); text(row.explanation);
    const signals = row.decisionSignals;
    exactFields(signals, ['exactOrAliasMatches', 'explicitAuthoritativeMatches', 'independentEvidenceFamilyCount', 'llmAdviceObserved', 'llmAdviceAuthoritative']);
    strings(signals.exactOrAliasMatches); strings(signals.explicitAuthoritativeMatches);
    check(Number.isSafeInteger(signals.independentEvidenceFamilyCount) && signals.independentEvidenceFamilyCount >= 0 && signals.independentEvidenceFamilyCount <= 64 && typeof signals.llmAdviceObserved === 'boolean' && signals.llmAdviceAuthoritative === false);
    // Check the imported count against the original wire's family equivalence;
    // this validates supplied evidence, without resolving any source or concept.
    const families = new Set(row.evidenceFamilies.map(v => v.replace(/^low-trust-/, '').replace(/^content-(?:purpose|inventory)$/, 'content').replace(/^lexical-content$/, 'content')));
    check(signals.independentEvidenceFamilyCount === families.size);
    if (row.outcome === 'RESOLVED') {
      text(row.resolvedConceptId);
      check(row.candidateConceptIds.length === 1 && row.candidateConceptIds[0] === row.resolvedConceptId && !row.conflictConceptIds.length && row.evidenceIds.length >= 2 && signals.independentEvidenceFamilyCount >= 2);
      check([...signals.exactOrAliasMatches, ...signals.explicitAuthoritativeMatches].includes(row.resolvedConceptId));
    } else check(row.resolvedConceptId === null);
    if (row.outcome === 'EXTENSION_REQUIRED') {
      exactFields(row.proposedExtension, ['parentConceptId', 'definition']);
      text(row.proposedExtension.parentConceptId); text(row.proposedExtension.definition);
    } else check(row.proposedExtension === null);
  }
  exactFields(value.outcomeCounts, OUTCOMES);
  for (const outcome of OUTCOMES) check(value.outcomeCounts[outcome] === value.results.filter(r => r.outcome === outcome).length);
  const p = value.presentation;
  exactFields(p, ['schema', 'locale', 'title', 'items', 'auditTermsHiddenFromPrimaryView', 'hostAuthored']);
  check(p.schema === 'evopilot-harness-ontology-grounding-presentation/v1' && ['zh-CN', 'en'].includes(p.locale) && p.hostAuthored === false);
  text(p.title); strings(p.auditTermsHiddenFromPrimaryView);
  check(list(p.items).length === value.results.length);
  p.items.forEach((item, i) => {
    exactFields(item, ['candidateId', 'conclusion', 'reason', 'nextChoices']);
    check(item.candidateId === value.results[i].candidateId && item.reason === value.results[i].explanation && same(item.nextChoices, value.results[i].userActions));
    text(item.conclusion); strings(item.nextChoices);
  });
}

export function evaluateSemanticCompatibility(input) {
  boundedData(input);
  exactFields(input, ['requirements', 'groundingResult'], ['eligibility']);
  const { groundingResult, eligibility = null } = input;
  if (eligibility !== null && (typeof eligibility !== 'object' || Array.isArray(eligibility))) fail('SEMANTIC_REQUIREMENTS_INVALID', 'Eligibility observation must be object or null');
  const requirements = createHarnessSemanticRequirements(input.requirements);
  validateGrounding(groundingResult);
  if (requirements.foundationDigest !== groundingResult.foundationDigest) fail('SEMANTIC_FOUNDATION_BINDING_MISMATCH', 'Exact expected Foundation digest mismatch');
  const resolved = new Set(groundingResult.results.filter(r => r.outcome === 'RESOLVED').map(r => r.resolvedConceptId));
  const missing = requirements.requiredConcepts.filter(r => !resolved.has(r.conceptId));
  const prohibited = requirements.prohibitedConcepts.filter(r => resolved.has(r.conceptId));
  const unresolved = groundingResult.results.filter(r => r.outcome !== 'RESOLVED');
  const status = missing.length || prohibited.length ? 'INCOMPATIBLE' : unresolved.length || !groundingResult.results.length || requirements.relationRequirements.length ? 'INDETERMINATE' : 'COMPATIBLE';
  const core = { schema: REPORT_SCHEMA, status, requirementsDigest: requirements.requirementsDigest, groundingResultDigest: groundingResult.groundingResultDigest,
    matchedRequiredConceptIds: requirements.requiredConcepts.filter(r => resolved.has(r.conceptId)).map(r => r.conceptId), missingRequiredConceptIds: missing.map(r => r.conceptId), presentProhibitedConceptIds: prohibited.map(r => r.conceptId), unresolvedCandidateIds: unresolved.map(r => r.candidateId), eligibilityObservation: eligibility,
    authority: { semanticCompatibilityOnly: true, harnessEligibilityIndependent: true, mayOverrideEligibility: false, mayCreateProposal: false, mayApprove: false, mayPublish: false } };
  // New 0.1.0 correction: legacy code silently ignored these constraints.
  if (requirements.relationRequirements.length) core.relationEvaluation = { status: 'NOT_EVALUATED', constraints: requirements.relationRequirements };
  core.compatibilityReportDigest = sha256(core);
  return frozenClone(core);
}
