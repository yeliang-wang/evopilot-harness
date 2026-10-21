import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHarnessService } from '@evopilot-next/harness/service';
import { nativeSha256, referenceForPackage } from '../../vendor/compatibility/v1/native.mjs';
import { createFeedbackStore } from '../../vendor/compatibility/feedback/v1/feedback.mjs';
import { openState } from '../../dist/state.js';
import { syntheticHarnessPackage, replaceNativeFile } from '../../examples/native/package.mjs';
import { syntheticDecisionEvidence } from '../fixtures/native/decision-evidence.mjs';

// Boundary E2E uses deliberately seeded synthetic owner records and test-only
// attestations. Parent integration tests exercise the real engines and collector.
const scope = { visibility: 'private', projectId: 'synthetic-response' };
const epoch = () => Math.floor(Date.now() / 1000);
function setup(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'harness-response-'));
  const options = { workspaceRoot: path.join(root, 'state'), workspaceId: 'synthetic-response' };
  const externalObservedAt = epoch() - 1;
  const prerequisite = { owner: 'runtime', id: 'synthetic-collection', digest: nativeSha256('prerequisite') };
  const runbook = { schema: 'evopilot-response-runbook/v1', id: 'recover-example', version: '1.0.0', serviceId: 'example', environment: 'test', sourceRevision: 'fixed', parameters: { mode: 'recheck' }, prerequisites: [prerequisite], steps: [{ id: 'verify', description: 'Run the reviewed isolated collection', operation: 'isolated-collection' }], stopConditions: ['SOURCE_DRIFT', 'PREREQUISITE_FAILED', 'GUIDANCE_WITHDRAWN', 'EXPIRED', 'TIMEOUT', 'UNKNOWN'], effectScope: 'isolated-local', maxEvidenceAgeSeconds: 300, expiresAt: epoch() + 3600 };
  const pkg = syntheticHarnessPackage(); replaceNativeFile(pkg, 'runbooks/recover.json', runbook);
  const pin = { reference: referenceForPackage(pkg), path: 'runbooks/recover.json', digest: nativeSha256(runbook) };
  let material = { reference: pin.reference, scope, workspaceId: options.workspaceId, package: pkg, published: true };
  let execution = null, externalStatus = 'UNKNOWN', service, sequence = 0;
  const providers = {
    resolveFeedbackMaterial: () => structuredClone(material),
    readResponseEvidence: ({ reference }) => ({ workspaceId: options.workspaceId, scope, reference, status: externalStatus, observedAt: externalObservedAt }),
    readResponseExecution: () => structuredClone(execution),
  };
  const open = () => { service = createHarnessService(options, providers); service.initialize(); };
  open(); t.after(() => { service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const read = (operation, input = {}, selected = scope) => service.response({ operation, scope: selected, input });
  const write = async (operation, input, requestId = 'response-' + (++sequence)) => service.response({ operation, scope, input, requestId, expectedRevision: (await read('response.inspect')).revision });
  const approve = (operation, reviewDigest) => syntheticDecisionEvidence(root, { owner: 'harness', operation, workspaceId: options.workspaceId, scope, reviewDigest, decision: 'APPROVE' });
  function seed(rows) {
    const store = openState(options.workspaceRoot, options.workspaceId), records = createFeedbackStore(store, 'harness', 5);
    try { store.db.exec('BEGIN IMMEDIATE'); for (const [kind, id, value] of rows) records.put(scope, kind, id, value); records.recordTransition({ syntheticFixture: true, id: ++sequence }, { rows: rows.length }); store.db.exec('COMMIT'); }
    catch (error) { if (store.db.isTransaction) store.db.exec('ROLLBACK'); throw error; }
    finally { store.db.close(); }
  }
  const bindingDigest = nativeSha256('synthetic-binding');
  const binding = { workspaceId: options.workspaceId, scope, reviewDigest: bindingDigest, spec: { id: 'monitor', serviceId: 'example', environment: 'test', deploymentRevision: 'fixed' } };
  const incidentId = nativeSha256({ binding: bindingDigest, source: 'evaluation' });
  const observed = (id, outcome, at) => {
    const body = { id: nativeSha256(id), bindingId: 'monitor', bindingDigest, workspaceId: options.workspaceId, scope, windowEnd: at, measurement: { synthetic: true }, policy: pin.reference, nativeReport: { synthetic: true, executionStatus: 'SUCCEEDED', qualityStatus: outcome, reportDigest: nativeSha256(id + '-report') }, outcome, diagnostic: null };
    return { ...body, digest: nativeSha256(body) };
  };
  const fault = observed('fault', 'FAIL', epoch() - 20), recovery = observed('recovery', 'PASS', epoch() - 5);
  function finding(observation, state = observation.outcome === 'FAIL' ? 'FIRING' : 'RESOLVED') {
    const body = { schema: 'evopilot-online-finding/v1', id: nativeSha256({ binding: bindingDigest, source: 'evaluation', state, causeId: observation.id }), workspaceId: options.workspaceId, scope, bindingId: 'monitor', bindingDigest, serviceId: 'example', environment: 'test', deploymentRevision: 'fixed', policy: pin.reference, incidentId, source: 'evaluation', state, at: observation.windowEnd, evidenceDigest: observation.digest, causeId: observation.id, candidate: { kind: 'regression', status: 'REVIEW_REQUIRED' } };
    return { ...body, digest: nativeSha256(body) };
  }
  const firing = finding(fault), resolved = finding(recovery), incident = { id: incidentId, bindingId: 'monitor', history: [firing.id], state: 'FIRING', at: fault.windowEnd };
  seed([['online-binding', 'monitor', binding], ['online-observation', fault.id, fault], ['online-finding', firing.id, { finding: firing, delivery: null, error: null }], ['online-incident', incidentId, incident]]);
  const faultRef = { owner: 'harness', id: 'finding:' + firing.id, digest: firing.digest };
  const assessment = { id: 'synthetic-problem', previousDigest: null, incidentId, findingIds: [firing.id], impact: 'Synthetic availability degradation', causes: [{ kind: 'suspected', description: 'A candidate explanation, not a confirmed cause', evidence: [faultRef] }], followups: [], evidence: [faultRef, prerequisite] };
  async function putAssessment(value = assessment, requestId) {
    const review = await read('response.problem.prepare', { assessment: value });
    const input = { assessment: value, reviewDigest: review.reviewDigest, humanEvidenceRef: approve('response.problem.put', review.reviewDigest) };
    const receipt = await write('response.problem.put', input, requestId); return { receipt, input, review };
  }
  function recover() {
    incident.history.push(resolved.id); incident.state = 'RESOLVED'; incident.at = recovery.windowEnd;
    const body = { bindingDigest, policy: pin.reference, fault: { id: fault.id, digest: fault.digest, reportDigest: fault.nativeReport.reportDigest, outcome: 'FAIL' }, recovery: { id: recovery.id, digest: recovery.digest, reportDigest: recovery.nativeReport.reportDigest, outcome: 'PASS' }, status: 'REVIEW_REQUIRED', policyMutation: false, ontologyMutation: false };
    const regression = { ...body, digest: nativeSha256(body) };
    seed([['online-observation', recovery.id, recovery], ['online-finding', resolved.id, { finding: resolved, delivery: null, error: null }], ['online-incident', incidentId, incident], ['online-regression', regression.digest, regression]]);
    return { owner: 'harness', id: regression.digest, digest: regression.digest };
  }
  function verified(problem, ref) {
    const reference = { owner: 'runtime', id: 'response:synthetic', digest: nativeSha256({ problem: problem.digest, recovery: ref }) };
    execution = { workspaceId: options.workspaceId, scope, reference, problemId: problem.id, problemDigest: problem.digest, serviceId: problem.serviceId, environment: problem.environment, deploymentRevision: problem.deploymentRevision, status: 'VERIFIED', recovery: ref, verifiedAt: epoch() - 1 }; return reference;
  }
  return { options, root, pin, runbook, pkg, fault, firing, recovery, resolved, incident, faultRef, prerequisite, assessment, seed, read, write, approve, putAssessment, recover, verified, finding, observed, setExternalStatus: value => { externalStatus = value; }, setExecution: value => { execution = value; }, getExecution: () => structuredClone(execution), setMaterial: value => { material = value; }, getMaterial: () => structuredClone(material), restart: () => { service.close(); open(); }, get service() { return service; } };
}

test('synthetic runbook admission requires exact published scoped package bytes; withdrawal is reviewed and durable', async t => {
  const e = setup(t);
  await assert.rejects(() => e.write('response.runbook.admit', { pin: { ...e.pin, digest: nativeSha256('forged') } }), { code: 'RESPONSE_RUNBOOK_INTEGRITY' });
  const material = e.getMaterial(); e.setMaterial({ ...material, published: false });
  await assert.rejects(() => e.write('response.runbook.admit', { pin: e.pin }), { code: 'RESPONSE_MATERIAL_MISMATCH' });
  e.setMaterial({ ...material, scope: { ...scope, projectId: 'foreign' } });
  await assert.rejects(() => e.write('response.runbook.admit', { pin: e.pin }), { code: 'RESPONSE_MATERIAL_MISMATCH' });
  e.setMaterial(material);
  const admitted = await e.write('response.runbook.admit', { pin: e.pin }, 'admit'); assert.equal(admitted.result.withdrawn, false);
  const declaration = { pin: e.pin, actor: 'test-reviewer', rationale: 'Superseded synthetic guidance' };
  const review = await e.read('response.runbook.withdraw.review', declaration);
  await assert.rejects(() => e.write('response.runbook.withdraw', { ...declaration, reviewDigest: review.reviewDigest, humanEvidenceRef: 'unverified' }), { code: 'HUMAN_EVIDENCE_REQUIRED' });
  const receipt = await e.write('response.runbook.withdraw', { ...declaration, reviewDigest: review.reviewDigest, humanEvidenceRef: e.approve('response.runbook.withdraw', review.reviewDigest) }, 'withdraw');
  assert.equal(receipt.result.withdrawn, true); e.restart();
  assert.equal((await e.read('response.runbook.inspect', { pin: e.pin })).withdrawn, true);
  assert.deepEqual(await e.read('response.receipt.inspect', { requestId: 'withdraw' }), receipt);
  assert.deepEqual(await e.read('response.receipt.inspect', { requestId: 'admit' }), admitted);
});

test('synthetic problem assessments require owned findings and pinned review, retaining FAIL and UNKNOWN evidence', async t => {
  const e = setup(t);
  await assert.rejects(() => e.read('response.problem.prepare', { assessment: { ...e.assessment, findingIds: [nativeSha256('missing')] } }), { code: 'RESPONSE_FINDING_CHANGED' });
  const review = await e.read('response.problem.prepare', { assessment: e.assessment });
  assert.deepEqual(review.evidence.map(value => value.status), ['FAIL', 'UNKNOWN']);
  await assert.rejects(() => e.write('response.problem.put', { assessment: e.assessment, reviewDigest: review.reviewDigest, humanEvidenceRef: 'fake' }), { code: 'HUMAN_EVIDENCE_REQUIRED' });
  const { receipt, input } = await e.putAssessment(e.assessment, 'assessment');
  assert.equal(receipt.result.causes[0].kind, 'suspected'); assert.equal(receipt.result.disposition, null);
  assert.deepEqual(await e.write('response.problem.put', input, 'assessment'), receipt);
  await assert.rejects(() => e.read('response.problem.inspect', { id: e.assessment.id }, { ...scope, projectId: 'foreign' }), { code: 'RESPONSE_NOT_FOUND' });
  assert.equal((await e.read('response.evidence.inspect', { reference: e.faultRef })).status, 'FAIL');
  const next = { ...e.assessment, previousDigest: receipt.result.digest, impact: 'Explicit revised assessment' };
  const second = (await e.putAssessment(next)).receipt.result;
  assert.notEqual(second.digest, receipt.result.digest);
  assert.deepEqual(await e.read('response.problem.version', { id: e.assessment.id, digest: receipt.result.digest }), receipt.result);
  await assert.rejects(() => e.putAssessment(e.assessment), { code: 'RESPONSE_STALE_ASSESSMENT' });
});

for (const kind of ['DEFERRED', 'RISK_ACCEPTED']) test(`synthetic ${kind} retains scoped decision and expires without changing quality evidence or old snapshots`, async t => {
  const e = setup(t), original = (await e.putAssessment()).receipt.result;
  const declaration = { id: original.id, expectedDigest: original.digest, kind, actor: 'test-owner', rationale: 'Bounded synthetic risk', expiresAt: epoch() + 60, recovery: null, execution: null };
  await assert.rejects(() => e.read('response.problem.review', { ...declaration, expiresAt: null }), { code: 'RESPONSE_EXPIRY' });
  await assert.rejects(() => e.read('response.problem.review', { ...declaration, expiresAt: epoch() - 1 }), { code: 'RESPONSE_EXPIRY' });
  const review = await e.read('response.problem.review', declaration);
  const input = { ...declaration, reviewDigest: review.reviewDigest, humanEvidenceRef: e.approve('response.problem.decide', review.reviewDigest) };
  await assert.rejects(() => e.write('response.problem.decide', { ...input, actor: 'different-owner' }), { code: 'RESPONSE_REVIEW_MISMATCH' });
  const accepted = await e.write('response.problem.decide', input, 'risk');
  assert.equal(accepted.result.disposition.kind, kind); assert.equal(accepted.result.history.length, 1);
  assert.deepEqual(accepted.result.scope, scope);
  for (const field of ['actor', 'rationale', 'expiresAt', 'reviewDigest', 'humanEvidenceRef']) assert.equal(accepted.result.disposition[field], input[field], kind + ' retains exact ' + field);
  assert.deepEqual(accepted.result.history[0], accepted.result.disposition);
  assert.equal((await e.read('response.evidence.inspect', { reference: e.faultRef })).status, 'FAIL');
  assert.deepEqual(await e.read('response.problem.version', { id: original.id, digest: original.digest }), original);
  e.restart(); assert.deepEqual(await e.write('response.problem.decide', input, 'risk'), accepted);
  assert.equal((await e.read('response.problem.status', { id: original.id })).decisionEffective, true);
  const clock = Date.now;
  try {
    Date.now = () => clock() + 120000;
    const status = await e.read('response.problem.status', { id: original.id });
    assert.equal(status.decisionEffective, false); assert.equal(status.requiresReview, true); assert(status.reasonCodes.includes('EXPIRED'));
    assert.deepEqual(await e.read('response.problem.inspect', { id: original.id }), accepted.result, 'Expiry never rewrites the accepted decision');
  } finally { Date.now = clock; }
});

test('reviewed preventive followups require owned PASS evidence for DONE and preserve prior versions', async t => {
  const e = setup(t);
  const followup = { id: 'add-regression', description: 'Add an independently verified recurrence check', actor: 'synthetic-quality-owner', status: 'PROPOSED', evidence: [e.faultRef] };
  const first = { ...e.assessment, followups: [followup] }, prepared = await e.read('response.problem.prepare', { assessment: first });
  const changedCause = { ...first, causes: [{ ...first.causes[0], kind: 'confirmed' }] };
  await assert.rejects(e.write('response.problem.put', { assessment: changedCause, reviewDigest: prepared.reviewDigest, humanEvidenceRef: e.approve('response.problem.put', prepared.reviewDigest) }), { code: 'RESPONSE_REVIEW_MISMATCH' });
  await assert.rejects(e.read('response.problem.prepare', { assessment: { ...first, followups: [followup, followup] } }), { code: 'RESPONSE_FOLLOWUP' });
  const original = (await e.putAssessment(first)).receipt.result;
  const done = { ...first, previousDigest: original.digest, followups: [{ ...followup, status: 'DONE', evidence: [e.prerequisite] }] };
  await assert.rejects(e.read('response.problem.prepare', { assessment: { ...done, followups: [{ ...done.followups[0], evidence: [] }] } }), { code: 'RESPONSE_FOLLOWUP_EVIDENCE' });
  await assert.rejects(e.read('response.problem.prepare', { assessment: { ...done, followups: [{ ...done.followups[0], evidence: [e.faultRef] }] } }), { code: 'RESPONSE_FOLLOWUP_INCOMPLETE' });
  await assert.rejects(e.read('response.problem.prepare', { assessment: done }), { code: 'RESPONSE_FOLLOWUP_INCOMPLETE' });
  const missing = { owner: 'runtime', id: 'not-in-assessment', digest: nativeSha256('missing') };
  await assert.rejects(e.read('response.problem.prepare', { assessment: { ...done, followups: [{ ...done.followups[0], evidence: [missing] }] } }), { code: 'RESPONSE_FOLLOWUP_EVIDENCE' });
  const ledger = { owner: 'workspace', id: 'private/campaign.json', digest: nativeSha256('prose') };
  await assert.rejects(e.read('response.problem.prepare', { assessment: { ...done, evidence: [...done.evidence, ledger], followups: [{ ...done.followups[0], evidence: [ledger] }] } }), { code: 'RESPONSE_FOLLOWUP_EVIDENCE' });
  e.setExternalStatus('PASS');
  const doneReview = await e.read('response.problem.prepare', { assessment: done });
  e.setExternalStatus('UNKNOWN');
  await assert.rejects(e.write('response.problem.put', { assessment: done, reviewDigest: doneReview.reviewDigest, humanEvidenceRef: e.approve('response.problem.put', doneReview.reviewDigest) }), { code: 'RESPONSE_FOLLOWUP_INCOMPLETE' });
  e.setExternalStatus('PASS');
  const completed = (await e.putAssessment(done)).receipt.result;
  assert.equal(completed.followups[0].status, 'DONE'); assert.equal(completed.causes[0].kind, 'suspected');
  assert.deepEqual(await e.read('response.problem.version', { id: original.id, digest: original.digest }), original);
  assert.equal((await e.read('response.evidence.inspect', { reference: e.faultRef })).status, 'FAIL');
  e.restart(); assert.deepEqual(await e.read('response.problem.inspect', { id: original.id }), completed);
});

test('synthetic verified closure requires retained regression, Runtime verification and exact human review', async t => {
  const e = setup(t), original = (await e.putAssessment()).receipt.result;
  const missing = { owner: 'harness', id: nativeSha256('not-a-regression'), digest: nativeSha256('not-a-regression') };
  const declaration = { id: original.id, expectedDigest: original.digest, kind: 'VERIFIED_CLOSED', actor: 'test-owner', rationale: 'Reviewed recovery and validation', expiresAt: null, recovery: missing, execution: { owner: 'runtime', id: 'response:synthetic', digest: nativeSha256('not-an-execution') } };
  await assert.rejects(() => e.read('response.problem.review', declaration), { code: 'RESPONSE_NOT_FOUND' });
  const recoveryRef = e.recover();
  assert.equal((await e.read('response.evidence.inspect', { reference: { owner: 'harness', id: 'finding:' + e.resolved.id, digest: e.resolved.digest } })).status, 'UNKNOWN', 'A resolved alert never becomes validation PASS');
  const executionRef = e.verified(original, recoveryRef), execution = e.getExecution();
  const close = { ...declaration, recovery: recoveryRef, execution: executionRef };
  e.setExecution({ ...execution, status: 'UNVERIFIED' });
  await assert.rejects(() => e.read('response.problem.review', close), { code: 'RESPONSE_EXECUTION_MISMATCH' });
  e.setExecution(execution);
  const review = await e.read('response.problem.review', close);
  await assert.rejects(() => e.write('response.problem.decide', { ...close, reviewDigest: review.reviewDigest, humanEvidenceRef: 'fake' }), { code: 'HUMAN_EVIDENCE_REQUIRED' });
  const closed = await e.write('response.problem.decide', { ...close, reviewDigest: review.reviewDigest, humanEvidenceRef: e.approve('response.problem.decide', review.reviewDigest) });
  assert.equal(closed.result.disposition.kind, 'VERIFIED_CLOSED');
  assert.equal((await e.read('response.problem.status', { id: original.id })).decisionEffective, true);
  assert.deepEqual(await e.read('response.problem.version', { id: original.id, digest: original.digest }), original);
  assert.equal((await e.read('response.evidence.inspect', { reference: e.faultRef })).status, 'FAIL');
  const late = e.finding(e.observed('after-closure-fault', 'FAIL', epoch() - 1));
  e.incident.history.push(late.id); e.incident.state = 'FIRING'; e.incident.at = late.at;
  e.seed([['online-finding', late.id, { finding: late, delivery: null, error: null }], ['online-incident', e.incident.id, e.incident]]);
  const status = await e.read('response.problem.status', { id: original.id });
  assert.equal(status.decisionEffective, false); assert.equal(status.requiresReview, true); assert(status.reasonCodes.includes('NEW_FINDINGS'));
  assert.deepEqual(status.problem, closed.result, 'Late event changes effective status, not the historical closure');
});

test('synthetic late findings invalidate closure approval without rewriting earlier assessment or recovery', async t => {
  const e = setup(t), original = (await e.putAssessment()).receipt.result, recoveryRef = e.recover(), executionRef = e.verified(original, recoveryRef);
  const declaration = { id: original.id, expectedDigest: original.digest, kind: 'VERIFIED_CLOSED', actor: 'test-owner', rationale: 'Synthetic reviewed recovery', expiresAt: null, recovery: recoveryRef, execution: executionRef };
  const review = await e.read('response.problem.review', declaration);
  const late = e.finding(e.observed('late-fault', 'FAIL', epoch() - 1));
  e.incident.history.push(late.id); e.incident.state = 'FIRING'; e.incident.at = late.at;
  e.seed([['online-finding', late.id, { finding: late, delivery: null, error: null }], ['online-incident', e.incident.id, e.incident]]);
  await assert.rejects(() => e.write('response.problem.decide', { ...declaration, reviewDigest: review.reviewDigest, humanEvidenceRef: e.approve('response.problem.decide', review.reviewDigest) }), { code: 'RESPONSE_FINDING_CHANGED' });
  assert.deepEqual(await e.read('response.problem.inspect', { id: original.id }), original);
  assert.equal((await e.read('response.recovery.inspect', { id: recoveryRef.id })).outcome, 'PASS', 'Historical regression remains evidence, not current incident closure');
  const revised = (await e.putAssessment({ ...e.assessment, previousDigest: original.digest, findingIds: [...e.incident.history] })).receipt.result;
  const revisedExecution = e.verified(revised, recoveryRef);
  await assert.rejects(() => e.read('response.problem.review', { ...declaration, expectedDigest: revised.digest, execution: revisedExecution }), { code: 'RESPONSE_RECOVERY_STALE' });
});


test('long incident history uses a reviewed checkpoint; healthy sampling never starves approvals or reopens closure', async t => {
  const e = setup(t);
  const appendHealthy = (label, at) => {
    const row = e.finding(e.observed(label, 'PASS', at));
    e.incident.history.push(row.id); e.incident.state = 'RESOLVED'; e.incident.at = Math.max(e.incident.at, at);
    e.seed([['online-finding', row.id, { finding: row, delivery: null, error: null }], ['online-incident', e.incident.id, e.incident]]);
    return row;
  };
  for (let index = 0; index < 140; index++) appendHealthy('window-' + index, e.fault.windowEnd + 1);
  const context = await e.read('response.problem.context', { incidentId: e.incident.id });
  assert.equal(context.historySnapshot.count, 141); assert.equal(context.historySnapshot.firingCount, 1);
  assert.equal(context.findingIds.length, 2); assert(context.findingIds.includes(e.firing.id));
  const assessment = { ...e.assessment, findingIds: context.findingIds };
  const review = await e.read('response.problem.prepare', { assessment });
  appendHealthy('after-assessment-review', e.fault.windowEnd + 2);
  assert.equal((await e.read('response.problem.prepare', { assessment })).reviewDigest, review.reviewDigest);
  const original = (await e.write('response.problem.put', { assessment, reviewDigest: review.reviewDigest, humanEvidenceRef: e.approve('response.problem.put', review.reviewDigest) })).result;
  const recovery = e.recover(), execution = e.verified(original, recovery);
  const declaration = { id: original.id, expectedDigest: original.digest, kind: 'VERIFIED_CLOSED', actor: 'test-owner', rationale: 'Actual synthetic owner checkpoint', expiresAt: null, recovery, execution };
  const closure = await e.read('response.problem.review', declaration);
  appendHealthy('after-closure-review', e.recovery.windowEnd + 1);
  assert.equal((await e.read('response.problem.review', declaration)).reviewDigest, closure.reviewDigest);
  const closed = (await e.write('response.problem.decide', { ...declaration, reviewDigest: closure.reviewDigest, humanEvidenceRef: e.approve('response.problem.decide', closure.reviewDigest) })).result;
  appendHealthy('after-closure', e.recovery.windowEnd + 2);
  const healthy = await e.read('response.problem.status', { id: original.id });
  assert.equal(healthy.decisionEffective, true); assert.equal(healthy.requiresReview, false);
  assert.equal(healthy.unreviewedObservationCount, 2); assert.deepEqual(healthy.unassessedFindingIds, []);
  assert.equal(healthy.historySnapshot.count, 145); assert.equal(healthy.reviewedHistorySnapshot.count, 143);
  assert.equal((await e.read('response.evidence.inspect', { reference: e.faultRef })).status, 'FAIL');
  const late = e.finding(e.observed('late-historical-fault', 'FAIL', e.fault.windowEnd - 1));
  e.incident.history.push(late.id); // Deliberately preserve RESOLVED: delivery is late, not the event timestamp.
  e.seed([['online-finding', late.id, { finding: late, delivery: null, error: null }], ['online-incident', e.incident.id, e.incident]]);
  const changed = await e.read('response.problem.status', { id: original.id });
  assert.equal(changed.incidentState, 'RESOLVED'); assert.equal(changed.decisionEffective, false);
  assert.deepEqual(changed.unassessedFindingIds, [late.id]); assert(changed.reasonCodes.includes('NEW_FINDINGS'));
  await assert.rejects(e.read('response.problem.prepare', { assessment: { ...assessment, previousDigest: closed.digest } }), { code: 'RESPONSE_FINDING_CHANGED' });
  const newContext = await e.read('response.problem.context', { incidentId: e.incident.id });
  const next = await e.putAssessment({ ...assessment, previousDigest: closed.digest, findingIds: newContext.findingIds });
  assert.equal(next.review.historySnapshot.count, 146); assert.equal(next.review.historySnapshot.firingCount, 2);
  assert.deepEqual(await e.read('response.problem.version', { id: original.id, digest: closed.digest }), closed);
});

function alertCorrelationFixture(t) {
  const e = setup(t), regression = e.recover();
  const incidentId = nativeSha256({ binding: e.firing.bindingDigest, source: 'alertmanager', fingerprint: 'synthetic-event', startsAt: e.fault.windowEnd - 1 });
  function alert(state, at, label = state) {
    const { digest, ...base } = state === 'FIRING' ? e.firing : e.resolved;
    const body = { ...base, source: 'alertmanager', incidentId, state, at, id: nativeSha256('synthetic-alert-' + label), evidenceDigest: nativeSha256('authenticated-payload-' + label) };
    return { ...body, digest: nativeSha256(body) };
  }
  const firing = alert('FIRING', e.fault.windowEnd - 1), resolved = alert('RESOLVED', e.recovery.windowEnd - 1);
  const incident = { id: incidentId, bindingId: 'monitor', history: [firing.id], state: 'FIRING', at: firing.at };
  e.seed([['online-finding', firing.id, { finding: firing, delivery: null, error: null }], ['online-incident', incidentId, incident]]);
  function resolve() {
    incident.history.push(resolved.id); incident.state = 'RESOLVED'; incident.at = resolved.at;
    e.seed([['online-finding', resolved.id, { finding: resolved, delivery: null, error: null }], ['online-incident', incidentId, incident]]);
  }
  return { e, regression, incident, firing, resolved, alert, resolve, input: { regressionId: regression.id, incidentId, firingId: firing.id, resolvedId: resolved.id } };
}

test('Alertmanager correlation preserves original quality regression and rejects unresolved or foreign events', async t => {
  const f = alertCorrelationFixture(t), { e } = f;
  await assert.rejects(e.write('response.recovery.link', f.input), { code: 'RESPONSE_RECOVERY_LINK' });
  f.resolve();
  await assert.rejects(e.write('response.recovery.link', { ...f.input, firingId: e.firing.id }), { code: 'RESPONSE_RECOVERY_LINK' });
  await assert.rejects(e.write('response.recovery.link', { ...f.input, incidentId: e.incident.id }), { code: 'RESPONSE_RECOVERY_LINK' });
  const original = await e.read('response.recovery.inspect', { id: f.regression.id });
  const linked = (await e.write('response.recovery.link', f.input, 'exact-correlation')).result;
  assert.equal(linked.incidentId, f.incident.id); assert.notEqual(linked.reference.id, f.regression.id);
  for (const field of ['faultDigest', 'recoveryDigest', 'faultAt', 'recoveryAt', 'bindingId', 'serviceId', 'environment', 'deploymentRevision']) assert.equal(linked[field], original[field], field);
  assert.deepEqual(await e.read('response.recovery.inspect', { id: f.regression.id }), original);
  e.restart(); assert.deepEqual(await e.read('response.recovery.inspect', { id: linked.reference.id }), linked);
  assert.equal((await e.write('response.recovery.link', f.input, 'exact-correlation')).result.reference.digest, linked.reference.digest);
  const healthy = f.alert('RESOLVED', e.recovery.windowEnd + 1, 'later-healthy'); f.incident.history.push(healthy.id); f.incident.at = healthy.at;
  e.seed([['online-finding', healthy.id, { finding: healthy, delivery: null, error: null }], ['online-incident', f.incident.id, f.incident]]);
  assert.deepEqual(await e.read('response.recovery.inspect', { id: linked.reference.id }), linked, 'Later healthy alert observations preserve the pinned recovery');
  const late = f.alert('FIRING', f.firing.at, 'late-distinct'); f.incident.history.push(late.id);
  e.seed([['online-finding', late.id, { finding: late, delivery: null, error: null }], ['online-incident', f.incident.id, f.incident]]);
  await assert.rejects(e.read('response.recovery.inspect', { id: linked.reference.id }), { code: 'RESPONSE_RECOVERY_LINK_CHANGED' });
  assert.deepEqual(await e.read('response.recovery.inspect', { id: f.regression.id }), original);
});

test('correlation cannot substitute alert timing or deployment for independently measured quality', async t => {
  for (const change of ['old-regression', 'early-quality-recovery', 'wrong-deployment']) {
    const f = alertCorrelationFixture(t), { e } = f; f.resolve();
    const selected = change === 'old-regression' ? f.firing : f.resolved;
    const { digest, ...body } = selected;
    const changedBody = change === 'old-regression' ? { ...body, at: e.fault.windowEnd + 1 }
      : change === 'early-quality-recovery' ? { ...body, at: e.recovery.windowEnd + 1 }
      : { ...body, deploymentRevision: 'other-release' };
    const changed = { ...changedBody, digest: nativeSha256(changedBody) };
    e.seed([['online-finding', changed.id, { finding: changed, delivery: null, error: null }]]);
    await assert.rejects(e.write('response.recovery.link', f.input), { code: change === 'wrong-deployment' ? 'RESPONSE_RECOVERY_LINK' : 'RESPONSE_RECOVERY_LINK_TIME' }, change);
  }
});

test('new quality failure invalidates Alertmanager correlation while preserving the original regression', async t => {
  for (const lateHistorical of [false, true]) {
    const f = alertCorrelationFixture(t), { e } = f; f.resolve();
    const linked = (await e.write('response.recovery.link', f.input)).result;
    const at = lateHistorical ? e.fault.windowEnd - 1 : e.recovery.windowEnd + 1;
    const late = e.finding(e.observed('new-quality-failure', 'FAIL', at));
    e.incident.history.push(late.id); if (!lateHistorical) { e.incident.state = 'FIRING'; e.incident.at = at; }
    e.seed([['online-finding', late.id, { finding: late, delivery: null, error: null }], ['online-incident', e.incident.id, e.incident]]);
    await assert.rejects(e.read('response.recovery.inspect', { id: linked.reference.id }), { code: lateHistorical ? 'RESPONSE_RECOVERY_LINK_CHANGED' : 'RESPONSE_RECOVERY_STALE' });
    assert.equal((await e.read('response.recovery.inspect', { id: f.regression.id })).outcome, 'PASS', 'Historical regression remains immutable evidence');
  }
});
