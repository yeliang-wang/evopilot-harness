import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateNativeHarness,inspectHarnessPackage,nativeSha256} from '@evopilot-next/harness/native';
import {syntheticHarnessPackage,replaceNativeFile} from '../../examples/native/package.mjs';

const tools=()=>JSON.parse(readFileSync(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN,'utf8'));
const observation=p=>JSON.parse(p.files['observations/current.json']);

for(const [id,mutate] of [
 ['H04.02',v=>{delete v.source;}],
 ['H04.03',v=>{v.values.tests.exitCode='0';}],
 ['H04.05',v=>{delete v.values.tests;}]
]) test(id+': malformed required observation cannot pass',async()=>{
 const p=syntheticHarnessPackage(),v=observation(p);mutate(v);
 if(id==='H04.02') await assert.rejects(()=>validateNativeHarness(p,tools(),{observation:v}));
 else {const r=await validateNativeHarness(p,tools(),{observation:v});assert.equal(r.qualityStatus,'FAIL');assert(r.criteria.some(c=>c.criterionId==='requirement-H001'&&c.variantId==='actual-observation'&&c.status==='FAIL'));}
});

test('H04.04: required rule array cannot be emptied',()=>{
 const p=syntheticHarnessPackage(),c=JSON.parse(p.files['coverage.json']);c.requiredRuleIds=[];
 replaceNativeFile(p,'coverage.json',c);assert.throws(()=>inspectHarnessPackage(p));
});

test('H05.05: actual builtin error remains ERROR with native diagnostics',async()=>{
 const p=syntheticHarnessPackage();
 replaceNativeFile(p,'policy/quality.rego',p.files['policy/quality.rego']+'\ndeny_H001 contains {"msg":"builtin error","ruleId":"H001"} if { input.values.errorCase; to_number(input.values.badNumber) > 0 }\n');
 const v=observation(p);v.values.errorCase=true;v.values.badNumber='not-a-number';
 const r=await validateNativeHarness(p,tools(),{observation:v});
 assert.equal(r.executionStatus,'ERROR');assert.equal(r.qualityStatus,'ERROR');
 assert(r.commands.some(c=>c.exitCode!==0&&/to_number|builtin/i.test(c.stderr+c.stdout)));
});

test('H06.02: unrelated working-directory configuration cannot weaken warnings',async()=>{
 const old=process.cwd(),dir=mkdtempSync(join(tmpdir(),'harness-cwd-'));
 writeFileSync(join(dir,'conftest.toml'),'no-fail = true\nfail-on-warn = false\n');
 try {process.chdir(dir);const p=syntheticHarnessPackage(),v=JSON.parse(p.files['tests/fixtures/warn.json']);
  const r=await validateNativeHarness(p,tools(),{observation:v});assert.equal(r.qualityStatus,'FAIL');
  const c=r.commands.find(x=>x.id==='actual-conftest');assert.equal(c.exitCode,1);assert(c.argv.includes('--fail-on-warn'));assert(c.argv.includes('--no-fail=false'));
 } finally {process.chdir(old);rmSync(dir,{recursive:true,force:true});}
});

test('H07.03: allowed threshold change invalidates the former configuration context',async()=>{
 const p=syntheticHarnessPackage(),schema=JSON.parse(p.files['parameter-schema.json']);schema.properties.maxWarnings.maximum=1;
 replaceNativeFile(p,'parameter-schema.json',schema);const prior=inspectHarnessPackage(p);
 const context={workspaceId:'synthetic',scope:{visibility:'private',projectId:'synthetic'},projectCandidateDigest:nativeSha256('candidate'),claimId:nativeSha256('claim'),inputDigest:nativeSha256('input'),effectiveConfigDigest:prior.effectiveConfigDigest,sourceScopeDigest:nativeSha256('scope'),requirementSetDigest:nativeSha256('requirements')};
 const digest=nativeSha256(p);replaceNativeFile(p,'data/parameters.json',{params:{maxWarnings:1}});
 schema.properties.maxWarnings.default=1;replaceNativeFile(p,'parameter-schema.json',schema);
 assert.notEqual(nativeSha256(p),digest);assert.notEqual(inspectHarnessPackage(p).effectiveConfigDigest,context.effectiveConfigDigest);
 await assert.rejects(()=>validateNativeHarness(p,tools(),{context}),/configuration context mismatch/);
});

test('H11.01: deleting one required native rule is detected by AST closure',async()=>{
 const p=syntheticHarnessPackage();replaceNativeFile(p,'policy/quality.rego',p.files['policy/quality.rego'].replace(/deny_H001 contains[\s\S]*?\n}\n/,''));
 const r=await validateNativeHarness(p,tools());assert.equal(r.qualityStatus,'ERROR');assert(r.issues.some(x=>/AST rule catalog/.test(x)));
});

test('H11.03: downgrading deny to warn cannot satisfy fixed negative cases',async()=>{
 const p=syntheticHarnessPackage();
 for(const path of ['policy/quality.rego','policy/quality_test.rego','rule-catalog.json'])replaceNativeFile(p,path,p.files[path].replaceAll('deny_H001','warn_H001'));
 const r=await validateNativeHarness(p,tools());assert.equal(r.qualityStatus,'FAIL');
 assert(r.criteria.some(c=>c.criterionId==='requirement-H001'&&c.variantId==='deny'&&c.status==='FAIL'));
 const c=r.commands.find(x=>x.id==='case-deny-conftest');assert.equal(c.exitCode,1);assert(c.argv.includes('--fail-on-warn'));
});
