import {timingSafeEqual} from 'node:crypto';
import {nativeAssertJSON,nativeExact,nativeSha256,nativeFrozenClone} from '../vendor/compatibility/v1/native.mjs';
import {onlineFail,onlineSlug,ONLINE_LIMITS} from '../vendor/compatibility/online/v1/online.mjs';
import type {OnlineAlert,OnlineAlertBatch} from '../vendor/compatibility/online/v1/online.mjs';
import {readOnlineSecret} from './online-prometheus.js';
export interface AlertmanagerConnection {id:string;bearerTokenFile:string}
function labels(value:unknown):Record<string,string>{
 nativeAssertJSON(value);if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>64)onlineFail('ALERT_LABELS');
 for(const [key,item]of Object.entries(value))if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)||key.length>128||typeof item!=='string'||Buffer.byteLength(item)>2048)onlineFail('ALERT_LABELS');
 return value as Record<string,string>;
}
/** Only authenticated HTTP ingress can populate this trusted readback provider.
 * The caller acknowledges HTTP only after consume commits owner evidence. */
export function createAlertmanagerReceiver(connections:readonly AlertmanagerConnection[]) {
 const configs=new Map<string,AlertmanagerConnection>(),receipts=new Map<string,OnlineAlertBatch>();
 for(const input of connections){nativeExact(input,['id','bearerTokenFile']);onlineSlug(input.id);if(configs.has(input.id)||configs.size>=ONLINE_LIMITS.bindings||typeof input.bearerTokenFile!=='string')onlineFail('ALERT_CONFIGURATION');configs.set(input.id,nativeFrozenClone(input));}
 async function receive(sourceId:string,authorization:string|undefined,body:Buffer,consume:(batch:OnlineAlertBatch)=>Promise<unknown>):Promise<unknown>{
  const config=configs.get(sourceId);if(!config)onlineFail('ALERT_UNAUTHORIZED');
  const expected=Buffer.from('Bearer '+readOnlineSecret(config.bearerTokenFile)),actual=Buffer.from(authorization??'');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))onlineFail('ALERT_UNAUTHORIZED');
  if(body.byteLength>ONLINE_LIMITS.responseBytes)onlineFail('ALERT_BODY_LIMIT');
  let value:unknown;try{value=JSON.parse(body.toString('utf8'));}catch{onlineFail('ALERT_JSON');}
  nativeAssertJSON(value);nativeExact(value,['version','groupKey','truncatedAlerts','status','receiver','groupLabels','commonLabels','commonAnnotations','externalURL','alerts']);
  if(value.version!=='4'||value.truncatedAlerts!==0||!['firing','resolved'].includes(String(value.status))||!Array.isArray(value.alerts)||!value.alerts.length||value.alerts.length>ONLINE_LIMITS.alerts)onlineFail('ALERT_PAYLOAD');
  for(const key of ['groupKey','receiver','externalURL']as const)if(typeof value[key]!=='string'||Buffer.byteLength(value[key])>4096)onlineFail('ALERT_PAYLOAD');
  labels(value.groupLabels);labels(value.commonLabels);labels(value.commonAnnotations);
  const alerts:OnlineAlert[]=value.alerts.map(raw=>{
   nativeExact(raw,['status','labels','annotations','startsAt','endsAt','generatorURL','fingerprint']);
   if(!['firing','resolved'].includes(String(raw.status))||typeof raw.fingerprint!=='string'||!/^[a-f0-9]{16}$/.test(raw.fingerprint)||typeof raw.startsAt!=='string'||typeof raw.endsAt!=='string'||typeof raw.generatorURL!=='string'||raw.generatorURL.length>4096)onlineFail('ALERT_PAYLOAD');
   labels(raw.annotations);const startsAt=Math.floor(Date.parse(raw.startsAt)/1000),end=Math.floor(Date.parse(raw.endsAt)/1000);
   if(!Number.isSafeInteger(startsAt)||startsAt<0||startsAt>Math.floor(Date.now()/1000)+300||!Number.isSafeInteger(end)||raw.status==='resolved'&&(end<startsAt||end>Math.floor(Date.now()/1000)+300))onlineFail('ALERT_TIME');
   const alert={fingerprint:raw.fingerprint,state:raw.status==='firing'?'FIRING' as const:'RESOLVED' as const,startsAt,endsAt:raw.status==='resolved'?end:null,labels:labels(raw.labels)};
   return {...alert,digest:nativeSha256(alert)};
  });
  const subject={schema:'evopilot-alertmanager-receipt/v1' as const,sourceId,payloadDigest:nativeSha256(value),alerts};const batch=nativeFrozenClone({...subject,digest:nativeSha256(subject)});
  const key=sourceId+':'+batch.digest;
  if(receipts.has(key))onlineFail('ALERT_IN_PROGRESS');if(receipts.size>=128)onlineFail('ALERT_BUSY');
  receipts.set(key,batch);try{return await consume(batch);}finally{receipts.delete(key);}
 }
 async function inspect({sourceId,digest}:{sourceId:string;digest:string}):Promise<OnlineAlertBatch>{const value=receipts.get(sourceId+':'+digest);if(!value)onlineFail('ALERT_UNVERIFIED');return nativeFrozenClone(value);}
 return Object.freeze({receive,inspect});
}
