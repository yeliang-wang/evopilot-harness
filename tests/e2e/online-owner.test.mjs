import {syntheticAuthoring} from '../fixtures/native/authoring.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createHarnessService} from '@evopilot-next/harness/service';
import {nativeSha256} from '@evopilot-next/harness/native';
import {inspectWorkspaceSnapshot} from '@evopilot-next/harness/workspace-migration';
import {measurementBody,createAlertmanagerReceiver} from '@evopilot-next/harness/online';
import {syntheticOnlinePackage} from '../../examples/native/online-package.mjs';
import {syntheticDecisionEvidence} from '../fixtures/native/decision-evidence.mjs';
const scope={visibility:'private',projectId:'synthetic'};
async function setup(t){
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'online-owner-')),options={workspaceId:'online-tests',workspaceRoot:path.join(root,'workspace')};
 const tokenFile=path.join(root,'token'),token='synthetic-alert-token-1234';fs.writeFileSync(tokenFile,token,{mode:0o600});
 const receiver=createAlertmanagerReceiver([{id:'alerts',bearerTokenFile:tokenFile}]);
 let ratio=1,reason=null,calls=0,service;
 const providers={resolveNativeAuthoring:syntheticAuthoring,nativeToolchain:JSON.parse(fs.readFileSync(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN)),inspectOnlineAlert:receiver.inspect,collectOnline:async({binding,windowEnd})=>{
  calls++;const points=[];for(let time=windowEnd-binding.slo.windowSeconds+1;time<=windowEnd;time++)points.push({time,good:ratio,total:1,goodSourceTime:time,totalSourceTime:time});
  const body=measurementBody(binding,windowEnd,points,reason?[reason]:[],[nativeSha256('synthetic-provider')]);return {...body,digest:nativeSha256(body)};
 }};
 const open=()=>{service=createHarnessService(options,providers);service.initialize();};open();
 t.after(()=>{service.close();fs.rmSync(root,{recursive:true,force:true});});
 let sequence=0;
 const read=(operation,input={})=>service.online({operation,scope,input});
 const write=async(operation,input,requestId='request-'+(++sequence))=>{
  if(input.decision)input={...input,humanEvidenceRef:syntheticDecisionEvidence(root,{owner:'harness',operation,workspaceId:options.workspaceId,scope,reviewDigest:input.reviewDigest,decision:input.decision})};
  return service.online({operation,scope,input,requestId,expectedRevision:(await read('online.inspect')).revision});
 };
 const pkg=syntheticOnlinePackage(),identity={id:pkg.manifest.id,version:pkg.manifest.version};
 const native=async(operation,input)=>service.native({operation,scope,input,requestId:'native-'+(++sequence),expectedRevision:service.execute({operation:'workspace.inspect',scope,input:{}}).revision});
 await native('native.package.put',{package:pkg});const validation=await native('native.package.validate',identity);assert.equal(validation.result.qualityStatus,'PASS',JSON.stringify(validation.result.issues));
 const review=(await native('native.package.review',identity)).result;await native('native.package.decide',{...identity,decision:'APPROVE',reviewDigest:review.reviewDigest,humanEvidenceRef:syntheticDecisionEvidence(root,{owner:'harness',operation:'native.package.decide',workspaceId:options.workspaceId,scope,reviewDigest:review.reviewDigest,decision:'APPROVE'})});
 const published=(await native('native.package.publish',identity)).result;
 const slo=JSON.parse(fs.readFileSync(new URL('../../specifications/online/v1/example.json',import.meta.url)));
 const spec={id:'monitor',serviceId:'example-service',environment:'test',deploymentRevision:'fixed',providerId:'metrics',alertSourceId:'alerts',policy:published.reference,slo,intervalSeconds:1};
 const b=(await write('online.binding.put',{spec})).result;
 const approve=()=>write('online.binding.decide',{id:spec.id,decision:'APPROVE',reviewDigest:b.reviewDigest,humanEvidenceRef:'synthetic'});
 const select=selected=>write('online.binding.select',{id:spec.id,selected});
 const evaluate=async(end)=>write('online.evaluate',{id:spec.id,windowEnd:end},'window-'+end);
 return {root,options,spec,b,read,write,approve,select,evaluate,receiver,token,setRatio:v=>{ratio=v;},setReason:v=>{reason=v;},calls:()=>calls,restart:()=>{service.close();open();},get service(){return service;},native};
}
test('online binding starts disabled; exact reviewed policy/target and immutable service revision are required',async t=>{
 const e=await setup(t);assert.equal(e.b.selected,false);assert.equal(e.calls(),0);await assert.rejects(()=>e.select(true),{code:'ONLINE_APPROVAL_REQUIRED'});
 await assert.rejects(()=>e.write('online.binding.put',{spec:{...e.spec,deploymentRevision:'changed'}}),{code:'ONLINE_IMMUTABLE_BINDING'});
 const slo=structuredClone(e.spec.slo);slo.spec.objectives[0].target=0.9;await assert.rejects(()=>e.write('online.binding.put',{spec:{...e.spec,id:'changed',slo}}),{code:'ONLINE_POLICY_TARGET_MISMATCH'});
 await e.approve();await e.select(true);assert.equal((await e.read('online.binding.inspect',{id:'monitor'})).selected,true);
 await assert.rejects(()=>e.service.online({operation:'online.binding.inspect',scope:{...scope,projectId:'foreign'},input:{id:'monitor'}}),{code:'ONLINE_NOT_FOUND'});
});
test('online native fault and recovery retain reports, same-window replay, incident history and reviewable regression',async t=>{
 const e=await setup(t);await e.approve();await e.select(true);const end=Math.floor(Date.now()/1000)-4;e.setRatio(0);
 const failed=(await e.evaluate(end)).observation;assert.equal(failed.outcome,'FAIL');assert.equal(failed.nativeReport.qualityStatus,'FAIL');assert.ok(failed.nativeReport.commands.some(c=>c.tool==='conftest'));assert.equal(failed.measurement.ratio,0);
 assert.deepEqual((await e.evaluate(end)).observation,failed);assert.equal(e.calls(),1);
 e.setRatio(1);const recovered=(await e.evaluate(end+1)).observation;assert.equal(recovered.outcome,'PASS');assert.equal(recovered.nativeReport.qualityStatus,'PASS');
 const state=await e.read('online.inspect');assert.equal(state.incidents[0].state,'RESOLVED');assert.equal(state.incidents[0].history.length,2);assert.equal(state.findings.length,2);
 const regression=(await e.write('online.regression.verify',{faultId:failed.id,recoveryId:recovered.id})).result;assert.equal(regression.status,'REVIEW_REQUIRED');assert.equal(regression.fault.outcome,'FAIL');assert.equal(regression.recovery.outcome,'PASS');assert.equal(regression.policyMutation,false);
 const before=inspectWorkspaceSnapshot(e.options);e.restart();assert.equal((await e.read('online.observation.inspect',{id:failed.id})).digest,failed.digest);assert.equal(inspectWorkspaceSnapshot(e.options).snapshotDigest,before.snapshotDigest);
 const db=new DatabaseSync(path.join(e.options.workspaceRoot,'state/harness/harness.db'));assert.equal(db.prepare('PRAGMA user_version').get().user_version,6);db.close();
});
test('online incomplete collection has no healthy result or false incident recovery',async t=>{
 const e=await setup(t);await e.approve();await e.select(true);const end=Math.floor(Date.now()/1000)-5;e.setRatio(0);await e.evaluate(end);e.setRatio(1);e.setReason('STALE_SAMPLES');
 const result=(await e.evaluate(end+1)).observation;assert.equal(result.outcome,'INCOMPLETE');assert.equal(result.nativeReport,null);assert.equal((await e.read('online.inspect')).incidents[0].state,'FIRING');
});
test('selected online schedule resumes persisted watermarks; backlog is explicit and each tick is bounded',async t=>{
 const e=await setup(t);await e.approve();await e.select(true);await e.select(false);const b=await e.read('online.binding.inspect',{id:'monitor'});assert.equal(b.selected,false);const before=e.calls();assert.equal((await e.read('online.tick')).completed.length,0);assert.equal(e.calls(),before);
 await e.select(true);e.restart();const selected=await e.read('online.binding.inspect',{id:'monitor'});assert.equal(selected.nextWindowEnd,b.nextWindowEnd);
 // Advance wall time in this isolated process, without rewriting owner evidence.
 const original=Date.now;Date.now=()=>original()+20000;t.after(()=>{Date.now=original;});
 const tick=await e.read('online.tick');assert.equal(tick.completed.length,8);assert.equal(tick.status,'INCOMPLETE_BACKLOG');assert.ok(tick.backlog>0);
 const after=await e.read('online.binding.inspect',{id:'monitor'});assert.equal(after.nextWindowEnd,selected.nextWindowEnd+8);e.restart();assert.equal((await e.read('online.binding.inspect',{id:'monitor'})).nextWindowEnd,after.nextWindowEnd);Date.now=original;
});
function alert(state,startsAt,endsAt,override={}){return {version:'4',groupKey:'synthetic',truncatedAlerts:0,status:state,receiver:'evopilot',groupLabels:{},commonLabels:{},commonAnnotations:{},externalURL:'http://127.0.0.1:9093',alerts:[{status:state,labels:{service:'example-service',environment:'test',deployment:'fixed',alertname:'SyntheticDown',...override},annotations:{},startsAt:new Date(startsAt*1000).toISOString(),endsAt:new Date(endsAt*1000).toISOString(),generatorURL:'http://127.0.0.1:9090',fingerprint:'abcdef0123456789'}]};}
test('authenticated Alertmanager batches deduplicate and late firing cannot erase recovery',async t=>{
 const e=await setup(t);await e.approve();await e.select(true);const now=Math.floor(Date.now()/1000)-1,start=now-5;
 const send=(payload,auth='Bearer '+e.token)=>e.receiver.receive('alerts',auth,Buffer.from(JSON.stringify(payload)),batch=>e.write('online.alert.ingest',{sourceId:'alerts',digest:batch.digest},'alert-'+batch.digest.slice(7)));
 const firing=alert('firing',start,now),resolved=alert('resolved',start,now);
 await assert.rejects(()=>send(firing,'Bearer incorrect'),{code:'ALERT_UNAUTHORIZED'});assert.equal((await e.read('online.inspect')).findings.length,0);
 await assert.rejects(()=>send(alert('firing',start,now,{deployment:'foreign'})),{code:'ALERT_SERVICE_MISMATCH'});
 await send(resolved);await send(firing);await send(firing);const s=await e.read('online.inspect');assert.equal(s.incidents[0].state,'RESOLVED');assert.equal(s.findings.length,2);assert.equal(s.incidents[0].history.length,2);
 await assert.rejects(()=>e.write('online.alert.ingest',{sourceId:'alerts',digest:nativeSha256('fake')}),{code:'ALERT_UNVERIFIED'});
 await assert.rejects(()=>send({...firing,truncatedAlerts:1}),{code:'ALERT_PAYLOAD'});
});

test('a real interrupted collector leaves a durable claim; restart resumes the same read-only window exactly once',async t=>{
 const e=await setup(t);await e.approve();await e.select(true);const end=Math.floor(Date.now()/1000)-2;
 const request={operation:'online.evaluate',scope,input:{id:'monitor',windowEnd:end},requestId:'interrupted-window',expectedRevision:(await e.read('online.inspect')).revision};e.service.close();
 const script=`import {createHarnessService} from '@evopilot-next/harness/service';const s=createHarnessService(${JSON.stringify(e.options)},{collectOnline:async()=>{process.exit(86);}});s.initialize();await s.online(${JSON.stringify(request)});`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:new URL('../../',import.meta.url),encoding:'utf8',timeout:10000});assert.ifError(child.error);assert.equal(child.status,86,child.stderr);
 e.restart();const claim=await e.read('online.receipt.inspect',{requestId:request.requestId});assert.equal(claim.result.windowEnd,end);assert.equal((await e.read('online.inspect')).observations.length,0);
 const result=await e.service.online(request);assert.equal(result.observation.outcome,'PASS');assert.equal(result.claim.result.id,claim.result.id);assert.equal(e.calls(),1);
 const receipt=await e.read('online.receipt.inspect',{requestId:request.requestId});assert.deepEqual(receipt,claim);e.restart();assert.deepEqual(await e.service.online(request),result);assert.equal(e.calls(),1);
});
