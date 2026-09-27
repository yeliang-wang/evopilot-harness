import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {exactKeys,isDigest,isId,probeDigest} from '../probe-session.mjs';
import {assertHarnessSupplyProjection} from './supply-assertions.mjs';
import {readHarnessSupplyEvidence} from './supply-materials.mjs';

const textHash=value=>'sha256:'+crypto.createHash('sha256').update(value).digest('hex');
const hashed=(v,key)=>{const {[key]:d,...body}=v;assert.ok(isDigest(d));assert.equal(probeDigest(body),d,'PUBLICATION_RECORD_DIGEST_MISMATCH');};

/** Session-owned publication, in separately authorized phases. The MCP caller
 * must be raw: no implicit confirmations or fabricated presentation receipts.
 * Host display evidence and campaign authority are independent prerequisites. */
export async function runHarnessPublicationJourney({phase,publicationInput,generation,catalogRoot,adapterId,hostInteraction,sessionRef,decision,
  invoke,authorizeInvocation,deliverBusinessView,signal,timeoutMs=30000}) {
  assert.ok(['prepare','confirm-plan','publish','readback'].includes(phase));assert.equal(typeof invoke,'function');assert.equal(typeof authorizeInvocation,'function');
  assert.ok(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=120000);
  ({publicationInput,generation,sessionRef,decision,hostInteraction}=structuredClone({publicationInput,generation,sessionRef,decision,hostInteraction}));
  exactKeys(publicationInput,['catalogId','file','inputDigest','expectedGenerationDigest','expectedHead','requestId','publication']);
  assert.ok(isId(publicationInput.catalogId)&&isId(publicationInput.requestId));assert.ok(isDigest(publicationInput.inputDigest));
  assert.ok(publicationInput.expectedHead==='EMPTY'||isDigest(publicationInput.expectedHead));
  hashed(generation,'generationDigest');assert.equal(generation.generationDigest,publicationInput.expectedGenerationDigest);assert.equal(generation.catalogId,publicationInput.catalogId);
  if(phase==='prepare'){assert.ok(isId(adapterId)&&hostInteraction);assert.equal(sessionRef,undefined);assert.equal(decision,undefined);}
  else if(phase!=='readback') {
    exactKeys(sessionRef,['sessionId','sessionDigest','planDigest']);assert.ok(isId(sessionRef.sessionId));assert.ok([sessionRef.sessionDigest,sessionRef.planDigest].every(isDigest));
    exactKeys(decision,['confirmedBy','confirmation','frameDigest']);assert.ok(isId(decision.confirmedBy)&&isDigest(decision.frameDigest));assert.equal(typeof deliverBusinessView,'function');
  }
  const deadline=performance.now()+timeoutMs,controller=new AbortController(),events=[];let mutatingAttempted=false,publishAttempted=false,session;
  const check=()=>{controller.signal.throwIfAborted();assert.ok(performance.now()<deadline,'PUBLICATION_JOURNEY_TIMEOUT');};
  const cancel=()=>controller.abort(new Error('PUBLICATION_JOURNEY_CANCELLED'));signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  const timer=setTimeout(()=>controller.abort(new Error('PUBLICATION_JOURNEY_TIMEOUT')),timeoutMs);
  let abort;const cancelled=new Promise((_,reject)=>{abort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',abort,{once:true});});cancelled.catch(()=>{});
  const wait=async fn=>{check();const result=await Promise.race([Promise.resolve().then(()=>{check();return fn();}),cancelled]);check();return result;};
  const call=async(tool,args,effect='READ')=>{
    const call={tool,args:structuredClone(args)};
    assert.equal(await wait(()=>authorizeInvocation({call:structuredClone(call),commandDigest:probeDigest(call),effect},{signal:controller.signal})),true,'PUBLICATION_INVOCATION_DENIED');
    const result=await wait(()=>{if(effect!=='READ')mutatingAttempted=true;if(effect==='PUBLISH_CATALOG')publishAttempted=true;return invoke(call,{signal:controller.signal});});
    const bytes=JSON.stringify(result);assert.ok(typeof bytes==='string'&&Buffer.byteLength(bytes)<=4194304,'PUBLICATION_RESPONSE_LIMIT');
    const captured=JSON.parse(bytes);assert.equal(captured.isError??false,false,'PUBLICATION_MCP_REFUSAL');assert.ok(captured.structuredContent);
    events.push({tool,effect,commandDigest:probeDigest(call),responseDigest:probeDigest(captured.structuredContent)});return captured.structuredContent;
  };
  const checkSession=value=>{
    assert.equal(value.schema,'evopilot-harness-agent-operation-session/v3');hashed(value,'sessionDigest');assert.ok(isId(value.sessionId));
    if(session)assert.equal(value.sessionId,session.sessionId);
    if(value.plan) {
      assert.equal(value.planDigest,probeDigest(value.plan));assert.equal(value.plan.scenario,'maintenance');
      assert.deepEqual(value.plan.operations,[{operation:'semantic.catalog.publish',input:publicationInput}],'PUBLICATION_PLAN_CHANGED');
      assert.deepEqual(value.plan.authority,{engineAuthoritative:true,humanApprovalRequired:true,publicationSeparate:true,sourceExecutionAllowed:false});
    }
    session=value;return value;
  };
  const baseArgs=()=>({sessionId:session.sessionId,expectedSessionDigest:session.sessionDigest,expectedPlanDigest:session.planDigest});
  const report=(status,extra={})=>({schema:'evopilot-harness-rc01-publication-journey/v1',phase,status,events,...extra,
    ...(session?{sessionRef:{sessionId:session.sessionId,sessionDigest:session.sessionDigest,planDigest:session.planDigest}}:{}),
    targetCriteriaClosed:0,formalAcceptance:'NOT_EVALUATED',installedIdentity:'REQUIRES_EXTERNAL_EXACT_BINDING',realHost:'NOT_QUALIFIED',releaseAuthorized:false});
  const expectedReceiptBody={schema:'evopilot-harness-semantic-catalog-receipt/v1',catalogId:publicationInput.catalogId,generationDigest:generation.generationDigest,
    expectedHead:publicationInput.expectedHead==='EMPTY'?null:publicationInput.expectedHead,action:'PUBLISH',requestDigest:textHash(publicationInput.requestId),authorization:publicationInput.publication};
  const expectedPointerBody={schema:'evopilot-harness-semantic-catalog-pointer/v1',catalogId:publicationInput.catalogId,
    generationPath:`semantic-catalog/generations/${generation.generationDigest.slice(7)}.json`,generationDigest:generation.generationDigest,
    previousPointerDigest:expectedReceiptBody.expectedHead,receiptDigest:probeDigest(expectedReceiptBody)};
  const verifyPublished=async()=>{
    const readback=await call('run_engine_diagnostic',{operation:'semantic.catalog.readback',input:{catalogId:publicationInput.catalogId,requestId:publicationInput.requestId}});
    assert.equal(readback.result.status,'COMMITTED','PUBLICATION_NOT_COMMITTED');
    const discovery=await call('run_engine_diagnostic',{operation:'semantic.catalog.inspect',input:{catalogId:publicationInput.catalogId}});
    assertHarnessSupplyProjection({discovery:discovery.result,generation});
    const expected={catalogId:publicationInput.catalogId,generationDigest:generation.generationDigest,pointerDigest:probeDigest(expectedPointerBody)};
    assert.equal(discovery.result.pointerDigest,expected.pointerDigest);
    check();
    const supplyEvidence=readHarnessSupplyEvidence({catalogRoot,generation,expected,publication:{requestId:publicationInput.requestId,
      expectedHead:expectedReceiptBody.expectedHead,authorization:publicationInput.publication},readback:readback.result,signal:controller.signal,
      timeoutMs:Math.max(1,Math.min(30000,Math.floor(deadline-performance.now())))});
    check();return report('PUBLICATION_SUBJOURNEY_ASSERTIONS_PASSED',{supplyEvidence});
  };
  try {
    controller.signal.throwIfAborted();
    if(phase==='readback')return await verifyPublished();
    if(phase==='prepare') {
      checkSession(await call('start_operation_session',{intent:'Publish one exactly reviewed semantic Catalog generation',adapterId,hostInteraction},'CREATE_SESSION'));
      checkSession(await call('plan_operation_session',{sessionId:session.sessionId,expectedSessionDigest:session.sessionDigest,scenario:'maintenance',goal:session.intent.text,
        operations:[{operation:'semantic.catalog.publish',input:publicationInput}]},'PREPARE_PLAN'));
      assert.equal(session.status,'PLAN_REVIEW_REQUIRED');return report('WAITING_PLAN_DECISION',{frame:session.interaction.currentFrame});
    }
    checkSession(await call('inspect_operation_session',{sessionId:sessionRef.sessionId}));
    assert.deepEqual({sessionId:session.sessionId,sessionDigest:session.sessionDigest,planDigest:session.planDigest},sessionRef,'PUBLICATION_SESSION_DRIFT');
    const frame=structuredClone(session.interaction.currentFrame);assert.equal(frame.frameDigest,decision.frameDigest,'PUBLICATION_FRAME_DRIFT');
    const expectedStage=phase==='confirm-plan'?'PLAN_PRESENTATION':'OPERATION_AUTHORIZATION_PRESENTATION';assert.equal(frame.stage,expectedStage);
    assert.equal(session.status,phase==='confirm-plan'?'PLAN_REVIEW_REQUIRED':'OPERATION_AUTHORIZATION_REQUIRED');
    const pending=session.pendingOperationAuthorization;
    if(phase==='publish')assert.deepEqual(pending,{operationIndex:0,operation:'semantic.catalog.publish',inputDigest:probeDigest(publicationInput),planDigest:session.planDigest,
      operationDigest:probeDigest({planDigest:session.planDigest,operationIndex:0,operation:'semantic.catalog.publish',inputDigest:probeDigest(publicationInput)})});
    const confirmation=phase==='confirm-plan'?`CONFIRM_OPERATION_PLAN:${session.planDigest}`:
      `AUTHORIZE_PLAN_PUBLICATION:${session.sessionId}:${session.planDigest}:0:${pending.operationDigest}`;
    assert.equal(decision.confirmation,confirmation,'PUBLICATION_EXACT_DECISION_REQUIRED');
    const delivery=await wait(()=>deliverBusinessView({sessionRef:structuredClone(sessionRef),frame:structuredClone(frame)},{signal:controller.signal}));
    exactKeys(delivery,['frameDigest','renderedBusinessViewDigest']);assert.equal(delivery.frameDigest,frame.frameDigest);
    assert.equal(delivery.renderedBusinessViewDigest,textHash(frame.businessView.canonicalMarkdown),'PUBLICATION_DISPLAY_MISMATCH');
    checkSession(await call('record_business_view_delivery',{sessionId:session.sessionId,expectedSessionDigest:session.sessionDigest,expectedFrameDigest:frame.frameDigest,
      deliveredBusinessViewDigest:frame.businessView.businessViewDigest,renderedBusinessViewDigest:delivery.renderedBusinessViewDigest},'RECORD_VERIFIED_PRESENTATION'));
    if(phase==='confirm-plan') {
      checkSession(await call('confirm_operation_plan',{...baseArgs(),confirmedBy:decision.confirmedBy,confirmation},'CONFIRM_EXACT_PLAN'));
      checkSession(await call('execute_operation_plan',baseArgs(),'REACH_PUBLICATION_GATE'));
      assert.equal(session.status,'OPERATION_AUTHORIZATION_REQUIRED');return report('WAITING_PUBLICATION_DECISION',{frame:session.interaction.currentFrame,pending:session.pendingOperationAuthorization});
    }
    checkSession(await call('authorize_plan_publication_operation',{...baseArgs(),operationIndex:0,expectedOperationDigest:pending.operationDigest,confirmedBy:decision.confirmedBy,confirmation},'AUTHORIZE_EXACT_PUBLICATION'));
    assert.equal(session.status,'READY_TO_EXECUTE');
    checkSession(await call('execute_operation_plan',baseArgs(),'PUBLISH_CATALOG'));assert.equal(session.status,'COMPLETED');
    assert.ok(session.humanDecisions.some(d=>d.type==='PLAN_PUBLICATION_AUTHORIZED'));return await verifyPublished();
  } catch(error) {
    if(publishAttempted)return report('UNKNOWN_PUBLICATION_OUTCOME',{requestId:publicationInput.requestId,nextAction:'readback-only-no-publication-replay'});
    if(mutatingAttempted)return report('UNKNOWN_SESSION_OUTCOME',{nextAction:'inspect-session-before-any-retry'});
    controller.signal.throwIfAborted();throw error;
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',abort);}
}
