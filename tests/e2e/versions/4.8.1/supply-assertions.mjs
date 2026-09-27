import assert from 'node:assert/strict';
import {probeDigest,isDigest} from '../probe-session.mjs';

/** Independent public projection oracle against an externally frozen expected
 * generation. No producer imports, material loading, publication or repair.
 * Projection equality does not replace actual material/receipt verification. */
export function assertHarnessSupplyProjection({discovery,generation}) {
  assert.equal(generation.schema,'evopilot-harness-semantic-catalog/v1');
  const {generationDigest,...body}=generation;assert.ok(isDigest(generationDigest));assert.equal(probeDigest(body),generationDigest);
  assert.equal(discovery.schema,'evopilot-harness-semantic-supply-discovery/v1');assert.equal(discovery.status,'AVAILABLE');
  assert.equal(discovery.catalogId,generation.catalogId);assert.equal(discovery.generationDigest,generationDigest);
  assert.equal(discovery.readOnly,true);assert.equal(discovery.grantsPublicationAuthority,false);
  assert.deepEqual(discovery.entries,generation.entries,'RC01_SUPPLY_ENTRIES_CHANGED');
  assert.deepEqual(discovery.sets,generation.sets,'RC01_SUPPLY_SETS_CHANGED');
  assert.deepEqual(discovery.revokedDigests,generation.revokedDigests,'RC01_SUPPLY_REVOCATION_CHANGED');
  assert.ok(generation.entries.length>0&&generation.entries.length<=4096);
  assert.ok(Array.isArray(generation.sets)&&generation.sets.length>0&&generation.sets.length<=4096);
  for(const set of generation.sets) {
    const scoped=d=>generation.entries.filter(e=>e.objectDigest===d&&probeDigest(e.scope)===probeDigest(set.scope));
    for(const [ref,kind] of [['artifactSet','ProjectOntologyArtifactSet'],['skill','ProjectOntologySkill'],['closure','TerminalSemanticClosure']]) {
      const matches=scoped(set.refs[ref]);assert.equal(matches.length,1);assert.equal(matches[0].kind,kind);
      assert.ok(!generation.revokedDigests.includes(matches[0].objectDigest));
    }
    const parent=scoped(set.refs.artifactSet)[0],skill=scoped(set.refs.skill)[0];
    assert.equal(skill.parent.artifactSetDigest,parent.objectDigest);assert.equal(skill.parent.jsonPointer,'/spec/projectOntologySkill');
    assert.equal(skill.fileDigest,parent.fileDigest);assert.equal(skill.path,parent.path);
    assert.ok(skill.dependencies.includes(parent.objectDigest));
  }
  return {schema:'evopilot-harness-rc01-supply-projection-assertion/v1',status:'SUPPLY_PROJECTION_ASSERTIONS_PASSED',
    generationDigest,entryCount:generation.entries.length,setCount:generation.sets.length,targetCriteriaClosed:0,
    formalAcceptance:'NOT_EVALUATED',materialBytes:'NOT_INDEPENDENTLY_READ_BY_THIS_ASSERTION',releaseAuthorized:false};
}
