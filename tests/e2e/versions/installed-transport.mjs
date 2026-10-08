import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {exactKeys,isDigest} from './probe-session.mjs';

export const bytesDigest = value => 'sha256:' + crypto.createHash('sha256').update(value).digest('hex');
const packages = {harness:{name:'@evopilot/harness',version:'4.8.1',entry:'src/index.mjs'}};
function safeRelative(relative) {
  assert.ok(typeof relative==='string' && relative.length<=1024 && !path.isAbsolute(relative) &&
    /^[a-zA-Z0-9@_.+/-]+$/.test(relative) && relative.split('/').every(p=>p && p!=='.' && p!=='..'),'INSTALLED_PATH_INVALID');
}
function outside(child,parent) {const rel=path.relative(parent,child);assert.ok(rel.startsWith('..'+path.sep)||rel==='..'||path.isAbsolute(rel),'INSTALLATION_MUST_BE_EXTERNAL');}
function fileBytes(file,max=33554432) {
  const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=max,'INSTALLED_FILE_INVALID');
  return fs.readFileSync(file);
}
function tree(root) {
  let total=0,entries=0;const files=[];
  const visit=(relative,depth)=>{
    assert.ok(depth<=32,'INSTALLED_DEPTH_LIMIT');
    for(const name of fs.readdirSync(path.join(root,relative)).sort()) {
      assert.ok(++entries<=32768,'INSTALLED_ENTRY_LIMIT');
      const rel=path.posix.join(relative,name);safeRelative(rel);assert.notEqual(name,'.git','SOURCE_CHECKOUT_NOT_ALLOWED');
      const file=path.join(root,rel),stat=fs.lstatSync(file);assert.ok(!stat.isSymbolicLink(),'INSTALLED_SYMLINK_REJECTED');
      if(stat.isDirectory())visit(rel,depth+1);
      else {total+=stat.size;assert.ok(total<=536870912,'INSTALLED_BYTES_LIMIT');files.push({path:rel,digest:bytesDigest(fileBytes(file))});}
    }
  };
  visit('',0);return files.sort((a,b)=>a.path.localeCompare(b.path));
}

/** Mechanical installation identity check, NOT a Candidate/Host authorization.
 * The external campaign must independently prove that this complete inventory
 * came from the accepted artifacts, including every package dependency. */
export function createInstalledProbeTransport({contextBytes,expectedContextDigest,sourceRoot,expectedVersion="4.8.1"}) {
  assert.ok(Buffer.isBuffer(contextBytes)&&contextBytes.length<=8388608,'CONTEXT_SIZE_LIMIT');
  assert.ok(isDigest(expectedContextDigest)&&bytesDigest(contextBytes)===expectedContextDigest,'CONTEXT_DIGEST_MISMATCH');
  const context=JSON.parse(contextBytes);
  assert.ok(Object.hasOwn(packages,context.product),'PROBE_PRODUCT_INVALID');
  const extra=['workspace'];
  exactKeys(context,['schema','product','version','installationRoot','files','artifactSetDigest','acceptanceBindingDigest','probeInputDigest',...extra]);
  assert.equal(context.schema,'evopilot-installed-readonly-probe-context/v1');
  // The historical CLI stays pinned to 4.8.1. A current source integration test
  // may supply an explicit supported version; the untrusted context never chooses it.
  assert.ok(["4.8.1","4.8.2","4.8.3"].includes(expectedVersion),'PROBE_VERSION_UNSUPPORTED');
  const spec={...packages[context.product],version:expectedVersion};assert.equal(context.version,spec.version);
  assert.ok([context.artifactSetDigest,context.acceptanceBindingDigest,context.probeInputDigest].every(isDigest),'EXTERNAL_BINDING_REFERENCE_REQUIRED');
  assert.ok(path.isAbsolute(context.installationRoot)&&path.isAbsolute(sourceRoot),'ABSOLUTE_ROOT_REQUIRED');
  const root=fs.realpathSync(context.installationRoot),source=fs.realpathSync(sourceRoot);outside(root,source);outside(source,root);
  assert.ok(Array.isArray(context.files)&&context.files.length>0&&context.files.length<=32768,'INSTALLED_INVENTORY_INVALID');
  const seen=new Set();
  for(const item of context.files){exactKeys(item,['path','digest']);safeRelative(item.path);assert.ok(isDigest(item.digest)&&!seen.has(item.path),'INSTALLED_INVENTORY_INVALID');seen.add(item.path);}
  const expected=[...context.files].sort((a,b)=>a.path.localeCompare(b.path));
  const verify=()=>assert.deepEqual(tree(root),expected,'INSTALLED_INVENTORY_DRIFT');verify();
  const packageRoot=path.join(root,'node_modules',spec.name);
  const manifest=JSON.parse(fileBytes(path.join(packageRoot,'package.json')));
  assert.equal(manifest.name,spec.name);assert.equal(manifest.version,spec.version);
  const entry=path.join(packageRoot,spec.entry);fileBytes(entry);
  const workspace=()=>{
    assert.ok(path.isAbsolute(context.workspace),'ABSOLUTE_WORKSPACE_REQUIRED');
    const p=fs.realpathSync(context.workspace);outside(p,root);outside(p,source);return ['--workspace',p];
  };
  if(context.product==='harness')workspace();
  const allowed=args=>{
    assert.ok(Array.isArray(args)&&args.every(x=>typeof x==='string'),'PROBE_COMMAND_INVALID');
    const id=x=>/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(x);
    assert.ok(args[0]==='semantic'&&args[2]==='--catalog-id'&&id(args[3])&&args.at(-1)==='--json'&&
      (args.length===5&&args[1]==='catalog-inspect'||args.length===7&&args[1]==='catalog-readback'&&args[4]==='--request-id'&&id(args[5])),'PROBE_COMMAND_DENIED');
  };
  return Object.freeze({identity:Object.freeze({contextDigest:expectedContextDigest,artifactSetDigest:context.artifactSetDigest,
    acceptanceBindingDigest:context.acceptanceBindingDigest,product:context.product,version:context.version,
    artifactProvenance:'REQUIRES_INDEPENDENT_CAMPAIGN_VERIFICATION',grantsAuthority:false}),
    invoke:async(args,{signal}={})=>{
      signal?.throwIfAborted();allowed(args);verify();
      const extraArgs=workspace();
      signal?.throwIfAborted();
      const r=await new Promise((resolve,reject)=>execFile(process.execPath,[entry,...args,...extraArgs],
        {cwd:root,signal,timeout:10000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C',LC_ALL:'C',EVOPILOT_LOG_LEVEL:'error'}},
        (error,stdout)=>{
          if(error&&(!Number.isInteger(error.code)||error.killed||error.signal))return reject(new Error('PROBE_TRANSPORT_FAILED'));
          try{resolve({exitCode:error?.code??0,json:stdout.trim()?JSON.parse(stdout):null});}catch{reject(new Error('PROBE_JSON_INVALID'));}
        }));
      signal?.throwIfAborted();verify();return r;
    }});
}
