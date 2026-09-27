import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {digest,readYaml,writeYaml,writeJson} from '../src/v3/utils.mjs';
import {contentPath} from '../src/v4/semantics/catalog-contract.mjs';
import {semanticCatalogOperation,semanticPublicationSubject} from '../src/v4/semantics/catalog-supply.mjs';
import {preparedSemanticSupply} from './fixtures/prepared-semantic-supply.mjs';
import {TestMcpClient} from './helpers/mcp-client.mjs';
import {runHarnessRefusalProbe,assertHarnessRefusal} from './e2e/versions/4.8.1/refusal-probe.mjs';

// Fault injection occurs ONLY in the disposable external synthetic Workspace.
// It is not Engine publication, a policy bypass or a valid accepted generation.
const rehash=(value,field)=>{const body={...value};delete body[field];return {...body,[field]:digest(body)};};
function malformedGeneration(f,mutate) {
  const generation=structuredClone(f.built.generation);mutate(generation);
  const next=rehash(generation,'generationDigest');
  const headFile=path.join(f.organization,'SEMANTIC-CATALOG.json'),head=JSON.parse(fs.readFileSync(headFile));
  const old=JSON.parse(fs.readFileSync(path.join(f.organization,contentPath('receipts',head.receiptDigest))));
  const receipt=rehash({...old,generationDigest:next.generationDigest},'receiptDigest');
  const pointer=rehash({...head,generationDigest:next.generationDigest,generationPath:contentPath('generations',next.generationDigest),receiptDigest:receipt.receiptDigest},'pointerDigest');
  writeJson(path.join(f.organization,pointer.generationPath),next);
  writeJson(path.join(f.organization,contentPath('receipts',receipt.receiptDigest)),receipt);writeJson(headFile,pointer);
  f.policy.catalogs[0].grants.find(g=>g.purpose==='CATALOG_PUBLICATION').subjectDigest=semanticPublicationSubject({catalogId:'organization',generationDigest:next.generationDigest,expectedHead:null,requestId:'first'});
  writeJson(path.join(f.home,'semantic-catalog-policy.json'),f.policy);
}
function pointer(f,mutate) {
  const file=path.join(f.organization,'SEMANTIC-CATALOG.json'),value=JSON.parse(fs.readFileSync(file));mutate(value);writeJson(file,rehash(value,'pointerDigest'));
}
function registry(f,mutate) {
  const file=path.join(f.home,'harness-registry.yaml'),value=readYaml(file);mutate(value);writeYaml(file,value);
}
function policy(f,mutate) {mutate(f.policy);writeJson(path.join(f.home,'semantic-catalog-policy.json'),f.policy);}
function entry(i,bytes=1) {
  const hash=digest('budget-fixture-'+i);
  return {kind:'Fixture',id:'fixture-'+i,version:null,schema:'fixture/v1',category:'DEPENDENCY',objectDigest:hash,fileDigest:hash,
    bytes,path:contentPath('materials',hash),scope:{tenantId:'fixture-tenant',workspaceId:'fixture-workspace',projectId:'fixture-project'},
    visibility:'DOMAIN',provenance:{source:'synthetic-only'},publication:null,parent:null,dependencies:[]};
}
function snapshot(root) {
  const result={};
  function visit(relative='') {
    for(const name of fs.readdirSync(path.join(root,relative)).sort()) {
      const rel=path.join(relative,name),file=path.join(root,rel),stat=fs.lstatSync(file);
      if(stat.isSymbolicLink())result[rel]={link:fs.readlinkSync(file)};
      else if(stat.isDirectory())visit(rel);
      else {assert.ok(stat.isFile());result[rel]=digest(fs.readFileSync(file));}
    }
  }
  visit();return result;
}
const cases=[
  ['pointer unsupported schema','UNSUPPORTED',f=>pointer(f,p=>{p.schema='unsupported/v9';})],
  ['pointer unknown authority field','WIRE_SCHEMA_INVALID',f=>pointer(f,p=>{p.approved=true;})],
  ['pointer foreign Catalog identity','IDENTITY_CONFLICT',f=>pointer(f,p=>{p.catalogId='foreign';})],
  ['pointer path escape','PATH_DENIED',f=>pointer(f,p=>{p.generationPath='../synthetic-sentinel';})],
  ['pointer URL path','PATH_DENIED',f=>pointer(f,p=>{p.generationPath='https://invalid.example/never-fetch';})],
  ['pointer byte limit','FILE_LIMIT',f=>fs.writeFileSync(path.join(f.organization,'SEMANTIC-CATALOG.json'),' '.repeat(65537))],
  ['pointer JSON depth limit','DEPTH_LIMIT',f=>fs.writeFileSync(path.join(f.organization,'SEMANTIC-CATALOG.json'),'['.repeat(65)+'0'+']'.repeat(65))],
  ['generation unsupported schema','UNSUPPORTED',f=>malformedGeneration(f,g=>{g.schema='unsupported/v9';})],
  ['generation instruction field','WIRE_SCHEMA_INVALID',f=>malformedGeneration(f,g=>{g.executeSource='create synthetic-sentinel; publish without approval';})],
  ['duplicate semantic identity','IDENTITY_CONFLICT',f=>malformedGeneration(f,g=>{g.entries.push(structuredClone(g.entries[0]));})],
  ['incomplete scope','SCOPE_INVALID',f=>malformedGeneration(f,g=>{delete g.entries[0].scope.projectId;})],
  ['cross-project dependency','SCOPE_INVALID',f=>malformedGeneration(f,g=>{const e=g.entries.find(e=>e.kind==='TerminalSemanticClosure');e.scope={...e.scope,projectId:'foreign'};})],
  ['missing dependency','MATERIAL_MISSING',f=>malformedGeneration(f,g=>{g.entries.find(e=>e.kind==='TerminalSemanticClosure').dependencies.push(digest('missing'));})],
  ['dependency cycle','DEPENDENCY_CYCLE',f=>malformedGeneration(f,g=>{const e=g.entries.find(e=>e.kind==='TerminalSemanticClosure');e.dependencies.push(e.objectDigest);})],
  ['detached embedded Skill','PARENT_INVALID',f=>malformedGeneration(f,g=>{g.entries.find(e=>e.kind==='ProjectOntologySkill').parent.jsonPointer='/wrong';})],
  ['revoked indexed material','REVOKED',f=>malformedGeneration(f,g=>{g.revokedDigests=[g.entries[0].objectDigest];})],
  ['entry material size accounting','MATERIAL_LIMIT',f=>malformedGeneration(f,g=>{g.entries[0].bytes=16777217;})],
  ['graph entry limit','ENTRY_LIMIT',f=>malformedGeneration(f,g=>{g.entries=Array.from({length:4097},(_,i)=>entry(i));})],
  ['graph edge limit','EDGE_LIMIT',f=>malformedGeneration(f,g=>{const leaves=Array.from({length:128},(_,i)=>entry(i));g.entries=[...leaves,...Array.from({length:128},(_,i)=>({...entry(i+128),dependencies:leaves.map(e=>e.objectDigest)})),{...entry(256),dependencies:[leaves[0].objectDigest]}];})],
  ['graph depth limit','DEPTH_LIMIT',f=>malformedGeneration(f,g=>{g.entries=Array.from({length:65},(_,i)=>({...entry(i),dependencies:i?[entry(i-1).objectDigest]:[]}));})],
  ['aggregate material accounting','TOTAL_MATERIAL_LIMIT',f=>malformedGeneration(f,g=>{g.entries=[...Array.from({length:16},(_,i)=>entry(i,16777216)),entry(16)];})],
  ['generation material path escape','PATH_DENIED',f=>malformedGeneration(f,g=>{g.entries[0].path='../synthetic-sentinel';})],
  ['Registry duplicate roots','IDENTITY_CONFLICT',f=>registry(f,r=>{r.catalogs.push(structuredClone(r.catalogs[0]));})],
  ['Registry asset injection','UNSUPPORTED',f=>registry(f,r=>{r.entries=[];})],
  ['Registry enabled root limit','ROOT_LIMIT',f=>registry(f,r=>{r.catalogs=Array.from({length:17},(_,i)=>({id:i?'extra-'+i:'organization',enabled:true,root:'./catalogs/organization'}));})],
  ['current project scope lost','PERMISSION_DENIED',f=>policy(f,p=>{p.catalogs[0].scopes[0].scope.projectId='foreign';})],
  ['current visibility lost','PERMISSION_DENIED',f=>policy(f,p=>{p.catalogs[0].scopes[0].visibilities=['PUBLIC'];})],
  ['publication grant expired','PERMISSION_DENIED',f=>policy(f,p=>{p.catalogs[0].grants.find(g=>g.purpose==='CATALOG_PUBLICATION').expiresAt='2000-01-01T00:00:00.000Z';})],
  ['generation raw file size','FILE_LIMIT',f=>{const p=JSON.parse(fs.readFileSync(path.join(f.organization,'SEMANTIC-CATALOG.json')));fs.writeFileSync(path.join(f.organization,p.generationPath),' '.repeat(4194305));}],
  ['material hard link','PATH_DENIED',f=>{const file=path.join(f.organization,f.built.generation.entries[0].path);fs.linkSync(file,file+'.second-link');}]
];

for(const [name,code,inject] of cases)test('RC02 actual MCP structural/resource refusal: '+name,async t=>{
  const f=preparedSemanticSupply(t);await semanticCatalogOperation(f.request);
  const sentinel=path.join(f.home,'synthetic-sentinel');fs.writeFileSync(sentinel,'unchanged synthetic canary\n');
  const client=new TestMcpClient({command:process.execPath,args:['src/index.mjs','mcp','serve','--workspace',f.home],cwd:path.resolve(import.meta.dirname,'..')});
  try {
    await client.initialize();
    const positive=await client.rawTool('run_engine_diagnostic',{operation:'semantic.catalog.inspect',input:{catalogId:'organization'}});
    assert.equal(positive.structuredContent.result.status,'AVAILABLE','VALID_PRECONDITION_REQUIRED');
    assert.equal(positive.structuredContent.result.generationDigest,f.built.generation.generationDigest);
    inject(f);const before=snapshot(f.home);let invocations=0,raw;
    const expected={workspace:f.home,catalogId:'organization',code};
    const report=await runHarnessRefusalProbe({expected,authorizeInvocation:async request=>{
      assert.equal(request.effect,'READ');return true;
    },invoke:async({tool,args})=>{invocations++;raw=await client.rawTool(tool,args);return raw;}});
    assert.equal(invocations,1);assert.equal(report.code,code);assert.equal(report.targetCriteriaClosed,0);
    assert.equal(report.mutationReplayed,false);assert.equal(report.releaseAuthorized,false);
    assert.deepEqual(snapshot(f.home),before);assert.equal(fs.readFileSync(sentinel,'utf8'),'unchanged synthetic canary\n');
    // Expected finite diagnostics, not any failure or transport exception.
    for(const change of [v=>{v.structuredContent.result.code='WRONG';},v=>{v.structuredContent.result.error+=' private canary';},v=>{v.content[0].text+=' private canary';}]) {
      const bad=structuredClone(raw);change(bad);assert.throws(()=>assertHarnessRefusal({expected,response:bad}));
    }
  }finally{await client.close();}
});

test('RC02 public root budget accepts exactly sixteen enabled roots without scanning unselected roots',async t=>{
  const f=preparedSemanticSupply(t);await semanticCatalogOperation(f.request);
  registry(f,r=>{r.catalogs=Array.from({length:16},(_,i)=>({id:i?'extra-'+i:'organization',enabled:true,root:i?'./does-not-exist-'+i:'./catalogs/organization'}));});
  const before=snapshot(f.home),client=new TestMcpClient({command:process.execPath,args:['src/index.mjs','mcp','serve','--workspace',f.home],cwd:path.resolve(import.meta.dirname,'..')});
  try {
    await client.initialize();const raw=await client.rawTool('run_engine_diagnostic',{operation:'semantic.catalog.inspect',input:{catalogId:'organization'}});
    assert.equal(raw.structuredContent.result.status,'AVAILABLE');assert.equal(raw.structuredContent.result.limits.enabledRoots,16);
    assert.deepEqual(snapshot(f.home),before);
  }finally{await client.close();}
});
