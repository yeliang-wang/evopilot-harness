import assert from 'node:assert/strict';
import {exactKeys,isDigest,isId,probeSession} from '../probe-session.mjs';
import {assertHarnessSupplyProjection} from './supply-assertions.mjs';

/** Read-only portion of RC01-M1 for an independently prepared published supply.
 * Workspace, installed CLI identity and authority are bound by the outer runner.
 * This probe never builds, prepares, publishes, rolls back or repairs a Catalog. */
export async function runHarnessDiscoveryProbe({invoke,expected,generation,signal,timeoutMs}) {
  exactKeys(expected,['catalogId','pointerDigest','generationDigest']);
  assert.ok(isId(expected.catalogId));assert.ok([expected.pointerDigest,expected.generationDigest].every(isDigest));
  const captured=structuredClone(expected);
  if(generation!==undefined)assert.ok(generation&&typeof generation==='object'&&!Array.isArray(generation),'PROBE_GENERATION_REQUIRED');
  const frozenGeneration=generation===undefined?undefined:structuredClone(generation);
  const report=await probeSession({product:'harness',version:'4.8.1',invoke,signal,timeoutMs},async request=>{
    let prior;
    for(let attempt=0;attempt<2;attempt++) {
      const r=await request(['semantic','catalog-inspect','--catalog-id',captured.catalogId,'--json']);
      assert.equal(r.exitCode,0,'PROBE_COMMAND_FAILED');const value=r.json;
      assert.equal(value.schema,'evopilot-harness-semantic-supply-discovery/v1');assert.equal(value.status,'AVAILABLE');
      assert.equal(value.catalogId,captured.catalogId);assert.equal(value.pointerDigest,captured.pointerDigest,'PROBE_POINTER_DRIFT');
      assert.equal(value.generationDigest,captured.generationDigest,'PROBE_GENERATION_DRIFT');assert.ok(isDigest(value.policyDigest));
      assert.equal(value.readOnly,true);assert.equal(value.grantsPublicationAuthority,false);
      assert.ok(Array.isArray(value.entries)&&value.entries.length>0);assert.ok(Array.isArray(value.sets)&&value.sets.length>0);
      assert.ok(Array.isArray(value.revokedDigests));
      if(frozenGeneration)assertHarnessSupplyProjection({discovery:value,generation:frozenGeneration});
      if(prior)assert.deepEqual(value,prior,'PROBE_DISCOVERY_DRIFT');prior=value;
    }
  });
  return {...report,supplyProjection:frozenGeneration?'INDEPENDENT_EXPECTED_PROJECTION_CHECKED':'NOT_REQUESTED'};
}
