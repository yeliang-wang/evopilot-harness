import { nativeExact, nativeDigest, nativeSha256 } from '../vendor/compatibility/v1/native.mjs';
import type { NativeScope } from '../vendor/compatibility/v1/native.mjs';
import { createFeedbackStore } from '../vendor/compatibility/feedback/v1/feedback.mjs';
import { validateOnlineFinding } from '../vendor/compatibility/online/v1/online.mjs';
import type { OnlineFinding } from '../vendor/compatibility/online/v1/online.mjs';
import { responseEqual as same, responseFail as fail, validateResponseRecovery } from '../vendor/compatibility/response/v1/response.mjs';
import type { ResponseRecovery } from '../vendor/compatibility/response/v1/response.mjs';
import type { Store } from './types.js';

interface LinkInput { regressionId: string; incidentId: string; firingId: string; resolvedId: string }
interface Incident { id: string; bindingId: string; history: string[]; state: 'FIRING' | 'RESOLVED'; at: number }
interface RecoveryLink {
  schema: 'evopilot-response-recovery-link/v1'; workspaceId: string; scope: NativeScope;
  input: LinkInput; regression: ResponseRecovery; firingDigest: string; resolvedDigest: string;
  firingHistoryDigest: string; regressionFiringHistoryDigest: string; digest: string;
}

/** A factual correlation retains two independent owner facts. An alert resolution
 * never supplies the native regression's quality result or timestamps. */
export function createRecoveryLinks(store: Store, records: ReturnType<typeof createFeedbackStore>, readRegression: (scope: NativeScope, id: string) => ResponseRecovery) {
  function required<T>(scope: NativeScope, kind: string, id: string): T {
    const value = records.get<T>(scope, kind, id); if (!value) fail('RESPONSE_NOT_FOUND'); return value;
  }
  function prepare(scope: NativeScope, value: unknown): RecoveryLink {
    nativeExact(value, ['regressionId', 'incidentId', 'firingId', 'resolvedId']);
    for (const key of ['regressionId', 'incidentId', 'firingId', 'resolvedId'] as const) nativeDigest(value[key]);
    const input = value as unknown as LinkInput;
    // Only a genuine original regression is admissible; no link-of-link chains.
    const regression = readRegression(scope, input.regressionId);
    const incident = required<Incident>(scope, 'online-incident', input.incidentId);
    if (incident.id !== input.incidentId || incident.state !== 'RESOLVED' || incident.bindingId !== regression.bindingId || new Set(incident.history).size !== incident.history.length) fail('RESPONSE_RECOVERY_LINK');
    const owned = incident.history.map(id => {
      const finding = required<{ finding: OnlineFinding }>(scope, 'online-finding', id).finding;
      validateOnlineFinding(finding);
      if (finding.id !== id || finding.workspaceId !== store.identity.id || !same(finding.scope, scope) || finding.incidentId !== incident.id || finding.source !== 'alertmanager' || finding.bindingId !== regression.bindingId || finding.serviceId !== regression.serviceId || finding.environment !== regression.environment || finding.deploymentRevision !== regression.deploymentRevision) fail('RESPONSE_RECOVERY_LINK');
      return finding;
    });
    const firing = owned.find(f => f.id === input.firingId), resolved = owned.find(f => f.id === input.resolvedId);
    if (!firing || !resolved || firing.state !== 'FIRING' || resolved.state !== 'RESOLVED' || firing.bindingDigest !== resolved.bindingDigest || !same(firing.policy, resolved.policy)) fail('RESPONSE_RECOVERY_LINK');
    const now = Math.floor(Date.now() / 1000);
    if (firing.at >= resolved.at || firing.at > regression.faultAt || regression.faultAt >= resolved.at || resolved.at > regression.recoveryAt || regression.recoveryAt > now || owned.some(f => f.state === 'FIRING' && f.at > regression.faultAt)) fail('RESPONSE_RECOVERY_LINK_TIME');
    const qualityIncident = required<Incident>(scope, 'online-incident', regression.incidentId);
    if (qualityIncident.state !== 'RESOLVED' || qualityIncident.bindingId !== regression.bindingId) fail('RESPONSE_RECOVERY_STALE');
    const qualityFaults = qualityIncident.history.map(id => {
      const f = required<{ finding: OnlineFinding }>(scope, 'online-finding', id).finding;
      validateOnlineFinding(f);
      if (f.id !== id || f.workspaceId !== store.identity.id || !same(f.scope, scope) || f.incidentId !== regression.incidentId || f.source !== 'evaluation' || f.bindingId !== regression.bindingId) fail('RESPONSE_RECOVERY_LINK');
      return f;
    }).filter(f => f.state === 'FIRING');
    if (qualityFaults.some(f => f.at >= regression.recoveryAt)) fail('RESPONSE_RECOVERY_STALE');
    const body = { schema: 'evopilot-response-recovery-link/v1' as const, workspaceId: store.identity.id, scope, input, regression, firingDigest: firing.digest, resolvedDigest: resolved.digest, firingHistoryDigest: nativeSha256(owned.filter(f => f.state === 'FIRING').map(f => f.digest)), regressionFiringHistoryDigest: nativeSha256(qualityFaults.map(f => f.digest)) };
    return { ...body, digest: nativeSha256(body) };
  }
  function projection(link: RecoveryLink): ResponseRecovery {
    const result = { ...link.regression, reference: { owner: 'harness' as const, id: link.digest, digest: link.digest }, incidentId: link.input.incidentId };
    validateResponseRecovery(result); return result;
  }
  function resolve(scope: NativeScope, id: string): ResponseRecovery {
    nativeDigest(id);
    const link = records.get<RecoveryLink>(scope, 'response-recovery-link', id);
    if (!link) return readRegression(scope, id);
    const { digest, ...body } = link;
    if (digest !== id || nativeSha256(body) !== digest || link.workspaceId !== store.identity.id || !same(link.scope, scope) || !same(prepare(scope, link.input), link)) fail('RESPONSE_RECOVERY_LINK_CHANGED');
    return projection(link);
  }
  function retain(link: RecoveryLink): ResponseRecovery {
    const prior = records.get<RecoveryLink>(link.scope, 'response-recovery-link', link.digest);
    if (prior && !same(prior, link)) fail('RESPONSE_IMMUTABLE_VERSION');
    if (!prior) records.put(link.scope, 'response-recovery-link', link.digest, link);
    return projection(link);
  }
  function matches(scope: NativeScope, recovery: ResponseRecovery, finding: OnlineFinding, state: 'FIRING' | 'RESOLVED'): boolean {
    if (finding.state !== state) return false;
    const link = records.get<RecoveryLink>(scope, 'response-recovery-link', recovery.reference.id);
    if (!link) return finding.evidenceDigest === (state === 'FIRING' ? recovery.faultDigest : recovery.recoveryDigest);
    return finding.id === (state === 'FIRING' ? link.input.firingId : link.input.resolvedId) && finding.digest === (state === 'FIRING' ? link.firingDigest : link.resolvedDigest);
  }
  return Object.freeze({ prepare, retain, resolve, matches });
}
