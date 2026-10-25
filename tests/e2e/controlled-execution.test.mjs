import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {assessmentFixture} from '../fixtures/usability-assessment.mjs';
import {behaviorOracleDigest,usabilityDigest as hash} from '@evopilot-next/harness';
const policy=()=>({schema:'evopilot-execution-policy/v1',externalNetwork:'DENY',internalTransport:'OWNED_LOOPBACK',childProcesses:'BROKERED_OWNED',originalSource:'DENY',hiddenOracle:'DENY',priorOutputs:'DENY',hostCredentials:'DENY',brokerDigest:hash('synthetic-broker'),dependencyManifestDigest:hash('synthetic-dependencies')});
const oracle={schema:'evopilot-behavior-oracle/v1',author:{actor:'synthetic-test',independent:true,origin:'SYNTHETIC'},cases:[{id:'all',behaviorId:'b1',facets:['outputs','states','errors','sideEffects','idempotency','concurrency','recovery'],purpose:'Synthetic versioned authority propagation only',input:{x:1},expected:{output:1,state:null,error:null,effects:[]},tolerances:[]}],negativeControls:[{id:'wrong',caseId:'all',purpose:'Synthetic wrong output',actual:{output:2,state:null,error:null,effects:[]}}]};
const seal=body=>({...body,digest:hash(body)});
async function fixture(t){const f=await assessmentFixture(t,{level:'L3',pinsOverrides:{oracleDigest:behaviorOracleDigest(oracle),inputManifestDigest:hash('synthetic-input')}});let alter=r=>r;
 f.close();f.providers.readReconstructionEvidence=async({attemptId})=>seal(alter({schema:'evopilot-reconstruction-observation/v2',workspaceId:f.options.workspaceId,scope:f.scope,attemptId,inventoryDigest:f.inventoryDigest,specificationDigest:f.specificationDigest,oracleDigest:behaviorOracleDigest(oracle),inputManifestDigest:f.pins.inputManifestDigest,environmentDigest:f.pins.environmentDigest,dependenciesDigest:f.pins.dependenciesDigest,outputDigest:hash('output'),executorDigest:hash('executor'),origin:'SYNTHETIC',inputMode:'ASSETS_ONLY',independent:true,isolated:true,status:'SUCCEEDED',authority:{policy:policy(),policyDigest:hash(policy()),enforcementDigest:hash('enforcement'),externalConnections:0,unrelatedPeerConnections:0,allOwnedProcessesClosed:true},execution:{planDigest:hash('plan'),claimId:hash(attemptId),cleanWorkspaceId:attemptId,receiptDigest:hash('receipt-'+attemptId)},cases:[{caseId:'all',inputDigest:hash({x:1}),status:'COMPLETE',actual:oracle.cases[0].expected}]}));f.open();
 const input={inventoryDigest:f.inventoryDigest,specificationDigest:f.specificationDigest,oracle},review=await f.call('usability.oracle.review',input);await f.write('usability.oracle.freeze',{...input,humanEvidenceRef:f.decision('usability.oracle.freeze',review.digest)});
 let n=0;return{...f,alter:fn=>{alter=fn},run:async()=>(await f.write('usability.oracle.evaluate',{bindingDigest:review.digest,attemptId:'attempt-'+ ++n})).evaluation.result};
}
test('CE-H01 versioned authority survives owner retention without giving synthetic evidence L3',async t=>{
 const f=await fixture(t),r=await f.run();assert.equal(r.status,'INCOMPLETE');assert.equal(r.results[0].status,'PASS');assert(r.gaps.includes('ORACLE_INDEPENDENT_ACTUAL_ISOLATION_REQUIRED'));assert.equal(r.verifiedLevel,null);assert.equal(r.authority,false);assert.equal(r.softwareRelease,false);
 f.close();const db=new DatabaseSync(path.join(f.options.workspaceRoot,'state/harness/harness.db'),{readOnly:true});try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,8)}finally{db.close()}f.open();assert.deepEqual(await f.call('usability.oracle.version',{digest:r.digest}),r);
});
test('CE-H02 v2 cannot claim isolation after external effects or disguise itself as offline v1',async t=>{
 const f=await fixture(t);
 for(const change of [r=>{r.authority.externalConnections=1;return r},r=>{r.authority.allOwnedProcessesClosed=false;return r},r=>{r.schema='evopilot-reconstruction-observation/v1';return r},r=>{r.authority.policyDigest=hash('forged');return r}]){f.alter(change);const result=await f.run();assert.equal(result.status,'INCOMPLETE');assert(result.gaps.includes('ORACLE_EVIDENCE_UNAVAILABLE'));assert(result.results.every(x=>x.status!=='PASS'));}
 f.alter(r=>{r.cases[0].actual={output:2,state:null,error:null,effects:[]};return r});assert.equal((await f.run()).status,'FAIL');
});

import fs from 'node:fs';import {homedir} from 'node:os';
import {inspectWorkspaceSnapshot,relocateWorkspaceSnapshot} from '@evopilot-next/harness/workspace-migration';
import {createHarnessService} from '@evopilot-next/harness/service';

test('CE-M01 marker 8 relocation preserves exact authority evidence and all owner records',async t=>{
 const f=await fixture(t),expected=await f.run();
 f.close();const before=inspectWorkspaceSnapshot(f.options),destinationRoot=path.join(f.root,'relocated');
 fs.cpSync(f.options.workspaceRoot,destinationRoot,{recursive:true,preserveTimestamps:true});
 const privateCopy=p=>{const stat=fs.lstatSync(p);assert(!stat.isSymbolicLink());fs.chmodSync(p,stat.isDirectory()?0o700:0o600);if(stat.isDirectory())for(const child of fs.readdirSync(p))privateCopy(path.join(p,child));};privateCopy(destinationRoot);
 const relocation=relocateWorkspaceSnapshot({sourceRoot:f.options.workspaceRoot,destinationRoot,workspaceId:f.options.workspaceId,expectedSnapshotDigest:before.snapshotDigest});
 t.after(()=>{for(const id of relocation.requiredKeyIds)fs.rmSync(path.join(homedir(),'.local/share/evopilot/relocation-keys',id+'.key'),{force:true})});
 assert.equal(relocation.snapshot.recordsDigest,before.recordsDigest);assert.equal(relocation.snapshot.blobsDigest,before.blobsDigest);assert.deepEqual(inspectWorkspaceSnapshot(f.options),before);
 const service=createHarnessService({...f.options,workspaceRoot:destinationRoot},f.providers);service.initialize();
 try{assert.deepEqual(await service.usability({operation:'usability.oracle.version',scope:f.scope,input:{digest:expected.digest}}),expected)}finally{service.close()}
 const db=new DatabaseSync(path.join(destinationRoot,'state/harness/harness.db'),{readOnly:true});try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,8)}finally{db.close()}
 assert.equal(relocateWorkspaceSnapshot({sourceRoot:f.options.workspaceRoot,destinationRoot,workspaceId:f.options.workspaceId,expectedSnapshotDigest:before.snapshotDigest}).relocationDigest,relocation.relocationDigest);
});
