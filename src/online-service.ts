import {nativeAssertJSON,nativeExact,nativeSha256,nativeFrozenClone,nativeDigest} from '../vendor/compatibility/v1/native.mjs';
import type {NativeScope,NativePackage,NativeJSON} from '../vendor/compatibility/v1/native.mjs';
import {verifyDecisionEvidence} from '../vendor/compatibility/v1/decision-evidence.mjs';
import {createFeedbackStore,feedbackScope,feedbackBounded} from '../vendor/compatibility/feedback/v1/feedback.mjs';
import {ONLINE_LIMITS,onlineFail,onlineSlug,onlineEqual,inspectOnlineSLO,validateOnlineBindingSpec,validateOnlineMeasurement,measurementBody} from '../vendor/compatibility/online/v1/online.mjs';
import type {OnlineEnvelope,OnlineBinding,OnlineBindingSpec,OnlineObservation,OnlineFinding,OnlineMeasurement,OnlineAlertBatch} from '../vendor/compatibility/online/v1/online.mjs';
import type {Store,Providers} from './types.js';
import {executeNativeHarness} from './native-service.js';
import {inspectHarnessPackage} from './native-package.js';
import {validateNativeHarness} from './native-evaluation.js';
import {inspectOnlineStandard} from './online-standard.js';

export const ONLINE_OPERATIONS=['online.inspect','online.binding.put','online.binding.inspect','online.binding.decide','online.binding.select','online.evaluate','online.observation.inspect','online.tick','online.alert.ingest','online.finding.inspect','online.finding.deliver','online.incident.inspect','online.regression.verify','online.receipt.inspect'] as const;
interface PendingWindow {id:string;bindingId:string;bindingDigest:string;windowEnd:number}
interface FindingRecord {finding:OnlineFinding;delivery:{id:string;digest:string}|null;error:string|null}
interface Incident {id:string;bindingId:string;history:string[];state:'FIRING'|'RESOLVED';at:number}
const fields:Record<typeof ONLINE_OPERATIONS[number],string[]>={
 'online.inspect':[],'online.binding.put':['spec'],'online.binding.inspect':['id'],'online.binding.decide':['id','reviewDigest','decision','humanEvidenceRef'],'online.binding.select':['id','selected'],
 'online.evaluate':['id','windowEnd'],'online.observation.inspect':['id'],'online.tick':[],'online.alert.ingest':['sourceId','digest'],'online.finding.inspect':['id'],'online.finding.deliver':['id'],'online.incident.inspect':['id'],'online.regression.verify':['faultId','recoveryId'],'online.receipt.inspect':['requestId']
};
const mutations=new Set(['online.binding.put','online.binding.decide','online.binding.select','online.evaluate','online.alert.ingest','online.regression.verify']);
export function createOnlineHarness(store:Store,providers:Providers) {
 const records=createFeedbackStore(store,'harness',4),inFlight=new Map<string,Promise<OnlineObservation>>();
 function required<T>(scope:NativeScope,kind:string,id:string):T {const value=records.get<T>(scope,kind,id);if(!value)onlineFail('ONLINE_NOT_FOUND');return value;}
 function binding(scope:NativeScope,id:string):OnlineBinding {onlineSlug(id);return required(scope,'online-binding',id);}
 function transition(scope:NativeScope,intent:unknown,fn:()=>unknown):unknown {
  store.guard();store.db.exec('BEGIN IMMEDIATE');try{const result=fn();records.recordTransition(intent,result);store.db.exec('COMMIT');return result;}catch(e){store.db.exec('ROLLBACK');throw e;}
 }
 async function policy(spec:OnlineBindingSpec,scope:NativeScope):Promise<NativePackage>{
  const scopes=spec.policy.visibility==='private'?[scope]:[...new Set([scope.projectId,'shared'])].map(projectId=>({visibility:'public' as const,projectId}));
  if(scope.visibility==='public'&&spec.policy.visibility==='private')onlineFail('ONLINE_SCOPE');
  const found:NativePackage[]=[];
  for(const ownerScope of scopes){
   try{const value=await executeNativeHarness(store,{operation:'native.package.readback',scope:ownerScope,input:{id:spec.policy.id,version:spec.policy.version}},providers) as {reference:unknown;package:NativePackage;published:boolean;workspaceId:string};
    if(!onlineEqual(value.reference,spec.policy)||value.published!==true||value.workspaceId!==store.identity.id)onlineFail('ONLINE_POLICY_MISMATCH');found.push(value.package);
   }catch(error){if(!['NOT_FOUND','NOT_PUBLISHED'].includes(String((error as {code?:unknown}).code)))throw error;}
  }
  if(found.length!==1)onlineFail('ONLINE_PUBLISHED_POLICY_REQUIRED');
  const inspected=inspectHarnessPackage(found[0]);const slo=inspectOnlineSLO(spec.slo);
  if(inspected.parameters.onlineTarget!==slo.target||!inspected.catalog.some(r=>r.required&&r.inputRefs.includes('/values/online/ratio')&&r.parameterRefs.includes('onlineTarget')))onlineFail('ONLINE_POLICY_TARGET_MISMATCH');
  return found[0];
 }
 function addFinding(scope:NativeScope,value:Omit<OnlineFinding,'digest'>):OnlineFinding {
  const finding={...value,digest:nativeSha256(value)},existing=records.get<FindingRecord>(scope,'online-finding',finding.id);
  if(existing){if(!onlineEqual(existing.finding,finding))onlineFail('ONLINE_FINDING_CONFLICT');return existing.finding;}
  records.put(scope,'online-finding',finding.id,{finding,delivery:null,error:null});
  const prior=records.get<Incident>(scope,'online-incident',finding.incidentId),history=[...(prior?.history??[]),finding.id];
  const latest=!prior||finding.at>prior.at||finding.at===prior.at&&finding.state==='RESOLVED';
  records.put(scope,'online-incident',finding.incidentId,{id:finding.incidentId,bindingId:finding.bindingId,history,state:latest?finding.state:prior.state,at:latest?finding.at:prior.at});return finding;
 }
 function findingBody(b:OnlineBinding,source:OnlineFinding['source'],state:OnlineFinding['state'],at:number,causeId:string,evidenceDigest:string,incidentId:string):Omit<OnlineFinding,'digest'>{
  return {schema:'evopilot-online-finding/v1',id:nativeSha256({binding:b.reviewDigest,source,state,causeId}),workspaceId:store.identity.id,scope:b.scope,bindingId:b.spec.id,bindingDigest:b.reviewDigest,serviceId:b.spec.serviceId,environment:b.spec.environment,deploymentRevision:b.spec.deploymentRevision,policy:b.spec.policy,incidentId,source,state,at,evidenceDigest,causeId,candidate:{kind:'regression',status:'REVIEW_REQUIRED'}};
 }
 async function collectWindow(scope:NativeScope,pending:PendingWindow):Promise<OnlineObservation>{
  const prior=records.get<OnlineObservation>(scope,'online-observation',pending.id);if(prior)return nativeFrozenClone(prior);
  const b=binding(scope,pending.bindingId);if(b.reviewDigest!==pending.bindingDigest||b.onlineStandardDigest!==inspectOnlineStandard().digest)onlineFail('ONLINE_BINDING_CHANGED');
  if(!b.selected||b.decision?.decision!=='APPROVE')onlineFail('ONLINE_NOT_SELECTED');
  const pkg=await policy(b.spec,scope);let measurement:OnlineMeasurement;
  try{
   if(!providers.collectOnline)onlineFail('ONLINE_PROVIDER_UNAVAILABLE');
   measurement=await feedbackBounded(()=>providers.collectOnline!({binding:nativeFrozenClone(b),windowEnd:pending.windowEnd}),ONLINE_LIMITS.timeoutMs*4+1000);
   validateOnlineMeasurement(measurement,b,pending.windowEnd);
  }catch(error){const code=String((error as {code?:unknown}).code??'ONLINE_COLLECTION_ERROR');const body=measurementBody(b,pending.windowEnd,[],[/^[A-Z_]{1,64}$/.test(code)?code:'ONLINE_COLLECTION_ERROR'],[]);measurement={...body,digest:nativeSha256(body)};}
  let nativeReport:NativeJSON|null=null,outcome:OnlineObservation['outcome']='INCOMPLETE',diagnostic:string|null=null;
  if(measurement.status==='COMPLETE'){
   try{
    if(!providers.nativeToolchain)onlineFail('ONLINE_NATIVE_TOOLCHAIN_REQUIRED');
    const report=await validateNativeHarness(pkg,providers.nativeToolchain,{observation:{schema:'evopilot-observation/v1',origin:'runtime-observation',source:{revision:b.spec.deploymentRevision,digest:measurement.digest},values:{online:{ratio:measurement.ratio,target:b.slo.target,windowStart:measurement.windowStart,windowEnd:measurement.windowEnd,service:b.spec.serviceId,environment:b.spec.environment,deployment:b.spec.deploymentRevision,bindingDigest:b.reviewDigest,measurementDigest:measurement.digest}}}});
    nativeReport=JSON.parse(JSON.stringify(report)) as NativeJSON;
    outcome=report.executionStatus!=='SUCCEEDED'?'INCOMPLETE':report.qualityStatus==='PASS'&&measurement.ratio!==null&&measurement.ratio>=b.slo.target?'PASS':'FAIL';
   }catch(error){diagnostic=String((error as {code?:unknown}).code??'ONLINE_NATIVE_ERROR');}
  }
  const body={id:pending.id,bindingId:b.spec.id,bindingDigest:b.reviewDigest,workspaceId:store.identity.id,scope,windowEnd:pending.windowEnd,measurement,policy:b.spec.policy,nativeReport,outcome,diagnostic};const observation:OnlineObservation={...body,digest:nativeSha256(body)};
  return transition(scope,{operation:'online.window.complete',id:pending.id},()=>{
   const retained=records.get<OnlineObservation>(scope,'online-observation',pending.id);if(retained)return retained;
   records.put(scope,'online-observation',pending.id,observation);
   if(outcome!=='INCOMPLETE'){
    const incidentId=nativeSha256({binding:b.reviewDigest,source:'evaluation'}),priorIncident=records.get<Incident>(scope,'online-incident',incidentId);
    // A healthy window is evidence; it resolves only an already-observed incident.
    if(outcome==='FAIL'||priorIncident)addFinding(scope,findingBody(b,'evaluation',outcome==='FAIL'?'FIRING':'RESOLVED',pending.windowEnd,pending.id,observation.digest,incidentId));
   }
   const current=binding(scope,b.spec.id);current.lastWindowEnd=Math.max(current.lastWindowEnd??0,pending.windowEnd);
   if(current.nextWindowEnd===pending.windowEnd)current.nextWindowEnd+=current.spec.intervalSeconds;
   records.put(scope,'online-binding',current.spec.id,current);return observation;
  }) as OnlineObservation;
 }
 async function resume(scope:NativeScope,pending:PendingWindow):Promise<OnlineObservation>{
  const key=nativeSha256({scope,id:pending.id});let result=inFlight.get(key);if(!result){result=collectWindow(scope,pending);inFlight.set(key,result);}
  try{return await result;}finally{inFlight.delete(key);}
 }
 async function deliver(scope:NativeScope,id:string):Promise<FindingRecord>{
  const record=required<FindingRecord>(scope,'online-finding',id);if(record.delivery)return record;
  if(!providers.deliverOnlineFinding||!providers.readOnlineRepair)onlineFail('ONLINE_RUNTIME_UNAVAILABLE');
  let delivery:FindingRecord['delivery']=null,error:string|null=null;
  try{
   // Inspect before replaying an uncertain Runtime response.
   let candidate=await feedbackBounded(()=>providers.readOnlineRepair!({scope,id:record.finding.incidentId}));
   if(!candidate?.history.some(x=>x.digest===record.finding.digest)){await feedbackBounded(()=>providers.deliverOnlineFinding!(record.finding));candidate=await feedbackBounded(()=>providers.readOnlineRepair!({scope,id:record.finding.incidentId}));}
   if(!candidate||candidate.workspaceId!==store.identity.id||!onlineEqual(candidate.scope,scope)||!candidate.history.some(x=>x.digest===record.finding.digest)||candidate.requestedVersion!==null||candidate.softwareRelease!==false||candidate.ontologyMutation!==false)onlineFail('ONLINE_REPAIR_MISMATCH');
   delivery={id:candidate.id,digest:candidate.digest};
  }catch(e){error=String((e as {code?:unknown}).code??'ONLINE_DELIVERY_ERROR');}
  return transition(scope,{operation:'online.finding.delivery',id},()=>{const current=required<FindingRecord>(scope,'online-finding',id);if(!current.delivery){current.delivery=delivery;current.error=error;records.put(scope,'online-finding',id,current);}return current;}) as FindingRecord;
 }
 async function online(request:OnlineEnvelope):Promise<unknown>{
  nativeAssertJSON(request);const op=request.operation as typeof ONLINE_OPERATIONS[number];if(!ONLINE_OPERATIONS.includes(op))onlineFail('ONLINE_OPERATION');
  nativeExact(request,['operation','scope','input',...(mutations.has(op)?['requestId','expectedRevision']:[])]);feedbackScope(request.scope);nativeExact(request.input,fields[op]);store.guard();
  const {scope,input}=request;
  if(op==='online.inspect')return nativeFrozenClone({...records.inspect(scope),standard:inspectOnlineStandard(),bindings:records.list<OnlineBinding>(scope,'online-binding'),observations:records.list<OnlineObservation>(scope,'online-observation').map(({id,bindingId,windowEnd,outcome,digest})=>({id,bindingId,windowEnd,outcome,digest})),incidents:records.list<Incident>(scope,'online-incident'),findings:records.list<FindingRecord>(scope,'online-finding').map(r=>({id:r.finding.id,incidentId:r.finding.incidentId,state:r.finding.state,at:r.finding.at,delivery:r.delivery,error:r.error})),limits:ONLINE_LIMITS,softwareRelease:false});
  if(op==='online.receipt.inspect'){if(typeof input.requestId!=='string')onlineFail('ONLINE_REQUEST');return records.receipt(scope,input.requestId);}
  if(op==='online.binding.inspect')return nativeFrozenClone(binding(scope,String(input.id)));
  if(op==='online.observation.inspect'||op==='online.finding.inspect'||op==='online.incident.inspect'){
   nativeDigest(input.id);const kind=op==='online.observation.inspect'?'online-observation':op==='online.finding.inspect'?'online-finding':'online-incident';const value=required(scope,kind,input.id);return nativeFrozenClone(op==='online.finding.inspect'?(value as FindingRecord).finding:value);
  }
  if(op==='online.binding.put'){
   validateOnlineBindingSpec(input.spec);const spec=nativeFrozenClone(input.spec);await policy(spec,scope);const slo=inspectOnlineSLO(spec.slo);
   const onlineStandardDigest=inspectOnlineStandard().digest,reviewDigest=nativeSha256({workspaceId:store.identity.id,scope,spec,slo,onlineStandardDigest});
   return records.mutate(request,()=>{const prior=records.get<OnlineBinding>(scope,'online-binding',spec.id);if(prior){if(prior.reviewDigest!==reviewDigest)onlineFail('ONLINE_IMMUTABLE_BINDING');return prior;}
    if(records.list(scope,'online-binding').length>=ONLINE_LIMITS.bindings)onlineFail('ONLINE_BINDING_LIMIT');
    const value:OnlineBinding={workspaceId:store.identity.id,scope,spec,slo,onlineStandardDigest,reviewDigest,decision:null,selected:false,nextWindowEnd:null,lastWindowEnd:null};records.put(scope,'online-binding',spec.id,value);return value;});
  }
  if(op==='online.binding.decide')return records.mutate(request,()=>{const b=binding(scope,String(input.id));if(input.reviewDigest!==b.reviewDigest||!['APPROVE','REJECT'].includes(String(input.decision))||typeof input.humanEvidenceRef!=='string')onlineFail('ONLINE_DECISION');
   const decision=input.decision as 'APPROVE'|'REJECT';verifyDecisionEvidence(input.humanEvidenceRef,{owner:'harness',operation:op,workspaceId:store.identity.id,scope,reviewDigest:b.reviewDigest,decision});
   const subject={decision,reviewDigest:b.reviewDigest,humanEvidenceRef:input.humanEvidenceRef};const value={...subject,digest:nativeSha256(subject)};
   if(b.decision&&!onlineEqual(b.decision,value))onlineFail('ONLINE_IMMUTABLE_DECISION');b.decision=value;records.put(scope,'online-binding',b.spec.id,b);return b;});
  if(op==='online.binding.select')return records.mutate(request,()=>{const b=binding(scope,String(input.id));if(typeof input.selected!=='boolean')onlineFail('ONLINE_SELECTION');if(input.selected&&b.decision?.decision!=='APPROVE')onlineFail('ONLINE_APPROVAL_REQUIRED');b.selected=input.selected;if(b.nextWindowEnd===null&&b.selected)b.nextWindowEnd=Math.floor((Date.now()/1000-1)/b.slo.stepSeconds)*b.slo.stepSeconds;records.put(scope,'online-binding',b.spec.id,b);return b;});
  if(op==='online.evaluate'){
   const claim=records.mutate(request,()=>{const b=binding(scope,String(input.id));if(!b.selected||b.decision?.decision!=='APPROVE')onlineFail('ONLINE_NOT_SELECTED');
    const end=input.windowEnd;if(typeof end!=='number'||!Number.isSafeInteger(end)||end<b.slo.windowSeconds||end% b.slo.stepSeconds||end>Math.floor(Date.now()/1000))onlineFail('ONLINE_WINDOW');
    const id=nativeSha256({binding:b.reviewDigest,windowEnd:end}),pending:PendingWindow={id,bindingId:b.spec.id,bindingDigest:b.reviewDigest,windowEnd:end};records.put(scope,'online-window',id,pending);return pending;});
   return {claim,observation:await resume(scope,claim.result)};
  }
  if(op==='online.tick'){
   const now=Math.floor(Date.now()/1000)-1,completed:string[]=[];let backlog=0;
   for(const b of records.list<OnlineBinding>(scope,'online-binding').filter(b=>b.selected)){
    let current=b;while(current.nextWindowEnd!==null&&current.nextWindowEnd<=now&&completed.length<ONLINE_LIMITS.backlogPerTick){
     const end=current.nextWindowEnd,id=nativeSha256({binding:current.reviewDigest,windowEnd:end});
     await online({operation:'online.evaluate',scope,input:{id:b.spec.id,windowEnd:end},requestId:'online-window-'+id.slice(7),expectedRevision:records.inspect(scope).revision});completed.push(id);current=binding(scope,b.spec.id);
    }
    if(current.nextWindowEnd!==null&&current.nextWindowEnd<=now)backlog+=Math.floor((now-current.nextWindowEnd)/current.spec.intervalSeconds)+1;
   }
   const deliveries=[];for(const r of records.list<FindingRecord>(scope,'online-finding').filter(r=>!r.delivery).slice(0,ONLINE_LIMITS.backlogPerTick))deliveries.push(await deliver(scope,r.finding.id));
   return {completed,backlog,status:backlog?'INCOMPLETE_BACKLOG':'CAUGHT_UP',deliveries,authority:false};
  }
  if(op==='online.alert.ingest'){
   onlineSlug(input.sourceId);nativeDigest(input.digest);if(!providers.inspectOnlineAlert)onlineFail('ALERT_PROVIDER_REQUIRED');
   const batch:OnlineAlertBatch=await feedbackBounded(()=>providers.inspectOnlineAlert!({sourceId:input.sourceId as string,digest:input.digest as string}));
   const {digest,...body}=batch;if(digest!==input.digest||batch.sourceId!==input.sourceId||digest!==nativeSha256(body)||batch.schema!=='evopilot-alertmanager-receipt/v1'||!batch.alerts.length||batch.alerts.length>ONLINE_LIMITS.alerts)onlineFail('ALERT_RECEIPT_MISMATCH');
   return records.mutate(request,()=>{
    const selected=records.list<OnlineBinding>(scope,'online-binding').filter(b=>b.selected&&b.decision?.decision==='APPROVE'&&b.spec.alertSourceId===batch.sourceId);const found:OnlineFinding[]=[];
    for(const a of batch.alerts){const matched=selected.filter(b=>a.labels.service===b.spec.serviceId&&a.labels.environment===b.spec.environment&&a.labels.deployment===b.spec.deploymentRevision);if(!matched.length)onlineFail('ALERT_SERVICE_MISMATCH');
     for(const b of matched){const incidentId=nativeSha256({binding:b.reviewDigest,source:'alertmanager',fingerprint:a.fingerprint,startsAt:a.startsAt});found.push(addFinding(scope,findingBody(b,'alertmanager',a.state,a.state==='RESOLVED'?a.endsAt!:a.startsAt,a.digest,batch.payloadDigest,incidentId)));}
    }return {batchDigest:batch.digest,findings:found};
   });
  }
  if(op==='online.finding.deliver'){nativeDigest(input.id);return deliver(scope,input.id);}
  if(op==='online.regression.verify')return records.mutate(request,()=>{
   nativeDigest(input.faultId);nativeDigest(input.recoveryId);const fault=required<OnlineObservation>(scope,'online-observation',input.faultId),recovery=required<OnlineObservation>(scope,'online-observation',input.recoveryId);
   if(fault.bindingDigest!==recovery.bindingDigest||fault.windowEnd>=recovery.windowEnd||fault.outcome!=='FAIL'||recovery.outcome!=='PASS'||!fault.nativeReport||!recovery.nativeReport)onlineFail('ONLINE_REGRESSION_EVIDENCE');
   const f=fault.nativeReport as Record<string,NativeJSON>,r=recovery.nativeReport as Record<string,NativeJSON>;
   if(f.executionStatus!=='SUCCEEDED'||f.qualityStatus!=='FAIL'||r.executionStatus!=='SUCCEEDED'||r.qualityStatus!=='PASS')onlineFail('ONLINE_REGRESSION_POLICY');
   const body={bindingDigest:fault.bindingDigest,policy:fault.policy,fault:{id:fault.id,digest:fault.digest,reportDigest:f.reportDigest,outcome:'FAIL'},recovery:{id:recovery.id,digest:recovery.digest,reportDigest:r.reportDigest,outcome:'PASS'},status:'REVIEW_REQUIRED',policyMutation:false,ontologyMutation:false};const result={...body,digest:nativeSha256(body)};records.put(scope,'online-regression',result.digest,result);return result;
  });
  onlineFail('ONLINE_OPERATION');
 }
 return Object.freeze({online,busy:()=>inFlight.size>0});
}
