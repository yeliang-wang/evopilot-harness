import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
export const probeDigest = x => 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
export const isDigest = x => typeof x === 'string' && /^sha256:[a-f0-9]{64}$/.test(x);
export const isId = x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(x);
export function exactKeys(value, keys) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'PROBE_INPUT_INVALID');
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'PROBE_INPUT_FIELDS_INVALID');
}

/** Transport-neutral, fixed-command probe support. An invocation must resolve to
 * {exitCode,json}; it must reject on timeout/transport error, not disguise those
 * as a negative product assertion. Exact installed identity and effect authority
 * belong to the external acceptance binding. This module grants neither. */
export async function probeSession({product, version, invoke, signal, timeoutMs = 30000}, body) {
  assert.equal(typeof invoke, 'function', 'PROBE_TRANSPORT_REQUIRED');
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000, 'PROBE_TIMEOUT_INVALID');
  const controller = new AbortController(), events = [];
  const abort = () => controller.abort(new Error('PROBE_CANCELLED'));
  signal?.addEventListener('abort', abort, {once:true}); if (signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error('PROBE_TIMEOUT')), timeoutMs);
  let rejectAbort;
  const cancelled = new Promise((_, reject) => {rejectAbort=()=>reject(controller.signal.reason); controller.signal.addEventListener('abort',rejectAbort,{once:true});});
  // Attach immediately, including the already-cancelled-before-first-call case.
  cancelled.catch(()=>{});
  const request = async args => {
    controller.signal.throwIfAborted();
    const captured = structuredClone(args);
    const response = await Promise.race([Promise.resolve().then(()=>invoke(structuredClone(captured), {signal:controller.signal})),cancelled]);
    controller.signal.throwIfAborted();
    exactKeys(response,['exitCode','json']);
    assert.ok(Number.isInteger(response.exitCode) && response.exitCode >= 0 && response.exitCode <= 255, 'PROBE_PROCESS_RESULT_INVALID');
    const bytes=JSON.stringify(response.json);
    assert.ok(typeof bytes==='string' && Buffer.byteLength(bytes)<=1048576,'PROBE_RESPONSE_LIMIT');
    const copy=JSON.parse(bytes);
    events.push({index:events.length,commandDigest:probeDigest(captured),responseDigest:probeDigest(copy),exitCode:response.exitCode});
    return {exitCode:response.exitCode,json:copy};
  };
  try {
    controller.signal.throwIfAborted();
    await body(request); controller.signal.throwIfAborted();
    return {schema:'evopilot-versioned-readonly-probe/v1',product,version,status:'PROBE_ASSERTIONS_PASSED',events,
      observationDigest:probeDigest(events),targetCriteriaClosed:0,formalAcceptance:'NOT_EVALUATED',
      installedIdentity:'REQUIRES_EXTERNAL_EXACT_BINDING',realHost:'NOT_QUALIFIED_BY_THIS_PROBE',
      workBuddy:'NOT_OPERATED_OR_OBSERVED',releaseAuthorized:false};
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',rejectAbort);}
}
