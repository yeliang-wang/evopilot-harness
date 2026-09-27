import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createInstalledProbeTransport,bytesDigest} from './versions/installed-transport.mjs';
import {probeDigest} from './versions/probe-session.mjs';
import {runInstalledProbe} from './versions/run-installed-probe.mjs';

const expected={catalogId:'organization',pointerDigest:'sha256:'+'3'.repeat(64),generationDigest:'sha256:'+'4'.repeat(64)};
// A tiny toy CLI with deliberately incomplete identity evidence; not Harness.
function fixture(t){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'harness-probe-toy-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const root=path.join(temp,'installation'),workspace=path.join(temp,'workspace'),pkg='node_modules/@evopilot/harness';fs.mkdirSync(path.join(root,pkg,'src'),{recursive:true});fs.mkdirSync(workspace);
  const response={schema:'evopilot-harness-semantic-supply-discovery/v1',status:'AVAILABLE',...expected,policyDigest:'sha256:'+'5'.repeat(64),readOnly:true,grantsPublicationAuthority:false,entries:[{}],sets:[{}],revokedDigests:[]};
  const files=Object.entries({'package.json':JSON.stringify({name:'@evopilot/harness',version:'4.8.1',type:'module'}),
    'src/index.mjs':'console.log('+JSON.stringify(JSON.stringify(response))+');\n'}).map(([rel,text])=>{
      const p=pkg+'/'+rel;fs.writeFileSync(path.join(root,p),text);return {path:p,digest:bytesDigest(text)};
    });
  const input={expected};
  const context={schema:'evopilot-installed-readonly-probe-context/v1',product:'harness',version:'4.8.1',installationRoot:root,workspace,files,
    artifactSetDigest:'sha256:'+'1'.repeat(64),acceptanceBindingDigest:'sha256:'+'2'.repeat(64),probeInputDigest:probeDigest(input)};
  const options=()=>{const contextBytes=Buffer.from(JSON.stringify(context));return {contextBytes,expectedContextDigest:bytesDigest(contextBytes),sourceRoot:path.resolve('.')};};
  return {temp,root,context,input,options};
}
const command=['semantic','catalog-inspect','--catalog-id','organization','--json'];
test('versioned wrapper runs pinned toy CLI but never claims formal acceptance',async t=>{
  const f=fixture(t),c=path.join(f.temp,'context.json'),i=path.join(f.temp,'input.json');fs.writeFileSync(c,f.options().contextBytes);fs.writeFileSync(i,JSON.stringify(f.input));
  const r=await runInstalledProbe(['--context',c,'--context-digest',f.options().expectedContextDigest,'--input',i]);
  assert.equal(r.status,'PROBE_ASSERTIONS_PASSED');assert.equal(r.events.length,2);assert.equal(r.targetCriteriaClosed,0);
  assert.equal(r.installation.artifactProvenance,'REQUIRES_INDEPENDENT_CAMPAIGN_VERIFICATION');
  assert.equal(r.supplyProjection,'NOT_REQUESTED');
});
test('null expected generation cannot silently skip the requested independent projection assertion',async t=>{
  const f=fixture(t),c=path.join(f.temp,'context.json'),i=path.join(f.temp,'input.json');
  f.input.generation=null;f.context.probeInputDigest=probeDigest(f.input);
  fs.writeFileSync(c,f.options().contextBytes);fs.writeFileSync(i,JSON.stringify(f.input));
  await assert.rejects(runInstalledProbe(['--context',c,'--context-digest',f.options().expectedContextDigest,'--input',i]),/GENERATION_REQUIRED/);
});
test('publication and Workspace redirection are not runnable commands',async t=>{
  const f=fixture(t),transport=createInstalledProbeTransport(f.options());
  for(const args of [['semantic','catalog-publish','--json'],[...command,'--workspace','/tmp'],['workspace','init','--json']])
    await assert.rejects(transport.invoke(args),/COMMAND_DENIED/);
});
test('only exact bounded readback is added to the read-only transport',async t=>{
  const f=fixture(t),transport=createInstalledProbeTransport(f.options());
  assert.equal((await transport.invoke(['semantic','catalog-readback','--catalog-id','organization','--request-id','first','--json'])).exitCode,0);
  for(const args of [['semantic','catalog-readback','--catalog-id','organization','--request-id','--publish','--json'],
    ['semantic','catalog-readback','--catalog-id','organization','--request-id','first','--publication','{}','--json']])
    await assert.rejects(transport.invoke(args),/COMMAND_DENIED/);
});
test('supply verification cannot be requested without its frozen generation',async t=>{
  const f=fixture(t),c=path.join(f.temp,'context.json'),i=path.join(f.temp,'input.json');
  f.input.supply={catalogRoot:f.temp,publication:{}};f.context.probeInputDigest=probeDigest(f.input);
  fs.writeFileSync(c,f.options().contextBytes);fs.writeFileSync(i,JSON.stringify(f.input));
  await assert.rejects(runInstalledProbe(['--context',c,'--context-digest',f.options().expectedContextDigest,'--input',i]),/EXPECTED_GENERATION_REQUIRED/);
});
test('other products are rejected before their installation can be inspected',t=>{
  const f=fixture(t);f.context.product='runtime';assert.throws(()=>createInstalledProbeTransport(f.options()),/PRODUCT_INVALID/);
});
test('changed and symlinked installed bytes invalidate the transport',async t=>{
  const f=fixture(t),transport=createInstalledProbeTransport(f.options()),file=path.join(f.root,f.context.files[0].path);
  fs.appendFileSync(file,' ');await assert.rejects(transport.invoke(command),/INVENTORY_DRIFT/);
  fs.renameSync(file,path.join(f.temp,'replacement'));fs.symlinkSync(path.join(f.temp,'replacement'),file);
  await assert.rejects(transport.invoke(command),/SYMLINK_REJECTED/);
});
test('source checkout is not an eligible installed root',t=>{
  const f=fixture(t);assert.throws(()=>createInstalledProbeTransport({...f.options(),sourceRoot:f.root}),/MUST_BE_EXTERNAL/);
});
test('input digest must match context before a probe begins',async t=>{
  const f=fixture(t),c=path.join(f.temp,'context.json'),i=path.join(f.temp,'input.json');fs.writeFileSync(c,f.options().contextBytes);fs.writeFileSync(i,'{}');
  await assert.rejects(runInstalledProbe(['--context',c,'--context-digest',f.options().expectedContextDigest,'--input',i]),/INPUT_DIGEST_MISMATCH/);
});
