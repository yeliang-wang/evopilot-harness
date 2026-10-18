import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createPrometheusCollector,inspectOnlineSLO,validateOnlineMeasurement,validatePrometheusConnection} from '../../dist/online.js';
import {nativeSha256} from '../../vendor/compatibility/v1/native.mjs';
const slo=JSON.parse(fs.readFileSync(new URL('../../specifications/online/v1/example.json',import.meta.url)));
const binding={workspaceId:'synthetic',scope:{visibility:'private',projectId:'example'},spec:{providerId:'metrics',serviceId:'example-service',environment:'test',deploymentRevision:'fixed'},slo:inspectOnlineSLO(slo),reviewDigest:nativeSha256('synthetic')};
const labels={service:'example-service',environment:'test',deployment:'fixed'};
async function fixture(t,mode='normal'){
 const calls=[];const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'online-prom-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const token='synthetic-private-token-123456';const tokenFile=path.join(dir,'token');fs.writeFileSync(tokenFile,token,{mode:0o600});
 const server=http.createServer((req,res)=>{
  calls.push({method:req.method,url:req.url,auth:req.headers.authorization});
  if(mode==='timeout')return;
  if(mode==='auth'){res.writeHead(401);return res.end(token);}
  if(mode==='redirect'){res.writeHead(302,{Location:'http://127.0.0.1:1/leak'});return res.end();}
  if(mode==='oversized')return res.end(' '.repeat(1048577));
  const url=new URL(req.url,'http://localhost'),query=url.searchParams.get('query'),start=Number(url.searchParams.get('start')),end=Number(url.searchParams.get('end')),step=Number(url.searchParams.get('step'));
  const freshness=query.startsWith('timestamp('),total=query.includes('total');
  const values=[];for(let at=start;at<=end;at+=step)values.push([at,String(freshness?at-(mode==='stale'?10:0):mode==='zero'&&total?0:mode==='fault'&&!total?0:1)]);
  if(mode==='missing')values.pop();if(mode==='nan')values[0][1]='NaN';
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'success',...(mode==='warnings'?{warnings:['partial backend']} :{}),data:{resultType:'matrix',result:mode==='empty'?[]:[{metric:{...labels,...(mode==='scope'?{deployment:'other'}:{})},values}]}}));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const origin='http://127.0.0.1:'+server.address().port;
 const collect=createPrometheusCollector([{id:'metrics',origin,bearerTokenFile:tokenFile,freshnessSeconds:3}]);
 const result=await collect({binding,windowEnd:Math.floor(Date.now()/1000)-1});
 assert.equal(JSON.stringify(result).includes(token),false);validateOnlineMeasurement(result,binding,result.windowEnd);
 return {result,calls};
}
test('Prometheus collector uses four GET queries and computes real response sample ratios',async t=>{
 const {result,calls}=await fixture(t);assert.equal(result.status,'COMPLETE');assert.equal(result.ratio,1);assert.equal(result.points.length,10);assert.equal(result.responseDigests.length,4);assert.equal(calls.length,4);assert.ok(calls.every(c=>c.method==='GET'&&c.url.startsWith('/api/v1/query_range?')));
});
test('Prometheus complete faulty samples remain a measurable zero ratio',async t=>{const {result}=await fixture(t,'fault');assert.equal(result.status,'COMPLETE');assert.equal(result.ratio,0);});
for(const [mode,reason]of Object.entries({missing:'MISSING_SAMPLES',stale:'STALE_SAMPLES',zero:'ZERO_DENOMINATOR',nan:'PROVIDER_SAMPLE',warnings:'PROVIDER_PARTIAL',empty:'PROVIDER_SERIES',scope:'PROVIDER_SCOPE',auth:'PROVIDER_AUTH',timeout:'PROVIDER_TIMEOUT',redirect:'PROVIDER_UNAVAILABLE',oversized:'PROVIDER_RESPONSE_LIMIT'}))test('Prometheus incomplete '+mode+' never reports healthy',async t=>{const {result}=await fixture(t,mode);assert.equal(result.status,'INCOMPLETE');assert.equal(result.ratio,null);assert.ok(result.reasons.includes(reason),JSON.stringify(result.reasons));});
test('Configured origin rejects plaintext remote, credentials, query injection and path',()=>{
 for(const origin of ['http://example.com','https://user:secret@example.com','https://example.com?query=secret','https://example.com/custom'])assert.throws(()=>validatePrometheusConnection({id:'metrics',origin,bearerTokenFile:null,freshnessSeconds:3}));
});
