import { nativeAssertJSON, nativeExact, nativeText, nativeDigest, nativeSha256, nativeFrozenClone, referenceForPackage } from '../vendor/compatibility/v1/native.mjs';
import type { NativeScope } from '../vendor/compatibility/v1/native.mjs';
import { verifyDecisionEvidence } from '../vendor/compatibility/v1/decision-evidence.mjs';
import { createFeedbackStore, feedbackScope, feedbackBounded } from '../vendor/compatibility/feedback/v1/feedback.mjs';
import type { FeedbackOwnerProviders } from '../vendor/compatibility/feedback/v1/feedback.mjs';
import { validateOnlineFinding } from '../vendor/compatibility/online/v1/online.mjs';
import type { OnlineFinding, OnlineObservation, OnlineBinding } from '../vendor/compatibility/online/v1/online.mjs';
import { responseEqual as same, responseFail as fail, responseReference, responseRunbookPin, validateResponseRunbook, validateResponseEvidence, validateResponseProblem, validateResponseFollowup, validateResponseRecovery, validateResponseExecutionVerification } from '../vendor/compatibility/response/v1/response.mjs';
import type { ResponseEnvelope, ResponseEvidenceRef, ResponseEvidence, ResponseProblem, ResponseCause, ResponseFollowup, ResponseDisposition, ResponseRecovery, ResolvedResponseRunbook, RunbookPin, ResponseExecutionVerification } from '../vendor/compatibility/response/v1/response.mjs';
import type { Store } from './types.js';
import { inspectHarnessPackage } from './native-package.js';
import { createRecoveryLinks } from './response-recovery.js';

export interface ResponseHarnessProviders extends FeedbackOwnerProviders {
  readResponseEvidence?: (input: { scope: NativeScope; reference: ResponseEvidenceRef }) => Promise<ResponseEvidence> | ResponseEvidence;
  readResponseRecovery?: (input: { scope: NativeScope; reference: ResponseEvidenceRef }) => Promise<ResponseRecovery> | ResponseRecovery;
  readResponseExecution?: (input: { scope: NativeScope; reference: ResponseEvidenceRef }) => Promise<ResponseExecutionVerification> | ResponseExecutionVerification;
}
export interface ResponseAssessment {
  id: string; previousDigest: string | null; incidentId: string; findingIds: string[];
  impact: string; causes: ResponseCause[]; followups: ResponseFollowup[]; evidence: ResponseEvidenceRef[];
}
interface RunbookRecord {
  resolved: ResolvedResponseRunbook;
  withdrawal: { actor: string; rationale: string; reviewDigest: string; humanEvidenceRef: string; at: number } | null;
}
interface ProblemDecisionInput {
  id: string; expectedDigest: string; kind: ResponseDisposition['kind']; actor: string;
  rationale: string; expiresAt: number | null; recovery: ResponseEvidenceRef | null;
  execution: ResponseEvidenceRef | null;
}
interface OnlineIncident { id: string; bindingId: string; history: string[]; state: 'FIRING' | 'RESOLVED'; at: number }
const decisionFields = ['id', 'expectedDigest', 'kind', 'actor', 'rationale', 'expiresAt', 'recovery', 'execution'];
export const RESPONSE_HARNESS_OPERATIONS = [
  'response.inspect', 'response.list', 'response.receipt.inspect', 'response.evidence.inspect', 'response.recovery.inspect', 'response.recovery.link',
  'response.runbook.admit', 'response.runbook.inspect', 'response.runbook.withdraw.review', 'response.runbook.withdraw',
  'response.problem.prepare', 'response.problem.put', 'response.problem.inspect', 'response.problem.version', 'response.problem.status', 'response.problem.context',
  'response.problem.review', 'response.problem.decide',
] as const;
const fields: Record<typeof RESPONSE_HARNESS_OPERATIONS[number], string[]> = {
  'response.inspect': [], 'response.list': [], 'response.receipt.inspect': ['requestId'], 'response.evidence.inspect': ['reference'], 'response.recovery.inspect': ['id'], 'response.recovery.link': ['regressionId', 'incidentId', 'firingId', 'resolvedId'],
  'response.runbook.admit': ['pin'], 'response.runbook.inspect': ['pin'],
  'response.runbook.withdraw.review': ['pin', 'actor', 'rationale'],
  'response.runbook.withdraw': ['pin', 'actor', 'rationale', 'reviewDigest', 'humanEvidenceRef'],
  'response.problem.prepare': ['assessment'], 'response.problem.put': ['assessment', 'reviewDigest', 'humanEvidenceRef'],
  'response.problem.inspect': ['id'], 'response.problem.version': ['id', 'digest'], 'response.problem.status': ['id'], 'response.problem.context': ['incidentId'],
  'response.problem.review': decisionFields,
  'response.problem.decide': [...decisionFields, 'reviewDigest', 'humanEvidenceRef'],
};
const mutations = new Set(['response.runbook.admit', 'response.runbook.withdraw', 'response.problem.put', 'response.problem.decide', 'response.recovery.link']);
const now = () => Math.floor(Date.now() / 1000);

/** An owner-local audit extension; original findings, native packages and reports are never rewritten. */
export function createHarnessResponse(store: Store, providers: ResponseHarnessProviders) {
  const records = createFeedbackStore(store, 'harness', 5);
  const recoveryLinks = createRecoveryLinks(store, records, ownedRegressionRecovery);
  function required<T>(scope: NativeScope, kind: string, id: string): T {
    const record = records.get<T>(scope, kind, id); if (!record) fail('RESPONSE_NOT_FOUND'); return record;
  }
  function problem(scope: NativeScope, id: string, digest?: string): ResponseProblem {
    nativeText(id);
    const head = digest ?? required<{ digest: string }>(scope, 'response-problem-head', id).digest;
    nativeDigest(head);
    const value = required<ResponseProblem>(scope, 'response-problem-version', head);
    validateResponseProblem(value);
    if (value.id !== id || value.workspaceId !== store.identity.id || !same(value.scope, scope)) fail('RESPONSE_SCOPE');
    return value;
  }
  function retainProblem(value: ResponseProblem): ResponseProblem {
    validateResponseProblem(value);
    const prior = records.get<ResponseProblem>(value.scope, 'response-problem-version', value.digest);
    if (prior && !same(prior, value)) fail('RESPONSE_IMMUTABLE_VERSION');
    if (!prior) records.put(value.scope, 'response-problem-version', value.digest, value);
    records.put(value.scope, 'response-problem-head', value.id, { id: value.id, digest: value.digest });
    return value;
  }
  function findings(scope: NativeScope, incidentId: string, ids: string[]): OnlineFinding[] {
    nativeDigest(incidentId);
    const incident = required<OnlineIncident>(scope, 'online-incident', incidentId);
    if (incident.id !== incidentId || new Set(incident.history).size !== incident.history.length || new Set(ids).size !== ids.length || ids.some(id => !incident.history.includes(id))) fail('RESPONSE_FINDING_CHANGED');
    return ids.map(id => {
      nativeDigest(id);
      const value = required<{ finding: OnlineFinding }>(scope, 'online-finding', id).finding;
      validateOnlineFinding(value);
      if (value.workspaceId !== store.identity.id || !same(value.scope, scope) || value.id !== id || value.incidentId !== incidentId || value.bindingId !== incident.bindingId) fail('RESPONSE_SCOPE');
      return value;
    });
  }
  function historySnapshot(owned: OnlineFinding[], count: number) {
    if (!Number.isSafeInteger(count) || count < 1 || count > owned.length) fail('RESPONSE_FINDING_CHANGED');
    const prefix = owned.slice(0, count), firing = prefix.filter(value => value.state === 'FIRING');
    return { count, digest: nativeSha256(prefix.map(value => value.digest)), firingCount: firing.length, firingDigest: nativeSha256(firing.map(value => value.digest)) };
  }
  function assessmentHistory(scope: NativeScope, incidentId: string, ids: string[]) {
    const incident = required<OnlineIncident>(scope, 'online-incident', incidentId), owned = findings(scope, incidentId, incident.history);
    findings(scope, incidentId, ids);
    const lastFault = owned.findLast(value => value.state === 'FIRING');
    if (!lastFault || !ids.includes(lastFault.id)) fail('RESPONSE_FINDING_CHANGED');
    const count = 1 + Math.max(...ids.map(id => incident.history.indexOf(id)));
    return { owned, snapshot: historySnapshot(owned, count) };
  }
  function assessedHistory(scope: NativeScope, current: ResponseProblem, owned: OnlineFinding[]) {
    const record = required<{ snapshot?: ReturnType<typeof historySnapshot> }>(scope, 'response-assessment-review', current.digest);
    const snapshot = record.snapshot ?? historySnapshot(owned, 1 + Math.max(...current.findingIds.map(id => owned.findIndex(value => value.id === id))));
    if (!same(historySnapshot(owned, snapshot.count), snapshot)) fail('RESPONSE_FINDING_CHANGED');
    return snapshot;
  }
  function observation(scope: NativeScope, id: string): OnlineObservation {
    nativeDigest(id);
    const value = required<OnlineObservation>(scope, 'online-observation', id), { digest, ...body } = value;
    if (digest !== nativeSha256(body) || value.id !== id || value.workspaceId !== store.identity.id || !same(value.scope, scope)) fail('RESPONSE_EVIDENCE_MISMATCH');
    return value;
  }
  function ownedEvidence(scope: NativeScope, reference: ResponseEvidenceRef): ResponseEvidence {
    responseReference(reference);
    if (reference.owner !== 'harness') fail('RESPONSE_SCOPE');
    let value: ResponseEvidence;
    if (reference.id.startsWith('finding:')) {
      const id = reference.id.slice('finding:'.length); nativeDigest(id);
      const finding = required<{ finding: OnlineFinding }>(scope, 'online-finding', id).finding;
      validateOnlineFinding(finding);
      if (finding.id !== id || finding.workspaceId !== store.identity.id || !same(finding.scope, scope) || finding.digest !== reference.digest) fail('RESPONSE_EVIDENCE_MISMATCH');
      value = { workspaceId: store.identity.id, scope, reference, status: finding.state === 'FIRING' ? 'FAIL' : 'UNKNOWN', observedAt: finding.at };
    } else if (reference.id.startsWith('observation:')) {
      const observed = observation(scope, reference.id.slice('observation:'.length));
      if (observed.digest !== reference.digest) fail('RESPONSE_EVIDENCE_MISMATCH');
      value = { workspaceId: store.identity.id, scope, reference, status: observed.outcome === 'INCOMPLETE' ? 'UNKNOWN' : observed.outcome, observedAt: observed.windowEnd };
    } else fail('RESPONSE_EVIDENCE_REFERENCE');
    validateResponseEvidence(value); return value;
  }
  function ownedRegressionRecovery(scope: NativeScope, id: string): ResponseRecovery {
    nativeDigest(id);
    interface Regression { bindingDigest: string; policy: OnlineObservation['policy']; fault: { id: string; digest: string; reportDigest: string; outcome: string }; recovery: { id: string; digest: string; reportDigest: string; outcome: string }; status: string; policyMutation: boolean; ontologyMutation: boolean; digest: string }
    const regression = required<Regression>(scope, 'online-regression', id), { digest, ...body } = regression;
    if (digest !== id || digest !== nativeSha256(body) || regression.status !== 'REVIEW_REQUIRED' || regression.policyMutation !== false || regression.ontologyMutation !== false) fail('RESPONSE_RECOVERY_MISMATCH');
    const fault = observation(scope, regression.fault.id), recovery = observation(scope, regression.recovery.id);
    const binding = required<OnlineBinding>(scope, 'online-binding', fault.bindingId);
    if (fault.bindingId !== recovery.bindingId || fault.bindingDigest !== recovery.bindingDigest || fault.bindingDigest !== regression.bindingDigest || binding.reviewDigest !== fault.bindingDigest || binding.workspaceId !== store.identity.id || !same(binding.scope, scope) || fault.digest !== regression.fault.digest || recovery.digest !== regression.recovery.digest || fault.outcome !== 'FAIL' || recovery.outcome !== 'PASS' || fault.windowEnd >= recovery.windowEnd || !same(fault.policy, regression.policy) || !same(recovery.policy, regression.policy)) fail('RESPONSE_RECOVERY_MISMATCH');
    const f = fault.nativeReport, r = recovery.nativeReport;
    if (!f || typeof f !== 'object' || Array.isArray(f) || !r || typeof r !== 'object' || Array.isArray(r) || f.executionStatus !== 'SUCCEEDED' || f.qualityStatus !== 'FAIL' || r.executionStatus !== 'SUCCEEDED' || r.qualityStatus !== 'PASS' || f.reportDigest !== regression.fault.reportDigest || r.reportDigest !== regression.recovery.reportDigest) fail('RESPONSE_RECOVERY_MISMATCH');
    const incidentId = nativeSha256({ binding: binding.reviewDigest, source: 'evaluation' });
    const incident = required<OnlineIncident>(scope, 'online-incident', incidentId), owned = findings(scope, incidentId, incident.history);
    if (!owned.some(value => value.state === 'FIRING' && value.evidenceDigest === fault.digest) || !owned.some(value => value.state === 'RESOLVED' && value.evidenceDigest === recovery.digest)) fail('RESPONSE_RECOVERY_MISMATCH');
    const value: ResponseRecovery = { workspaceId: store.identity.id, scope, reference: { owner: 'harness', id, digest }, bindingId: fault.bindingId, incidentId, serviceId: binding.spec.serviceId, environment: binding.spec.environment, deploymentRevision: binding.spec.deploymentRevision, faultDigest: fault.digest, recoveryDigest: recovery.digest, faultAt: fault.windowEnd, recoveryAt: recovery.windowEnd, outcome: 'PASS' };
    validateResponseRecovery(value); return value;
  }
  async function evidence(scope: NativeScope, reference: ResponseEvidenceRef): Promise<ResponseEvidence> {
    responseReference(reference);
    if (reference.owner === 'harness') return ownedEvidence(scope, reference);
    if (!providers.readResponseEvidence) fail('RESPONSE_EVIDENCE_PROVIDER_REQUIRED');
    const value = await feedbackBounded(() => providers.readResponseEvidence!({ scope, reference }));
    validateResponseEvidence(value);
    if (value.workspaceId !== store.identity.id || !same(value.scope, scope) || !same(value.reference, reference) || value.observedAt > now()) fail('RESPONSE_EVIDENCE_MISMATCH');
    return value;
  }
  async function publishedRunbook(scope: NativeScope, pin: RunbookPin): Promise<ResolvedResponseRunbook> {
    responseRunbookPin(pin);
    if (scope.visibility === 'public' && pin.reference.visibility === 'private') fail('RESPONSE_SCOPE');
    if (!providers.resolveFeedbackMaterial) fail('RESPONSE_MATERIAL_PROVIDER_REQUIRED');
    const material = await feedbackBounded(() => providers.resolveFeedbackMaterial!({ scope, reference: pin.reference }));
    if (!material.published || material.workspaceId !== store.identity.id || !same(material.reference, pin.reference) || material.scope.visibility !== pin.reference.visibility ||
        (pin.reference.visibility === 'private' ? !same(material.scope, scope) : ![scope.projectId, 'shared'].includes(material.scope.projectId))) fail('RESPONSE_MATERIAL_MISMATCH');
    inspectHarnessPackage(material.package);
    if (!same(referenceForPackage(material.package), pin.reference) || typeof material.package.files[pin.path] !== 'string') fail('RESPONSE_MATERIAL_MISMATCH');
    let runbook: unknown;
    try { runbook = JSON.parse(material.package.files[pin.path]); } catch { fail('RESPONSE_RUNBOOK'); }
    validateResponseRunbook(runbook);
    if (nativeSha256(runbook) !== pin.digest) fail('RESPONSE_RUNBOOK_INTEGRITY');
    return { workspaceId: store.identity.id, scope, pin, runbook, published: true, withdrawn: false };
  }
  async function runbook(scope: NativeScope, pin: RunbookPin): Promise<RunbookRecord> {
    responseRunbookPin(pin);
    const value = required<RunbookRecord>(scope, 'response-runbook', nativeSha256(pin));
    const resolved = await publishedRunbook(scope, pin);
    if (!same(value.resolved, { ...resolved, withdrawn: value.withdrawal !== null })) fail('RESPONSE_RUNBOOK_INTEGRITY');
    return value;
  }
  async function prepare(scope: NativeScope, input: unknown) {
    nativeExact(input, ['id', 'previousDigest', 'incidentId', 'findingIds', 'impact', 'causes', 'followups', 'evidence']);
    nativeText(input.id); nativeText(input.impact); nativeDigest(input.incidentId);
    if (input.previousDigest !== null) nativeDigest(input.previousDigest);
    if (!Array.isArray(input.findingIds) || !input.findingIds.length || input.findingIds.length > 128 || !Array.isArray(input.causes) || input.causes.length > 32 || !Array.isArray(input.evidence) || !input.evidence.length || input.evidence.length > 64) fail('RESPONSE_ASSESSMENT');
    const assessment = input as unknown as ResponseAssessment;
    const head = records.get<{ digest: string }>(scope, 'response-problem-head', assessment.id);
    if ((head?.digest ?? null) !== assessment.previousDigest) fail('RESPONSE_STALE_ASSESSMENT');
    const prior = head ? problem(scope, assessment.id) : null;
    const history = assessmentHistory(scope, assessment.incidentId, assessment.findingIds);
    const owned = findings(scope, assessment.incidentId, assessment.findingIds);
    if (!owned.some(value => value.state === 'FIRING')) fail('RESPONSE_FAULT_REQUIRED');
    const first = owned[0];
    if (owned.some(value => value.serviceId !== first.serviceId || value.environment !== first.environment || value.deploymentRevision !== first.deploymentRevision) || prior && (prior.incidentId !== first.incidentId || prior.serviceId !== first.serviceId || prior.environment !== first.environment || prior.deploymentRevision !== first.deploymentRevision)) fail('RESPONSE_SCOPE');
    const refs = new Map<string, ResponseEvidenceRef>();
    for (const ref of assessment.evidence) { responseReference(ref); refs.set(nativeSha256(ref), ref); }
    if (refs.size !== assessment.evidence.length) fail('RESPONSE_EVIDENCE_DUPLICATE');
    for (const cause of assessment.causes) {
      nativeExact(cause, ['kind', 'description', 'evidence']); nativeText(cause.description);
      if (!['observed', 'suspected', 'confirmed'].includes(cause.kind) || !Array.isArray(cause.evidence) || !cause.evidence.length || cause.evidence.length > 32) fail('RESPONSE_CAUSE');
      for (const ref of cause.evidence) { responseReference(ref); if (!refs.has(nativeSha256(ref))) fail('RESPONSE_CAUSE_EVIDENCE'); }
    }
    if (!Array.isArray(input.followups) || input.followups.length > 32) fail('RESPONSE_FOLLOWUP');
    const followupIds = new Set<string>();
    for (const followup of assessment.followups) {
      validateResponseFollowup(followup);
      if (followupIds.has(followup.id)) fail('RESPONSE_FOLLOWUP');
      followupIds.add(followup.id);
      for (const ref of followup.evidence) if (!refs.has(nativeSha256(ref))) fail('RESPONSE_FOLLOWUP_EVIDENCE');
    }
    const checked = await Promise.all([...refs.values()].map(ref => evidence(scope, ref)));
    const checkedByReference = new Map(checked.map(value => [nativeSha256(value.reference), value]));
    for (const followup of assessment.followups) if (followup.status === 'DONE' && followup.evidence.some(ref => checkedByReference.get(nativeSha256(ref))?.status !== 'PASS')) fail('RESPONSE_FOLLOWUP_INCOMPLETE');
    const body = { schema: 'evopilot-response-problem/v1' as const, id: assessment.id, workspaceId: store.identity.id, scope, incidentId: first.incidentId, findingIds: [...assessment.findingIds], serviceId: first.serviceId, environment: first.environment, deploymentRevision: first.deploymentRevision, impact: assessment.impact, causes: assessment.causes, followups: assessment.followups, evidence: assessment.evidence, disposition: null, history: prior?.history ?? [] };
    const candidate: ResponseProblem = { ...body, digest: nativeSha256(body) };
    validateResponseProblem(candidate);
    const subject = { workspaceId: store.identity.id, scope, assessment, historySnapshot: history.snapshot, findingDigests: owned.map(value => value.digest), evidence: checked, candidateDigest: candidate.digest };
    return { candidate, assessment, evidence: checked, historySnapshot: history.snapshot, reviewDigest: nativeSha256(subject), authority: false };
  }
  async function decisionReview(scope: NativeScope, input: Record<string, unknown>) {
    nativeExact(input, decisionFields);
    for (const key of ['id', 'actor', 'rationale'] as const) nativeText(input[key]);
    nativeDigest(input.expectedDigest);
    if (!['OPEN', 'DEFERRED', 'RISK_ACCEPTED', 'VERIFIED_CLOSED'].includes(String(input.kind))) fail('RESPONSE_DISPOSITION');
    const value = input as unknown as ProblemDecisionInput, current = problem(scope, value.id);
    if (current.digest !== value.expectedDigest) fail('RESPONSE_STALE_ASSESSMENT');
    if (value.expiresAt !== null && (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now())) fail('RESPONSE_EXPIRY');
    if (['DEFERRED', 'RISK_ACCEPTED'].includes(value.kind) && value.expiresAt === null) fail('RESPONSE_EXPIRY');
    if (['OPEN', 'VERIFIED_CLOSED'].includes(value.kind) && value.expiresAt !== null) fail('RESPONSE_EXPIRY');
    const incident = required<OnlineIncident>(scope, 'online-incident', current.incidentId);
    const owned = findings(scope, current.incidentId, incident.history);
    if (current.findingIds.some(id => !incident.history.includes(id))) fail('RESPONSE_FINDING_CHANGED');
    const assessed = assessedHistory(scope, current, owned);
    const unassessed = owned.slice(assessed.count).filter(value => value.state === 'FIRING');
    let recovery: ResponseRecovery | null = null, execution: ResponseExecutionVerification | null = null;
    if (value.kind === 'VERIFIED_CLOSED') {
      responseReference(value.recovery); responseReference(value.execution);
      if (value.execution.owner !== 'runtime' || value.recovery.owner !== 'harness' || !providers.readResponseExecution) fail('RESPONSE_CLOSURE_PROVIDER_REQUIRED');
      recovery = recoveryLinks.resolve(scope, value.recovery.id);
      if (providers.readResponseRecovery) {
        const resolved = await feedbackBounded(() => providers.readResponseRecovery!({ scope, reference: value.recovery! }));
        if (!same(resolved, recovery)) fail('RESPONSE_RECOVERY_MISMATCH');
      }
      validateResponseRecovery(recovery);
      if (recovery.workspaceId !== store.identity.id || !same(recovery.scope, scope) || !same(recovery.reference, value.recovery) || recovery.outcome !== 'PASS' || recovery.incidentId !== current.incidentId || recovery.serviceId !== current.serviceId || recovery.environment !== current.environment || recovery.deploymentRevision !== current.deploymentRevision || recovery.recoveryAt > now() || !owned.some(f => recoveryLinks.matches(scope, recovery!, f, 'FIRING'))) fail('RESPONSE_RECOVERY_MISMATCH');
      if (unassessed.length) fail('RESPONSE_FINDING_CHANGED');
      if (owned.some(value => value.state === 'FIRING' && value.at >= recovery!.recoveryAt)) fail('RESPONSE_RECOVERY_STALE');
      execution = await feedbackBounded(() => providers.readResponseExecution!({ scope, reference: value.execution! }));
      validateResponseExecutionVerification(execution);
      if (execution.workspaceId !== store.identity.id || !same(execution.scope, scope) || !same(execution.reference, value.execution) || execution.problemId !== current.id || execution.problemDigest !== current.digest || execution.serviceId !== current.serviceId || execution.environment !== current.environment || execution.deploymentRevision !== current.deploymentRevision || execution.status !== 'VERIFIED' || !same(execution.recovery, value.recovery) || execution.verifiedAt === null || !Number.isSafeInteger(execution.verifiedAt) || execution.verifiedAt < recovery.recoveryAt || execution.verifiedAt > now()) fail('RESPONSE_EXECUTION_MISMATCH');
    } else {
      if (value.recovery !== null || value.execution !== null) fail('RESPONSE_CLOSURE_INPUT');
      if (unassessed.length) fail('RESPONSE_FINDING_CHANGED');
    }
    const recoveryIndex = recovery ? owned.findIndex(f => recoveryLinks.matches(scope, recovery!, f, 'RESOLVED')) : -1;
    if (recovery && recoveryIndex < 0) fail('RESPONSE_RECOVERY_MISMATCH');
    const snapshot = historySnapshot(owned, Math.max(assessed.count, recoveryIndex + 1));
    const subject = { workspaceId: store.identity.id, scope, ...value, recovery, execution, historySnapshot: snapshot };
    return { input: value, problem: current, recovery, execution, historySnapshot: snapshot, findingIds: current.findingIds, reviewDigest: nativeSha256(subject), authority: false };
  }
  async function response(request: ResponseEnvelope): Promise<unknown> {
    nativeAssertJSON(request);
    const op = request.operation as typeof RESPONSE_HARNESS_OPERATIONS[number];
    if (!RESPONSE_HARNESS_OPERATIONS.includes(op)) fail('RESPONSE_OPERATION');
    nativeExact(request, ['operation', 'scope', 'input', ...(mutations.has(op) ? ['requestId', 'expectedRevision'] : [])]);
    feedbackScope(request.scope); nativeExact(request.input, fields[op]); store.guard();
    const { scope, input } = request;
    if (mutations.has(op) && request.requestId && records.receipt(scope, request.requestId)) return records.mutate(request, () => fail('RESPONSE_REPLAY'));
    if (op === 'response.inspect') return nativeFrozenClone({ ...records.inspect(scope), operations: RESPONSE_HARNESS_OPERATIONS, softwareRelease: false, ontologyMutation: false });
    if (op === 'response.list') return nativeFrozenClone({ runbooks: records.list<RunbookRecord>(scope, 'response-runbook'), problems: records.list<{ id: string }>(scope, 'response-problem-head').map(head => problem(scope, head.id)) });
    if (op === 'response.receipt.inspect') { nativeText(input.requestId); return records.receipt(scope, input.requestId); }
    if (op === 'response.evidence.inspect') { responseReference(input.reference); return nativeFrozenClone(ownedEvidence(scope, input.reference)); }
    if (op === 'response.recovery.inspect') { nativeDigest(input.id); return nativeFrozenClone(recoveryLinks.resolve(scope, input.id)); }
    if (op === 'response.recovery.link') { const link = recoveryLinks.prepare(scope, input); return records.mutate(request, () => recoveryLinks.retain(link)); }
    if (op === 'response.runbook.admit') {
      responseRunbookPin(input.pin); const resolved = await publishedRunbook(scope, input.pin);
      if (resolved.runbook.expiresAt <= now()) fail('RESPONSE_RUNBOOK_EXPIRED');
      return records.mutate(request, () => {
        const id = nativeSha256(resolved.pin), prior = records.get<RunbookRecord>(scope, 'response-runbook', id);
        if (prior) return prior.resolved;
        records.put(scope, 'response-runbook', id, { resolved, withdrawal: null }); return resolved;
      });
    }
    if (op === 'response.runbook.inspect') { responseRunbookPin(input.pin); return nativeFrozenClone((await runbook(scope, input.pin)).resolved); }
    if (op.startsWith('response.runbook.withdraw')) {
      responseRunbookPin(input.pin); nativeText(input.actor); nativeText(input.rationale);
      const current = await runbook(scope, input.pin), subject = { workspaceId: store.identity.id, scope, pin: input.pin, actor: input.actor, rationale: input.rationale }, reviewDigest = nativeSha256(subject);
      if (op === 'response.runbook.withdraw.review') return nativeFrozenClone({ ...subject, reviewDigest, withdrawn: current.resolved.withdrawn, authority: false });
      nativeText(input.humanEvidenceRef);
      if (input.reviewDigest !== reviewDigest) fail('RESPONSE_REVIEW_MISMATCH');
      verifyDecisionEvidence(input.humanEvidenceRef, { owner: 'harness', operation: op, workspaceId: store.identity.id, scope, reviewDigest, decision: 'APPROVE' });
      return records.mutate(request, () => {
        if (current.withdrawal) fail('RESPONSE_IMMUTABLE_DECISION');
        current.resolved.withdrawn = true; current.withdrawal = { actor: input.actor as string, rationale: input.rationale as string, reviewDigest, humanEvidenceRef: input.humanEvidenceRef as string, at: now() };
        records.put(scope, 'response-runbook', nativeSha256(current.resolved.pin), current); return current.resolved;
      });
    }
    if (op === 'response.problem.context') {
      nativeDigest(input.incidentId);
      const incident = required<OnlineIncident>(scope, 'online-incident', input.incidentId);
      const owned = findings(scope, input.incidentId, incident.history), latestFault = owned.findLast(value => value.state === 'FIRING');
      if (!latestFault || !owned.length) fail('RESPONSE_FAULT_REQUIRED');
      return nativeFrozenClone({ incidentId: incident.id, incidentState: incident.state, findingIds: [...new Set([latestFault.id, owned[owned.length - 1].id])], historySnapshot: historySnapshot(owned, owned.length), authority: false });
    }
    if (op === 'response.problem.inspect') { nativeText(input.id); return nativeFrozenClone(problem(scope, input.id)); }
    if (op === 'response.problem.version') { nativeText(input.id); nativeDigest(input.digest); return nativeFrozenClone(problem(scope, input.id, input.digest)); }
    if (op === 'response.problem.status') {
      nativeText(input.id); const current = problem(scope, input.id), disposition = current.disposition;
      const incident = required<OnlineIncident>(scope, 'online-incident', current.incidentId);
      const owned = findings(scope, current.incidentId, incident.history);
      const decision = disposition ? required<{ review: { findingIds: string[]; historySnapshot?: ReturnType<typeof historySnapshot> } }>(scope, 'response-decision-review', disposition.reviewDigest) : null;
      const assessed = assessedHistory(scope, current, owned);
      const checkpoint = decision?.review.historySnapshot ?? assessed;
      if (!same(historySnapshot(owned, checkpoint.count), checkpoint)) fail('RESPONSE_FINDING_CHANGED');
      const appended = owned.slice(checkpoint.count);
      const unassessedFindingIds = appended.filter(value => value.state === 'FIRING').map(value => value.id);
      const expired = disposition?.expiresAt !== null && disposition?.expiresAt !== undefined && disposition.expiresAt <= now();
      const reasonCodes = [...(!disposition ? ['NO_DISPOSITION'] : []), ...(unassessedFindingIds.length ? ['NEW_FINDINGS'] : []), ...(expired ? ['EXPIRED'] : []), ...(disposition?.kind === 'VERIFIED_CLOSED' && incident.state !== 'RESOLVED' ? ['INCIDENT_FIRING'] : [])];
      return nativeFrozenClone({ problem: current, incidentState: incident.state, historySnapshot: historySnapshot(owned, owned.length), reviewedHistorySnapshot: checkpoint, unreviewedObservationCount: appended.length, unassessedFindingIds, decisionEffective: disposition !== null && reasonCodes.length === 0, requiresReview: reasonCodes.length > 0, reasonCodes, observedAt: now(), authority: false });
    }
    if (op === 'response.problem.prepare' || op === 'response.problem.put') {
      const prepared = await prepare(scope, input.assessment);
      if (op === 'response.problem.prepare') return nativeFrozenClone(prepared);
      nativeText(input.humanEvidenceRef);
      if (input.reviewDigest !== prepared.reviewDigest) fail('RESPONSE_REVIEW_MISMATCH');
      verifyDecisionEvidence(input.humanEvidenceRef, { owner: 'harness', operation: op, workspaceId: store.identity.id, scope, reviewDigest: prepared.reviewDigest, decision: 'APPROVE' });
      return records.mutate(request, () => {
        records.put(scope, 'response-assessment-review', prepared.candidate.digest, { reviewDigest: prepared.reviewDigest, humanEvidenceRef: input.humanEvidenceRef, snapshot: prepared.historySnapshot });
        return retainProblem(prepared.candidate);
      });
    }
    const decisionInput = Object.fromEntries(decisionFields.map(key => [key, input[key]]));
    const review = await decisionReview(scope, decisionInput);
    if (op === 'response.problem.review') return nativeFrozenClone(review);
    nativeText(input.humanEvidenceRef);
    if (input.reviewDigest !== review.reviewDigest) fail('RESPONSE_REVIEW_MISMATCH');
    verifyDecisionEvidence(input.humanEvidenceRef, { owner: 'harness', operation: op, workspaceId: store.identity.id, scope, reviewDigest: review.reviewDigest, decision: 'APPROVE' });
    return records.mutate(request, () => {
      const disposition: ResponseDisposition = { kind: review.input.kind, actor: review.input.actor, rationale: review.input.rationale, expiresAt: review.input.expiresAt, humanEvidenceRef: input.humanEvidenceRef as string, reviewDigest: review.reviewDigest, at: now() };
      records.put(scope, 'response-decision-review', review.reviewDigest, { review, humanEvidenceRef: input.humanEvidenceRef });
      const { digest: ignored, ...body } = review.problem; void ignored;
      const updated = { ...body, disposition, history: [...body.history, disposition] };
      const result = { ...updated, digest: nativeSha256(updated) };
      records.put(scope, 'response-assessment-review', result.digest, required(scope, 'response-assessment-review', review.problem.digest));
      return retainProblem(result);
    });
  }
  return Object.freeze({ response });
}
