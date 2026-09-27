import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {exactKeys,isDigest,isId,probeDigest,probeSession} from '../probe-session.mjs';

const hash=x=>'sha256:'+crypto.createHash('sha256').update(x).digest('hex');
const content=(area,digest)=>`semantic-catalog/${area}/${digest.slice(7)}.json`;

/** A complete, externally reviewed chain starting at the empty Catalog. Neither
 * readback nor discovery supplies expected truth. Not a mutation plan. */
export function harnessHistoryExpectations(expected) {
  exactKeys(expected,['catalogId','steps']);assert.ok(isId(expected.catalogId));
  assert.ok(Array.isArray(expected.steps)&&expected.steps.length>0&&expected.steps.length<=32);
  const frozen=structuredClone(expected),chain=[],requests=new Set();
  for(const step of frozen.steps) {
    exactKeys(step,['requestId','action','generation','authorization','transition']);
    assert.ok(isId(step.requestId)&&!requests.has(step.requestId));requests.add(step.requestId);
    assert.ok(['PUBLISH','ROLLBACK','REVOKE'].includes(step.action));
    exactKeys(step.authorization,['decision','actor','authorizationDigest']);assert.equal(step.authorization.decision,'AUTHORIZED');
    assert.ok(isId(step.authorization.actor)&&isDigest(step.authorization.authorizationDigest));
    const {generationDigest,...body}=step.generation;assert.ok(isDigest(generationDigest));assert.equal(probeDigest(body),generationDigest);
    assert.equal(body.schema,'evopilot-harness-semantic-catalog/v1');assert.equal(body.catalogId,frozen.catalogId);
    assert.ok(Array.isArray(body.entries)&&body.entries.length<=4096&&Array.isArray(body.sets)&&Array.isArray(body.revokedDigests));
    assert.ok(body.revokedDigests.every(isDigest));assert.equal(new Set(body.revokedDigests).size,body.revokedDigests.length);
    assert.ok((chain.at(-1)?.generation.revokedDigests??[]).every(d=>body.revokedDigests.includes(d)),'HISTORY_REVOCATION_LOST');
    let transitionDigest;
    if(step.action==='PUBLISH')assert.equal(step.transition,null);
    else if(step.action==='ROLLBACK') {
      exactKeys(step.transition,['targetPointerDigest']);assert.ok(chain.some(s=>s.pointer.pointerDigest===step.transition.targetPointerDigest),'HISTORY_ROLLBACK_TARGET_UNKNOWN');
      transitionDigest=probeDigest({action:'ROLLBACK',targetPointerDigest:step.transition.targetPointerDigest});
    }else {
      exactKeys(step.transition,['revokedDigests']);assert.ok(Array.isArray(step.transition.revokedDigests)&&step.transition.revokedDigests.length>0);
      assert.ok(step.transition.revokedDigests.every(d=>isDigest(d)&&body.revokedDigests.includes(d)));
      transitionDigest=probeDigest({action:'REVOKE',revokedDigests:[...step.transition.revokedDigests].sort()});
    }
    const receiptBody={schema:'evopilot-harness-semantic-catalog-receipt/v1',catalogId:frozen.catalogId,generationDigest,
      expectedHead:chain.at(-1)?.pointer.pointerDigest??null,action:step.action,requestDigest:hash(step.requestId),
      ...(transitionDigest?{transitionDigest}:{}),authorization:step.authorization};
    const receipt={...receiptBody,receiptDigest:probeDigest(receiptBody)};
    const pointerBody={schema:'evopilot-harness-semantic-catalog-pointer/v1',catalogId:frozen.catalogId,generationPath:content('generations',generationDigest),
      generationDigest,previousPointerDigest:receipt.expectedHead,receiptDigest:receipt.receiptDigest};
    chain.push({...step,receipt,pointer:{...pointerBody,pointerDigest:probeDigest(pointerBody)}});
  }
  return {frozen,chain};
}

export function assertHarnessHistoryReadback({expected,index,result}) {
  const {chain}=harnessHistoryExpectations(expected);assert.ok(Number.isSafeInteger(index)&&index>=0&&index<chain.length);
  const {pointer,receipt}=chain[index];
  assert.deepEqual(result,{schema:'evopilot-harness-semantic-supply-readback/v1',status:'COMMITTED',pointer,receipt},'HISTORY_READBACK_CHANGED');
}

/** Read-only independent durable chain/material verification. Bounded to 32
 * revisions and 256 MiB total; current pointer is checked before and after. */
export function readHarnessHistoryEvidence({expected,catalogRoot,signal,deadline=performance.now()+30000}) {
  const {chain}=harnessHistoryExpectations(expected),observed=[],cache=new Map();let total=0;
  const check=()=>{signal?.throwIfAborted();assert.ok(performance.now()<deadline,'HISTORY_TIMEOUT');};check();
  assert.ok(path.isAbsolute(catalogRoot));const root=fs.realpathSync(catalogRoot),rootStat=fs.lstatSync(root);
  const relative=path.relative(path.resolve(import.meta.dirname,'../../../..'),root);
  assert.ok(relative==='..'||relative.startsWith('../')||path.isAbsolute(relative),'HISTORY_CATALOG_MUST_BE_EXTERNAL');
  const safe=relative=>{
    check();assert.equal(fs.realpathSync(catalogRoot),root);const st=fs.lstatSync(root);assert.equal(st.ino,rootStat.ino);assert.equal(st.dev,rootStat.dev);
    let cursor=root;for(const part of relative.split('/')){assert.ok(part&&part!=='.'&&part!=='..');cursor=path.join(cursor,part);assert.equal(fs.lstatSync(cursor).isSymbolicLink(),false,'HISTORY_SYMLINK_DENIED');}return cursor;
  };
  const read=(relative,limit,refresh=false)=>{
    check();if(!refresh&&cache.has(relative))return cache.get(relative);
    const fd=fs.openSync(safe(relative),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try {
      const before=fs.fstatSync(fd);assert.ok(before.isFile()&&before.nlink===1&&before.size>0&&before.size<=limit,'HISTORY_FILE_LIMIT');
      total+=before.size;assert.ok(total<=268435456,'HISTORY_TOTAL_LIMIT');
      const bytes=Buffer.alloc(before.size);let offset=0;
      while(offset<bytes.length){check();const n=fs.readSync(fd,bytes,offset,Math.min(65536,bytes.length-offset),offset);assert.ok(n>0);offset+=n;}
      const after=fs.fstatSync(fd),named=fs.lstatSync(safe(relative));for(const key of ['size','mtimeMs','ctimeMs'])assert.equal(after[key],before[key],'HISTORY_FILE_DRIFT');
      assert.equal(after.ino,named.ino);assert.equal(after.dev,named.dev);check();
      const result={value:JSON.parse(bytes),digest:hash(bytes),bytes:bytes.length};cache.set(relative,result);
      observed.push({path:relative,digest:result.digest,bytes:result.bytes});return result;
    }finally{fs.closeSync(fd);}
  };
  const head=chain.at(-1).pointer;assert.deepEqual(read('SEMANTIC-CATALOG.json',65536).value,head,'HISTORY_HEAD_CHANGED');
  for(const step of chain) {
    assert.deepEqual(read(content('heads',step.pointer.pointerDigest),65536).value,step.pointer,'HISTORY_DURABLE_POINTER_CHANGED');
    assert.deepEqual(read(content('receipts',step.receipt.receiptDigest),65536).value,step.receipt,'HISTORY_DURABLE_RECEIPT_CHANGED');
    assert.deepEqual(read(content('requests',step.receipt.requestDigest),65536).value,step.receipt,'HISTORY_DURABLE_REQUEST_CHANGED');
    assert.deepEqual(read(step.pointer.generationPath,4194304).value,step.generation,'HISTORY_DURABLE_GENERATION_CHANGED');
    for(const entry of step.generation.entries) {
      assert.ok(isDigest(entry.fileDigest));assert.equal(entry.path,content('materials',entry.fileDigest));
      assert.ok(Number.isSafeInteger(entry.bytes)&&entry.bytes>0&&entry.bytes<=16777216);
      const file=read(entry.path,16777216);assert.equal(file.digest,entry.fileDigest,'HISTORY_MATERIAL_CHANGED');assert.equal(file.bytes,entry.bytes);
    }
  }
  assert.deepEqual(read('SEMANTIC-CATALOG.json',65536,true).value,head,'HISTORY_HEAD_CHANGED');check();
  return {status:'HISTORY_DURABLE_EVIDENCE_CHECKED',revisionCount:chain.length,pointerDigest:head.pointerDigest,observed};
}

/** Fixed diagnostics only, no publication/recovery/Session mutation or retry.
 * Current grants remain enforced by the actual Engine on each readback. */
export async function runHarnessHistoryProbe({expected,catalogRoot,invoke,authorizeInvocation,signal,timeoutMs=30000}) {
  assert.equal(typeof invoke,'function');assert.equal(typeof authorizeInvocation,'function');
  const {frozen,chain}=harnessHistoryExpectations(expected),deadline=performance.now()+timeoutMs;let durableEvidence;
  const report=await probeSession({product:'harness',version:'4.8.1',signal,timeoutMs,invoke:async(call,options)=>{
    options.signal.throwIfAborted();assert.equal(await authorizeInvocation({call:structuredClone(call),commandDigest:probeDigest(call),effect:'READ'},options),true,'HISTORY_INVOCATION_DENIED');
    options.signal.throwIfAborted();const result=await invoke(call,options);options.signal.throwIfAborted();return {exitCode:0,json:result};
  }},async request=>{
    const read=async(operation,input)=>{
      const raw=(await request({tool:'run_engine_diagnostic',args:{operation,input}})).json;
      assert.equal(raw.isError??false,false,'HISTORY_MCP_REFUSAL');assert.ok(raw.structuredContent?.result,'HISTORY_RESULT_REQUIRED');return raw.structuredContent.result;
    };
    const inspect=async()=>{
      const result=await read('semantic.catalog.inspect',{catalogId:frozen.catalogId}),current=chain.at(-1);
      assert.equal(result.schema,'evopilot-harness-semantic-supply-discovery/v1');assert.equal(result.status,'AVAILABLE');assert.equal(result.catalogId,frozen.catalogId);
      assert.equal(result.pointerDigest,current.pointer.pointerDigest,'HISTORY_HEAD_CHANGED');assert.equal(result.generationDigest,current.generation.generationDigest);
      assert.ok(isDigest(result.policyDigest));assert.equal(result.readOnly,true);assert.equal(result.grantsPublicationAuthority,false);
      for(const field of ['entries','sets','revokedDigests'])assert.deepEqual(result[field],current.generation[field],'HISTORY_PROJECTION_CHANGED');return result;
    };
    const before=await inspect();
    for(let index=0;index<chain.length;index++)assertHarnessHistoryReadback({expected:frozen,index,result:await read('semantic.catalog.readback',{catalogId:frozen.catalogId,requestId:chain[index].requestId})});
    durableEvidence=readHarnessHistoryEvidence({expected:frozen,catalogRoot,signal,deadline});
    assert.deepEqual(await inspect(),before,'HISTORY_DISCOVERY_DRIFT');assert.ok(performance.now()<deadline,'HISTORY_TIMEOUT');
  });
  return {...report,schema:'evopilot-harness-rc05-history-probe/v1',status:'HISTORY_SUBJOURNEY_ASSERTIONS_PASSED',expectedDigest:probeDigest(frozen),durableEvidence,mutationReplayed:false};
}
