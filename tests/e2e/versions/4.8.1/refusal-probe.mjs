import assert from 'node:assert/strict';
import path from 'node:path';
import {exactKeys,isId,probeDigest,probeSession} from '../probe-session.mjs';

// Independent public-error oracle. Transport failures are not product refusals.
const ACTIONS=Object.freeze({UNAVAILABLE:'configure-published-semantic-catalog',PERMISSION_DENIED:'review-catalog-permission',
  TRUST_REQUIRED:'review-semantic-catalog',PATH_DENIED:'review-semantic-catalog',INVALID_JSON:'review-semantic-catalog',DIGEST_MISMATCH:'review-semantic-catalog',FILE_LIMIT:'review-semantic-catalog',
  UNSUPPORTED:'review-semantic-catalog',WIRE_SCHEMA_INVALID:'review-semantic-catalog',IDENTITY_CONFLICT:'review-semantic-catalog',
  SCOPE_INVALID:'review-semantic-catalog',MATERIAL_MISSING:'review-semantic-catalog',DEPENDENCY_CYCLE:'review-semantic-catalog',
  PARENT_INVALID:'review-semantic-catalog',REVOKED:'review-semantic-catalog',MATERIAL_LIMIT:'review-semantic-catalog',
  ENTRY_LIMIT:'review-semantic-catalog',EDGE_LIMIT:'review-semantic-catalog',DEPTH_LIMIT:'review-semantic-catalog',
  TOTAL_MATERIAL_LIMIT:'review-semantic-catalog',ROOT_LIMIT:'review-semantic-catalog',MATERIAL_INVALID:'review-semantic-catalog'});
function expectedFrame(expected) {
  exactKeys(expected,['catalogId','workspace','code']);assert.ok(isId(expected.catalogId));assert.ok(path.isAbsolute(expected.workspace));
  assert.ok(Object.hasOwn(ACTIONS,expected.code),'REFUSAL_CODE_NOT_SUPPORTED');return structuredClone(expected);
}
export function assertHarnessRefusal({expected,response}) {
  const e=expectedFrame(expected),nextAction=ACTIONS[e.code];
  exactKeys(response,['content','structuredContent']);
  const result={schema:'evopilot-harness-engine-operation-result/v1',operation:'semantic.catalog.inspect',workspace:e.workspace,
    exitCode:1,status:'FAILED',result:{schema:'evopilot-harness-error/v3',status:'FAILED',error:`Semantic Catalog ${e.code}.`,
      errorType:'SemanticCatalogError',nextAction,code:e.code},nextAction};
  assert.deepEqual(response.structuredContent,result,'REFUSAL_RESULT_CHANGED');
  assert.deepEqual(response.content,[{type:'text',text:JSON.stringify(result)}],'REFUSAL_TEXT_CHANGED');
}

/** One exact, read-only raw MCP diagnostic; fixture preparation belongs to an
 * independently authorized campaign, never this probe. No retry or repair. */
export async function runHarnessRefusalProbe({expected,invoke,authorizeInvocation,signal,timeoutMs=30000}) {
  const frozen=expectedFrame(expected);assert.equal(typeof invoke,'function');assert.equal(typeof authorizeInvocation,'function');
  const report=await probeSession({product:'harness',version:'4.8.1',signal,timeoutMs,invoke:async(call,options)=>{
    options.signal.throwIfAborted();assert.equal(await authorizeInvocation({call:structuredClone(call),commandDigest:probeDigest(call),effect:'READ'},options),true,'REFUSAL_INVOCATION_DENIED');
    options.signal.throwIfAborted();const response=await invoke(call,options);options.signal.throwIfAborted();return {exitCode:0,json:response};
  }},async request=>{
    const response=await request({tool:'run_engine_diagnostic',args:{operation:'semantic.catalog.inspect',input:{catalogId:frozen.catalogId}}});
    assertHarnessRefusal({expected:frozen,response:response.json});
  });
  return {...report,schema:'evopilot-harness-rc02-refusal-probe/v1',status:'REFUSAL_SUBJOURNEY_ASSERTIONS_PASSED',
    expectedDigest:probeDigest(frozen),code:frozen.code,nextAction:ACTIONS[frozen.code],mutationReplayed:false};
}
