import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateNativeHarness,nativeBytesDigest,inspectHarnessPackage,nativeSha256} from '@evopilot-next/harness/native';
import {syntheticHarnessPackage,replaceNativeFile} from '../../examples/native/package.mjs';
import {wrapperSource} from '../fixtures/native-fault-wrapper.mjs';
const tools=()=>JSON.parse(readFileSync(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN,'utf8'));

for(const fault of ['truncated','unknown-structure','unknown-status','exit','signal','exit-report-mismatch','tests-unknown-status','verify-unknown-status','tests-duplicate','tests-missing','tests-skip','tests-error','engine-disagreement']) {
 test('H03/H12: native subprocess fault '+fault+' cannot produce PASS',async t=>{
  const root=mkdtempSync(join(tmpdir(),'harness-fault-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const lock=tools(),tool=fault.startsWith('tests-')||fault==='engine-disagreement'?'opa':'conftest';
  const executable=join(root,'fault.mjs'),source=wrapperSource({node:process.execPath,executable:lock.tools[tool].executable,tool,fault});
  writeFileSync(executable,source,{mode:0o700});lock.tools[tool]={...lock.tools[tool],executable,sha256:nativeBytesDigest(source).slice(7)};
  const report=await validateNativeHarness(syntheticHarnessPackage(),lock);
  assert.equal(report.executionStatus,'ERROR',JSON.stringify(report.issues));
  assert.equal(report.qualityStatus,'ERROR');assert(report.commands.length>0);
  if(fault==='signal')assert(report.commands.some(c=>c.signal==='SIGKILL'));
  if(fault==='exit')assert(report.commands.some(c=>c.exitCode===73));
  if(fault==='engine-disagreement')assert(report.issues.some(x=>x.includes('Engine failure agreement')));
 });
}

for(const [id,expression] of [
 ['DNS','net.lookup_ip_addr("localhost")'],['ENVIRONMENT','opa.runtime()'],
 ['RANDOM','rand.intn("unbound",100)'],['FILE','io.read_file("/etc/hosts")']
])test('H08: '+id+' capability is rejected by the actual locked compiler',async()=>{
 const p=syntheticHarnessPackage();replaceNativeFile(p,'policy/quality.rego',p.files['policy/quality.rego']+'\nunsafe := '+expression+'\n');
 const r=await validateNativeHarness(p,tools());assert.equal(r.executionStatus,'ERROR');assert.equal(r.qualityStatus,'ERROR');
 const strict=r.commands.find(c=>c.id==='strict');assert(strict);assert.notEqual(strict.exitCode,0);
});

for(const [id,text] of [['SYNTAX','package project.quality\nbroken {'],['REGO_V0','package project.quality\ndeny_H001[x] { x := "legacy" }'],['EMPTY',''],['HELPER_ONLY','package project.quality\nhelper := 1\n']])
 test('H01/H02: '+id+' cannot replace the declared required rule set',async()=>{
  const p=syntheticHarnessPackage();replaceNativeFile(p,'policy/quality.rego',text);
  const r=await validateNativeHarness(p,tools());assert.notEqual(r.qualityStatus,'PASS');
 });

test('H05: deny and violation observations remain quality failures',async()=>{
 const p=syntheticHarnessPackage();
 for(const id of ['deny','violation']){const r=await validateNativeHarness(p,tools(),{observation:JSON.parse(p.files['tests/fixtures/'+id+'.json'])});assert.equal(r.executionStatus,'SUCCEEDED');assert.equal(r.qualityStatus,'FAIL');assert(r.criteria.some(x=>x.variantId==='actual-observation'&&x.status==='FAIL'));}
});

test('H06: inherited CONFTEST environment cannot disable fail-on-warn',async()=>{
 const before=process.env.CONFTEST_NO_FAIL;process.env.CONFTEST_NO_FAIL='true';
 try {const p=syntheticHarnessPackage(),r=await validateNativeHarness(p,tools(),{observation:JSON.parse(p.files['tests/fixtures/warn.json'])});assert.equal(r.qualityStatus,'FAIL');assert(r.commands.find(c=>c.id==='actual-conftest').argv.includes('--no-fail=false'));}
 finally {if(before===undefined)delete process.env.CONFTEST_NO_FAIL;else process.env.CONFTEST_NO_FAIL=before;}
});

test('H07: same-valued parameter source changes the candidate identity',()=>{
 const p=syntheticHarnessPackage(),old=nativeSha256(p),value=p.files['data/parameters.json'];
 replaceNativeFile(p,'data/relocated.json',value);delete p.files['data/parameters.json'];p.manifest.files=p.manifest.files.filter(x=>x.path!=='data/parameters.json');p.manifest.entrypoints.data=['data/relocated.json'];
 assert.equal(inspectHarnessPackage(p).parameters.maxWarnings,0);assert.notEqual(nativeSha256(p),old);
});
