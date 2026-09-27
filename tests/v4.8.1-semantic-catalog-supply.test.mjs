import {stageSourceHarness} from './helpers/isolated-source-harness.mjs';
import assert from "node:assert/strict";
import fs from "node:fs";
import asyncFs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {spawnSync,fork} from "node:child_process";
import { digest, readYaml, writeJson, writeYaml } from "../src/v3/utils.mjs";
import { engineCapabilities, invokeEngineOperation } from "../src/v4/engine-adapter.mjs";
import { assembleSemanticGeneration, resolveSemanticGeneration } from "../src/v4/semantics/catalog-generation.mjs";
import { semanticCatalogOperation, semanticPublicationSubject, semanticRecoverySubject } from "../src/v4/semantics/catalog-supply.mjs";
import { semanticSupplyFixture } from "./fixtures/semantic-supply.mjs";
import {withSupplyDigest} from "../src/v4/semantics/catalog-contract.mjs";
import { TestMcpClient, structured, governedHostInteraction } from "./helpers/mcp-client.mjs";
import {runHarnessDiscoveryProbe} from './e2e/versions/4.8.1/discovery-probe.mjs';
import {assertHarnessSupplyProjection} from './e2e/versions/4.8.1/supply-assertions.mjs';
import {readHarnessSupplyEvidence} from './e2e/versions/4.8.1/supply-materials.mjs';
import {runInstalledProbe} from './e2e/versions/run-installed-probe.mjs';
import {probeDigest} from './e2e/versions/probe-session.mjs';
import {runHarnessPublicationJourney} from './e2e/versions/4.8.1/publication-journey.mjs';
import {runHarnessRecoveryProbe,recoveryExpectations,assertHarnessRecoveryProjection,readHarnessRecoveryEvidence} from './e2e/versions/4.8.1/recovery-probe.mjs';
import {runHarnessHistoryProbe,harnessHistoryExpectations,assertHarnessHistoryReadback,readHarnessHistoryEvidence} from './e2e/versions/4.8.1/history-probe.mjs';
import {runHarnessRefusalProbe,assertHarnessRefusal} from './e2e/versions/4.8.1/refusal-probe.mjs';

import {preparedSemanticSupply as prepared} from './fixtures/prepared-semantic-supply.mjs';

test('versioned Harness probe reads actual CLI without publishing or mutating the synthetic Catalog',async t=>{
  const setup=prepared(t);await semanticCatalogOperation(setup.request);
  const before=fs.readFileSync(path.join(setup.organization,'SEMANTIC-CATALOG.json'));
  const current=await semanticCatalogOperation({home:setup.home,action:'inspect',catalogId:'organization'});
  const report=await runHarnessDiscoveryProbe({expected:{catalogId:'organization',pointerDigest:current.pointerDigest,generationDigest:current.generationDigest},
    generation:setup.built.generation,
    invoke:async args=>{
      const r=spawnSync(process.execPath,[path.resolve('src/index.mjs'),...args,'--workspace',setup.home],
        {timeout:10000,encoding:'utf8',maxBuffer:1048576,env:{PATH:process.env.PATH}});
      if(r.error)throw r.error;return {exitCode:r.status,json:JSON.parse(r.stdout)};
    }});
  assert.equal(report.status,'PROBE_ASSERTIONS_PASSED');assert.equal(report.events.length,2);assert.equal(report.targetCriteriaClosed,0);
  assert.deepEqual(fs.readFileSync(path.join(setup.organization,'SEMANTIC-CATALOG.json')),before);
  for(const [name,mutate] of [
    ['missing material entry',v=>v.entries.pop()],['duplicate identity',v=>v.entries.push(v.entries[0])],
    ['foreign scope',v=>{v.sets[0].scope.projectId='foreign';}],
    ['detached embedded Skill',v=>{v.entries.find(e=>e.kind==='ProjectOntologySkill').parent.jsonPointer='/wrong';}],
    ['asset relabeled as Engine version',v=>{v.entries.find(e=>e.kind==='TerminalSemanticClosure').version='4.8.1';}]
  ])await t.test(name,()=>{const bad=structuredClone(current);mutate(bad);assert.throws(()=>assertHarnessSupplyProjection({discovery:bad,generation:setup.built.generation}));});
});

test('independent supply byte evidence verifies actual materials, embedded Skill and committed publication receipt',async t=>{
  const setup=prepared(t),generation=structuredClone(setup.built.generation);
  const publication={requestId:setup.request.requestId,expectedHead:null,authorization:structuredClone(setup.request.publication)};
  const published=await semanticCatalogOperation(setup.request);
  const readback=await semanticCatalogOperation({home:setup.home,action:'readback',requestId:publication.requestId});
  const input={catalogRoot:setup.organization,generation,publication,readback,
    expected:{catalogId:generation.catalogId,pointerDigest:published.pointer.pointerDigest,generationDigest:generation.generationDigest}};
  const verify=overrides=>readHarnessSupplyEvidence({...input,...overrides});
  const report=verify();assert.equal(report.status,'SUPPLY_BYTES_AND_RECEIPT_ASSERTIONS_PASSED');
  assert.equal(report.materialFiles,new Set(generation.entries.map(e=>e.path)).size);assert.equal(report.targetCriteriaClosed,0);
  assert.equal(report.observed.some(e=>e.path.includes('/receipts/')),true);
  await t.test('installed wrapper connects toy transport to independently read actual supply bytes',async()=>{
    const discovery=await semanticCatalogOperation({home:setup.home,action:'inspect',catalogId:'organization'});
    const root=path.join(setup.home,'toy-installation'),pkg='node_modules/@evopilot/harness';
    const toy=`console.log(JSON.stringify(process.argv[3]==='catalog-readback'?${JSON.stringify(readback)}:${JSON.stringify(discovery)}));\n`;
    const files=Object.entries({'package.json':JSON.stringify({name:'@evopilot/harness',version:'4.8.1',type:'module'}),'src/index.mjs':toy}).map(([relative,text])=>{
      const file=path.join(root,pkg,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return {path:pkg+'/'+relative,digest:digest(text)};
    });
    const request={expected:input.expected,generation,supply:{catalogRoot:setup.organization,publication}};
    const context={schema:'evopilot-installed-readonly-probe-context/v1',product:'harness',version:'4.8.1',installationRoot:root,workspace:setup.home,files,
      artifactSetDigest:digest('toy-not-a-candidate'),acceptanceBindingDigest:digest('synthetic-only'),probeInputDigest:probeDigest(request)};
    const contextFile=path.join(setup.home,'toy-context.json'),inputFile=path.join(setup.home,'toy-probe-input.json');writeJson(contextFile,context);writeJson(inputFile,request);
    const connected=await runInstalledProbe(['--context',contextFile,'--context-digest',digest(fs.readFileSync(contextFile)),'--input',inputFile]);
    assert.equal(connected.supplyEvidence.status,report.status);assert.equal(connected.targetCriteriaClosed,0);
  });
  await t.test('isolated real Harness CLI verifies supply and receipts without changing the published pointer',async()=>{
    const staged=stageSourceHarness(setup.home),request={expected:input.expected,generation,supply:{catalogRoot:setup.organization,publication}};
    const before=fs.readFileSync(path.join(setup.organization,'SEMANTIC-CATALOG.json'));
    const context={schema:'evopilot-installed-readonly-probe-context/v1',product:'harness',version:'4.8.1',...staged,workspace:setup.home,
      artifactSetDigest:probeDigest(staged.files),acceptanceBindingDigest:probeDigest('source-integration-not-candidate'),probeInputDigest:probeDigest(request)};
    const contextFile=path.join(setup.home,'source-context.json'),inputFile=path.join(setup.home,'source-probe-input.json');writeJson(contextFile,context);writeJson(inputFile,request);
    const args=['--context',contextFile,'--context-digest',digest(fs.readFileSync(contextFile)),'--input',inputFile];
    const connected=await runInstalledProbe(args);assert.equal(connected.status,'PROBE_ASSERTIONS_PASSED');assert.equal(connected.supplyEvidence.status,'SUPPLY_BYTES_AND_RECEIPT_ASSERTIONS_PASSED');assert.equal(connected.targetCriteriaClosed,0);
    assert.deepEqual(fs.readFileSync(path.join(setup.organization,'SEMANTIC-CATALOG.json')),before);
    fs.appendFileSync(path.join(staged.installationRoot,'node_modules/@evopilot/harness/src/index.mjs'),'\n// drift\n');
    await assert.rejects(runInstalledProbe(args),/INSTALLED_INVENTORY_DRIFT/);
    assert.deepEqual(fs.readFileSync(path.join(setup.organization,'SEMANTIC-CATALOG.json')),before);
  });
  for(const [name,change] of [
    ['wrong request',v=>{v.publication.requestId='unrelated';}],
    ['wrong decision',v=>{v.publication.authorization.actor='foreign';}],
    ['uncertain readback',v=>{v.readback.status='UNKNOWN';}],
    ['forged readback',v=>{v.readback.receipt.action='ROLLBACK';}],
    ['wrong pointer',v=>{v.expected.pointerDigest=digest('wrong');}]
  ])await t.test(name,()=>{const copy=structuredClone(input);change(copy);assert.throws(()=>readHarnessSupplyEvidence(copy));});
  for(const relative of [generation.entries[0].path,
    `semantic-catalog/receipts/${published.receipt.receiptDigest.slice(7)}.json`,
    `semantic-catalog/requests/${published.receipt.requestDigest.slice(7)}.json`]) {
    await t.test('missing and changed '+relative,()=>{
      const file=path.join(setup.organization,relative),bytes=fs.readFileSync(file);
      fs.renameSync(file,file+'.retained');assert.throws(()=>verify());fs.renameSync(file+'.retained',file);
      fs.writeFileSync(file,'{}\n');assert.throws(()=>verify());fs.writeFileSync(file,bytes);
    });
  }
  await t.test('symlinked material directory',()=>{
    const dir=path.join(setup.organization,'semantic-catalog/materials');fs.renameSync(dir,dir+'-retained');fs.symlinkSync(dir+'-retained',dir);
    assert.throws(()=>verify(),/SYMLINK_DENIED/);fs.unlinkSync(dir);fs.renameSync(dir+'-retained',dir);
  });
  await t.test('cancellation and operation deadline',()=>{
    const controller=new AbortController();controller.abort();assert.throws(()=>verify({signal:controller.signal}));
    let now=0;const mocked=t.mock.method(performance,'now',()=>{now+=1000;return now;});
    assert.throws(()=>verify({timeoutMs:1500}),/TIMEOUT/);mocked.mock.restore();
  });
  assert.equal(verify().status,report.status);
});

test("already cancelled service operations stop before configuration or preview work", async t => {
  const setup = prepared(t);
  const controller = new AbortController();
  controller.abort();
  for (const action of ["preview", "publish", "inspect", "readback", "transition-preview", "rollback", "revoke", "recovery-inspect", "recovery-readback", "recover"]) {
    await assert.rejects(semanticCatalogOperation({...setup.request, action, signal: controller.signal}), error => error.code === "CANCELLED");
  }
  assert.equal(fs.existsSync(path.join(setup.organization, "semantic-catalog")), false);
});

test("cancelling a chunked service input read closes its handle without reading remaining chunks", async t => {
  const setup = prepared(t);
  fs.appendFileSync(path.join(setup.home, "input.json"), " ".repeat(131072));
  const controller = new AbortController();
  const open = asyncFs.open;
  let reads = 0, closed = false;
  t.mock.method(asyncFs, "open", async (...args) => {
    const handle = await open(...args);
    if (args[0] === path.join(setup.home, "input.json")) {
      const read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = async (...values) => {const result = await read(...values); reads++; controller.abort(); return result;};
      handle.close = async () => {await close(); closed = true;};
    }
    return handle;
  });
  await assert.rejects(semanticCatalogOperation({...setup.request, action: "preview", signal: controller.signal}), error => error.code === "CANCELLED");
  assert.equal(reads, 1);
  assert.equal(closed, true);
  assert.equal(fs.existsSync(path.join(setup.organization, "semantic-catalog")), false);
});

test("service preparation and publication share one deadline rather than resetting at the store", async t => {
  const setup = prepared(t);
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const open = asyncFs.open;
  let preparedInput = false, staged = false;
  const mocked = t.mock.method(asyncFs, "open", async (...args) => {
    const handle = await open(...args);
    if (args[0] === path.join(setup.home, "input.json")) {now = 20000; preparedInput = true;}
    if (String(args[0]).includes("/semantic-catalog/materials/")) {now = 30000; staged = true;}
    return handle;
  });
  await assert.rejects(semanticCatalogOperation(setup.request), error => error.code === "TIMEOUT");
  assert.equal(preparedInput && staged, true);
  assert.equal(fs.existsSync(path.join(setup.organization, "SEMANTIC-CATALOG.json")), false);
  mocked.mock.restore();
  const readback = await semanticCatalogOperation({home: setup.home, action: "readback", requestId: "first"});
  assert.equal(readback.status, "UNKNOWN");
});

test("Registry accepts exactly sixteen enabled roots and rejects a seventeenth without scanning it", async t => {
  const setup = prepared(t);
  const file = path.join(setup.home, "harness-registry.yaml");
  const registry = readYaml(file);
  registry.catalogs = [registry.catalogs.find(item => item.id === "organization")];
  for (let i = 1; i < 16; i++) registry.catalogs.push({id: `unused-${i}`, root: `./unused-${i}`, enabled: true});
  writeYaml(file, registry);
  assert.equal((await semanticCatalogOperation({...setup.request, action: "preview"})).status, "READY");
  registry.catalogs.push({id: "unused-16", root: "./unused-16", enabled: true});
  writeYaml(file, registry);
  await assert.rejects(semanticCatalogOperation({...setup.request, action: "preview"}), error => error.code === "ROOT_LIMIT");
});

test("cancellation after pointer rename returns UNKNOWN and fresh readback proves COMMITTED", async t => {
  const setup = prepared(t);
  const controller = new AbortController();
  const rename = asyncFs.rename;
  let switches = 0;
  t.mock.method(asyncFs, "rename", async (from, to) => {
    await rename(from, to);
    if (path.basename(to) === "SEMANTIC-CATALOG.json") {switches++; controller.abort();}
  });
  await assert.rejects(semanticCatalogOperation({...setup.request, signal: controller.signal}), error => error.code === "UNKNOWN");
  assert.equal((await semanticCatalogOperation({home: setup.home, action: "readback", requestId: "first"})).status, "COMMITTED");
  await assert.rejects(semanticCatalogOperation(setup.request), error => error.code === "CONFLICT");
  assert.equal(switches, 1);
});

test("generation discovers ArtifactSet, parent-bound embedded Skill and exact old-version Closure", () => {
  const set = semanticSupplyFixture();
  const assembled = assembleSemanticGeneration({catalogId: "organization", sets: [set]});
  const skill = assembled.generation.entries.find(entry => entry.kind === "ProjectOntologySkill");
  const artifact = assembled.generation.entries.find(entry => entry.kind === "ProjectOntologyArtifactSet");
  assert.equal(skill.path, artifact.path);
  assert.equal(skill.parent.jsonPointer, "/spec/projectOntologySkill");
  assert.equal(skill.parent.artifactSetDigest, artifact.objectDigest);
  assert.equal(assembled.generation.entries.find(entry => entry.kind === "TerminalSemanticClosure").version, "4.8.0");
  assert.ok(assembled.generation.entries.some(entry => entry.category === "DEPENDENCY" && entry.version === null));
  assert.equal(digest(resolveSemanticGeneration(assembled)[0]), digest(set));
});

test("full synthetic assembly-publication-discovery-readback preserves legacy bytes", async t => {
  const setup = prepared(t);
  const before = ["CATALOG.md", "catalog.lock.json"].map(file => digest(fs.readFileSync(path.join(setup.organization, file))));
  const preview = await semanticCatalogOperation({...setup.request, action: "preview"});
  assert.equal(preview.generationDigest, setup.built.generation.generationDigest);
  assert.equal(preview.grantsPublicationAuthority, false);
  const published = await semanticCatalogOperation(setup.request);
  assert.equal(published.status, "PUBLISHED");
  const discovered = await semanticCatalogOperation({home: setup.home, action: "inspect"});
  assert.equal(discovered.status, "AVAILABLE");
  assert.equal(discovered.entries.filter(entry => entry.category === "ASSET").length, 3);
  assert.equal(discovered.readOnly, true);
  assert.equal((await semanticCatalogOperation({home: setup.home, action: "readback", requestId: "first"})).status, "COMMITTED");
  assert.deepEqual(["CATALOG.md", "catalog.lock.json"].map(file => digest(fs.readFileSync(path.join(setup.organization, file)))), before);
});

test("every published material file is required and tampering never yields a partial service result", async t => {
  const setup = prepared(t);
  await semanticCatalogOperation(setup.request);
  const files = [...new Set(setup.built.generation.entries.map(entry => entry.path))];
  assert.ok(files.length > 10);
  const pointerFile = path.join(setup.organization, "SEMANTIC-CATALOG.json");
  const originalPointer = fs.readFileSync(pointerFile);
  for (const relative of files) {
    const file = path.join(setup.organization, relative);
    const original = fs.readFileSync(file);
    fs.renameSync(file, `${file}.fixture-saved`);
    try {
      await assert.rejects(semanticCatalogOperation({home: setup.home, action: "inspect"}), error => error.code === "UNAVAILABLE", relative);
    } finally {fs.renameSync(`${file}.fixture-saved`, file);}
    fs.writeFileSync(file, "{}\n");
    try {
      await assert.rejects(semanticCatalogOperation({home: setup.home, action: "inspect"}), error => error.code === "DIGEST_MISMATCH", relative);
    } finally {fs.writeFileSync(file, original);}
  }
  assert.deepEqual(fs.readFileSync(pointerFile), originalPointer);
  assert.equal((await semanticCatalogOperation({home: setup.home, action: "inspect"})).generationDigest, setup.built.generation.generationDigest);
});

test("shared dependencies stay project-scoped and generation ordering is deterministic", () => {
  const first = semanticSupplyFixture({projectId: "first-project"});
  const second = semanticSupplyFixture({projectId: "second-project"});
  const a = assembleSemanticGeneration({catalogId: "organization", sets: [first, second]});
  const b = assembleSemanticGeneration({catalogId: "organization", sets: [second, first]});
  assert.equal(a.generation.generationDigest, b.generation.generationDigest);
  assert.equal(a.generation.entries.filter(entry => entry.kind === "OntologyFoundation").length, 2);
  assert.equal(resolveSemanticGeneration(a).length, 2);
});

for(const [variant,code] of [
  ['unpublished','UNAVAILABLE'],['permission','PERMISSION_DENIED'],['disabled','PERMISSION_DENIED'],
  ['revoked-asset','PERMISSION_DENIED'],['root-binding','PERMISSION_DENIED'],['unknown-policy','TRUST_REQUIRED'],
  ['policy-symlink','PATH_DENIED'],['pointer-json','INVALID_JSON'],['pointer-digest','DIGEST_MISMATCH'],
  ['missing-material','UNAVAILABLE'],['material-digest','DIGEST_MISMATCH'],['material-size','FILE_LIMIT']
])test(`RC02 public refusal probe independently checks ${variant}`,async t=>{
  const setup=prepared(t);if(variant!=='unpublished')await semanticCatalogOperation(setup.request);
  const policyFile=path.join(setup.home,'semantic-catalog-policy.json'),pointerFile=path.join(setup.organization,'SEMANTIC-CATALOG.json');
  const materialFile=path.join(setup.organization,setup.built.generation.entries[0].path);
  if(variant==='permission')setup.policy.catalogs[0].permission='DENIED';
  if(variant==='revoked-asset')setup.policy.catalogs[0].grants[0].revoked=true;
  if(variant==='root-binding')setup.policy.catalogs[0].rootBindingDigest=digest('other-root');
  if(variant==='unknown-policy')setup.policy.catalogs[0].allowAll=true;
  writeJson(policyFile,setup.policy);
  if(variant==='disabled'){const file=path.join(setup.home,'harness-registry.yaml'),registry=readYaml(file);registry.catalogs[0].enabled=false;writeYaml(file,registry);}
  if(variant==='policy-symlink'){fs.renameSync(policyFile,policyFile+'.saved');fs.symlinkSync(policyFile+'.saved',policyFile);}
  if(variant==='pointer-json')fs.writeFileSync(pointerFile,'{ invalid synthetic marker: do-not-disclose }');
  if(variant==='pointer-digest'){const pointer=JSON.parse(fs.readFileSync(pointerFile));pointer.pointerDigest=digest('tamper');writeJson(pointerFile,pointer);}
  if(variant==='missing-material')fs.renameSync(materialFile,materialFile+'.saved');
  if(variant==='material-size')fs.appendFileSync(materialFile,'\n');
  if(variant==='material-digest'){const bytes=fs.readFileSync(materialFile);assert.equal(bytes.at(-1),10);bytes[bytes.length-1]=32;fs.writeFileSync(materialFile,bytes);}
  const expected={catalogId:'organization',workspace:setup.home,code},calls=[];
  const client=new TestMcpClient({command:process.execPath,args:['src/index.mjs','mcp','serve','--workspace',setup.home],cwd:path.resolve(import.meta.dirname,'..')});
  try {
    await client.initialize();const before=catalogSnapshot(setup.home);let raw;
    const base={expected,authorizeInvocation:async frame=>{calls.push(frame);return true;},invoke:async({tool,args})=>{raw=await client.rawTool(tool,args);return raw;}};
    const report=await runHarnessRefusalProbe(base);assert.equal(report.status,'REFUSAL_SUBJOURNEY_ASSERTIONS_PASSED');assert.equal(report.code,code);
    assert.equal(report.targetCriteriaClosed,0);assert.equal(report.realHost,'NOT_QUALIFIED_BY_THIS_PROBE');assert.equal(report.releaseAuthorized,false);
    assert.equal(calls.length,1);assert.equal(calls[0].effect,'READ');assert.equal(calls[0].call.args.operation,'semantic.catalog.inspect');
    assert.deepEqual(catalogSnapshot(setup.home),before);
    for(const [name,mutate] of [
      ['wrong code',v=>{v.structuredContent.result.code='OTHER';}],['wrong action',v=>{v.structuredContent.nextAction='publish-now';}],
      ['leaked content',v=>{v.structuredContent.result.error+=' synthetic-private-content';}],['wrong workspace',v=>{v.structuredContent.workspace='/foreign';}],
      ['wrong operation',v=>{v.structuredContent.operation='semantic.catalog.publish';}],['success disguised',v=>{v.structuredContent.exitCode=0;}],
      ['transport error',v=>{v.isError=true;}],['injected authority',v=>{v.structuredContent.grantsPublicationAuthority=true;}],
      ['text-only leak',v=>{v.content[0].text+=' synthetic-private-content';}]
    ]){const forged=structuredClone(raw);mutate(forged);assert.throws(()=>assertHarnessRefusal({expected,response:forged}),undefined,name);}
    let invoked=0;const fake={...base,invoke:async()=>{invoked++;return raw;}};
    await assert.rejects(runHarnessRefusalProbe({...fake,authorizeInvocation:async()=>false}),/INVOCATION_DENIED/);assert.equal(invoked,0);
    await assert.rejects(runHarnessRefusalProbe({...fake,expected:{...expected,code:'UNKNOWN'}}),/CODE_NOT_SUPPORTED/);assert.equal(invoked,0);
    const controller=new AbortController();controller.abort();await assert.rejects(runHarnessRefusalProbe({...fake,signal:controller.signal}),/CANCELLED/);assert.equal(invoked,0);
    await assert.rejects(runHarnessRefusalProbe({...fake,timeoutMs:10,authorizeInvocation:()=>new Promise(()=>{})}),/TIMEOUT/);assert.equal(invoked,0);
    await assert.rejects(runHarnessRefusalProbe({...fake,timeoutMs:10,invoke:()=>{invoked++;return new Promise(()=>{});}}),/TIMEOUT/);assert.equal(invoked,1);
    await assert.rejects(runHarnessRefusalProbe({...fake,invoke:async()=>{throw Error('transport disconnected');}}),/transport disconnected/);
    await assert.rejects(runHarnessRefusalProbe({...fake,invoke:async()=>({huge:'x'.repeat(1048576)})}),/RESPONSE_LIMIT/);
    assert.deepEqual(catalogSnapshot(setup.home),before);
  }finally{await client.close();}
});

test("operator policy rejects unknown authority fields and unscoped permissions", async t => {
  const setup = prepared(t);
  const file = path.join(setup.home, "semantic-catalog-policy.json");
  for (const mutate of [policy => {policy.catalogs[0].allowAll = true;},
    policy => {delete policy.catalogs[0].scopes[0].scope.tenantId;},
    policy => {policy.catalogs[0].grants[0].purpose = "ALL";}]) {
    const altered = structuredClone(setup.policy);
    mutate(altered);
    writeJson(file, altered);
    await assert.rejects(semanticCatalogOperation({...setup.request, action: "preview"}), error => error.code === "TRUST_REQUIRED");
  }
});

test("enabled root alone is not publication authority; missing independent asset approval rejects", async t => {
  const setup = prepared(t);
  setup.policy.catalogs[0].grants = setup.policy.catalogs[0].grants.filter(item => item.purpose !== "ASSET_PUBLICATION");
  writeJson(path.join(setup.home, "semantic-catalog-policy.json"), setup.policy);
  await assert.rejects(semanticCatalogOperation(setup.request), error => error.code === "PERMISSION_DENIED");
  assert.equal(fs.existsSync(path.join(setup.organization, "SEMANTIC-CATALOG.json")), false);
});

test("input, expected head, generation and request id are exact independent publication bindings", async t => {
  const {request} = prepared(t);
  for (const mutation of [{inputDigest: digest("changed")}, {expectedGenerationDigest: digest("changed")},
    {expectedHead: undefined}, {requestId: "different"}, {publication: {...request.publication, actor: "forged"}}]) {
    await assert.rejects(semanticCatalogOperation({...request, ...mutation}));
  }
});

test("disabled roots, stale policy root binding, and current permission/approval loss block reads", async t => {
  const setup = prepared(t);
  await semanticCatalogOperation(setup.request);
  const policyFile = path.join(setup.home, "semantic-catalog-policy.json");
  for (const mutate of [policy => { policy.catalogs[0].permission = "DENIED"; },
    policy => { policy.catalogs[0].rootBindingDigest = digest("changed-root"); },
    policy => { policy.catalogs[0].grants[0].revoked = true; },
    policy => { policy.catalogs[0].grants[2].expiresAt = "2000-01-01T00:00:00.000Z"; }]) {
    const altered = structuredClone(setup.policy);
    mutate(altered);
    writeJson(policyFile, altered);
    await assert.rejects(semanticCatalogOperation({home: setup.home, action: "inspect"}), error => error.code === "PERMISSION_DENIED");
  }
  writeJson(policyFile, setup.policy);
  const registryFile = path.join(setup.home, "harness-registry.yaml");
  const registry = readYaml(registryFile);
  registry.catalogs[0].enabled = false;
  writeYaml(registryFile, registry);
  await assert.rejects(semanticCatalogOperation({home: setup.home, action: "inspect"}), error => error.code === "PERMISSION_DENIED");
});

test("unindexed, modified, unsupported or unsafe v3 material cannot be supplied", async t => {
  const setup = prepared(t);
  const item = setup.input.sets[0].harnessAssets[0];
  fs.appendFileSync(path.resolve(setup.organization, item.entry.assetPath), "\nfixtureTamper: true\n");
  await assert.rejects(semanticCatalogOperation(setup.request), error => error.code === "HARNESS_BINDING_MISMATCH");
  writeYaml(path.resolve(setup.organization, item.entry.assetPath), item.document);
  fs.appendFileSync(path.join(setup.organization, "CATALOG.md"), "tampered\n");
  await assert.rejects(semanticCatalogOperation(setup.request), error => error.code === "DIGEST_MISMATCH");
});

test("source paths and policy symlinks are rejected without reading outside the workspace", async t => {
  const setup = prepared(t);
  await assert.rejects(semanticCatalogOperation({...setup.request, file: "../outside.json"}), error => error.code === "PATH_DENIED");
  const policyFile = path.join(setup.home, "semantic-catalog-policy.json");
  fs.renameSync(policyFile, `${policyFile}.saved`);
  fs.symlinkSync(`${policyFile}.saved`, policyFile);
  await assert.rejects(semanticCatalogOperation({...setup.request, action: "preview"}), error => error.code === "PATH_DENIED");
});

test("unknown rehashed generation metadata and secret-bearing materials fail closed", () => {
  const set = semanticSupplyFixture();
  const built = assembleSemanticGeneration({catalogId: "organization", sets: [set]});
  built.generation.entries[0].visibility = "PUBLIC";
  delete built.generation.generationDigest;
  built.generation.generationDigest = digest(built.generation);
  assert.throws(() => resolveSemanticGeneration(built), error => error.code === "GENERATION_MISMATCH");
  const secret = semanticSupplyFixture();
  secret.artifactSet.spec.projectOntologySkill.spec.instructions.push("apiKey=synthetic-fixture-marker");
  assert.throws(() => assembleSemanticGeneration({catalogId: "organization", sets: [secret]}));
});

test("Engine exposes read-only discovery but publication remains a Session-gated operation", async t => {
  const setup = prepared(t);
  const {home, action, ...input} = setup.request;
  const capabilities = new Map(engineCapabilities().map(item => [item.id, item]));
  assert.equal(capabilities.get("semantic.catalog.inspect").mutating, false);
  assert.equal(capabilities.get("semantic.catalog.publish").publicationAuthorizationRequired, true);
  await assert.rejects(invokeEngineOperation({home, operation: "semantic.catalog.publish", input}), error => error.code === "PUBLICATION_AUTHORIZATION_REQUIRED");
  const published = await invokeEngineOperation({home, operation: "semantic.catalog.publish", input, authority: "publication"});
  assert.equal(published.status, "PUBLISHED", JSON.stringify(published));
  const inspected = await invokeEngineOperation({home, operation: "semantic.catalog.inspect"});
  assert.equal(inspected.status, "AVAILABLE");
});

test("atomic JSON CLI returns finite nextAction diagnostics and discovers the exact generation", async t => {
  const setup = prepared(t);
  const cli = path.resolve(import.meta.dirname, "../src/index.mjs");
  const unavailable = spawnSync(process.execPath, [cli, "semantic", "catalog-inspect", "--workspace", setup.home, "--json"], {encoding: "utf8"});
  assert.equal(unavailable.status, 1);
  assert.equal(JSON.parse(unavailable.stdout).code, "UNAVAILABLE");
  await semanticCatalogOperation(setup.request);
  const available = spawnSync(process.execPath, [cli, "semantic", "catalog-inspect", "--workspace", setup.home, "--json"], {encoding: "utf8"});
  assert.equal(available.status, 0, available.stderr);
  assert.equal(JSON.parse(available.stdout).generationDigest, setup.built.generation.generationDigest);
});

test("cached Engine publication revalidates current authority without mutation replay", async t => {
  const setup = prepared(t);
  const {home, action, ...input} = setup.request;
  const request = {home, operation: "semantic.catalog.publish", input, authority: "publication", idempotencyKey: digest("cached-publication").slice(7)};
  const first = await invokeEngineOperation(request);
  assert.equal(first.status, "PUBLISHED");
  const pointerFile = path.join(setup.organization, "SEMANTIC-CATALOG.json");
  const before = fs.readFileSync(pointerFile, "utf8");
  assert.deepEqual(await invokeEngineOperation(request), first);
  setup.policy.catalogs[0].grants[2].revoked = true;
  writeJson(path.join(home, "semantic-catalog-policy.json"), setup.policy);
  await assert.rejects(invokeEngineOperation(request), error => error.code === "PERMISSION_DENIED");
  assert.equal(fs.readFileSync(pointerFile, "utf8"), before);
});

for(const lostResponse of [false,true])test(`RC01 raw MCP publication runner preserves two decisions and independent byte evidence (lost response=${lostResponse})`,async t=>{
  const setup=prepared(t),{home,action,...publicationInput}=setup.request,calls=[],deliveries=[];
  const client=new TestMcpClient({command:process.execPath,args:['src/index.mjs','mcp','serve','--workspace',home],cwd:path.resolve(import.meta.dirname,'..')});
  try {
    await client.initialize();
    const base={publicationInput,generation:setup.built.generation,catalogRoot:setup.organization,
      authorizeInvocation:async frame=>{calls.push(frame);return true;},invoke:({tool,args})=>client.rawTool(tool,args),
      deliverBusinessView:async({frame})=>{deliveries.push(frame.stage);return {frameDigest:frame.frameDigest,renderedBusinessViewDigest:digest(frame.businessView.canonicalMarkdown)};}};
    const prepared=await runHarnessPublicationJourney({...base,phase:'prepare',adapterId:'synthetic-conformance',hostInteraction:governedHostInteraction()});
    assert.equal(prepared.status,'WAITING_PLAN_DECISION',JSON.stringify(prepared));assert.equal(deliveries.length,0);
    const before=calls.length,decision={confirmedBy:'synthetic-operator',confirmation:`CONFIRM_OPERATION_PLAN:${prepared.sessionRef.planDigest}`,frameDigest:prepared.frame.frameDigest};
    await assert.rejects(runHarnessPublicationJourney({...base,phase:'confirm-plan',sessionRef:prepared.sessionRef,decision:{...decision,confirmation:'continue'}}),/EXACT_DECISION_REQUIRED/);
    await assert.rejects(runHarnessPublicationJourney({...base,phase:'confirm-plan',sessionRef:prepared.sessionRef,decision,
      deliverBusinessView:async()=>({frameDigest:prepared.frame.frameDigest,renderedBusinessViewDigest:digest('invented view')})}),/DISPLAY_MISMATCH/);
    assert.ok(calls.slice(before).every(c=>c.effect==='READ'));assert.equal(fs.existsSync(path.join(setup.organization,'SEMANTIC-CATALOG.json')),false);
    const confirmed=await runHarnessPublicationJourney({...base,phase:'confirm-plan',sessionRef:prepared.sessionRef,decision});
    assert.equal(confirmed.status,'WAITING_PUBLICATION_DECISION',JSON.stringify(confirmed));
    assert.equal(fs.existsSync(path.join(setup.organization,'SEMANTIC-CATALOG.json')),false);
    const publishDecision={confirmedBy:'synthetic-publisher',frameDigest:confirmed.frame.frameDigest,
      confirmation:`AUTHORIZE_PLAN_PUBLICATION:${confirmed.sessionRef.sessionId}:${confirmed.sessionRef.planDigest}:0:${confirmed.pending.operationDigest}`};
    await assert.rejects(runHarnessPublicationJourney({...base,phase:'publish',sessionRef:confirmed.sessionRef,decision:{...publishDecision,confirmation:decision.confirmation}}),/EXACT_DECISION_REQUIRED/);
    const result=await runHarnessPublicationJourney({...base,phase:'publish',sessionRef:confirmed.sessionRef,decision:publishDecision,
      invoke:async(call,options)=>{const value=await base.invoke(call,options);if(lostResponse&&call.tool==='execute_operation_plan')throw Error('synthetic lost publication reply');return value;}});
    assert.equal(result.status,lostResponse?'UNKNOWN_PUBLICATION_OUTCOME':'PUBLICATION_SUBJOURNEY_ASSERTIONS_PASSED',JSON.stringify(result));
    assert.deepEqual(deliveries,['PLAN_PRESENTATION','OPERATION_AUTHORIZATION_PRESENTATION']);
    const after=calls.length,recovered=await runHarnessPublicationJourney({...base,phase:'readback'});
    assert.equal(recovered.status,'PUBLICATION_SUBJOURNEY_ASSERTIONS_PASSED');assert.equal(recovered.targetCriteriaClosed,0);
    assert.ok(calls.slice(after).every(c=>c.effect==='READ'));assert.equal(calls.filter(c=>c.effect==='PUBLISH_CATALOG').length,1);
    await assert.rejects(runHarnessPublicationJourney({...base,phase:'publish',sessionRef:confirmed.sessionRef,decision:publishDecision}),/SESSION_DRIFT/);
    const controller=new AbortController();controller.abort();await assert.rejects(runHarnessPublicationJourney({...base,phase:'readback',signal:controller.signal}),/CANCELLED/);
  } finally {await client.close();}
});

test("local stdio MCP semantic supply separates plan confirmation, publication authority and readback", async t => {
  const setup = prepared(t);
  const {home, action, ...input} = setup.request;
  const client = new TestMcpClient({command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: path.resolve(import.meta.dirname, "..")});
  try {
    await client.initialize();
    const preview = structured(await client.tool("run_engine_diagnostic", {operation: "semantic.catalog.preview", input: {catalogId: input.catalogId, file: input.file, inputDigest: input.inputDigest}}));
    assert.equal(preview.result.generationDigest, setup.built.generation.generationDigest);
    await assert.rejects(client.tool("run_engine_diagnostic", {operation: "semantic.catalog.publish", input}), error => error.response?.error?.code === -32602);
    let session = structured(await client.tool("start_operation_session", {intent: "Publish the reviewed synthetic semantic Catalog generation", adapterId: "codex-conformance"}));
    session = structured(await client.tool("plan_operation_session", {sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest,
      scenario: "maintenance", goal: session.intent.text, operations: [{operation: "semantic.catalog.publish", input}]}));
    session = structured(await client.tool("confirm_operation_plan", {sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest,
      expectedPlanDigest: session.planDigest, confirmedBy: "conformance-operator", confirmation: `CONFIRM_OPERATION_PLAN:${session.planDigest}`}));
    session = structured(await client.tool("execute_operation_plan", {sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, expectedPlanDigest: session.planDigest}));
    assert.equal(session.status, "OPERATION_AUTHORIZATION_REQUIRED");
    assert.equal(fs.existsSync(path.join(setup.organization, "SEMANTIC-CATALOG.json")), false);
    const pending = session.pendingOperationAuthorization;
    const authorization = {sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, expectedPlanDigest: session.planDigest,
      operationIndex: pending.operationIndex, expectedOperationDigest: pending.operationDigest, confirmedBy: "conformance-operator",
      confirmation: `AUTHORIZE_PLAN_PUBLICATION:${session.sessionId}:${session.planDigest}:${pending.operationIndex}:${pending.operationDigest}`};
    const implicit = await client.rawTool("authorize_plan_publication_operation", {...authorization, confirmation: "continue"});
    assert.equal(implicit.isError, true);
    const stale = await client.rawTool("authorize_plan_publication_operation", {...authorization, expectedOperationDigest: digest("different-operation")});
    assert.equal(stale.isError, true);
    assert.equal(fs.existsSync(path.join(setup.organization, "SEMANTIC-CATALOG.json")), false);
    session = structured(await client.tool("authorize_plan_publication_operation", authorization));
    assert.equal(session.status, "READY_TO_EXECUTE");
    session = structured(await client.tool("execute_operation_plan", {sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, expectedPlanDigest: session.planDigest}));
    assert.equal(session.status, "COMPLETED", JSON.stringify(session));
    assert.ok(session.humanDecisions.some(item => item.type === "PLAN_PUBLICATION_AUTHORIZED"));
    const inspected = structured(await client.tool("run_engine_diagnostic", {operation: "semantic.catalog.inspect", input: {catalogId: "organization"}}));
    assert.equal(inspected.result.generationDigest, input.expectedGenerationDigest);
    const readback = structured(await client.tool("run_engine_diagnostic", {operation: "semantic.catalog.readback", input: {catalogId: "organization", requestId: "first"}}));
    assert.equal(readback.result.status, "COMMITTED");
    setup.policy.catalogs[0].permission = "DENIED";
    writeJson(path.join(home, "semantic-catalog-policy.json"), setup.policy);
    const denied = structured(await client.tool("run_engine_diagnostic", {operation: "semantic.catalog.inspect", input: {catalogId: "organization"}}));
    assert.equal(denied.result.code, "PERMISSION_DENIED");
  } finally { await client.close(); }
});

function allowTransition(setup, preview, requestId, publication) {
  setup.policy.catalogs[0].grants.push({...publication, purpose: "CATALOG_PUBLICATION", revoked: false, expiresAt: null,
    subjectDigest: semanticPublicationSubject({catalogId: "organization", generationDigest: preview.generationDigest,
      expectedHead: preview.expectedHead, action: preview.action, requestId, transitionDigest: preview.transitionDigest})});
  writeJson(path.join(setup.home, "semantic-catalog-policy.json"), setup.policy);
}

function catalogSnapshot(root) {
  const files=[];const walk=directory=>{for(const item of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const file=path.join(directory,item.name);if(item.isDirectory())walk(file);else files.push([path.relative(root,file),digest(fs.readFileSync(file))]);
  }};walk(root);return files;
}

test('RC05 concurrent source processes commit exactly one same-head publication and retain the loser as uncommitted',async t=>{
  const setup=prepared(t),requests=['race-a','race-b'];
  for(const requestId of requests){
    allowTransition(setup,{generationDigest:setup.built.generation.generationDigest,expectedHead:null,action:'PUBLISH'},requestId,setup.request.publication);
    writeJson(path.join(setup.home,requestId+'.json'),{...setup.request,requestId});
  }
  const children=requests.map(requestId=>{
    const child=fork(path.resolve(import.meta.dirname,'fixtures/semantic-supply-race.mjs'),[setup.home,requestId+'.json'],{silent:true,env:{PATH:process.env.PATH}});
    t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
    let stderr='',result;child.stderr.on('data',chunk=>{stderr+=chunk;});
    let readyResolve,readyReject,doneResolve,doneReject;
    const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    const done=new Promise((resolve,reject)=>{doneResolve=resolve;doneReject=reject;});done.catch(()=>{});
    const timer=setTimeout(()=>{child.kill('SIGKILL');const error=Error('race child timeout');readyReject(error);doneReject(error);},15000);
    child.on('message',message=>{if(message.status==='READY')readyResolve();else if(message.status==='RESULT')result=message;});
    child.on('error',error=>{clearTimeout(timer);readyReject(error);doneReject(error);});
    child.on('exit',code=>{clearTimeout(timer);if(code!==0||!result){const error=Error('race child failed: '+stderr);readyReject(error);doneReject(error);}else doneResolve({requestId,...result});});
    return {child,ready,done};
  });
  await Promise.all(children.map(c=>c.ready));for(const c of children)c.child.send('GO');
  const results=await Promise.all(children.map(c=>c.done)),winners=results.filter(r=>r.result?.status==='PUBLISHED'),losers=results.filter(r=>r.error?.code==='CONFLICT');
  assert.equal(winners.length,1,JSON.stringify(results));assert.equal(losers.length,1,JSON.stringify(results));
  const winner=winners[0],loser=losers[0],expected={catalogId:'organization',steps:[{requestId:winner.requestId,action:'PUBLISH',generation:setup.built.generation,authorization:setup.request.publication,transition:null}]};
  assert.equal(fs.existsSync(path.join(setup.organization,'semantic-catalog/requests',digest(loser.requestId).slice(7)+'.json')),false);
  const snapshot=catalogSnapshot(setup.organization),calls=[];
  const client=new TestMcpClient({command:process.execPath,args:['src/index.mjs','mcp','serve','--workspace',setup.home],cwd:path.resolve(import.meta.dirname,'..')});
  try {
    await client.initialize();const report=await runHarnessHistoryProbe({expected,catalogRoot:setup.organization,
      authorizeInvocation:async frame=>{calls.push(frame);return true;},invoke:({tool,args})=>client.rawTool(tool,args)});
    assert.equal(report.status,'HISTORY_SUBJOURNEY_ASSERTIONS_PASSED');assert.equal(report.targetCriteriaClosed,0);
    assert.ok(calls.every(c=>c.effect==='READ'));assert.equal(calls.length,3);
    const denied=structured(await client.rawTool('run_engine_diagnostic',{operation:'semantic.catalog.readback',input:{catalogId:'organization',requestId:loser.requestId}}));
    assert.equal(denied.result.code,'UNAVAILABLE');assert.deepEqual(catalogSnapshot(setup.organization),snapshot);
  }finally{await client.close();}
});

test("RC05 history probe verifies publish grow rollback revoke restart and rejects resurrection", async t => {
  const setup = prepared(t);
  const expected={catalogId:'organization',steps:[{requestId:'first',action:'PUBLISH',generation:structuredClone(setup.built.generation),authorization:setup.request.publication,transition:null}]};
  const first = await semanticCatalogOperation(setup.request);
  const oldBytes = fs.readFileSync(path.join(setup.organization, first.pointer.generationPath), "utf8");
  const next = semanticSupplyFixture({projectId: "next-project"});
  for (const item of next.harnessAssets) item.entry = setup.input.sets[0].harnessAssets.find(old => old.entry.assetDigest === item.entry.assetDigest).entry;
  setup.input.sets.push(next);
  setup.policy.catalogs[0].scopes.push({scope: {tenantId: "fixture-tenant", workspaceId: "fixture-workspace", projectId: "next-project"}, visibilities: ["DOMAIN"]});
  for (const [asset, publication] of [[next.artifactSet.artifactSetDigest, next.artifactSet.spec.publication], [next.closure.closureDigest, next.closure.publication]]) {
    setup.policy.catalogs[0].grants.push({...publication, purpose: "ASSET_PUBLICATION", subjectDigest: asset, revoked: false, expiresAt: null});
  }
  const grow = assembleSemanticGeneration({catalogId: "organization", sets: setup.input.sets});
  const publication = setup.request.publication;
  expected.steps.push({requestId:'grow',action:'PUBLISH',generation:structuredClone(grow.generation),authorization:publication,transition:null});
  allowTransition(setup, {generationDigest: grow.generation.generationDigest, expectedHead: first.pointer.pointerDigest, action: "PUBLISH"}, "grow", publication);
  writeJson(path.join(setup.home, "input.json"), setup.input);
  const grown = await semanticCatalogOperation({...setup.request, inputDigest: digest(setup.input), expectedHead: first.pointer.pointerDigest,
    expectedGenerationDigest: grow.generation.generationDigest, requestId: "grow"});
  assert.equal((await semanticCatalogOperation({home: setup.home, action: "inspect"})).sets.length, 2);
  const rollbackInput = {home: setup.home, action: "transition-preview", transition: "ROLLBACK", expectedHead: grown.pointer.pointerDigest, targetPointerDigest: first.pointer.pointerDigest};
  expected.steps.push({requestId:'rollback',action:'ROLLBACK',generation:structuredClone(setup.built.generation),authorization:publication,
    transition:{targetPointerDigest:harnessHistoryExpectations({...expected,steps:expected.steps.slice(0,1)}).chain[0].pointer.pointerDigest}});
  const preview = await semanticCatalogOperation(rollbackInput);
  allowTransition(setup, preview, "rollback", publication);
  const {home, action, transition, ...input} = rollbackInput;
  const rollback = await invokeEngineOperation({home, operation: "semantic.catalog.rollback", authority: "publication",
    input: {...input, requestId: "rollback", expectedGenerationDigest: preview.generationDigest, publication}});
  assert.equal(rollback.status, "PUBLISHED", JSON.stringify(rollback));
  assert.notEqual(rollback.result.pointer.pointerDigest, first.pointer.pointerDigest);
  assert.equal(rollback.result.pointer.previousPointerDigest, grown.pointer.pointerDigest);
  assert.equal(rollback.result.pointer.generationDigest, first.pointer.generationDigest);
  const revocation = {home, action: "transition-preview", transition: "REVOKE", expectedHead: rollback.result.pointer.pointerDigest,
    revokedDigests: [setup.input.sets[0].artifactSet.artifactSetDigest]};
  const empty=assembleSemanticGeneration({catalogId:'organization',sets:[],revokedDigests:revocation.revokedDigests}).generation;
  expected.steps.push({requestId:'revoke',action:'REVOKE',generation:empty,authorization:publication,transition:{revokedDigests:revocation.revokedDigests}});
  const revokedPreview = await semanticCatalogOperation(revocation);
  allowTransition(setup, revokedPreview, "revoke", publication);
  const revoked = await invokeEngineOperation({home, operation: "semantic.catalog.revoke", authority: "publication", input: {
    expectedHead: revocation.expectedHead, revokedDigests: revocation.revokedDigests, expectedGenerationDigest: revokedPreview.generationDigest, requestId: "revoke", publication}});
  assert.equal(revoked.status, "PUBLISHED", JSON.stringify(revoked));
  const current = await semanticCatalogOperation({home, action: "inspect"});
  assert.equal(current.entries.length, 0);
  assert.deepEqual(current.revokedDigests, revocation.revokedDigests);
  await assert.rejects(semanticCatalogOperation({...rollbackInput, expectedHead: current.pointerDigest}), error => error.code === "REVOKED");
  assert.equal(fs.readFileSync(path.join(setup.organization, first.pointer.generationPath), "utf8"), oldBytes);
  const restarted = spawnSync(process.execPath, [path.resolve(import.meta.dirname, "../src/index.mjs"), "semantic", "catalog-inspect", "--workspace", home, "--json"], {encoding: "utf8"});
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.equal(JSON.parse(restarted.stdout).pointerDigest, current.pointerDigest);
  const before=catalogSnapshot(setup.organization),calls=[];
  const client=new TestMcpClient({command:process.execPath,args:['src/index.mjs','mcp','serve','--workspace',home],cwd:path.resolve(import.meta.dirname,'..')});
  try {
    await client.initialize();const base={expected,catalogRoot:setup.organization,
      authorizeInvocation:async frame=>{calls.push(frame);return true;},invoke:({tool,args})=>client.rawTool(tool,args)};
    const report=await runHarnessHistoryProbe(base);assert.equal(report.status,'HISTORY_SUBJOURNEY_ASSERTIONS_PASSED');
    assert.equal(report.durableEvidence.revisionCount,4);assert.equal(report.targetCriteriaClosed,0);assert.equal(report.releaseAuthorized,false);
    assert.equal(report.realHost,'NOT_QUALIFIED_BY_THIS_PROBE');assert.ok(calls.every(c=>c.effect==='READ'));assert.equal(calls.length,6);
    assert.deepEqual(catalogSnapshot(setup.organization),before);
    const {chain}=harnessHistoryExpectations(expected);
    for(const [name,mutate] of [
      ['action',v=>{v.receipt.action='PUBLISH';}],['decision',v=>{v.receipt.authorization.actor='forged';}],
      ['request',v=>{v.receipt.requestDigest=digest('forged');}],['transition',v=>{v.receipt.transitionDigest=digest('forged');}],
      ['previous head',v=>{v.pointer.previousPointerDigest=null;}],['head substitution',v=>{v.pointer=chain[3].pointer;}],
      ['unknown',v=>{v.status='UNKNOWN';}],['authority escalation',v=>{v.grantsPublicationAuthority=true;}]
    ]) {
      const value={schema:'evopilot-harness-semantic-supply-readback/v1',status:'COMMITTED',pointer:structuredClone(chain[2].pointer),receipt:structuredClone(chain[2].receipt)};
      mutate(value);const {receiptDigest,...rb}=value.receipt;value.receipt.receiptDigest=probeDigest(rb);
      value.pointer.receiptDigest=value.receipt.receiptDigest;const {pointerDigest,...pb}=value.pointer;value.pointer.pointerDigest=probeDigest(pb);
      assert.throws(()=>assertHarnessHistoryReadback({expected,index:2,result:value}),/HISTORY_READBACK_CHANGED/,name);
    }
    for(const relative of [chain[0].pointer.generationPath,`semantic-catalog/receipts/${chain[1].receipt.receiptDigest.slice(7)}.json`,chain[0].generation.entries[0].path]) {
      const file=path.join(setup.organization,relative),saved=fs.readFileSync(file);
      writeJson(file,{changed:true});assert.throws(()=>readHarnessHistoryEvidence({expected,catalogRoot:setup.organization}),/HISTORY_/);fs.writeFileSync(file,saved);
    }
    const headFile=path.join(setup.organization,'SEMANTIC-CATALOG.json'),saved=fs.readFileSync(headFile);
    writeJson(headFile,chain[0].pointer);assert.throws(()=>readHarnessHistoryEvidence({expected,catalogRoot:setup.organization}),/HISTORY_HEAD_CHANGED/);fs.writeFileSync(headFile,saved);
    let attempts=0;const fake={...base,invoke:async()=>{attempts++;return {};}};
    await assert.rejects(runHarnessHistoryProbe({...fake,authorizeInvocation:async()=>false}),/INVOCATION_DENIED/);assert.equal(attempts,0);
    const controller=new AbortController();controller.abort();await assert.rejects(runHarnessHistoryProbe({...fake,signal:controller.signal}),/CANCELLED/);assert.equal(attempts,0);
    await assert.rejects(runHarnessHistoryProbe({...fake,timeoutMs:10,authorizeInvocation:()=>new Promise(()=>{})}),/TIMEOUT/);assert.equal(attempts,0);
    await assert.rejects(runHarnessHistoryProbe({...fake,timeoutMs:10,invoke:()=>{attempts++;return new Promise(()=>{});}}),/TIMEOUT/);assert.equal(attempts,1);
    await assert.rejects(runHarnessHistoryProbe({...fake,invoke:async()=>({isError:true})}),/MCP_REFUSAL/);
    await assert.rejects(runHarnessHistoryProbe({...fake,invoke:async()=>({huge:'x'.repeat(1048576)})}),/RESPONSE_LIMIT/);
    assert.deepEqual(catalogSnapshot(setup.organization),before);
    setup.policy.catalogs[0].grants.find(g=>g.subjectDigest===semanticPublicationSubject({catalogId:'organization',generationDigest:setup.built.generation.generationDigest,expectedHead:null,requestId:'first'})).revoked=true;
    writeJson(path.join(home,'semantic-catalog-policy.json'),setup.policy);
    await assert.rejects(runHarnessHistoryProbe(base),/HISTORY_READBACK_CHANGED/);assert.deepEqual(catalogSnapshot(setup.organization),before);
  }finally{await client.close();}
});

test("rollback and revocation require distinct exact grants and reject stale heads", async t => {
  const setup = prepared(t);
  const first = await semanticCatalogOperation(setup.request);
  const request = {home: setup.home, action: "transition-preview", transition: "REVOKE", expectedHead: first.pointer.pointerDigest,
    revokedDigests: [setup.input.sets[0].closure.closureDigest]};
  const preview = await semanticCatalogOperation(request);
  await assert.rejects(semanticCatalogOperation({...request, action: "revoke", requestId: "revoke", expectedGenerationDigest: preview.generationDigest, publication: setup.request.publication}), error => error.code === "PERMISSION_DENIED");
  await assert.rejects(semanticCatalogOperation({...request, expectedHead: digest("stale")}), error => error.code === "CONFLICT");
  await assert.rejects(semanticCatalogOperation({...request, revokedDigests: [digest("unknown")]}), error => error.code === "REVOCATION_TARGET_INVALID");
  assert.equal((await semanticCatalogOperation({home: setup.home, action: "inspect"})).pointerDigest, first.pointer.pointerDigest);
});

for(const [stage,expectedExit] of [['before-generation',92],['after-generation',93],['before-pointer',86],['after-pointer',87]])
test(`RC05 raw MCP read-only recovery probe independently verifies ${stage}`,async t=>{
  const setup=prepared(t),{home,action,...publicationInput}=setup.request;
  writeJson(path.join(home,'fixture-request.json'),setup.request);
  const child=spawnSync(process.execPath,[path.resolve(import.meta.dirname,'fixtures/semantic-supply-crash.mjs'),home,stage],{encoding:'utf8',timeout:10000});
  assert.equal(child.status,expectedExit,child.stderr);
  const lock=JSON.parse(fs.readFileSync(path.join(setup.organization,'semantic-catalog/publication.lock/owner.json')));
  const recoveryId=`probe-${stage}`,recoveryAuthorization={decision:'AUTHORIZED',actor:'fixture-recovery',authorizationDigest:digest(recoveryId)};
  const expected={catalogId:'organization',requestId:'first',generationDigest:setup.built.generation.generationDigest,
    previousHead:null,publication:setup.request.publication,lock,recoveryId,recoveryAuthorization,
    publicationOutcome:stage==='after-pointer'?'COMMITTED':'NOT_COMMITTED'};
  const snapshot=()=>{
    const files=[];const walk=directory=>{for(const item of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const file=path.join(directory,item.name);if(item.isDirectory())walk(file);else files.push([path.relative(setup.organization,file),digest(fs.readFileSync(file))]);
    }};walk(setup.organization);return files;
  };
  const client=new TestMcpClient({command:process.execPath,args:['src/index.mjs','mcp','serve','--workspace',home],cwd:path.resolve(import.meta.dirname,'..')});
  const calls=[],authorizations=[];
  try {
    await client.initialize();
    const base={expected,publicationInput,generation:setup.built.generation,catalogRoot:setup.organization,
      authorizeInvocation:async frame=>{authorizations.push(frame);return true;},
      invoke:async({tool,args})=>{calls.push({tool,args});return client.rawTool(tool,args);}};
    const crashed=snapshot(),inspection=await runHarnessRecoveryProbe({...base,phase:'inspect'});
    assert.equal(inspection.status,'RECOVERY_SUBJOURNEY_ASSERTIONS_PASSED');assert.deepEqual(snapshot(),crashed);
    assert.equal(inspection.durableEvidence,null);assert.equal(inspection.targetCriteriaClosed,0);
    assert.equal(fs.existsSync(path.join(setup.organization,'semantic-catalog/recoveries')),false);
    const {head}=recoveryExpectations(expected);
    // The fixture alone performs an independently granted recovery. The runner
    // cannot grant policy, unlock, publish or infer authorization from inspect.
    const request={home,action:'recover',expectedLockDigest:lock.lockDigest,expectedHead:head??'EMPTY',recoveryId,publication:recoveryAuthorization};
    await assert.rejects(semanticCatalogOperation(request),error=>error.code==='PERMISSION_DENIED');
    setup.policy.catalogs[0].grants.push({...recoveryAuthorization,purpose:'CATALOG_RECOVERY',revoked:false,expiresAt:null,
      subjectDigest:semanticRecoverySubject({catalogId:'organization',lockDigest:lock.lockDigest,expectedHead:head,recoveryId})});
    writeJson(path.join(home,'semantic-catalog-policy.json'),setup.policy);
    await semanticCatalogOperation(request);
    const recovered=snapshot(),report=await runHarnessRecoveryProbe({...base,phase:'readback'});
    assert.equal(report.status,'RECOVERY_SUBJOURNEY_ASSERTIONS_PASSED');assert.equal(report.mutationReplayed,false);
    assert.equal(report.targetCriteriaClosed,0);assert.equal(report.realHost,'NOT_QUALIFIED_BY_THIS_PROBE');assert.equal(report.releaseAuthorized,false);
    assert.equal(report.publicationEvidence?.status??null,stage==='after-pointer'?'PUBLICATION_SUBJOURNEY_ASSERTIONS_PASSED':null);
    assert.deepEqual(snapshot(),recovered);assert.equal(calls.length,authorizations.length);
    assert.ok(calls.every(c=>c.tool==='run_engine_diagnostic'&&['semantic.catalog.recovery-inspect','semantic.catalog.recovery-readback','semantic.catalog.readback','semantic.catalog.inspect'].includes(c.args.operation)));
    assert.ok(authorizations.every(c=>c.effect==='READ'));
    const {record}=recoveryExpectations(expected),result={schema:'evopilot-harness-semantic-recovery-readback/v1',status:'RECOVERED',record,mutationReplayed:false};
    for(const [name,mutate] of [
      ['wrong lock',v=>{v.record.lockDigest=digest('wrong');}],['wrong head',v=>{v.record.expectedHead=digest('wrong');}],
      ['wrong request',v=>{v.record.publicationRequestDigest=digest('wrong');}],['wrong recovery',v=>{v.record.recoveryRequestDigest=digest('wrong');}],
      ['wrong actor',v=>{v.record.authorization.actor='other';}],['wrong authorization',v=>{v.record.authorization.authorizationDigest=digest('wrong');}],
      ['false outcome',v=>{v.record.publicationOutcome=stage==='after-pointer'?'NOT_COMMITTED':'COMMITTED';}],
      ['preflight',v=>{v.record.publicationOutcome='PREFLIGHT';}],['replay',v=>{v.mutationReplayed=true;}],
      ['extra authority',v=>{v.grantsRecoveryAuthority=true;}],['unknown',v=>{v.status='UNKNOWN';}]
    ]) {
      const forged=structuredClone(result);mutate(forged);const {recoveryDigest,...body}=forged.record;forged.record.recoveryDigest=probeDigest(body);
      assert.throws(()=>assertHarnessRecoveryProjection({phase:'readback',expected,result:forged}),/RECOVERY_RECORD_CHANGED/,name);
    }
    const goodInspection={schema:'evopilot-harness-semantic-recovery-inspection/v1',status:'RECOVERABLE',ownerState:'DEAD',lockDigest:lock.lockDigest,
      expectedHead:head,requestDigest:digest('first'),grantsRecoveryAuthority:false};
    for(const patch of [{grantsRecoveryAuthority:true},{ownerState:'ALIVE'},{ownerState:'UNKNOWN'},{expectedHead:digest('wrong')},{requestDigest:digest('other')}])
      assert.throws(()=>assertHarnessRecoveryProjection({phase:'inspect',expected,result:{...goodInspection,...patch}}),/RECOVERY_INSPECTION_CHANGED/);
    let attempted=0;
    const fake={...base,phase:'readback',invoke:async()=>{attempted++;return {structuredContent:{result}};}};
    await assert.rejects(runHarnessRecoveryProbe({...fake,authorizeInvocation:async()=>false}),/INVOCATION_DENIED/);assert.equal(attempted,0);
    const cancelled=new AbortController();cancelled.abort();await assert.rejects(runHarnessRecoveryProbe({...fake,signal:cancelled.signal}),/CANCELLED/);assert.equal(attempted,0);
    await assert.rejects(runHarnessRecoveryProbe({...fake,timeoutMs:10,authorizeInvocation:()=>new Promise(()=>{})}),/TIMEOUT/);assert.equal(attempted,0);
    await assert.rejects(runHarnessRecoveryProbe({...fake,timeoutMs:10,invoke:()=>{attempted++;return new Promise(()=>{});}}),/TIMEOUT/);assert.equal(attempted,1);
    await assert.rejects(runHarnessRecoveryProbe({...fake,invoke:async()=>({isError:true,structuredContent:{result}})}),/MCP_REFUSAL/);
    await assert.rejects(runHarnessRecoveryProbe({...fake,invoke:async()=>({structuredContent:{result},oversized:'x'.repeat(1048576)})}),/RESPONSE_LIMIT/);
    await assert.rejects(runHarnessRecoveryProbe({...fake,invoke:async()=>({structuredContent:{result:{status:'UNKNOWN'}}})}),/RECOVERY_RECORD_CHANGED/);
    const archived=path.join(setup.organization,'semantic-catalog/recovered-locks',lock.lockDigest.slice(7),'owner.json'),saved=fs.readFileSync(archived);
    writeJson(archived,{...lock,requestDigest:digest('forged')});
    assert.throws(()=>readHarnessRecoveryEvidence({catalogRoot:setup.organization,expected}),/RECOVERY_ARCHIVED_LOCK_CHANGED/);
    fs.writeFileSync(archived,saved);
    const renamed=archived+'.saved';fs.renameSync(archived,renamed);
    assert.throws(()=>readHarnessRecoveryEvidence({catalogRoot:setup.organization,expected}),error=>error.code==='ENOENT');
    fs.symlinkSync(renamed,archived);
    assert.throws(()=>readHarnessRecoveryEvidence({catalogRoot:setup.organization,expected}),/SYMLINK_DENIED/);
    fs.unlinkSync(archived);fs.renameSync(renamed,archived);
    assert.deepEqual(snapshot(),recovered);
    setup.policy.catalogs[0].grants.at(-1).revoked=true;writeJson(path.join(home,'semantic-catalog-policy.json'),setup.policy);
    await assert.rejects(runHarnessRecoveryProbe({...base,phase:'readback'}),/RECOVERY_RECORD_CHANGED/);
    assert.deepEqual(snapshot(),recovered);
  }finally{await client.close();}
});

test("crash recovery reconciles before and after pointer outcomes without replay", async t => {
  for (const [stage, expectedExit] of [["before-generation", 92], ["after-generation", 93], ["before-pointer", 86], ["after-pointer", 87]]) {
    const setup = prepared(t);
    writeJson(path.join(setup.home, "fixture-request.json"), setup.request);
    const child = spawnSync(process.execPath, [path.resolve(import.meta.dirname, "fixtures/semantic-supply-crash.mjs"), setup.home, stage], {encoding: "utf8"});
    assert.equal(child.status, expectedExit, child.stderr);
    const inspection = await semanticCatalogOperation({home: setup.home, action: "recovery-inspect"});
    assert.equal(inspection.status, "RECOVERABLE");
    const recoveryId = `recover-${stage}`;
    const publication = {decision: "AUTHORIZED", actor: "fixture-recovery-operator", authorizationDigest: digest(recoveryId)};
    const request = {home: setup.home, action: "recover", expectedLockDigest: inspection.lockDigest,
      expectedHead: inspection.expectedHead ?? "EMPTY", recoveryId, publication};
    await assert.rejects(semanticCatalogOperation(request), error => error.code === "PERMISSION_DENIED");
    setup.policy.catalogs[0].grants.push({...publication, purpose: "CATALOG_RECOVERY", revoked: false, expiresAt: null,
      subjectDigest: semanticRecoverySubject({catalogId: "organization", lockDigest: inspection.lockDigest, expectedHead: inspection.expectedHead, recoveryId})});
    writeJson(path.join(setup.home, "semantic-catalog-policy.json"), setup.policy);
    const recovered = await semanticCatalogOperation(request);
    assert.equal(recovered.status, "RECOVERED");
    assert.equal(recovered.record.publicationOutcome, stage === "after-pointer" ? "COMMITTED" : "NOT_COMMITTED");
    assert.equal(fs.existsSync(path.join(setup.organization, "semantic-catalog/publication.lock")), false);
    assert.equal(fs.existsSync(path.join(setup.organization, "semantic-catalog/recovered-locks", inspection.lockDigest.slice(7), "owner.json")), true);
    assert.deepEqual(await semanticCatalogOperation(request), recovered);
    assert.equal((await semanticCatalogOperation({home: setup.home, action: "recovery-readback", recoveryId})).record.recoveryDigest, recovered.record.recoveryDigest);
    if (stage !== "after-pointer") {
      assert.equal(fs.existsSync(path.join(setup.organization, "SEMANTIC-CATALOG.json")), false);
      await assert.rejects(semanticCatalogOperation(setup.request), error => error.code === "UNKNOWN");
      allowTransition(setup, {generationDigest: setup.built.generation.generationDigest, expectedHead: null, action: "PUBLISH"}, "new-reviewed-request", setup.request.publication);
      const fresh = await semanticCatalogOperation({...setup.request, requestId: "new-reviewed-request"});
      assert.equal(fresh.status, "PUBLISHED");
      assert.notEqual(fresh.receipt.requestDigest, recovered.record.publicationRequestDigest);
    } else assert.equal((await semanticCatalogOperation({home: setup.home, action: "readback", requestId: "first"})).status, "COMMITTED");
  }
});

async function sessionPublication(client, operation, input) {
  let session = structured(await client.tool("start_operation_session", {intent: "Perform exactly one reviewed synthetic Catalog maintenance action", adapterId: "codex-conformance"}));
  session = structured(await client.tool("plan_operation_session", {sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest,
    scenario: "maintenance", goal: session.intent.text, operations: [{operation, input}]}));
  session = structured(await client.tool("confirm_operation_plan", {sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest,
    expectedPlanDigest: session.planDigest, confirmedBy: "conformance-operator", confirmation: `CONFIRM_OPERATION_PLAN:${session.planDigest}`}));
  session = structured(await client.tool("execute_operation_plan", {sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, expectedPlanDigest: session.planDigest}));
  assert.equal(session.status, "OPERATION_AUTHORIZATION_REQUIRED");
  const pending = session.pendingOperationAuthorization;
  session = structured(await client.tool("authorize_plan_publication_operation", {sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest,
    expectedPlanDigest: session.planDigest, operationIndex: pending.operationIndex, expectedOperationDigest: pending.operationDigest,
    confirmedBy: "conformance-operator", confirmation: `AUTHORIZE_PLAN_PUBLICATION:${session.sessionId}:${session.planDigest}:${pending.operationIndex}:${pending.operationDigest}`}));
  session = structured(await client.tool("execute_operation_plan", {sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, expectedPlanDigest: session.planDigest}));
  assert.equal(session.status, "COMPLETED", JSON.stringify(session));
}

test("local stdio MCP gates rollback revoke and recovery independently of diagnostics", async t => {
  const setup = prepared(t);
  const first = await semanticCatalogOperation(setup.request);
  const client = new TestMcpClient({command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", setup.home], cwd: path.resolve(import.meta.dirname, "..")});
  try {
    await client.initialize();
    for (const transition of ["ROLLBACK", "REVOKE"]) {
      const current = await semanticCatalogOperation({home: setup.home, action: "inspect"});
      const source = transition === "ROLLBACK" ? {targetPointerDigest: first.pointer.pointerDigest} : {revokedDigests: [setup.input.sets[0].closure.closureDigest]};
      const preview = structured(await client.tool("run_engine_diagnostic", {operation: "semantic.catalog.transition-preview", input: {transition, expectedHead: current.pointerDigest, ...source}})).result;
      assert.equal(preview.status, "READY");
      const requestId = transition.toLowerCase();
      allowTransition(setup, preview, requestId, setup.request.publication);
      await sessionPublication(client, transition === "ROLLBACK" ? "semantic.catalog.rollback" : "semantic.catalog.revoke",
        {...source, expectedHead: current.pointerDigest, expectedGenerationDigest: preview.generationDigest, requestId, publication: setup.request.publication});
    }
    assert.equal((await semanticCatalogOperation({home: setup.home, action: "inspect"})).sets.length, 0);
  } finally {await client.close();}

  const crashed = prepared(t);
  writeJson(path.join(crashed.home, "fixture-request.json"), crashed.request);
  const child = spawnSync(process.execPath, [path.resolve(import.meta.dirname, "fixtures/semantic-supply-crash.mjs"), crashed.home, "before-pointer"], {encoding: "utf8"});
  assert.equal(child.status, 86, child.stderr);
  const recovering = new TestMcpClient({command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", crashed.home], cwd: path.resolve(import.meta.dirname, "..")});
  try {
    await recovering.initialize();
    const inspection = structured(await recovering.tool("run_engine_diagnostic", {operation: "semantic.catalog.recovery-inspect", input: {}})).result;
    assert.equal(inspection.status, "RECOVERABLE");
    const recoveryId = "mcp-recovery";
    const publication = {decision: "AUTHORIZED", actor: "fixture-recovery-operator", authorizationDigest: digest(recoveryId)};
    crashed.policy.catalogs[0].grants.push({...publication, purpose: "CATALOG_RECOVERY", revoked: false, expiresAt: null,
      subjectDigest: semanticRecoverySubject({catalogId: "organization", lockDigest: inspection.lockDigest, expectedHead: null, recoveryId})});
    writeJson(path.join(crashed.home, "semantic-catalog-policy.json"), crashed.policy);
    await sessionPublication(recovering, "semantic.catalog.recover", {expectedLockDigest: inspection.lockDigest, expectedHead: "EMPTY", recoveryId, publication});
    const result = structured(await recovering.tool("run_engine_diagnostic", {operation: "semantic.catalog.recovery-readback", input: {recoveryId}})).result;
    assert.equal(result.status, "RECOVERED");
    assert.equal(result.record.publicationOutcome, "NOT_COMMITTED");
    assert.equal(fs.existsSync(path.join(crashed.organization, "SEMANTIC-CATALOG.json")), false);
  } finally {await recovering.close();}
});

test("recovery rejects active owners unknown metadata stale bindings and revoked cached authority", async t => {
  const setup = prepared(t);
  writeJson(path.join(setup.home, "fixture-request.json"), setup.request);
  const child = spawnSync(process.execPath, [path.resolve(import.meta.dirname, "fixtures/semantic-supply-crash.mjs"), setup.home, "before-pointer"], {encoding: "utf8"});
  assert.equal(child.status, 86, child.stderr);
  const ownerFile = path.join(setup.organization, "semantic-catalog/publication.lock/owner.json");
  const owner = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
  const {lockDigest, ...body} = owner;
  const active = withSupplyDigest({...body, pid: process.pid}, "lockDigest");
  writeJson(ownerFile, active);
  const recoveryId = "negative-recovery";
  const publication = {decision: "AUTHORIZED", actor: "fixture-recovery-operator", authorizationDigest: digest(recoveryId)};
  const authorize = hash => {
    setup.policy.catalogs[0].grants.push({...publication, purpose: "CATALOG_RECOVERY", revoked: false, expiresAt: null,
      subjectDigest: semanticRecoverySubject({catalogId: "organization", lockDigest: hash, expectedHead: null, recoveryId})});
    writeJson(path.join(setup.home, "semantic-catalog-policy.json"), setup.policy);
  };
  authorize(active.lockDigest);
  const request = {home: setup.home, action: "recover", recoveryId, publication, expectedHead: "EMPTY", expectedLockDigest: active.lockDigest};
  assert.equal((await semanticCatalogOperation({home: setup.home, action: "recovery-inspect"})).ownerState, "ALIVE");
  await assert.rejects(semanticCatalogOperation(request), error => error.code === "LOCK_OWNER_ACTIVE_OR_UNKNOWN");
  writeJson(ownerFile, {...active, pid: 0});
  await assert.rejects(semanticCatalogOperation({home: setup.home, action: "recovery-inspect"}), error => error.code === "DIGEST_MISMATCH");
  writeJson(ownerFile, owner);
  await assert.rejects(semanticCatalogOperation(request), error => error.code === "DRIFT");
  authorize(owner.lockDigest);
  const engine = {home: setup.home, operation: "semantic.catalog.recover", authority: "publication", idempotencyKey: digest("recovery-cache").slice(7),
    input: {recoveryId, publication, expectedHead: "EMPTY", expectedLockDigest: owner.lockDigest}};
  const recovered = await invokeEngineOperation(engine);
  assert.equal(recovered.status, "RECOVERED", JSON.stringify(recovered));
  assert.deepEqual(await invokeEngineOperation(engine), recovered);
  setup.policy.catalogs[0].grants.at(-1).revoked = true;
  writeJson(path.join(setup.home, "semantic-catalog-policy.json"), setup.policy);
  await assert.rejects(invokeEngineOperation(engine), error => error.code === "PERMISSION_DENIED");
});

test("post-commit unlock failure reports UNKNOWN and is reconciled without republishing", async t => {
  const setup = prepared(t);
  writeJson(path.join(setup.home, "fixture-request.json"), setup.request);
  const child = spawnSync(process.execPath, [path.resolve(import.meta.dirname, "fixtures/semantic-supply-crash.mjs"), setup.home, "unlock-failure"], {encoding: "utf8"});
  assert.equal(child.status, 1);
  assert.equal(JSON.parse(child.stdout).code, "UNKNOWN");
  assert.equal((await semanticCatalogOperation({home: setup.home, action: "readback", requestId: "first"})).status, "COMMITTED");
  assert.equal((await semanticCatalogOperation({home: setup.home, action: "recovery-inspect"})).status, "RECOVERABLE");
});

for (const [stage, exitCode, moved, receiptExists] of [
  ["recovery-after-guard", 88, false, false],
  ["recovery-after-receipt", 89, false, true],
  ["recovery-before-move", 90, false, true],
  ["recovery-after-move", 91, true, true],
  ["recovery-cleanup-failure", 1, true, true]
]) test(`recovery interruption ${stage} preserves evidence and never replays mutation`, async t => {
  const setup = prepared(t);
  const requestFile = path.join(setup.home, "fixture-request.json");
  const fixture = path.resolve(import.meta.dirname, "fixtures/semantic-supply-crash.mjs");
  writeJson(requestFile, setup.request);
  const writer = spawnSync(process.execPath, [fixture, setup.home, "before-pointer"], {encoding: "utf8"});
  assert.equal(writer.status, 86, writer.stderr);
  const inspection = await semanticCatalogOperation({home: setup.home, action: "recovery-inspect"});
  const recoveryId = stage;
  const publication = {decision: "AUTHORIZED", actor: "fixture-recovery-operator", authorizationDigest: digest(stage)};
  setup.policy.catalogs[0].grants.push({...publication, purpose: "CATALOG_RECOVERY", revoked: false, expiresAt: null,
    subjectDigest: semanticRecoverySubject({catalogId: "organization", lockDigest: inspection.lockDigest, expectedHead: null, recoveryId})});
  writeJson(path.join(setup.home, "semantic-catalog-policy.json"), setup.policy);
  const request = {home: setup.home, action: "recover", recoveryId, publication, expectedLockDigest: inspection.lockDigest, expectedHead: "EMPTY"};
  const expected={catalogId:'organization',requestId:'first',generationDigest:setup.built.generation.generationDigest,
    previousHead:null,publication:setup.request.publication,recoveryId,recoveryAuthorization:publication,publicationOutcome:'NOT_COMMITTED',
    lock:JSON.parse(fs.readFileSync(path.join(setup.organization,'semantic-catalog/publication.lock/owner.json')))};
  writeJson(requestFile, request);
  const recovery = spawnSync(process.execPath, [fixture, setup.home, stage], {encoding: "utf8"});
  assert.equal(recovery.status, exitCode, recovery.stderr);
  if (exitCode === 1) assert.equal(JSON.parse(recovery.stdout).code, "UNKNOWN");
  const recordFile = path.join(setup.organization, "semantic-catalog/recoveries", `${digest(recoveryId).slice(7)}.json`);
  assert.equal(fs.existsSync(recordFile), receiptExists);
  assert.equal(fs.existsSync(path.join(setup.organization, "semantic-catalog/recovery.lock")), true);
  assert.equal(fs.existsSync(path.join(setup.organization, "semantic-catalog/publication.lock")), !moved);
  assert.equal(fs.existsSync(path.join(setup.organization, "SEMANTIC-CATALOG.json")), false);
  const before = receiptExists ? fs.readFileSync(recordFile, "utf8") : null;
  const beforeProbe=catalogSnapshot(setup.organization),calls=[];
  const client=new TestMcpClient({command:process.execPath,args:['src/index.mjs','mcp','serve','--workspace',setup.home],cwd:path.resolve(import.meta.dirname,'..')});
  try {
    await client.initialize();const probe={phase:'readback',expected,catalogRoot:setup.organization,
      authorizeInvocation:async frame=>{calls.push(frame);return true;},invoke:({tool,args})=>client.rawTool(tool,args)};
    if(moved){const report=await runHarnessRecoveryProbe(probe);assert.equal(report.status,'RECOVERY_SUBJOURNEY_ASSERTIONS_PASSED');assert.equal(report.targetCriteriaClosed,0);}
    else await assert.rejects(runHarnessRecoveryProbe(probe),/RECOVERY_RECORD_CHANGED/);
    assert.equal(calls.length,1);assert.equal(calls[0].effect,'READ');assert.equal(calls[0].call.args.operation,'semantic.catalog.recovery-readback');
    assert.deepEqual(catalogSnapshot(setup.organization),beforeProbe);
  }finally{await client.close();}
  if (moved) {
    const readback = await semanticCatalogOperation({home: setup.home, action: "recovery-readback", recoveryId});
    assert.equal(readback.status, "RECOVERED");
    assert.equal(readback.record.publicationOutcome, "NOT_COMMITTED");
    assert.deepEqual(await semanticCatalogOperation(request), readback.schema ? {...readback, schema: "evopilot-harness-semantic-recovery-result/v1"} : readback);
  } else {
    await assert.rejects(semanticCatalogOperation(request), error => error.code === (receiptExists ? "UNKNOWN" : "LOCKED"));
  }
  if (receiptExists) assert.equal(fs.readFileSync(recordFile, "utf8"), before);
  assert.equal((await semanticCatalogOperation({home: setup.home, action: "readback", requestId: "first"})).status, "UNKNOWN");
  assert.equal(fs.existsSync(path.join(setup.organization, "semantic-catalog/recovery.lock")), true);
  if (moved) {
    for (const change of [{publicationOutcome: "PREFLIGHT"}, {publicationRequestDigest: digest("unrelated-publication")}]) {
      const {recoveryDigest, ...body} = JSON.parse(before);
      writeJson(recordFile, withSupplyDigest({...body, ...change}, "recoveryDigest"));
      await assert.rejects(semanticCatalogOperation({home: setup.home, action: "recovery-readback", recoveryId}), error => error.code === "RECOVERY_RECORD_INVALID");
    }
    fs.writeFileSync(recordFile, before);
  }
});
