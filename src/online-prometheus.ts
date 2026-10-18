import {openSync,closeSync,fstatSync,readFileSync,realpathSync,lstatSync,constants} from 'node:fs';
import {isAbsolute,resolve,dirname} from 'node:path';
import {nativeAssertJSON,nativeExact,nativeSha256,nativeFrozenClone} from '../vendor/compatibility/v1/native.mjs';
import {ONLINE_LIMITS,onlineFail,onlineSlug,onlineText,measurementBody} from '../vendor/compatibility/online/v1/online.mjs';
import type {OnlineProviderInput,OnlineMeasurement,OnlinePoint} from '../vendor/compatibility/online/v1/online.mjs';

/** Private server configuration, never an asset or an MCP request credential. */
export interface PrometheusConnection {id:string;origin:string;bearerTokenFile:string|null;freshnessSeconds:number}
export function readOnlineSecret(file:string):string {
 if(!isAbsolute(file)||realpathSync(file)!==resolve(file))onlineFail('ONLINE_CREDENTIAL_PATH');
 let p=file;while(p!==dirname(p)){if(lstatSync(p).isSymbolicLink())onlineFail('ONLINE_CREDENTIAL_PATH');p=dirname(p);}
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=fstatSync(fd);if(!s.isFile()||s.size<16||s.size>4096||(s.mode&0o077)!==0||(process.getuid&&s.uid!==process.getuid()))onlineFail('ONLINE_CREDENTIAL_PERMISSIONS');const value=readFileSync(fd,'utf8').trim();if(value.length<16||/[\s\u0000-\u001f]/.test(value))onlineFail('ONLINE_CREDENTIAL_FORMAT');return value;}finally{closeSync(fd);}
}
export function validatePrometheusConnection(value:unknown):asserts value is PrometheusConnection {
 nativeAssertJSON(value);nativeExact(value,['id','origin','bearerTokenFile','freshnessSeconds']);onlineSlug(value.id);onlineText(value.origin,2048);
 const url=new URL(value.origin);const local=['127.0.0.1','[::1]'].includes(url.hostname);
 if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&local))onlineFail('ONLINE_PROVIDER_ORIGIN');
 if(value.bearerTokenFile!==null&&(typeof value.bearerTokenFile!=='string'||!isAbsolute(value.bearerTokenFile)))onlineFail('ONLINE_CREDENTIAL_PATH');
 if(typeof value.freshnessSeconds!=='number'||!Number.isSafeInteger(value.freshnessSeconds)||value.freshnessSeconds<1||value.freshnessSeconds>300)onlineFail('ONLINE_FRESHNESS_LIMIT');
}
async function boundedJSON(response:Response):Promise<unknown> {
 if(!response.body)onlineFail('PROVIDER_EMPTY');const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>ONLINE_LIMITS.responseBytes)onlineFail('PROVIDER_RESPONSE_LIMIT');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;}catch{onlineFail('PROVIDER_INVALID_JSON');}
}
/** Four read-only bounded queries against one preconfigured origin. */
export function createPrometheusCollector(input:readonly PrometheusConnection[]) {
 if(!Array.isArray(input)||input.length>ONLINE_LIMITS.bindings)onlineFail('ONLINE_PROVIDER_LIMIT');
 const connections=new Map<string,PrometheusConnection>();
 for(const item of input){validatePrometheusConnection(item);if(connections.has(item.id))onlineFail('ONLINE_PROVIDER_DUPLICATE');connections.set(item.id,nativeFrozenClone(item));}
 return async ({binding,windowEnd}:OnlineProviderInput):Promise<OnlineMeasurement>=>{
  const connection=connections.get(binding.spec.providerId);if(!connection)onlineFail('ONLINE_PROVIDER_UNAVAILABLE');
  const {stepSeconds,windowSeconds,good,total}=binding.slo;
  if(windowEnd>Math.floor(Date.now()/1000)||windowEnd<windowSeconds||windowEnd%stepSeconds)onlineFail('ONLINE_WINDOW');
  const start=windowEnd-windowSeconds+stepSeconds,expected=windowSeconds/stepSeconds;
  const responseDigests:string[]=[],reasons:string[]=[],maps:Map<number,number>[]=[];
  try{
   const token=connection.bearerTokenFile?readOnlineSecret(connection.bearerTokenFile):null;
   for(const query of [good.query,total.query,good.freshnessQuery,total.freshnessQuery]){
    const url=new URL('/api/v1/query_range',connection.origin);url.search=new URLSearchParams({query,start:String(start),end:String(windowEnd),step:String(stepSeconds),timeout:'4s'}).toString();
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ONLINE_LIMITS.timeoutMs);
    try{
     const response=await fetch(url,{method:'GET',redirect:'error',signal:controller.signal,headers:token?{authorization:'Bearer '+token}:{}});
     if(response.status===401||response.status===403)onlineFail('PROVIDER_AUTH');
     if(!response.ok)onlineFail('PROVIDER_HTTP');
     const body=await boundedJSON(response);nativeAssertJSON(body);responseDigests.push(nativeSha256(body));
     if(typeof body!=='object'||body===null||Array.isArray(body)||body.status!=='success')onlineFail('PROVIDER_RESPONSE');
     if(body.warnings||body.infos)reasons.push('PROVIDER_PARTIAL');
     const data=body.data;nativeExact(data,['resultType','result']);
     if(data.resultType!=='matrix'||!Array.isArray(data.result)||data.result.length!==1)onlineFail('PROVIDER_SERIES');
     const series=data.result[0];nativeExact(series,['metric','values']);
     const labels=series.metric;nativeAssertJSON(labels);
     if(!labels||typeof labels!=='object'||Array.isArray(labels)||labels.service!==binding.spec.serviceId||labels.environment!==binding.spec.environment||labels.deployment!==binding.spec.deploymentRevision)onlineFail('PROVIDER_SCOPE');
     if(!Array.isArray(series.values)||series.values.length>expected)onlineFail('PROVIDER_SAMPLE_LIMIT');
     const map=new Map<number,number>();
     for(const value of series.values){
      if(!Array.isArray(value)||value.length!==2||typeof value[0]!=='number'||!Number.isSafeInteger(value[0])||value[0]<start||value[0]>windowEnd||(value[0]-start)%stepSeconds||typeof value[1]!=='string'||!value[1].trim())onlineFail('PROVIDER_SAMPLE');
      const n=Number(value[1]);if(!Number.isFinite(n)||map.has(value[0]))onlineFail('PROVIDER_SAMPLE');map.set(value[0],n);
     }
     maps.push(map);
    }catch(error){if(controller.signal.aborted)onlineFail('PROVIDER_TIMEOUT');throw error;}finally{clearTimeout(timer);}
   }
  }catch(error){const code=(error as {code?:unknown}).code;reasons.push(typeof code==='string'&&/^(PROVIDER|ONLINE_CREDENTIAL)_[A-Z_]+$/.test(code)?code:'PROVIDER_UNAVAILABLE');}
  const points:OnlinePoint[]=[];
  if(maps.length===4)for(let time=start;time<=windowEnd;time+=stepSeconds){
   const values=maps.map(map=>map.get(time));if(values.some(v=>v===undefined)){reasons.push('MISSING_SAMPLES');continue;}
   const [g,t,gs,ts]=values as [number,number,number,number];
   if(time-gs>connection.freshnessSeconds||time-ts>connection.freshnessSeconds)reasons.push('STALE_SAMPLES');
   points.push({time,good:g,total:t,goodSourceTime:gs,totalSourceTime:ts});
  }
  const body=measurementBody(binding,windowEnd,points,reasons,responseDigests);
  return nativeFrozenClone({...body,digest:nativeSha256(body)});
 };
}
