import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const hash=bytes=>'sha256:'+crypto.createHash('sha256').update(bytes).digest('hex');
const exact=(actual,expected)=>assert.deepEqual([...actual].sort(),[...expected].sort());
export function promotionFiles(version){return [`evopilot-harness-${version}.tgz`,`evopilot-harness-${version}-source.tar.gz`,`evopilot-harness-${version}-sbom.spdx.json`,`evopilot-harness-${version}-provenance.json`,'SHA256SUMS'];}

// These checks bind bytes and origin only. Acceptance and the separately
// authorized release decision remain prerequisites of workflow dispatch.
export function verifyCandidatePromotion({expected,run,artifact,zipBytes,files}){
  assert.match(expected.repository,/^[\w.-]+\/[\w.-]+$/);
  assert.match(expected.version,/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/);
  assert.match(expected.commit,/^[a-f0-9]{40}$/);
  assert.match(String(expected.runId),/^[1-9][0-9]*$/);assert.ok(Number.isSafeInteger(Number(expected.runId)));assert.ok(Number.isSafeInteger(run.repository.id)&&run.repository.id>0);
  for(const d of [expected.artifactDigest,expected.packageDigest])assert.match(d,/^sha256:[a-f0-9]{64}$/);
  assert.equal(run.id,Number(expected.runId));assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
  assert.equal(run.path,'.github/workflows/release-candidate.yml');assert.equal(run.repository.full_name,expected.repository);
  assert.equal(run.head_repository.full_name,expected.repository);assert.equal(run.head_sha,expected.commit);
  assert.equal(artifact.name,`evopilot-harness-${expected.version}-candidate-release-set`);assert.equal(artifact.expired,false);
  assert.equal(artifact.workflow_run.id,run.id);assert.equal(artifact.workflow_run.head_sha,expected.commit);
  assert.equal(artifact.workflow_run.repository_id,run.repository.id);assert.equal(artifact.workflow_run.head_repository_id,run.repository.id);
  assert.equal(artifact.digest,expected.artifactDigest);assert.equal(hash(zipBytes),expected.artifactDigest,'CANDIDATE_ZIP_DIGEST_MISMATCH');
  exact(Object.keys(files),promotionFiles(expected.version));
  for(const bytes of Object.values(files))assert.ok(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=67108864);
  const lines=files.SHA256SUMS.toString('utf8').trim().split(/\r?\n/),seen=new Set();
  assert.equal(lines.length,4);
  for(const line of lines){const match=/^([a-f0-9]{64})\s+([a-zA-Z0-9.-]+)$/.exec(line);assert.ok(match,'CHECKSUM_FORMAT');const [,digest,name]=match;assert.ok(!seen.has(name)&&Object.hasOwn(files,name)&&name!=='SHA256SUMS');seen.add(name);assert.equal(hash(files[name]),'sha256:'+digest);}
  exact(seen,promotionFiles(expected.version).filter(f=>f!=='SHA256SUMS'));
  assert.equal(hash(files[`evopilot-harness-${expected.version}.tgz`]),expected.packageDigest,'ACCEPTED_NPM_BYTES_MISMATCH');
  const p=JSON.parse(files[`evopilot-harness-${expected.version}-provenance.json`]);
  assert.equal(p.schema,'evopilot-harness-release-provenance/v1');assert.equal(p.project,'evopilot-harness');assert.equal(p.npmPackage,'@evopilot/harness');
  assert.equal(p.version,expected.version);assert.equal(p.tag,'v'+expected.version);assert.equal(p.commit,expected.commit);assert.equal(p.source.commit,expected.commit);assert.equal(p.source.dirty,false);assert.equal(p.source.statusDigest,null);
  assert.equal(p.github.repository,expected.repository);assert.equal(String(p.github.runId),String(expected.runId));
  exact(p.artifacts.map(a=>a.name),promotionFiles(expected.version).filter(f=>!['SHA256SUMS',`evopilot-harness-${expected.version}-provenance.json`].includes(f)));
  for(const item of p.artifacts){assert.equal(item.bytes,files[item.name].length);assert.equal('sha256:'+item.sha256,hash(files[item.name]));}
  return {schema:'evopilot-harness-candidate-promotion/v1',status:'EXACT_CANDIDATE_BYTES_VERIFIED',...expected,repacked:false,releaseAuthorized:false};
}

export function extractCandidateZip(zip,destination,version){
  execFileSync('python3',['-c',`import json,sys,zipfile,stat,pathlib
allowed=json.loads(sys.argv[3])
with zipfile.ZipFile(sys.argv[1]) as z:
 entries=z.infolist()
 assert sorted(i.filename for i in entries)==sorted(allowed)
 assert sum(i.file_size for i in entries)<=67108864
 for i in entries:
  assert not i.is_dir() and stat.S_IFMT(i.external_attr>>16) in (0,stat.S_IFREG)
  assert 0<i.file_size<=67108864
  data=z.read(i)
  with (pathlib.Path(sys.argv[2])/i.filename).open('xb') as f:f.write(data)
`,zip,destination,JSON.stringify(promotionFiles(version))],{timeout:30000});
}

function main(){
  const root=process.cwd(),version=JSON.parse(fs.readFileSync('package.json')).version;
  assert.equal(process.env.RELEASE_TAG,'v'+version,'RELEASE_TAG_MISMATCH');
  const expected={repository:process.env.GITHUB_REPOSITORY,version,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runId:process.env.CANDIDATE_RUN_ID,artifactDigest:process.env.CANDIDATE_ARTIFACT_DIGEST,packageDigest:process.env.CANDIDATE_PACKAGE_DIGEST};
  assert.match(expected.repository,/^[\w.-]+\/[\w.-]+$/);assert.match(expected.runId,/^[1-9][0-9]*$/);
  const api=route=>JSON.parse(execFileSync('gh',['api',`repos/${expected.repository}/${route}`],{maxBuffer:4194304,timeout:60000}));
  const run=api(`actions/runs/${expected.runId}`),listing=api(`actions/runs/${expected.runId}/artifacts?per_page=100`);
  assert.ok(listing.total_count<=100,'ARTIFACT_LIST_LIMIT');const matches=listing.artifacts.filter(a=>a.name===`evopilot-harness-${version}-candidate-release-set`);assert.equal(matches.length,1);
  const artifact=matches[0];assert.equal(artifact.expired,false);assert.equal(artifact.digest,expected.artifactDigest);assert.ok(Number.isSafeInteger(artifact.id));
  const zipBytes=execFileSync('gh',['api',`repos/${expected.repository}/actions/artifacts/${artifact.id}/zip`],{maxBuffer:67108864,timeout:60000});
  assert.equal(hash(zipBytes),expected.artifactDigest,'CANDIDATE_ZIP_DIGEST_MISMATCH');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'harness-promotion-'));const zip=path.join(temp,'candidate.zip'),destination=path.join(root,'dist/release');
  assert.equal(fs.existsSync(destination),false,'PROMOTION_DESTINATION_NOT_EMPTY');fs.writeFileSync(zip,zipBytes);fs.mkdirSync(destination,{recursive:true});
  try{
    // Fixed allowlist, no paths, directories, links, duplicate entries or bombs.
    extractCandidateZip(zip,destination,version);
    const files=Object.fromEntries(promotionFiles(version).map(name=>[name,fs.readFileSync(path.join(destination,name))]));
    const report=verifyCandidatePromotion({expected,run,artifact,zipBytes,files});
    execFileSync(process.execPath,['scripts/verify-release-artifacts.mjs'],{stdio:'inherit',timeout:60000});
    fs.writeFileSync(path.join(root,'candidate-promotion.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    if(process.env.GITHUB_ENV)fs.appendFileSync(process.env.GITHUB_ENV,`CANDIDATE_TARBALL=dist/release/evopilot-harness-${version}.tgz\n`);
    console.log(JSON.stringify(report));
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main();
