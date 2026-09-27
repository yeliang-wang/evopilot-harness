import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createInstalledProbeTransport} from './installed-transport.mjs';
import {probeDigest,exactKeys} from './probe-session.mjs';
import {runHarnessDiscoveryProbe} from './4.8.1/discovery-probe.mjs';
import {readHarnessSupplyEvidence} from './4.8.1/supply-materials.mjs';
const root=path.resolve(import.meta.dirname,'../../..');
const read=(file,limit)=>{assert.ok(path.isAbsolute(file));const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=limit);return fs.readFileSync(file);};
export async function runInstalledProbe(args){
  assert.equal(args.length,6,'EXPLICIT_CONTEXT_AND_INPUT_REQUIRED');
  assert.equal(args[0],'--context');assert.equal(args[2],'--context-digest');assert.equal(args[4],'--input');
  const contextBytes=read(args[1],8388608),context=JSON.parse(contextBytes);assert.equal(context.product,'harness','OWNING_PRODUCT_REQUIRED');
  const input=JSON.parse(read(args[5],8388608));assert.equal(probeDigest(input),context.probeInputDigest,'PROBE_INPUT_DIGEST_MISMATCH');
  exactKeys(input,['expected',...(Object.hasOwn(input,'generation')?['generation']:[]),...(Object.hasOwn(input,'supply')?['supply']:[])]);
  if(Object.hasOwn(input,'supply')){exactKeys(input.supply,['catalogRoot','publication']);assert.ok(input.generation,'EXPECTED_GENERATION_REQUIRED');}
  const transport=createInstalledProbeTransport({contextBytes,expectedContextDigest:args[3],sourceRoot:root});
  const report=await runHarnessDiscoveryProbe({invoke:transport.invoke,expected:input.expected,generation:input.generation});
  let supplyEvidence=null;
  if(input.supply) {
    const readback=await transport.invoke(['semantic','catalog-readback','--catalog-id',input.expected.catalogId,'--request-id',input.supply.publication.requestId,'--json']);
    assert.equal(readback.exitCode,0,'SUPPLY_READBACK_FAILED');
    supplyEvidence=readHarnessSupplyEvidence({...input.supply,generation:input.generation,expected:input.expected,readback:readback.json});
  }
  return {...report,supplyEvidence,installation:transport.identity};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{process.stdout.write(JSON.stringify(await runInstalledProbe(process.argv.slice(2)))+'\n');}
  catch{process.stdout.write(JSON.stringify({status:'BLOCKED',code:'INSTALLED_PROBE_REFUSED',targetCriteriaClosed:0,formalAcceptance:'NOT_EVALUATED',releaseAuthorized:false})+'\n');process.exitCode=2;}
}
