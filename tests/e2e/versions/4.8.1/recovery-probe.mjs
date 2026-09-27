import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {exactKeys,isDigest,isId,probeDigest,probeSession} from '../probe-session.mjs';
import {runHarnessPublicationJourney} from './publication-journey.mjs';

const hash=x=>'sha256:'+crypto.createHash('sha256').update(x).digest('hex');
const bound=(value,key)=>{const {[key]:digest,...body}=value;assert.ok(isDigest(digest));assert.equal(probeDigest(body),digest,'RECOVERY_DIGEST_MISMATCH');};
const decision=value=>{exactKeys(value,['decision','actor','authorizationDigest']);assert.equal(value.decision,'AUTHORIZED');assert.ok(isId(value.actor)&&isDigest(value.authorizationDigest));};

/** Independent frozen expectations, never inferred from the diagnostic result.
 * This initial-publication/subsequent-head-stable probe does not traverse history
 * and does not grant or execute recovery. An external campaign owns all pins. */
export function recoveryExpectations(expected) {
  exactKeys(expected,['catalogId','requestId','generationDigest','previousHead','publication','lock','recoveryId','recoveryAuthorization','publicationOutcome']);
  const e=structuredClone(expected);
  assert.ok([e.catalogId,e.requestId,e.recoveryId].every(isId));assert.ok(isDigest(e.generationDigest));
  assert.ok(e.previousHead===null||isDigest(e.previousHead));decision(e.publication);decision(e.recoveryAuthorization);
  assert.ok(['COMMITTED','NOT_COMMITTED'].includes(e.publicationOutcome));
  const receipt={schema:'evopilot-harness-semantic-catalog-receipt/v1',catalogId:e.catalogId,generationDigest:e.generationDigest,
    expectedHead:e.previousHead,action:'PUBLISH',requestDigest:hash(e.requestId),authorization:e.publication};
  const pointer={schema:'evopilot-harness-semantic-catalog-pointer/v1',catalogId:e.catalogId,
    generationPath:`semantic-catalog/generations/${e.generationDigest.slice(7)}.json`,generationDigest:e.generationDigest,
    previousPointerDigest:e.previousHead,receiptDigest:probeDigest(receipt)};
  exactKeys(e.lock,['schema','catalogId','nonce','pid','hostDigest','rootDigest','receiptDigest','requestDigest','expectedHead','lockDigest']);
  bound(e.lock,'lockDigest');assert.equal(e.lock.schema,'evopilot-harness-semantic-catalog-lock/v1');
  assert.equal(e.lock.catalogId,e.catalogId);assert.equal(e.lock.requestDigest,receipt.requestDigest);
  assert.equal(e.lock.receiptDigest,probeDigest(receipt));assert.equal(e.lock.expectedHead,e.previousHead);
  assert.ok(Number.isSafeInteger(e.lock.pid)&&e.lock.pid>0);assert.ok(isId(e.lock.nonce));
  assert.ok([e.lock.hostDigest,e.lock.rootDigest].every(isDigest));
  const head=e.publicationOutcome==='COMMITTED'?probeDigest(pointer):e.previousHead;
  const record={schema:'evopilot-harness-semantic-catalog-recovery/v1',catalogId:e.catalogId,lockDigest:e.lock.lockDigest,
    expectedHead:head,recoveryRequestDigest:hash(e.recoveryId),publicationRequestDigest:hash(e.requestId),
    publicationOutcome:e.publicationOutcome,authorization:e.recoveryAuthorization};
  return {expected:e,head,record:{...record,recoveryDigest:probeDigest(record)}};
}

export function assertHarnessRecoveryProjection({phase,expected,result}) {
  const {expected:e,head,record}=recoveryExpectations(expected);
  if(phase==='inspect')assert.deepEqual(result,{schema:'evopilot-harness-semantic-recovery-inspection/v1',status:'RECOVERABLE',
    ownerState:'DEAD',lockDigest:e.lock.lockDigest,expectedHead:head,requestDigest:hash(e.requestId),grantsRecoveryAuthority:false},'RECOVERY_INSPECTION_CHANGED');
  else {
    assert.equal(phase,'readback');
    assert.deepEqual(result,{schema:'evopilot-harness-semantic-recovery-readback/v1',status:'RECOVERED',record,mutationReplayed:false},'RECOVERY_RECORD_CHANGED');
  }
}

// Small, fixed-path independent durable evidence oracle. It rejects changed
// names/inodes, links, non-files and oversized data; it never creates directories.
export function readHarnessRecoveryEvidence({catalogRoot,expected,signal}) {
  const {expected:e,head,record}=recoveryExpectations(expected),started=performance.now(),observed=[];
  const check=()=>{signal?.throwIfAborted();assert.ok(performance.now()-started<5000,'RECOVERY_FILE_TIMEOUT');};check();
  assert.ok(path.isAbsolute(catalogRoot));const root=fs.realpathSync(catalogRoot),st=fs.lstatSync(root);
  const relative=path.relative(path.resolve(import.meta.dirname,'../../../..'),root);
  assert.ok(relative==='..'||relative.startsWith('../')||path.isAbsolute(relative),'RECOVERY_CATALOG_MUST_BE_EXTERNAL');
  const safe=relative=>{
    check();assert.equal(fs.realpathSync(catalogRoot),root);const current=fs.lstatSync(root);assert.equal(current.ino,st.ino);assert.equal(current.dev,st.dev);
    let cursor=root;for(const part of relative.split('/')){assert.ok(part&&part!=='.'&&part!=='..');cursor=path.join(cursor,part);
      try {assert.equal(fs.lstatSync(cursor).isSymbolicLink(),false,'RECOVERY_SYMLINK_DENIED');}catch(error){if(error.code!=='ENOENT')throw error;}}
    return cursor;
  };
  const read=relative=>{
    const file=safe(relative),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try {
      const before=fs.fstatSync(fd);assert.ok(before.isFile()&&before.nlink===1&&before.size>0&&before.size<=65536,'RECOVERY_FILE_LIMIT');
      const bytes=Buffer.alloc(before.size);let offset=0;
      while(offset<bytes.length){check();const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);assert.ok(n>0);offset+=n;}
      const after=fs.fstatSync(fd),named=fs.lstatSync(safe(relative));
      for(const key of ['size','mtimeMs','ctimeMs'])assert.equal(after[key],before[key],'RECOVERY_FILE_DRIFT');
      assert.equal(after.ino,named.ino);assert.equal(after.dev,named.dev);check();
      observed.push({path:relative,digest:hash(bytes),bytes:bytes.length});return JSON.parse(bytes);
    }finally{fs.closeSync(fd);}
  };
  const checkHead=()=>{
    if(head===null)assert.throws(()=>fs.lstatSync(safe('SEMANTIC-CATALOG.json')),error=>error.code==='ENOENT','RECOVERY_HEAD_CHANGED');
    else {const pointer=read('SEMANTIC-CATALOG.json');bound(pointer,'pointerDigest');assert.equal(pointer.catalogId,e.catalogId);assert.equal(pointer.pointerDigest,head,'RECOVERY_HEAD_CHANGED');}
  };
  checkHead();
  assert.deepEqual(read(`semantic-catalog/recoveries/${hash(e.recoveryId).slice(7)}.json`),record,'RECOVERY_DURABLE_RECORD_CHANGED');
  assert.deepEqual(read(`semantic-catalog/recovered-locks/${e.lock.lockDigest.slice(7)}/owner.json`),e.lock,'RECOVERY_ARCHIVED_LOCK_CHANGED');
  assert.throws(()=>fs.lstatSync(safe('semantic-catalog/publication.lock')),error=>error.code==='ENOENT','RECOVERY_LOCK_STILL_ACTIVE');
  checkHead();check();return {status:'RECOVERY_DURABLE_EVIDENCE_CHECKED',observed,head,recordDigest:record.recoveryDigest};
}

/** Fixed raw-MCP read operations only. Reconciliation must be independently
 * authorized and completed outside this probe. Errors are terminal, no retries. */
export async function runHarnessRecoveryProbe({phase,expected,catalogRoot,publicationInput,generation,invoke,authorizeInvocation,signal,timeoutMs=30000}) {
  assert.ok(['inspect','readback'].includes(phase));assert.equal(typeof invoke,'function');assert.equal(typeof authorizeInvocation,'function');
  const frozen=recoveryExpectations(expected).expected;
  ({publicationInput,generation}=structuredClone({publicationInput,generation}));
  const deadline=performance.now()+timeoutMs;let durableEvidence=null,publicationEvidence=null;
  const check=()=>{signal?.throwIfAborted();assert.ok(performance.now()<deadline,'RECOVERY_PROBE_TIMEOUT');};
  const report=await probeSession({product:'harness',version:'4.8.1',signal,timeoutMs,invoke:async(call,options)=>{
    options.signal.throwIfAborted();
    assert.equal(await authorizeInvocation({call:structuredClone(call),commandDigest:probeDigest(call),effect:'READ'},options),true,'RECOVERY_INVOCATION_DENIED');
    options.signal.throwIfAborted();const response=await invoke(call,options);
    options.signal.throwIfAborted();return {exitCode:0,json:response};
  }},async request=>{
    const operation=phase==='inspect'?'semantic.catalog.recovery-inspect':'semantic.catalog.recovery-readback';
    const input={catalogId:frozen.catalogId,...(phase==='readback'?{recoveryId:frozen.recoveryId}:{})};
    const raw=(await request({tool:'run_engine_diagnostic',args:{operation,input}})).json;
    assert.equal(raw.isError??false,false,'RECOVERY_MCP_REFUSAL');assert.ok(raw.structuredContent?.result,'RECOVERY_MCP_RESULT_REQUIRED');
    assertHarnessRecoveryProjection({phase,expected:frozen,result:raw.structuredContent.result});
    if(phase==='readback') {
      check();durableEvidence=readHarnessRecoveryEvidence({catalogRoot,expected:frozen,signal});check();
      if(frozen.publicationOutcome==='COMMITTED') {
        assert.equal(publicationInput?.catalogId,frozen.catalogId);assert.equal(publicationInput.requestId,frozen.requestId);
        assert.equal(publicationInput.expectedGenerationDigest,frozen.generationDigest);
        assert.equal(publicationInput.expectedHead,frozen.previousHead??'EMPTY');assert.deepEqual(publicationInput.publication,frozen.publication);
        const remaining=Math.floor(deadline-performance.now());assert.ok(remaining>0,'RECOVERY_PROBE_TIMEOUT');
        publicationEvidence=await runHarnessPublicationJourney({phase:'readback',publicationInput,generation,catalogRoot,invoke,authorizeInvocation,signal,timeoutMs:remaining});
      }
      assert.deepEqual(readHarnessRecoveryEvidence({catalogRoot,expected:frozen,signal}),durableEvidence,'RECOVERY_DURABLE_DRIFT');
      check();
    }
  });
  return {...report,schema:'evopilot-harness-rc05-recovery-probe/v1',phase,expectedDigest:probeDigest(frozen),
    status:'RECOVERY_SUBJOURNEY_ASSERTIONS_PASSED',durableEvidence,publicationEvidence,mutationReplayed:false};
}
