import assert from 'node:assert/strict';
import {exactKeys,isDigest,probeDigest} from '../probe-session.mjs';

/** The independent consumer report is external evidence, not an instruction,
 * permission, project binding or proof of fresh installed/Host identity. */
export function assertHarnessConsumerHandoff({expected,response}) {
  exactKeys(expected,['schema','status','catalogId','registryDigest','policyDigest','trustContext','pointer','generation','receipt',
    'materialDigests','legacy','eligibleForExecution']);
  assert.equal(expected.schema,'evopilot-source-semantic-consumer-evidence/v1');
  assert.equal(expected.status,'CONFIGURED_MATERIALS_VERIFIED');assert.equal(expected.eligibleForExecution,false);
  for(const d of [expected.registryDigest,expected.policyDigest,expected.pointer.pointerDigest,
    expected.generation.generationDigest,expected.receipt.receiptDigest])assert.ok(isDigest(d));
  assert.equal(expected.catalogId,expected.generation.catalogId);
  assert.equal(expected.pointer.generationDigest,expected.generation.generationDigest);
  assert.equal(expected.pointer.receiptDigest,expected.receipt.receiptDigest);
  assert.equal(expected.receipt.generationDigest,expected.generation.generationDigest);
  assert.ok(Array.isArray(expected.materialDigests)&&expected.materialDigests.length>0);
  assert.equal(new Set(expected.materialDigests.map(x=>x.path)).size,expected.materialDigests.length);
  for(const material of expected.materialDigests){exactKeys(material,['path','documentDigest']);assert.ok(isDigest(material.documentDigest));}
  assert.deepEqual(expected.materialDigests.map(x=>x.path).sort(),[...new Set(expected.generation.entries.map(x=>x.path))].sort());
  assert.deepEqual(response,expected,'INDEPENDENT_CONSUMER_HANDOFF_CHANGED');
  return {schema:'evopilot-harness-rc04-consumer-handoff-evidence/v1',status:'HANDOFF_SOURCE_ASSERTIONS_PASSED',
    expectedDigest:probeDigest(expected),targetCriteriaClosed:0,formalAcceptance:'NOT_EVALUATED',
    installedIdentity:'NOT_VERIFIED',realHost:'NOT_RUN',releaseAuthorized:false};
}
