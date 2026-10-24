import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {assessmentFixture} from '../fixtures/usability-assessment.mjs';
import {behaviorOracleDigest,usabilityDigest,compareBehavior,validateBehaviorOracle} from '@evopilot-next/harness';

// These fixtures exercise trust boundaries with synthetic approvals/observations.
// Their ACTUAL-tagged test branches are not real project or reconstruction evidence.
const observation=(n=1)=>({output:{completed:true,total:n},state:{phase:'complete'},error:null,effects:[{kind:'stored',count:1}]});
function profile(){return {schema:'evopilot-behavior-oracle/v1',author:{actor:'synthetic-independent-reviewer',independent:true,origin:'ACTUAL'},cases:[
 {id:'completion',behaviorId:'b1',facets:['outputs','states','sideEffects','idempotency','concurrency','recovery'],purpose:'Synthetic completion and exactly-once side effect',input:{operation:'complete'},expected:observation(),tolerances:[{field:'output',path:['total'],absolute:0.01,relative:0}]},
 {id:'rejection',behaviorId:'b1',facets:['errors'],purpose:'Synthetic rejection preserves state',input:{operation:'invalid'},expected:{output:null,state:{phase:'pending'},error:{code:'INVALID'},effects:[]},tolerances:[]}
],negativeControls:[
 {id:'duplicate-effect',caseId:'completion',purpose:'Duplicate effects must fail',actual:{...observation(),effects:[{kind:'stored',count:1},{kind:'stored',count:1}]}},
 {id:'premature-success',caseId:'completion',purpose:'A success response before state completion must fail',actual:{...observation(),state:{phase:'pending'}}}
]};}
const seal=body=>({...body,digest:usabilityDigest(body)});
async function fixture(t){
 const oracle=profile(),f=await assessmentFixture(t,{level:'L3',pinsOverrides:{oracleDigest:behaviorOracleDigest(oracle),inputManifestDigest:usabilityDigest('synthetic-input')}});
 let calls=0,transform=r=>r;
 const receipt=attemptId=>seal({schema:'evopilot-reconstruction-observation/v1',workspaceId:f.options.workspaceId,scope:structuredClone(f.scope),attemptId,inventoryDigest:f.inventoryDigest,specificationDigest:f.specificationDigest,oracleDigest:behaviorOracleDigest(oracle),inputManifestDigest:f.inventory.pins.inputManifestDigest,environmentDigest:f.inventory.pins.environmentDigest,dependenciesDigest:f.inventory.pins.dependenciesDigest,outputDigest:usabilityDigest('synthetic-output'),executorDigest:usabilityDigest('synthetic-executor'),origin:'ACTUAL',inputMode:'ASSETS_ONLY',independent:true,isolated:true,status:'SUCCEEDED',execution:{planDigest:usabilityDigest('synthetic-plan'),claimId:usabilityDigest('claim-'+attemptId),cleanWorkspaceId:'isolated-'+attemptId,receiptDigest:usabilityDigest('receipt-'+attemptId)},cases:oracle.cases.map(c=>({caseId:c.id,inputDigest:usabilityDigest(c.input),status:'COMPLETE',actual:structuredClone(c.expected)}))});
 f.close();f.providers.readReconstructionEvidence=async c=>{calls++;return transform(receipt(c.attemptId));};f.open();
 const input={inventoryDigest:f.inventoryDigest,specificationDigest:f.specificationDigest,oracle};const review=await f.call('usability.oracle.review',input),humanEvidenceRef=f.decision('usability.oracle.freeze',review.digest);await f.write('usability.oracle.freeze',{...input,humanEvidenceRef});
 return {...f,oracle,review,humanEvidenceRef,calls:()=>calls,receipt,transform:fn=>{transform=r=>{const {digest,...body}=r;return seal(fn(body));};},provider:fn=>{f.close();f.providers.readReconstructionEvidence=fn;f.open();},evaluateOracle:async(attemptId='attempt-1')=>(await f.write('usability.oracle.evaluate',{bindingDigest:review.digest,attemptId})).evaluation.result};
}

test('UO01 frozen exact oracle compares every case; negative controls are effective; success never awards L3',async t=>{
 const f=await fixture(t);f.transform(r=>{r.cases[0].actual.output.total=1.005;return r;});const result=await f.evaluateOracle();assert.equal(result.status,'PASS');assert.equal(result.denominator,2);assert.deepEqual(result.negativeControls,{required:2,rejected:2});assert(result.results.every(r=>r.status==='PASS'));assert.equal(result.verifiedLevel,null);assert.equal(result.softwareRelease,false);assert.equal(f.calls(),1);
 const saved=await f.call('usability.oracle.version',{digest:result.digest});assert.deepEqual(saved,result);await f.record();const assessment=await f.evaluate();assert.notEqual(assessment.verifiedLevel,'L3');
});

test('UO02 wrong output/state/errors, duplicate effects and premature success fail exact comparisons',async t=>{
 const f=await fixture(t);const variants=[r=>{r.cases[0].actual.output.total=2;},r=>{r.cases[0].actual.state.phase='pending';},r=>{r.cases[1].actual.error=null;},r=>{r.cases[0].actual.effects.push({kind:'stored',count:1});},r=>{r.cases[0].inputDigest=usabilityDigest('wrong-input');}];
 for(let n=0;n<variants.length;n++){f.transform(r=>{variants[n](r);return r;});const result=await f.evaluateOracle('wrong-'+n);assert.equal(result.status,'FAIL');assert.equal(result.denominator,2);assert(result.results.some(r=>r.status==='FAIL'));}
 assert(compareBehavior(observation(),observation(2),[]).length);
});

test('UO03 missing/skipped/unknown cases and nonterminal receipt cannot pass or shrink denominator',async t=>{
 const f=await fixture(t);for(const mode of ['missing','SKIPPED','UNKNOWN','receipt-unknown']){f.transform(r=>{if(mode==='missing')r.cases.pop();else if(mode==='receipt-unknown')r.status='UNKNOWN';else{r.cases[0].status=mode;r.cases[0].actual=null;}return r;});const result=await f.evaluateOracle(mode.toLowerCase());assert.equal(result.status,'INCOMPLETE');assert.equal(result.denominator,2);assert.equal(result.results.length,2);}
 f.transform(r=>{r.status='FAILED';return r;});assert.equal((await f.evaluateOracle('failed')).status,'FAIL');
});

test('UO04 scope/pins/digests, duplicate and undeclared cases are rejected without provider detail disclosure',async t=>{
 const f=await fixture(t);for(const mutate of [r=>{r.scope.projectId='other';},r=>{r.inputManifestDigest=usabilityDigest('wrong');},r=>{r.cases.push(r.cases[0]);},r=>{r.cases.push({...r.cases[0],caseId:'extra'});}]){f.transform(r=>{mutate(r);return r;});assert.notEqual((await f.evaluateOracle()).status,'PASS');}
 f.provider(async()=>({...f.receipt('attempt-1'),digest:usabilityDigest('tampered')}));assert.deepEqual((await f.evaluateOracle()).gaps,['ORACLE_RECEIPT_DIGEST']);
 f.provider(async()=>{throw Error('private-secret-path');});const value=await f.evaluateOracle();assert(!JSON.stringify(value).includes('private-secret-path'));assert.equal(value.status,'INCOMPLETE');
});

test('UO05 source-assisted, synthetic, non-independent or unisolated observations cannot qualify',async t=>{
 const f=await fixture(t);for(const patch of [{inputMode:'SOURCE_ASSISTED'},{origin:'SYNTHETIC'},{independent:false},{isolated:false}]){f.transform(r=>Object.assign(r,patch));const result=await f.evaluateOracle();assert.equal(result.status,'INCOMPLETE');assert(result.gaps.includes('ORACLE_INDEPENDENT_ACTUAL_ISOLATION_REQUIRED'));}
});

test('UO06 caller observations are forbidden; effective controls, coverage and exact review are required',async t=>{
 const f=await fixture(t),input={bindingDigest:f.review.digest,attemptId:'attempt-1',observations:[]};await assert.rejects(f.write('usability.oracle.evaluate',input));
 const invalid=profile();invalid.negativeControls[0].actual=structuredClone(invalid.cases[0].expected);assert.throws(()=>validateBehaviorOracle(invalid),{code:'ORACLE_INEFFECTIVE_CONTROL'});
 const wrong=profile();wrong.cases[0].tolerances[0].path=['missing'];assert.throws(()=>validateBehaviorOracle(wrong),{code:'ORACLE_TOLERANCE'});
 await assert.rejects(f.write('usability.oracle.freeze',{inventoryDigest:f.inventoryDigest,specificationDigest:f.specificationDigest,oracle:f.oracle,humanEvidenceRef:f.decision('usability.oracle.freeze',usabilityDigest('other'))}));
 const covered=profile();covered.cases[0].facets=['outputs'];const g=await assessmentFixture(t,{pinsOverrides:{oracleDigest:behaviorOracleDigest(covered)}});await assert.rejects(g.call('usability.oracle.review',{inventoryDigest:g.inventoryDigest,specificationDigest:g.specificationDigest,oracle:covered}),{code:'ORACLE_COVERAGE'});
});

test('UO07 exact request replay survives restart and never rereads provider',async t=>{
 const f=await fixture(t),request=await f.request('usability.oracle.evaluate',{bindingDigest:f.review.digest,attemptId:'attempt-1'},'exact-evaluation');const first=await f.call(request.operation,request.input,request);assert.equal(f.calls(),1);f.close();f.open();const again=await f.call(request.operation,request.input,request);assert.deepEqual(again,first);assert.equal(f.calls(),1);await assert.rejects(f.call(request.operation,{...request.input,attemptId:'other'},{...request,input:{...request.input,attemptId:'other'}}));
});

test('UO08 current pins and exact decision integrity govern freshness without editing historical results',async t=>{
 const f=await fixture(t),request=await f.request('usability.oracle.evaluate',{bindingDigest:f.review.digest,attemptId:'attempt-1'},'fresh-evaluation');const original=(await f.call(request.operation,request.input,request)).evaluation.result;
 f.setPins({...f.pins,environmentDigest:usabilityDigest('changed')});const view=await f.call('usability.oracle.evaluation',{id:request.requestId});assert.equal(view.freshness,'STALE');assert.equal(view.status,'STALE');assert.deepEqual(await f.call('usability.oracle.version',{digest:original.digest}),original);assert.equal((await f.evaluateOracle()).status,'STALE');
 f.setPins(f.pins);const file=new URL(f.humanEvidenceRef);file.hash='';writeFileSync(file,readFileSync(file,'utf8')+' ');assert.equal((await f.call('usability.oracle.evaluation',{id:request.requestId})).freshness,'UNKNOWN');assert.equal((await f.evaluateOracle()).status,'INCOMPLETE');
});

test('UO09 pending claim is durable; busy/reconciliation block concurrent work and late overwrite',async t=>{
 const f=await fixture(t);let entered,release;const waiting=new Promise(r=>{entered=r;});f.provider(async()=>{entered();return new Promise(r=>{release=r;});});const request=await f.request('usability.oracle.evaluate',{bindingDigest:f.review.digest,attemptId:'attempt-1'},'pending-evaluation');const pending=f.call(request.operation,request.input,request);await waiting;
 await assert.rejects(f.write('usability.oracle.evaluate',{bindingDigest:f.review.digest,attemptId:'attempt-2'}),{code:'ORACLE_BUSY'});const same=await f.call(request.operation,request.input,request);assert.equal(same.evaluation.status,'IN_PROGRESS');const reconciled=await f.write('usability.oracle.reconcile',{id:request.requestId});assert.equal(reconciled.result.result.status,'INCOMPLETE');release(f.receipt('attempt-1'));await assert.rejects(pending,{code:'ORACLE_RECONCILED'});assert.equal((await f.call('usability.oracle.evaluation',{id:request.requestId})).evaluation.status,'RECONCILED');
});

test('UO10 absent provider and bounded timeout stay unsupported/incomplete',async t=>{
 const f=await fixture(t);f.close();delete f.providers.readReconstructionEvidence;f.open();assert.equal((await f.evaluateOracle()).status,'UNSUPPORTED');let aborted=false;f.provider(async(_,signal)=>{signal.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});});const result=await f.evaluateOracle();assert.equal(result.status,'INCOMPLETE');assert(result.gaps.includes('ORACLE_TIMEOUT'));assert(aborted);
});

test('UO11 killed process retains claim; replay and reconciliation do not repeat external reads',async t=>{
 const f=await fixture(t),request=await f.request('usability.oracle.evaluate',{bindingDigest:f.review.digest,attemptId:'attempt-1'},'killed-evaluation');f.close();const child=fork(new URL('../fixtures/usability-assessment.mjs',import.meta.url),['interrupted-oracle',JSON.stringify({options:f.options,request})],{stdio:['ignore','ignore','pipe','ipc']});const exited=once(child,'exit');let errors='';child.stderr.on('data',b=>{errors+=b;});const signal=await Promise.race([once(child,'message').then(([v])=>v),exited.then(()=>{throw Error(errors);})]);assert.equal(signal,'oracle-claimed');child.kill('SIGKILL');await exited;f.open();const read=await f.call(request.operation,request.input,request);assert.equal(read.evaluation.status,'IN_PROGRESS');assert.equal(f.calls(),0);const result=await f.write('usability.oracle.reconcile',{id:request.requestId});assert.equal(result.result.result.status,'INCOMPLETE');assert.equal(f.calls(),0);
});

test('UO12 actual Node execution of synthetic good/bad implementations exposes duplicate effects and premature success',async t=>{
 const {execFileSync}=await import('node:child_process');const f=await fixture(t);
 const program=`const mode=process.argv[1];const complete=()=>({output:{completed:true,total:1},state:{phase:mode==='premature'?'pending':'complete'},error:null,effects:mode==='duplicate'?[{kind:'stored',count:1},{kind:'stored',count:1}]:[{kind:'stored',count:1}]});const invalid=()=>({output:null,state:{phase:'pending'},error:mode==='wrong-error'?null:{code:'INVALID'},effects:[]});process.stdout.write(JSON.stringify([complete(),invalid()]));`;
 for(const mode of ['correct','duplicate','premature','wrong-error']){
  const actual=JSON.parse(execFileSync(process.execPath,['-e',program,mode],{timeout:2000,maxBuffer:16384,encoding:'utf8'}));
  f.transform(r=>{r.origin='SYNTHETIC';r.cases.forEach((c,i)=>{c.actual=actual[i];});return r;});const result=await f.evaluateOracle(mode);
  if(mode==='correct'){assert(result.results.every(c=>c.status==='PASS'));assert.equal(result.status,'INCOMPLETE');}else assert.equal(result.status,'FAIL');
  assert.equal(result.verifiedLevel,null);
 }
});

async function l3Selection(f,{id='l3-assessment',attempts=['attempt-a','attempt-b'],record=true}={}){
 if(record)await f.record();const ids=[];
 for(let n=0;n<attempts.length;n++){const request=await f.request('usability.oracle.evaluate',{bindingDigest:f.review.digest,attemptId:attempts[n]});await f.call(request.operation,request.input,request);ids.push(request.requestId);}
 await f.write('usability.assessment.start',{id,inventoryDigest:f.inventoryDigest,specificationDigest:f.specificationDigest,reconstructionEvaluationIds:ids});
 return {ids,id,evaluate:async()=>(await f.write('usability.assessment.evaluate',{id})).evaluation.result,read:()=>f.call('usability.assessment.read',{id})};
}
test('UO13 L3 requires two selected independent executions, complete semantics and current immutable oracle verdicts',async t=>{
 const f=await fixture(t),selected=await l3Selection(f),result=await selected.evaluate();
 assert.equal(result.verifiedLevel,'L3',JSON.stringify(result));assert.equal(result.assessmentStatus,'VERIFIED');assert.equal(result.reconstructionEvidence.length,2);assert.equal(result.gaps.length,0);assert.equal(result.authority,false);assert.equal(result.softwareRelease,false);
 const version=await f.call('usability.assessment.version',{digest:result.digest});f.close();f.open();const read=await selected.read();assert.equal(read.verifiedLevel,'L3');assert.deepEqual(read.version,version);
});
test('UO14 one execution, duplicate selections or repeated evaluations of one attempt cannot qualify as independent rebuilds',async t=>{
 const f=await fixture(t);
 for(const ids of [[],['one'],['one','one'],['a','b','c','d','e']])await assert.rejects(f.write('usability.assessment.start',{id:'invalid',inventoryDigest:f.inventoryDigest,specificationDigest:f.specificationDigest,reconstructionEvaluationIds:ids}),{code:'USABILITY_RECONSTRUCTION_SELECTION'});
 const selected=await l3Selection(f,{attempts:['same-attempt','same-attempt']}),result=await selected.evaluate();assert.equal(result.verifiedLevel,'L2');assert.equal(result.assessmentStatus,'INCOMPLETE');assert(result.gaps.some(g=>g.code==='USABILITY_RECONSTRUCTION_NOT_INDEPENDENT'));
});
test('UO15 reused workspace, claim or receipt, mixed plan/executor and legacy observations cannot qualify',async t=>{
 for(const mode of ['workspace','claim','receipt','plan','executor','missing']){
  const f=await fixture(t);f.transform(r=>{
   if(mode==='workspace')r.execution.cleanWorkspaceId='same-clean-workspace';
   if(mode==='claim')r.execution.claimId=usabilityDigest('same-claim');
   if(mode==='receipt')r.execution.receiptDigest=usabilityDigest('same-receipt');
   if(mode==='plan')r.execution.planDigest=usabilityDigest(r.attemptId);
   if(mode==='executor')r.executorDigest=usabilityDigest(r.attemptId);
   if(mode==='missing')delete r.execution;
   return r;
  });
  const result=await (await l3Selection(f)).evaluate();assert.notEqual(result.verifiedLevel,'L3',mode);assert.equal(result.assessmentStatus,'INCOMPLETE');
  assert(result.gaps.some(g=>g.code===('missing'===mode?'USABILITY_RECONSTRUCTION_IDENTITY_REQUIRED':['plan','executor'].includes(mode)?'USABILITY_RECONSTRUCTION_BINDING':'USABILITY_RECONSTRUCTION_NOT_INDEPENDENT')));
 }
});
test('UO16 L3 current readback revokes stale output receipts while immutable history remains unchanged',async t=>{
 const f=await fixture(t),selected=await l3Selection(f),original=await selected.evaluate();assert.equal(original.verifiedLevel,'L3');
 f.transform(r=>{r.execution.receiptDigest=usabilityDigest('changed-bytes');return r;});const view=await selected.read();assert.equal(view.freshness,'STALE');assert.equal(view.verifiedLevel,null);assert.equal(view.assessmentStatus,'STALE');
 assert.deepEqual(await f.call('usability.assessment.version',{digest:original.digest}),original);
 const recheck=await selected.evaluate();assert.notEqual(recheck.verifiedLevel,'L3');assert(recheck.gaps.some(g=>g.code==='ORACLE_OBSERVATION_DRIFT'));
});
test('UO17 unavailable Runtime evidence and changed semantic decisions cannot preserve a current L3 claim',async t=>{
 const f=await fixture(t),selected=await l3Selection(f),original=await selected.evaluate();
 f.provider(async()=>{throw Error('private-provider-detail');});const unavailable=await selected.read();assert.equal(unavailable.freshness,'UNKNOWN');assert.equal(unavailable.verifiedLevel,null);assert(!JSON.stringify(unavailable).includes('private-provider-detail'));
 f.provider(async c=>f.receipt(c.attemptId));assert.equal((await selected.read()).verifiedLevel,'L3');
 const semantic=await f.record(),file=new URL(semantic.result.humanEvidenceRef);file.hash='';writeFileSync(file,readFileSync(file,'utf8')+' ');
 const tampered=await selected.read();assert.equal(tampered.verifiedLevel,null);assert.equal(tampered.freshness,'UNKNOWN');assert.deepEqual(await f.call('usability.assessment.version',{digest:original.digest}),original);
});
test('UO18 failed oracle or missing semantic review retains its fixed denominator and cannot promote L3',async t=>{
 const f=await fixture(t);f.transform(r=>{r.cases[0].actual.state.phase='pending';return r;});const selected=await l3Selection(f),failed=await selected.evaluate();assert.equal(failed.verifiedLevel,'L2');assert.equal(failed.assessmentStatus,'FAILED');assert(failed.gaps.some(g=>g.code==='ORACLE_BEHAVIOR_FAILED'));
 const g=await fixture(t),missing=await (await l3Selection(g,{record:false})).evaluate();assert.equal(missing.verifiedLevel,null);assert(missing.gaps.some(g=>g.code==='USABILITY_SEMANTIC_REVIEW_REQUIRED'));assert.equal(missing.denominator.required,14);
});
test('UO19 reconstruction selection cannot accept caller grades or cross-inventory evidence',async t=>{
 const f=await fixture(t);await assert.rejects(f.write('usability.assessment.start',{id:'forged',inventoryDigest:f.inventoryDigest,specificationDigest:f.specificationDigest,reconstructionEvaluationIds:['a','b'],verifiedLevel:'L3'}));
 const selected=await l3Selection(f);f.transform(r=>{r.inventoryDigest=usabilityDigest('foreign');return r;});assert.notEqual((await selected.evaluate()).verifiedLevel,'L3');
});
