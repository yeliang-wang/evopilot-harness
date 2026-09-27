import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bytesDigest} from '../e2e/versions/installed-transport.mjs';

// Source integration fixture, not npm publication or a frozen Candidate.
// Copies only declared package inputs and locally resolved dependencies.
export function stageSourceHarness(parent){
 const source=path.resolve(import.meta.dirname,'../..'),installationRoot=path.join(parent,'source-installation');
 assert.equal(fs.existsSync(installationRoot),false);
 const manifest=JSON.parse(fs.readFileSync(path.join(source,'package.json'))),dest=path.join(installationRoot,'node_modules/@evopilot/harness');
 for(const rel of ['package.json',...manifest.files]){
  assert.ok(!path.isAbsolute(rel)&&!rel.split('/').includes('..')&&!/[?*]/.test(rel));
  const file=path.join(dest,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.cpSync(path.join(source,rel),file,{recursive:true,dereference:false});
 }
 const seen=new Map();
 function dependencies(owner){
  const pkg=JSON.parse(fs.readFileSync(owner)),resolve=createRequire(owner);
  for(const name of Object.keys(pkg.dependencies??{})){
   const metadata=resolve.resolve(name+'/package.json'),body=JSON.parse(fs.readFileSync(metadata));
   if(seen.has(name)){assert.equal(seen.get(name),body.version);continue;}
   seen.set(name,body.version);fs.cpSync(path.dirname(metadata),path.join(installationRoot,'node_modules',name),{recursive:true,dereference:false});dependencies(metadata);
  }
 }dependencies(path.join(source,'package.json'));
 const files=[];function visit(rel=''){
  for(const name of fs.readdirSync(path.join(installationRoot,rel)).sort()){
   const entry=path.posix.join(rel,name),file=path.join(installationRoot,entry),stat=fs.lstatSync(file);assert.equal(stat.isSymbolicLink(),false);
   if(stat.isDirectory())visit(entry);else files.push({path:entry,digest:bytesDigest(fs.readFileSync(file))});
  }
 }visit();return {installationRoot,files};
}
