import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {exactKeys,isDigest,isId,probeDigest} from '../probe-session.mjs';

const hash=bytes=>'sha256:'+crypto.createHash('sha256').update(bytes).digest('hex');
const content=(area,digest)=>{assert.ok(isDigest(digest));return `semantic-catalog/${area}/${digest.slice(7)}.json`;};
const bound=(value,key,schema)=>{assert.equal(value.schema,schema);const {[key]:digest,...body}=value;assert.ok(isDigest(digest));assert.equal(probeDigest(body),digest);};

/** Independent read-only byte/receipt evidence. Expected generation and exact
 * publication decision must come from the reviewed campaign, not discovery.
 * This checks their on-disk realization, not policy provenance or authority. */
export function readHarnessSupplyEvidence({catalogRoot,generation,expected,publication,readback,signal,timeoutMs=30000}) {
  assert.ok(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=30000);
  const deadline=performance.now()+timeoutMs;
  const check=()=>{signal?.throwIfAborted();assert.ok(performance.now()<deadline,'SUPPLY_EVIDENCE_TIMEOUT');};check();
  exactKeys(expected,['catalogId','pointerDigest','generationDigest']);
  assert.ok(isId(expected.catalogId));assert.ok([expected.pointerDigest,expected.generationDigest].every(isDigest));
  exactKeys(publication,['requestId','expectedHead','authorization']);
  assert.ok(typeof publication.requestId==='string'&&publication.requestId.length>0&&publication.requestId.length<=128);
  assert.ok(publication.expectedHead===null||isDigest(publication.expectedHead));
  assert.equal(publication.authorization.decision,'AUTHORIZED');assert.ok(isDigest(publication.authorization.authorizationDigest));
  assert.ok(isId(publication.authorization.actor));
  bound(generation,'generationDigest','evopilot-harness-semantic-catalog/v1');
  assert.equal(generation.catalogId,expected.catalogId);assert.equal(generation.generationDigest,expected.generationDigest);
  assert.ok(Array.isArray(generation.entries)&&generation.entries.length>0&&generation.entries.length<=4096);
  assert.ok(path.isAbsolute(catalogRoot));const root=fs.realpathSync(catalogRoot),rootStat=fs.lstatSync(root);
  const source=path.resolve(import.meta.dirname,'../../../..'),relative=path.relative(source,root);
  assert.ok(relative==='..'||relative.startsWith('../')||path.isAbsolute(relative),'CATALOG_MUST_BE_EXTERNAL');
  assert.ok(rootStat.isDirectory());let total=0;const observed=[];
  const checkedPath=relative=>{
    check();assert.equal(fs.realpathSync(catalogRoot),root,'SUPPLY_ROOT_DRIFT');
    const st=fs.lstatSync(root);assert.equal(st.dev,rootStat.dev);assert.equal(st.ino,rootStat.ino);
    assert.ok(/^[a-zA-Z0-9./-]+$/.test(relative)&&relative.split('/').every(x=>x&&x!=='.'&&x!=='..'));
    let cursor=root;
    for(const part of relative.split('/').slice(0,-1)){cursor=path.join(cursor,part);const s=fs.lstatSync(cursor);assert.ok(s.isDirectory()&&!s.isSymbolicLink(),'SUPPLY_SYMLINK_DENIED');}
    return path.join(root,relative);
  };
  const read=(relative,limit)=>{
    const file=checkedPath(relative),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try {
      const before=fs.fstatSync(fd);assert.ok(before.isFile()&&before.nlink===1&&before.size>0&&before.size<=limit,'SUPPLY_FILE_LIMIT');
      total+=before.size;assert.ok(total<=268435456,'SUPPLY_TOTAL_LIMIT');
      const bytes=Buffer.alloc(before.size);let offset=0;
      while(offset<bytes.length){check();const n=fs.readSync(fd,bytes,offset,Math.min(65536,bytes.length-offset),offset);assert.ok(n>0,'SUPPLY_FILE_DRIFT');offset+=n;}
      const after=fs.fstatSync(fd);for(const k of ['size','mtimeMs','ctimeMs'])assert.equal(after[k],before[k],'SUPPLY_FILE_DRIFT');
      const named=fs.lstatSync(checkedPath(relative));assert.ok(!named.isSymbolicLink());assert.equal(named.dev,after.dev);assert.equal(named.ino,after.ino);
      check();observed.push({path:relative,digest:hash(bytes),bytes:bytes.length});return {bytes,value:JSON.parse(bytes)};
    } finally {fs.closeSync(fd);}
  };
  const pointer=read('SEMANTIC-CATALOG.json',65536).value;
  bound(pointer,'pointerDigest','evopilot-harness-semantic-catalog-pointer/v1');
  exactKeys(pointer,['schema','catalogId','generationPath','generationDigest','previousPointerDigest','receiptDigest','pointerDigest']);
  assert.equal(pointer.catalogId,expected.catalogId);assert.equal(pointer.pointerDigest,expected.pointerDigest);
  assert.equal(pointer.generationDigest,expected.generationDigest);assert.equal(pointer.previousPointerDigest,publication.expectedHead);
  assert.equal(pointer.generationPath,content('generations',expected.generationDigest));
  assert.deepEqual(read(pointer.generationPath,4194304).value,generation,'SUPPLY_GENERATION_CHANGED');
  assert.deepEqual(read(content('heads',pointer.pointerDigest),65536).value,pointer,'SUPPLY_HEAD_CHANGED');
  const receipt=read(content('receipts',pointer.receiptDigest),65536).value;
  bound(receipt,'receiptDigest','evopilot-harness-semantic-catalog-receipt/v1');
  const body={schema:receipt.schema,catalogId:expected.catalogId,generationDigest:expected.generationDigest,
    expectedHead:publication.expectedHead,action:'PUBLISH',requestDigest:hash(publication.requestId),authorization:publication.authorization};
  assert.deepEqual(receipt,{...body,receiptDigest:probeDigest(body)},'SUPPLY_PUBLICATION_CHANGED');
  assert.equal(receipt.receiptDigest,pointer.receiptDigest);
  assert.deepEqual(read(`semantic-catalog/requests/${receipt.requestDigest.slice(7)}.json`,65536).value,receipt,'SUPPLY_REQUEST_CHANGED');
  assert.equal(readback.schema,'evopilot-harness-semantic-supply-readback/v1');assert.equal(readback.status,'COMMITTED');
  assert.deepEqual(readback.pointer,pointer);assert.deepEqual(readback.receipt,receipt);
  const files=new Map();
  for(const entry of generation.entries) {
    assert.equal(entry.path,content('materials',entry.fileDigest));assert.ok(Number.isSafeInteger(entry.bytes)&&entry.bytes>0&&entry.bytes<=16777216);
    if(!files.has(entry.path))files.set(entry.path,read(entry.path,16777216));
    const material=files.get(entry.path);assert.equal(material.bytes.length,entry.bytes);assert.equal(hash(material.bytes),entry.fileDigest,'SUPPLY_MATERIAL_CHANGED');
    if(entry.kind==='ProjectOntologySkill') {
      assert.deepEqual(entry.parent,{artifactSetDigest:material.value.artifactSetDigest,jsonPointer:'/spec/projectOntologySkill'});
      assert.equal(material.value.spec.projectOntologySkill.skillDigest,entry.objectDigest);
    }
  }
  assert.deepEqual(read('SEMANTIC-CATALOG.json',65536).value,pointer,'SUPPLY_POINTER_DRIFT');check();
  return {schema:'evopilot-harness-rc01-supply-bytes-evidence/v1',status:'SUPPLY_BYTES_AND_RECEIPT_ASSERTIONS_PASSED',
    pointerDigest:pointer.pointerDigest,generationDigest:generation.generationDigest,receiptDigest:receipt.receiptDigest,
    materialFiles:files.size,observed,targetCriteriaClosed:0,formalAcceptance:'NOT_EVALUATED',
    publicationAuthority:'REQUIRES_INDEPENDENT_CAMPAIGN_VERIFICATION',releaseAuthorized:false};
}
