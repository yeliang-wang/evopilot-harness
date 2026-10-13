import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as api from '../../dist/index.js';
import { createHarnessService } from '../../dist/service.js';
import { sha256 } from '../../vendor/compatibility/v1/reference.mjs';

const foundationDigest = 'sha256:' + 'a'.repeat(64);
const concept = conceptId => ({ conceptId, metaType: 'ENTITY' });
const requirements = (extra = {}) => api.createHarnessSemanticRequirements({ foundationDigest, requiredConcepts: [concept('apple')], ...extra });
const outcomes = ['RESOLVED', 'UNRESOLVED_CONCEPT', 'AMBIGUOUS_CONCEPT', 'CONFLICTING_CONCEPT', 'EXTENSION_REQUIRED', 'EVIDENCE_INSUFFICIENT'];
// Synthetic consumer DTO matching the pinned producer's original wire layout.
function grounding(outcome = 'RESOLVED') {
  const explanation = outcome === 'RESOLVED' ? 'One authoritative concept is supported by independent Source evidence and deterministic identity signals.' : 'Fewer than two independent non-LLM Source evidence families support the concept.';
  const userActions = outcome === 'RESOLVED' ? ['REVIEW_GROUNDING', 'CONTINUE_WITH_SEMANTIC_COMPATIBILITY'] : ['SUPPLY_MORE_SOURCE_EVIDENCE', 'CLOSE'];
  const results = outcome === null ? [] : [{ candidateId: 'candidate-0001', outcome, resolvedConceptId: outcome === 'RESOLVED' ? 'apple' : null,
    candidateConceptIds: outcome === 'RESOLVED' ? ['apple'] : [], conflictConceptIds: [], evidenceIds: outcome === 'RESOLVED' ? ['e1', 'e2'] : ['e1'], evidenceFamilies: outcome === 'RESOLVED' ? ['content', 'structure'] : ['content'], uncertainty: outcome === 'RESOLVED' ? 'BOUNDED' : 'HIGH',
    explanation, userActions, proposedExtension: null,
    decisionSignals: { exactOrAliasMatches: outcome === 'RESOLVED' ? ['apple'] : [], explicitAuthoritativeMatches: [], independentEvidenceFamilyCount: outcome === 'RESOLVED' ? 2 : 1, llmAdviceObserved: false, llmAdviceAuthoritative: false } }];
  const value = { schema: 'evopilot-harness-ontology-grounding-result/v1', foundationDigest, candidateSetDigest: foundationDigest, sourceSnapshotDigest: foundationDigest, evidenceGraphDigest: foundationDigest, conceptSetDigest: foundationDigest, results,
    outcomeCounts: Object.fromEntries(outcomes.map(o => [o, results.filter(r => r.outcome === o).length])),
    precedence: ['EVIDENCE_INSUFFICIENT', 'CONFLICTING_CONCEPT', 'AMBIGUOUS_CONCEPT', 'RESOLVED', 'EXTENSION_REQUIRED', 'UNRESOLVED_CONCEPT'], priorResultDigests: [],
    presentation: { schema: 'evopilot-harness-ontology-grounding-presentation/v1', locale: 'en', title: 'Business concepts found in the Source', items: results.map(r => ({ candidateId: r.candidateId, conclusion: outcome.toLowerCase().replaceAll('_', ' '), reason: r.explanation, nextChoices: r.userActions })), auditTermsHiddenFromPrimaryView: ['OntologyFoundation', 'SemanticCandidateSet', 'OntologyGroundingResolver', 'digest', 'precedence'], hostAuthored: false },
    authority: { deterministicResolverDecides: true, llmAdviceIsEvidenceOnly: true, llmMayAssignAuthoritativeConceptId: false, provesHarnessEligibility: false, mayCreateProposal: false, mayApprove: false, mayPublish: false, appendOnlyReanalysis: true } };
  return seal(value);
}
function seal(value) { delete value.groundingResultDigest; value.groundingResultDigest = sha256(value); return value; }
const inspect = (req = requirements(), g = grounding(), eligibility = null) => api.evaluateSemanticCompatibility({ requirements: req, groundingResult: g, eligibility });

test('semantic pure: legacy canonical object hashes and concept comparison priority', () => {
  // Independent original canonicalJson/digest algorithm; object hashing only.
  const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
  const legacyHash = v => 'sha256:' + createHash('sha256').update(canonical(v)).digest('hex');
  const req = requirements({ requiredConcepts: [{ ...concept(' apple '), rationale: ' why ', evidenceRefs: ['z', 'a', 'z'] }, concept('banana'), concept('apple')] });
  const { requirementsDigest, ...core } = req;
  assert.equal(requirementsDigest, legacyHash(core));
  assert.deepEqual(req.requiredConcepts.map(r => r.conceptId), ['apple', 'banana']);
  const report = inspect(); const { compatibilityReportDigest, ...reportCore } = report;
  assert.equal(report.status, 'COMPATIBLE'); assert.equal(compatibilityReportDigest, legacyHash(reportCore));
  assert(!Object.hasOwn(report, 'relationEvaluation'));
  assert.equal(inspect(requirements({ requiredConcepts: [concept('missing')] })).status, 'INCOMPATIBLE');
  assert.equal(inspect(requirements({ requiredConcepts: [], prohibitedConcepts: [concept('apple')] })).status, 'INCOMPATIBLE');
  assert.throws(() => requirements({ prohibitedConcepts: [concept('apple')] }), { code: 'SEMANTIC_REQUIREMENT_CONFLICT' });
  assert.equal(inspect(requirements({ requiredConcepts: [] }), grounding('EVIDENCE_INSUFFICIENT')).status, 'INDETERMINATE');
  assert.equal(inspect(requirements({ requiredConcepts: [] }), grounding(null)).status, 'INDETERMINATE');
  assert.equal(inspect(requirements(), grounding(null)).status, 'INCOMPATIBLE');
  assert(Object.isFrozen(report.authority)); assert(Object.isFrozen(req.requiredConcepts));
});

test('semantic pure: relation non-evaluation and independent eligibility', () => {
  const relationRequirements = [{ subjectConceptId: 'apple', relationType: 'REQUIRES', objectConceptId: 'water' }];
  const report = inspect(requirements({ relationRequirements }), grounding(), { status: 'PASS', mayPublish: true });
  assert.equal(report.status, 'INDETERMINATE'); assert.equal(report.relationEvaluation.status, 'NOT_EVALUATED');
  assert.equal(report.eligibilityObservation.mayPublish, true);
  for (const field of ['mayOverrideEligibility', 'mayCreateProposal', 'mayApprove', 'mayPublish']) assert.equal(report.authority[field], false);
  assert.equal(inspect(requirements({ relationRequirements, requiredConcepts: [concept('missing')] })).status, 'INCOMPATIBLE');
  assert.equal(inspect(requirements(), grounding(), { status: 'FAIL' }).status, 'COMPATIBLE');
});

test('semantic pure: malformed, tampered, unknown, unbounded and non-data inputs fail closed', () => {
  assert.throws(() => inspect(requirements({ foundationDigest: 'sha256:' + 'b'.repeat(64) })), { code: 'SEMANTIC_FOUNDATION_BINDING_MISMATCH' });
  assert.throws(() => api.createHarnessSemanticRequirements({}));
  const tampered = grounding(); tampered.results[0].resolvedConceptId = 'other'; assert.throws(() => inspect(requirements(), tampered));
  for (const edit of [g => { g.results[0].outcome = 'ERROR'; }, g => { delete g.results[0].outcome; }, g => { g.results = {}; }, g => { g.extra = true; }, g => { g.results[0].evidenceIds = []; }, g => { g.results[0].decisionSignals.extra = true; }, g => { g.outcomeCounts.RESOLVED = 0; }, g => { g.results[0].resolvedConceptId = null; }]) {
    const g = grounding(); edit(g); assert.throws(() => inspect(requirements(), seal(g)));
  }
  let accessed = false;
  const accessor = { get requirements() { accessed = true; return requirements(); }, groundingResult: grounding() };
  assert.throws(() => api.evaluateSemanticCompatibility(accessor)); assert.equal(accessed, false);
  for (const value of [{ ...grounding(), [Symbol('x')]: true }, { ...grounding(), fn() {} }, { ...grounding(), extra: 'x'.repeat(524289) }]) assert.throws(() => inspect(requirements(), value));
  const deep = {}; let cursor = deep; for (let i = 0; i < 50; i++) cursor = cursor.next = {};
  assert.throws(() => inspect(requirements(), grounding(), deep), { code: 'LIMIT' });
});

test('semantic pure: exported consumer dependencies remain pure and own no Ontology production', () => {
  for (const name of ['createOntologyFoundation', 'createOntologyPack', 'createOntologySnapshot', 'defaultemptyOntologyPack']) assert.equal(api[name], undefined);
  const source = readFileSync(new URL('../../dist/semantic-consumer.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.deepEqual(imports, ['../vendor/compatibility/v1/reference.mjs']);
  assert.doesNotMatch(source, /\b(?:eval|require)\s*\(|\bimport\s*\(|node:fs|node:child_process|\.local\//);
});

test('semantic pure: service requires exact scope/input and explicit initialization', () => {
  const service = createHarnessService({ workspaceRoot: '/unopened-semantic-test', workspaceId: 'test' });
  const request = { operation: 'semantic.compatibility.inspect', scope: { visibility: 'private', projectId: 'test' }, input: { requirements: requirements(), groundingResult: grounding(), eligibility: null } };
  assert.throws(() => service.execute(request), { code: 'NOT_INITIALIZED' });
  for (const patch of [{ input: { ...request.input, publish: true } }, { input: { requirements: requirements(), groundingResult: grounding() } }, { scope: {} }, { expectedRevision: 0 }]) assert.throws(() => service.execute({ ...request, ...patch }), { code: 'INVALID_REQUEST' });
  for (const operation of ['semantic.compatibility.publish', 'ontology.create', 'createOntologyPack', 'semantic.compatibility.approve']) assert.throws(() => service.execute({ ...request, operation }), { code: 'UNSUPPORTED_OPERATION' });
  assert(service.capabilities().operations.includes(request.operation));
  assert(!service.capabilities().pending.includes('CLI')); service.close();
});

test('semantic filesystem: inspect leaves revision, receipts, audit and assets unchanged', t => {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'harness-semantic-'));
  const workspaceRoot = join(parent, 'workspace');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const service = createHarnessService({ workspaceRoot, workspaceId: 'test' });
  t.after(() => service.close()); service.initialize();
  const scope = { visibility: 'private', projectId: 'alpha' };
  const read = (operation, input = {}) => service.execute({ operation, input, scope });
  const before = read('workspace.inspect');
  const db = new DatabaseSync(join(workspaceRoot, 'state/harness/harness.db'), { readOnly: true });
  t.after(() => db.close());
  const snapshot = () => ['state', 'receipts', 'audit'].map(table => db.prepare('SELECT * FROM ' + table).all());
  const initial = snapshot();
  const result = read('semantic.compatibility.inspect', { requirements: requirements(), groundingResult: grounding(), eligibility: null });
  assert.equal(result.report.status, 'COMPATIBLE'); assert.equal(result.authority, false); assert.deepEqual(result.scope, scope);
  assert.equal(result.report.authority.mayApprove, false); assert.equal(result.report.authority.mayPublish, false);
  assert.deepEqual(read('workspace.inspect'), before); assert.deepEqual(read('asset.list'), []); assert.deepEqual(snapshot(), initial);
});
