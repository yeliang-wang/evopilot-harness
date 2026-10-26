import {nativeSha256,nativeBytesDigest,nativeFrozenClone,nativeStableSerialize,nativeDigest,nativeText} from '../vendor/compatibility/v1/native.mjs';
import type {NativeScope,NativeReference} from '../vendor/compatibility/v1/native.mjs';
import {createFeedbackStore,feedbackScope,feedbackBounded} from '../vendor/compatibility/feedback/v1/feedback.mjs';
import type {FeedbackEnvelope} from '../vendor/compatibility/feedback/v1/feedback.mjs';
import {readinessExact as nativeExact,READINESS_STANDARD,READINESS_STANDARD_DIGEST,boundedReadiness,assertReadinessVersion,readinessCriteria,validateReadinessReview,validateReadinessIntent,verifyReadinessProjection,noReconstruction,validateReadinessReconstruction,readinessId,readinessFail as fail} from '../vendor/compatibility/usability/v2/contract.mjs';
import type {ReadinessIntentRecord,ReadinessProjection,ReadinessReview,ReadinessResult,ReadinessReconstruction} from '../vendor/compatibility/usability/v2/contract.mjs';
import type {Store} from './types.js';
export interface ReadinessHarnessProviders {
  readReadinessIntent?:(context:{workspaceId:string;scope:NativeScope;digest:string})=>Promise<ReadinessIntentRecord&{current:boolean}>;
  readReadinessProjection?:(context:{workspaceId:string;scope:NativeScope;reference:NativeReference})=>Promise<ReadinessProjection>;
  readReadinessReconstruction?:(context:{workspaceId:string;scope:NativeScope;evidenceIds:string[];reference:NativeReference})=>Promise<ReadinessReconstruction>;
}
export const READINESS_HARNESS_OPERATIONS=['readiness.standard.inspect','readiness.inspect','readiness.review.prepare','readiness.review.record','readiness.assessment.evaluate','readiness.assessment.read','readiness.assessment.version','readiness.assessment.list','readiness.gap.record','readiness.receipt.inspect'] as const;
interface AssessmentHead {id:string;intentDigest:string;reference:NativeReference;resultDigest:string;history:string[];reconstructionEvidenceIds:string[]}
const same=(a:unknown,b:unknown)=>nativeStableSerialize(a)===nativeStableSerialize(b);
/** Content checks plus criterion-level review evidence; never accepts a requested grade. */
export function assessReadinessContent(intent:ReadinessIntentRecord,projection:ReadinessProjection,review:ReadinessReview|null,knownGaps:{criterionId:string;code:string}[]=[],candidate=false):ReadinessResult['assetAssessment']{
  const i=validateReadinessIntent(intent.definition);verifyReadinessProjection(projection);const s=projection.specification;
  if(nativeSha256(i)!==intent.digest||s.intentDigest!==intent.digest||i.workspaceId!==projection.workspaceId||!same(i.scope,projection.scope))fail('READINESS_SCOPE');
  const required=readinessCriteria(i),requiredSet=new Set(required),gaps=[...knownGaps];
  const statementMap=new Map(s.statements.map(r=>[r.criterionId,r])),reviewMap=new Map(review?.results.map(r=>[r.criterionId,r])??[]),fileHashes=new Map(Object.entries(projection.files).map(([p,c])=>[p,nativeBytesDigest(c)]));
  const add=(criterionId:string,code:string)=>gaps.push({criterionId,code});
  if(!candidate&&!projection.published)add('package','READINESS_UNPUBLISHED');
  if(s.statements.some(x=>!requiredSet.has(x.criterionId)))fail('READINESS_UNDECLARED_REQUIREMENT');
  if(review){validateReadinessReview(review);if(review.intentDigest!==intent.digest||review.projectionDigest!==projection.digest||review.results.some(r=>!requiredSet.has(r.criterionId)))fail('READINESS_REVIEW_DRIFT');}
  for(const id of required){
    const row=statementMap.get(id),r=reviewMap.get(id);
    if(!row){add(id,'READINESS_MISSING_SPECIFICATION');continue;}
    if(row.status!=='RESOLVED')add(id,'READINESS_'+row.status);
    if(!row.citations.length||!row.provenance.length)add(id,'READINESS_MISSING_PROVENANCE');
    for(const p of row.provenance){const source=i.sources.find(s=>s.id===p.sourceId);if(!source)add(id,'READINESS_UNKNOWN_SOURCE');
      if(p.kind==='INFERENCE'&&!p.resolutionReference)add(id,'READINESS_UNRESOLVED_INFERENCE');
      if(p.kind==='SOURCE_FACT'&&source?.kind!=='SOURCE')add(id,'READINESS_PROVENANCE_CONFLICT');
      if(p.kind==='USER_DECISION'&&source?.kind!=='USER_DECISION')add(id,'READINESS_PROVENANCE_CONFLICT');
    }
    for(const c of row.citations)if(typeof projection.files[c.path]!=='string'||fileHashes.get(c.path)!==c.contentDigest)add(id,'READINESS_CITATION');
    if(!r||r.verdict!=='SUPPORTED'||!r.citations.length)add(id,'READINESS_REVIEW_'+(r?.verdict??'MISSING'));
    else for(const c of r.citations)if(typeof projection.files[c.path]!=='string'||fileHashes.get(c.path)!==c.contentDigest)add(id,'READINESS_REVIEW_EVIDENCE');
  }
  // N/A is itself reviewed evidence; no absent field or blanket omission exempts a criterion.
  for(const b of i.targetLevel==='L1'?[]:i.requirements)for(const f of b.excludedFacets){const id='behavior:'+b.id+':'+f.facet,sr=s.statements.find(s=>s.criterionId===id);if(!sr||!sr.text.includes(f.reason)||!sr.provenance.some(p=>p.resolutionReference===f.reviewReference))add(id,'READINESS_APPLICABILITY_UNREVIEWED');}
  if(i.targetLevel==='L3'&&!s.normativeFiles.length)add('closure:C08','READINESS_EMPTY_PACKAGE');
  const unique=[...new Map(gaps.map(g=>[g.criterionId+'\0'+g.code,g])).values()];
  return {level:unique.length?null:i.targetLevel,status:unique.some(g=>/CONFLICT|CONFIRMED_DEFECT/.test(g.code))?'FAILED':unique.length?'INCOMPLETE':'QUALIFIED',freshness:'CURRENT',gaps:unique,required:required.length,reviewDigest:review?nativeSha256(review):null,evidenceOrigin:review?.origin??null};
}
export function createHarnessReadiness(store:Store,providers:ReadinessHarnessProviders){
  const records=createFeedbackStore(store,'harness');
  const get=<T>(scope:NativeScope,kind:string,id:string):T=>{const r=records.get<T>(scope,'readiness-'+kind,id);if(!r)fail('READINESS_NOT_FOUND');return r;};
  const mutate=(request:FeedbackEnvelope,fn:()=>unknown)=>records.mutate(request,()=>{store.db.exec('PRAGMA user_version=8');return fn();});
  async function material(scope:NativeScope,intentDigest:string,reference:NativeReference){
    if(!providers.readReadinessIntent||!providers.readReadinessProjection)fail('READINESS_PROVIDER_REQUIRED');
    const context={workspaceId:store.identity.id,scope};
    const intent=await feedbackBounded(()=>providers.readReadinessIntent!({...context,digest:intentDigest}));
    const projection=await feedbackBounded(()=>providers.readReadinessProjection!({...context,reference}));
    if(intent.definition.workspaceId!==store.identity.id||!same(intent.definition.scope,scope)||intent.digest!==intentDigest||projection.workspaceId!==store.identity.id||!same(projection.scope,scope)||!same(projection.reference,reference))fail('READINESS_SCOPE');
    verifyReadinessProjection(projection);return {intent,projection};
  }
  async function readiness(request:FeedbackEnvelope):Promise<unknown>{
    boundedReadiness(request);feedbackScope(request.scope);const {operation,input,scope}=request;assertReadinessVersion(input.standardVersion);
    if(!READINESS_HARNESS_OPERATIONS.includes(operation as typeof READINESS_HARNESS_OPERATIONS[number]))fail('READINESS_OPERATION');
    const writes=new Set(['readiness.review.record','readiness.assessment.evaluate','readiness.gap.record']);
    if(writes.has(operation)&&request.requestId&&records.receipt(scope,request.requestId))return records.mutate(request,()=>fail('READINESS_RECEIPT_INTEGRITY'));
    if(!writes.has(operation))nativeExact(request,['operation','scope','input']);
    if(operation==='readiness.standard.inspect'){nativeExact(input,['standardVersion']);return {...READINESS_STANDARD,standardDigest:READINESS_STANDARD_DIGEST,authority:false};}
    if(operation==='readiness.inspect'){nativeExact(input,['standardVersion']);return records.inspect(scope);}
    if(operation==='readiness.receipt.inspect'){nativeExact(input,['standardVersion','requestId']);nativeText(input.requestId);return records.receipt(scope,input.requestId);}
    if(operation==='readiness.assessment.version'){nativeExact(input,['standardVersion','digest']);nativeDigest(input.digest);return get<ReadinessResult>(scope,'result',input.digest);}
    if(operation==='readiness.assessment.list'){nativeExact(input,['standardVersion']);return {items:records.list<AssessmentHead>(scope,'readiness-head'),aggregateLevel:null,authority:false};}
    if(operation==='readiness.gap.record'){
      nativeExact(input,['standardVersion','projectionDigest','criterionId','reason','evidenceDigest']);nativeDigest(input.projectionDigest);nativeDigest(input.evidenceDigest);nativeText(input.criterionId);nativeText(input.reason);
      return mutate(request,()=>{const g={criterionId:input.criterionId as string,code:'READINESS_CONFIRMED_DEFECT',reason:input.reason,evidenceDigest:input.evidenceDigest,projectionDigest:input.projectionDigest};records.put(scope,'readiness-gap',nativeSha256(g),g);return g;});
    }
    if(operation==='readiness.review.prepare'||operation==='readiness.review.record'){
      nativeExact(input,['standardVersion','reference','report']);const report=validateReadinessReview(input.report),{intent,projection}=await material(scope,report.intentDigest,input.reference as NativeReference);
      if(!intent.current||report.projectionDigest!==projection.digest)fail('READINESS_REVIEW_DRIFT');
      const defects=records.list<{projectionDigest:string;criterionId:string;code:string}>(scope,'readiness-gap').filter(g=>g.projectionDigest===projection.digest);
      const check=assessReadinessContent(intent,projection,report,defects.map(({criterionId,code})=>({criterionId,code})),true),digest=nativeSha256(report);
      if(operation==='readiness.review.prepare')return {report,reviewDigest:digest,candidateContent:check,published:projection.published,authority:false,softwareRelease:false};
      return mutate(request,()=>{records.put(scope,'readiness-review',digest,report);return {digest,origin:report.origin,authority:false,softwareRelease:false};});
    }
    if(operation==='readiness.assessment.read'){
      nativeExact(input,['standardVersion','id']);readinessId(input.id);const head=get<AssessmentHead>(scope,'head',input.id),recorded=get<ReadinessResult>(scope,'result',head.resultDigest);let freshness:'CURRENT'|'STALE'|'UNKNOWN'='UNKNOWN';
      try{const m=await material(scope,head.intentDigest,head.reference);freshness=m.intent.current&&m.projection.digest===recorded.projectionDigest?'CURRENT':'STALE';}catch{freshness='UNKNOWN';}
      const defects=records.list<{projectionDigest:string;criterionId:string;code:string}>(scope,'readiness-gap').filter(g=>g.projectionDigest===recorded.projectionDigest);
      let reconstruction=recorded.reconstructionVerification;
      if(head.reconstructionEvidenceIds.length){try{if(!providers.readReadinessReconstruction)fail('READINESS_RECONSTRUCTION_UNAVAILABLE');reconstruction=validateReadinessReconstruction(await feedbackBounded(()=>providers.readReadinessReconstruction!({workspaceId:store.identity.id,scope,evidenceIds:head.reconstructionEvidenceIds,reference:head.reference})));}catch{reconstruction={...reconstruction,status:'INCOMPLETE'};}}
      const {digest:_recordedDigest,...recordedBody}=recorded;
      const view={...recordedBody,reconstructionVerification:reconstruction,assetAssessment:{...recorded.assetAssessment,freshness,...(freshness==='STALE'?{status:'STALE' as const,level:null}:freshness==='UNKNOWN'?{status:'INCOMPLETE' as const,level:null}:{}),...(defects.length?{status:'FAILED' as const,level:null,gaps:[...recorded.assetAssessment.gaps,...defects.map(({criterionId,code})=>({criterionId,code}))]}:{})}};
      const result=nativeFrozenClone({...view,digest:nativeSha256(view)});
      return {recordedDigest:recorded.digest,result,currentViewDigest:nativeSha256(result),authority:false};
    }
    nativeExact(input,['standardVersion','id','intentDigest','reference','reviewDigest','reconstructionEvidenceIds']);readinessId(input.id);nativeDigest(input.intentDigest);if(input.reviewDigest!==null)nativeDigest(input.reviewDigest);
    if(!Array.isArray(input.reconstructionEvidenceIds)||input.reconstructionEvidenceIds.length>16||input.reconstructionEvidenceIds.some(x=>typeof x!=='string'))fail('READINESS_RECONSTRUCTION');
    const {intent,projection}=await material(scope,input.intentDigest,input.reference as NativeReference);
    if(!intent.current)fail('READINESS_INTENT_STALE');
    const review=input.reviewDigest===null?null:get<ReadinessReview>(scope,'review',input.reviewDigest as string);
    const defects=records.list<{projectionDigest:string;criterionId:string;code:string}>(scope,'readiness-gap').filter(g=>g.projectionDigest===projection.digest);
    const assessment=assessReadinessContent(intent,projection,review,defects.map(({criterionId,code})=>({criterionId,code})));
    let reconstruction=noReconstruction();
    if(input.reconstructionEvidenceIds.length){if(!providers.readReadinessReconstruction)fail('READINESS_RECONSTRUCTION_UNAVAILABLE');reconstruction=validateReadinessReconstruction(await feedbackBounded(()=>providers.readReadinessReconstruction!({workspaceId:store.identity.id,scope,evidenceIds:input.reconstructionEvidenceIds as string[],reference:projection.reference})));}
    return mutate(request,()=>{
      const prior=records.get<AssessmentHead>(scope,'readiness-head',input.id as string);if(prior&&prior.intentDigest!==intent.digest)fail('READINESS_ASSESSMENT_CONFLICT');
      const body={schema:'evopilot-asset-readiness-result/v2' as const,standardVersion:'v2' as const,standardDigest:READINESS_STANDARD_DIGEST,workspaceId:store.identity.id,scope,intentDigest:intent.digest,projectionDigest:projection.digest,specificationDigest:projection.specificationDigest,reference:projection.reference,targetLevel:intent.definition.targetLevel,assetAssessment:assessment,reconstructionVerification:reconstruction,assessedAt:new Date().toISOString(),authority:false as const,softwareRelease:false as const};
      const result:ReadinessResult={...body,digest:nativeSha256(body)};records.put(scope,'readiness-result',result.digest,result);records.put(scope,'readiness-head',input.id as string,{id:input.id,intentDigest:intent.digest,reference:projection.reference,resultDigest:result.digest,history:[...(prior?.history??[]),result.digest],reconstructionEvidenceIds:input.reconstructionEvidenceIds});return result;
    });
  }
  return {readiness};
}
export type {ReadinessResult,ReadinessReview,ReadinessProjection};
