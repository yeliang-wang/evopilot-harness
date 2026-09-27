import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifyCandidatePromotion,extractCandidateZip,promotionFiles} from '../scripts/prepare-candidate-promotion.mjs';
const h=b=>'sha256:'+crypto.createHash('sha256').update(b).digest('hex');
function fixture(){
 const version='4.8.1',commit='a'.repeat(40),repository='fixture/harness',zipBytes=Buffer.from('synthetic ZIP fixture; unpacking is separately bounded');
 const files={};for(const [name,value] of [[`evopilot-harness-${version}.tgz`,'npm'],[`evopilot-harness-${version}-source.tar.gz`,'source'],[`evopilot-harness-${version}-sbom.spdx.json`,'{}']])files[name]=Buffer.from(value);
 const p={schema:'evopilot-harness-release-provenance/v1',project:'evopilot-harness',npmPackage:'@evopilot/harness',version,tag:'v'+version,commit,source:{commit,dirty:false,statusDigest:null},github:{repository,runId:'123'},artifacts:Object.entries(files).map(([name,b])=>({name,bytes:b.length,sha256:h(b).slice(7)}))};
 files[`evopilot-harness-${version}-provenance.json`]=Buffer.from(JSON.stringify(p));
 const sums=()=>Buffer.from(Object.entries(files).filter(([n])=>n!=='SHA256SUMS').map(([n,b])=>h(b).slice(7)+'  '+n).join('\n')+'\n');files.SHA256SUMS=sums();
 return {expected:{version,repository,commit,runId:'123',artifactDigest:h(zipBytes),packageDigest:h(files[`evopilot-harness-${version}.tgz`])},run:{id:123,status:'completed',conclusion:'success',path:'.github/workflows/release-candidate.yml',repository:{id:9,full_name:repository},head_repository:{full_name:repository},head_sha:commit},artifact:{name:`evopilot-harness-${version}-candidate-release-set`,expired:false,digest:h(zipBytes),workflow_run:{id:123,head_sha:commit,repository_id:9,head_repository_id:9}},zipBytes,files};
}
test('pinned successful Candidate verifies without granting acceptance or release authority',()=>{const report=verifyCandidatePromotion(fixture());assert.equal(report.status,'EXACT_CANDIDATE_BYTES_VERIFIED');assert.equal(report.repacked,false);assert.equal(report.releaseAuthorized,false);});
for(const [name,mutate] of [
 ['failed workflow',f=>f.run.conclusion='failure'],['unfinished workflow',f=>f.run.status='in_progress'],
 ['different workflow',f=>f.run.path='.github/workflows/ci.yml'],['foreign repository',f=>f.run.repository.full_name='foreign/harness'],
 ['fork head',f=>f.run.head_repository.full_name='fork/harness'],['changed commit',f=>f.run.head_sha='b'.repeat(40)],
 ['wrong artifact run',f=>f.artifact.workflow_run.id=124],['fork artifact',f=>f.artifact.workflow_run.head_repository_id=10],
 ['expired artifact',f=>f.artifact.expired=true],['wrong artifact name',f=>f.artifact.name='other'],
 ['modified ZIP',f=>f.zipBytes=Buffer.from('substituted')],['wrong accepted npm digest',f=>f.expected.packageDigest=h(Buffer.from('other'))],
 ['missing source archive',f=>delete f.files['evopilot-harness-4.8.1-source.tar.gz']],
 ['extra release file',f=>f.files['unexpected.txt']=Buffer.from('extra')],
 ['changed npm tarball',f=>f.files['evopilot-harness-4.8.1.tgz']=Buffer.from('changed')],
 ['duplicate checksums',f=>f.files.SHA256SUMS=Buffer.concat([f.files.SHA256SUMS,f.files.SHA256SUMS])],
 ['checksum path traversal',f=>f.files.SHA256SUMS=Buffer.from('0'.repeat(64)+'  ../escape\n')]
])test('promotion refuses '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>verifyCandidatePromotion(f));});
for(const mode of ['valid','duplicate','traversal','symlink','fifo','extra'])test('actual ZIP extraction handles '+mode+' without escaping its destination',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'promotion-zip-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const destination=path.join(root,'out');fs.mkdirSync(destination);const zip=path.join(root,'fixture.zip');
 execFileSync('python3',['-c',`import json,sys,zipfile,stat
names=json.loads(sys.argv[2]);mode=sys.argv[3]
with zipfile.ZipFile(sys.argv[1],'w') as z:
 for index,name in enumerate(names):
  entry=zipfile.ZipInfo('../escape' if mode=='traversal' and index==0 else name)
  if index==0 and mode in ('symlink','fifo'):entry.create_system=3;entry.external_attr=((stat.S_IFLNK if mode=='symlink' else stat.S_IFIFO)|0o600)<<16
  z.writestr(entry,b'payload')
 if mode=='duplicate':z.writestr(names[0],b'duplicate')
 if mode=='extra':z.writestr('unexpected.txt',b'extra')
`,zip,JSON.stringify(promotionFiles('4.8.1')),mode],{stdio:'pipe'});
 if(mode==='valid'){extractCandidateZip(zip,destination,'4.8.1');assert.deepEqual(fs.readdirSync(destination).sort(),promotionFiles('4.8.1').sort());}
 else assert.throws(()=>extractCandidateZip(zip,destination,'4.8.1'));
 assert.equal(fs.existsSync(path.join(root,'escape')),false);
});
for(const [name,mutate] of [['dirty source',p=>p.source.dirty=true],['different provenance commit',p=>p.commit='b'.repeat(40)],['different package identity',p=>p.npmPackage='@other/package'],['wrong version',p=>p.version='4.8.0'],['different provenance run',p=>p.github.runId='124'],['duplicate provenance entry',p=>p.artifacts.push(p.artifacts[0])]])test('promotion rejects rehashed '+name,()=>{
 const f=fixture(),nameOfFile='evopilot-harness-4.8.1-provenance.json',p=JSON.parse(f.files[nameOfFile]);mutate(p);f.files[nameOfFile]=Buffer.from(JSON.stringify(p));f.files.SHA256SUMS=Buffer.from(Object.entries(f.files).filter(([n])=>n!=='SHA256SUMS').map(([n,b])=>h(b).slice(7)+'  '+n).join('\n')+'\n');assert.throws(()=>verifyCandidatePromotion(f));
});
