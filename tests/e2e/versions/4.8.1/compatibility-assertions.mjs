import assert from 'node:assert/strict';
import {exactKeys,isDigest,probeDigest} from '../probe-session.mjs';

// Pure evidence oracle. The external campaign owns file capture and the
// independent consumer; Harness never invokes Runtime or executes a project.
export function assertHarnessCompatibility({expected,legacyBefore,legacyAfter,filesAfter,generation}) {
  exactKeys(expected,['filesBefore','registry','legacy','generation']);
  assert.ok(Object.keys(expected.filesBefore).length>0);
  for(const [file,digest] of Object.entries(expected.filesBefore)) {
    assert.ok(file&&!file.startsWith('/')&&!file.split('/').includes('..'));
    assert.ok(isDigest(digest));assert.equal(filesAfter[file],digest,'LEGACY_FILE_CHANGED: '+file);
  }
  const registry=expected.registry;
  assert.ok(['evopilot-harness-registry/v1','evopilot-harness-registry/v2'].includes(registry.schema));
  assert.equal(Object.hasOwn(registry,'entries')||Object.hasOwn(registry,'assets'),false);
  assert.ok(Array.isArray(registry.catalogs)&&registry.catalogs.length>0);
  for(const root of registry.catalogs) {
    assert.equal(typeof root.root,'string');
    assert.equal(Object.hasOwn(root,'entries')||Object.hasOwn(root,'assets'),false,'REGISTRY_MUST_CONTAIN_ROOTS_ONLY');
  }
  assert.equal(expected.legacy.schema,'evopilot-source-legacy-consumer-evidence/v1');
  assert.equal(expected.legacy.status,'READY');assert.ok(isDigest(expected.legacy.catalogDigest));
  assert.deepEqual(legacyBefore,expected.legacy,'OLD_CONSUMER_BASELINE_CHANGED');
  assert.deepEqual(legacyAfter,expected.legacy,'OLD_CONSUMER_RESULT_CHANGED');
  assert.deepEqual(generation,expected.generation,'SEMANTIC_ASSET_VERSION_OR_CONTENT_CHANGED');
  const entries=generation.entries.filter(e=>['ProjectOntologyArtifactSet','TerminalSemanticClosure'].includes(e.kind));
  assert.equal(entries.length,2);assert.ok(entries.every(e=>e.version&&isDigest(e.objectDigest)));
  return {schema:'evopilot-harness-rc03-compatibility-evidence/v1',status:'COMPATIBILITY_SOURCE_ASSERTIONS_PASSED',
    expectedDigest:probeDigest(expected),preservedFiles:Object.keys(expected.filesBefore).length,
    targetCriteriaClosed:0,formalAcceptance:'NOT_EVALUATED',installedIdentity:'NOT_VERIFIED',realHost:'NOT_RUN',releaseAuthorized:false};
}
