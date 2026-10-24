import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {writeFileSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {usabilityDigest} from '@evopilot-next/harness';
import {assessmentFixture} from '../fixtures/usability-assessment.mjs';

const status=async f=>(await f.call('usability.assessment.read',{id:'assessment'})).assessmentStatus;
test('UA01 reviewed semantic evidence awards L1/L2 and preserves explicit target',async t=>{
  for(const level of ['L1','L2','L3']){const f=await assessmentFixture(t,{level});assert.equal(await status(f),'NOT_EVALUATED');await f.record();const result=await f.evaluate();assert.equal(result.targetLevel,level);assert.equal(result.verifiedLevel,level==='L3'?'L2':level);assert.equal(result.assessmentStatus,level==='L3'?'UNSUPPORTED':'VERIFIED');assert.equal(result.authority,false);assert.equal(result.softwareRelease,false);assert.equal(result.denominator.required,level==='L1'?1:14);}
});
test('UA02 shape-complete documents, missing review and synthetic review cannot award a level',async t=>{
  const f=await assessmentFixture(t);assert.equal((await f.evaluate()).verifiedLevel,null);
  for(const change of [{origin:'SYNTHETIC'},{independent:false}]){await f.record({...f.report,...change});const result=await f.evaluate();assert.equal(result.verifiedLevel,null);assert.equal(result.assessmentStatus,'INCOMPLETE');}
});
test('UA03 semantic FAIL UNKNOWN UNSUPPORTED and missing mandatory results cannot certify L2',async t=>{
  for(const value of ['FAIL','UNKNOWN','UNSUPPORTED','MISSING']){const f=await assessmentFixture(t),r=structuredClone(f.report);if(value==='MISSING')r.results.pop();else r.results.at(-1).status=value;await f.record(r);const result=await f.evaluate();assert.equal(result.verifiedLevel,'L1');assert.equal(result.assessmentStatus,value==='FAIL'?'FAILED':value==='UNSUPPORTED'?'UNSUPPORTED':'INCOMPLETE');assert.equal(result.denominator.required,14);assert(result.gaps.length);}
});
test('UA04 review is bound to exact scoped inventory and semantic report',async t=>{
  const f=await assessmentFixture(t,{prepare:false});await assert.rejects(f.write('usability.inventory.freeze',{inventory:f.inventory,assets:[{...f.assets[0],normativePaths:[]}]}),{code:'HUMAN_EVIDENCE_REQUIRED'});
  await f.write('usability.inventory.freeze',{inventory:f.inventory,assets:f.assets});await f.write('usability.specification.put',{specification:f.spec});
  await assert.rejects(f.write('usability.semantic.record',{report:f.report,humanEvidenceRef:'synthetic-forged'}),{code:'HUMAN_EVIDENCE_REQUIRED'});
  const report=structuredClone(f.report);report.results[0].criterionId='question:undeclared';await assert.rejects(f.record(report),{code:'USABILITY_UNDECLARED_REQUIREMENT'});
  await assert.rejects(f.call('usability.inventory.read',{digest:f.inventoryDigest},{scope:{...f.scope,projectId:'other'}}),{code:'USABILITY_NOT_FOUND'});
});
test('UA05 reads are nonmutating; changed pins and changed semantic review make historical evidence stale',async t=>{
  const f=await assessmentFixture(t);await f.record();const initial=await f.evaluate(),before=await f.call('usability.inspect');
  assert.equal(await status(f),'VERIFIED');assert.deepEqual(await f.call('usability.inspect'),before);
  f.setPins({...f.pins,sourceDigest:usabilityDigest('evolved')});let current=await f.call('usability.assessment.read',{id:'assessment'});assert.equal(current.assessmentStatus,'STALE');assert.equal(current.verifiedLevel,null);assert.deepEqual(await f.call('usability.assessment.version',{digest:initial.digest}),initial);
  assert.equal((await f.evaluate()).assessmentStatus,'STALE');f.setPins(f.pins);
  const report=structuredClone(f.report);report.results[0].status='FAIL';await f.record(report);assert.equal(await status(f),'STALE');assert.equal((await f.evaluate()).assessmentStatus,'FAILED');assert.deepEqual(await f.call('usability.assessment.version',{digest:initial.digest}),initial);
});
test('UA06 an exact replay returns the retained result with no repeated evidence calls',async t=>{
  const f=await assessmentFixture(t);await f.record();const request=await f.request('usability.assessment.evaluate',{id:'assessment'},'once');const first=await f.call(request.operation,request.input,request),reads=f.reads();assert.deepEqual(await f.call(request.operation,request.input,{...request,expectedRevision:999}),first);assert.equal(f.reads(),reads);await assert.rejects(f.call(request.operation,{id:'other'},{...request,input:{id:'other'}}),{code:'REQUEST_CONFLICT'});
});
test('UA07 crash after durable admission does not redispatch; explicit reconciliation retains incomplete evidence',async t=>{
  const f=await assessmentFixture(t);await f.record();const request=await f.request('usability.assessment.evaluate',{id:'assessment'},'crash');f.close();
  const child=fork(new URL('../fixtures/usability-assessment.mjs',import.meta.url),['interrupted-evaluation',JSON.stringify({options:f.options,request})],{stdio:['ignore','ignore','pipe','ipc']});
  let stderr='';child.stderr.on('data',c=>{stderr+=c;});const received=once(child,'message'),exited=once(child,'exit');
  const first=await Promise.race([received,exited.then(()=>{throw Error(stderr||'worker exited before claim');})]);assert.equal(first[0],'claimed');child.kill('SIGKILL');await exited;f.open();
  const replay=await f.call(request.operation,request.input,request);assert.equal(replay.evaluation.status,'IN_PROGRESS');assert.equal(f.reads(),0);assert.equal(await status(f),'IN_PROGRESS');
  const reconciled=await f.write('usability.assessment.reconcile',{id:'assessment',evaluationId:'crash'});assert.equal(reconciled.result.status,'RECONCILED');assert.equal(reconciled.result.result.assessmentStatus,'INCOMPLETE');assert.equal(reconciled.result.result.verifiedLevel,null);assert.equal((await f.call(request.operation,request.input,request)).evaluation.status,'RECONCILED');assert.equal(f.reads(),0);
});
test('UA08 missing adapters, mutable evidence and forged citations fail closed',async t=>{
  const f=await assessmentFixture(t);await f.record();f.material.package.files['sources/requirements.txt']+='tampered';const r=await f.evaluate();assert.equal(r.verifiedLevel,null);assert(r.gaps.length);
  const g=await assessmentFixture(t);g.close();delete g.providers.readUsabilityPins;g.open();assert.equal((await g.evaluate()).assessmentStatus,'UNSUPPORTED');
  const h=await assessmentFixture(t),report=structuredClone(h.report);report.results[0].evidenceDigests=[usabilityDigest('forged')];await h.record(report);assert.equal((await h.evaluate()).verifiedLevel,null);
});
test('UA09 retained approvals are revalidated and secrets are not copied into diagnostics',async t=>{
  const f=await assessmentFixture(t);await f.record();const url=new URL(f.inventory.reviewReference),bytes=readFileSync(url);writeFileSync(url,'tampered');assert.equal((await f.evaluate()).verifiedLevel,null);writeFileSync(url,bytes);
  f.close();f.providers.readUsabilityPins=async()=>{throw Error('must-not-appear-secret');};f.open();const result=await f.evaluate();assert.equal(result.assessmentStatus,'INCOMPLETE');assert(!JSON.stringify(result).includes('must-not-appear-secret'));
});
test('UA10 durable state uses additive marker 7 and survives service reopen',async t=>{
  const f=await assessmentFixture(t);await f.record();const result=await f.evaluate();f.close();const db=new DatabaseSync(join(f.options.workspaceRoot,'state/harness/harness.db'));assert.equal(db.prepare('PRAGMA user_version').get().user_version,7);db.close();f.open();assert.deepEqual(await f.call('usability.assessment.version',{digest:result.digest}),result);assert.equal(await status(f),'VERIFIED');
});

test('UA11 concurrent requests cannot overwrite a durable pending claim or close its service',async t=>{
 const f=await assessmentFixture(t);await f.record();f.close();let unblock,started;const entered=new Promise(r=>{started=r;});let calls=0;
 f.providers.readUsabilityPins=async()=>{if(++calls===1){started();await new Promise(r=>{unblock=r;});}return structuredClone(f.pins);};f.open();
 const request=await f.request('usability.assessment.evaluate',{id:'assessment'},'pending'),running=f.call(request.operation,request.input,request);
 try{await entered;assert.throws(f.close,{code:'BUSY'});await assert.rejects(f.write('usability.assessment.evaluate',{id:'assessment'},'other-evaluation'),{code:'USABILITY_BUSY'});assert.equal(await status(f),'IN_PROGRESS');await f.write('usability.assessment.reconcile',{id:'assessment',evaluationId:'pending'});unblock();await assert.rejects(running,{code:'USABILITY_RECONCILED'});assert.equal(await status(f),'INCOMPLETE');}finally{unblock?.();await running.catch(()=>{});}
});
test('UA12 semantic evidence changed during evaluation cannot commit a current verified level',async t=>{
 const f=await assessmentFixture(t);await f.record();f.close();let unblock,started;const entered=new Promise(r=>{started=r;});let calls=0;
 f.providers.readUsabilityPins=async()=>{if(++calls===2){started();await new Promise(r=>{unblock=r;});}return structuredClone(f.pins);};f.open();
 const running=f.evaluate();try{await entered;const r=structuredClone(f.report);r.results[0].status='FAIL';await f.record(r);unblock();const result=await running;assert.equal(result.assessmentStatus,'STALE');assert.equal(result.verifiedLevel,null);}finally{unblock?.();await running.catch(()=>{});}
});
