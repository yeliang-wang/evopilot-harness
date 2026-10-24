import {createUsabilityOracle,ORACLE_FIELDS,ORACLE_MUTATIONS} from './usability-oracle.js';
import type {OracleInputs,OracleResults,OracleProviders} from './usability-oracle.js';
import {preflightUsability} from './usability.js';
import {BEHAVIOR_FACETS, USABILITY_LEVELS, ASSESSMENT_STATES, USABILITY_STANDARD_DIGEST, USABILITY_LIMITS, usabilityStable, usabilityDigest, usabilityFail as fail, validateUsabilityInventory, validateUsabilitySpecification, validateUsabilityPins, validateUsabilityDigest} from '../vendor/usability/v1/contract.mjs';
import type {UsabilityInventory, UsabilitySpecification, UsabilityPins, UsabilityScope} from '../vendor/usability/v1/contract.mjs';
import {semanticCriteria, validateSemanticReport, semanticReportDigest} from '../vendor/usability/v1/assessment.mjs';
import type {UsabilitySemanticReport, UsabilityAssessmentResult} from '../vendor/usability/v1/assessment.mjs';
import {nativeExact, nativeText, nativeFrozenClone, nativePackageDigest, validateNativeReference} from '../vendor/compatibility/v1/native.mjs';
import type {NativeReference} from '../vendor/compatibility/v1/native.mjs';
import {verifyDecisionEvidence} from '../vendor/compatibility/v1/decision-evidence.mjs';
import {createFeedbackStore, feedbackScope} from '../vendor/compatibility/feedback/v1/feedback.mjs';
import type {FeedbackEnvelope, FeedbackOwnerProviders} from '../vendor/compatibility/feedback/v1/feedback.mjs';
import type {Store} from './types.js';

export interface UsabilityAssessmentProviders extends FeedbackOwnerProviders, OracleProviders {
  readUsabilityPins?: (context:{workspaceId:string;scope:UsabilityScope;inventoryDigest:string;inventory:UsabilityInventory},signal:AbortSignal)=>Promise<UsabilityPins>;
}
export interface UsabilityAssetBinding {reference:NativeReference; normativePaths:string[]}
export interface UsabilityInventoryRecord {inventory:UsabilityInventory;assets:UsabilityAssetBinding[];reviewDigest:string;digest:string}
export interface SemanticRecord {report:UsabilitySemanticReport;humanEvidenceRef:string;digest:string}
interface SemanticHead {digest:string;history:string[]}
export interface Assessment {id:string;inventoryDigest:string;specificationDigest:string;reconstructionEvaluationIds?:string[];status:'NOT_EVALUATED'|'IN_PROGRESS'|UsabilityAssessmentResult['assessmentStatus'];evaluationId:string|null;history:string[]}
export interface Evaluation {id:string;assessmentId:string;status:'IN_PROGRESS'|'COMPLETE'|'RECONCILED';result:UsabilityAssessmentResult|null}
export interface UsabilityInputs extends OracleInputs {
  'usability.standard.inspect': Record<string,never>;
  'usability.inspect': Record<string,never>;
  'usability.inventory.review': {inventory:UsabilityInventory;assets:UsabilityAssetBinding[]};
  'usability.inventory.freeze': {inventory:UsabilityInventory;assets:UsabilityAssetBinding[]};
  'usability.inventory.read': {digest:string};
  'usability.specification.put': {specification:UsabilitySpecification};
  'usability.specification.read': {digest:string};
  'usability.semantic.review': {report:UsabilitySemanticReport};
  'usability.semantic.record': {report:UsabilitySemanticReport;humanEvidenceRef:string};
  'usability.assessment.start': {id:string;inventoryDigest:string;specificationDigest:string;reconstructionEvaluationIds?:string[]};
  'usability.assessment.evaluate': {id:string};
  'usability.assessment.read': {id:string};
  'usability.assessment.version': {digest:string};
  'usability.assessment.list': Record<string,never>;
  'usability.assessment.reconcile': {id:string;evaluationId:string};
  'usability.receipt.inspect': {requestId:string};
}
export type UsabilityOperation=keyof UsabilityInputs;
export interface UsabilityReceipt<T> {revision:number;result:T;requestId:string;digest:string}
export interface UsabilityReadAssessment {
  assessment:Assessment;version:UsabilityAssessmentResult|null;
  targetLevel:UsabilityInventory['targetLevel'];verifiedLevel:UsabilityAssessmentResult['verifiedLevel'];
  assessmentStatus:Assessment['status'];freshness:'CURRENT'|'STALE'|'UNKNOWN';authority:false;
}
export interface UsabilityResults extends OracleResults {
  'usability.standard.inspect':{standardDigest:string;levels:typeof USABILITY_LEVELS;states:typeof ASSESSMENT_STATES;authority:false};
  'usability.inspect':{owner:string;workspaceId:string;scope:UsabilityScope;revision:number;authority:false};
  'usability.inventory.review':UsabilityInventoryRecord;
  'usability.inventory.freeze':UsabilityReceipt<UsabilityInventoryRecord>;
  'usability.inventory.read':UsabilityInventoryRecord;
  'usability.specification.put':UsabilityReceipt<{digest:string}>;
  'usability.specification.read':UsabilitySpecification;
  'usability.semantic.review':{report:UsabilitySemanticReport;reviewDigest:string;required:string[];missing:string[];authority:false};
  'usability.semantic.record':UsabilityReceipt<SemanticRecord>;
  'usability.assessment.start':UsabilityReceipt<Assessment>;
  'usability.assessment.evaluate':{admission:UsabilityReceipt<{id:string;evaluationId:string}>;evaluation:Evaluation};
  'usability.assessment.read':UsabilityReadAssessment;
  'usability.assessment.version':UsabilityAssessmentResult;
  'usability.assessment.list':{items:{id:string;inventoryDigest:string;specificationDigest:string;recordedStatus:Assessment['status'];versions:number}[];aggregateVerifiedLevel:null;authority:false};
  'usability.assessment.reconcile':UsabilityReceipt<Evaluation>;
  'usability.receipt.inspect':UsabilityReceipt<unknown>;
}
export type UsabilityResponse<K extends UsabilityOperation>=UsabilityResults[K];
type Mutation=typeof ORACLE_MUTATIONS[number]|'usability.inventory.freeze'|'usability.specification.put'|'usability.semantic.record'|'usability.assessment.start'|'usability.assessment.evaluate'|'usability.assessment.reconcile';
export type UsabilityRequest<K extends UsabilityOperation=UsabilityOperation>={[P in K]:{operation:P;scope:UsabilityScope;input:UsabilityInputs[P]}&(P extends Mutation?{requestId:string;expectedRevision:number}:{})}[K];
const fields:{[P in UsabilityOperation]:string[]}={...ORACLE_FIELDS,
  'usability.standard.inspect':[],'usability.inspect':[],'usability.inventory.review':['inventory','assets'],'usability.inventory.freeze':['inventory','assets'],'usability.inventory.read':['digest'],
  'usability.specification.put':['specification'],'usability.specification.read':['digest'],'usability.semantic.review':['report'],'usability.semantic.record':['report','humanEvidenceRef'],
  'usability.assessment.start':['id','inventoryDigest','specificationDigest'],'usability.assessment.evaluate':['id'],'usability.assessment.read':['id'],'usability.assessment.version':['digest'],'usability.assessment.list':[],
  'usability.assessment.reconcile':['id','evaluationId'],'usability.receipt.inspect':['requestId'],
};
export const USABILITY_OPERATIONS=Object.freeze(Object.keys(fields) as UsabilityOperation[]);
const mutations=new Set<UsabilityOperation>([...ORACLE_MUTATIONS,'usability.inventory.freeze','usability.specification.put','usability.semantic.record','usability.assessment.start','usability.assessment.evaluate','usability.assessment.reconcile']);
const same=(a:unknown,b:unknown)=>usabilityStable(a)===usabilityStable(b);
async function bounded<T>(work:(signal:AbortSignal)=>Promise<T>,deadline:number):Promise<T>{
  const ms=Math.min(USABILITY_LIMITS.evidenceTimeoutMs,Math.floor(deadline-performance.now()));if(ms<=0)fail('USABILITY_TIMEOUT');
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('USABILITY_TIMEOUT'),{code:'USABILITY_TIMEOUT'}));},ms);})]);}finally{clearTimeout(timer);}
}
export function createUsabilityAssessment(store:Store,providers:UsabilityAssessmentProviders){
  const records=createFeedbackStore(store,'harness');
  function get<T>(scope:UsabilityScope,kind:string,id:string):T{const r=records.get<T>(scope,'usability-'+kind,id);if(!r)fail('USABILITY_NOT_FOUND');return r;}
  function retain(scope:UsabilityScope,kind:string,id:string,value:unknown){const prior=records.get(scope,'usability-'+kind,id);if(prior&&!same(prior,value))fail('USABILITY_IMMUTABLE');if(!prior)records.put(scope,'usability-'+kind,id,value);}
  function put(scope:UsabilityScope,kind:string,id:string,value:unknown){records.put(scope,'usability-'+kind,id,value);}
  function mark(){if(Number(store.db.prepare('PRAGMA user_version').get()!.user_version)<7)store.db.exec('PRAGMA user_version=7');}
  function scoped(inventory:UsabilityInventory,scope:UsabilityScope){if(inventory.workspaceId!==store.identity.id||!same(inventory.scope,scope))fail('USABILITY_SCOPE');}
  function inventoryReview(scope:UsabilityScope,input:UsabilityInputs['usability.inventory.review']):UsabilityInventoryRecord{
    const inventory=validateUsabilityInventory(input.inventory);scoped(inventory,scope);
    if(!Array.isArray(input.assets)||input.assets.length>64)fail('USABILITY_LIMIT');
    for(const a of input.assets){nativeExact(a,['reference','normativePaths']);validateNativeReference(a.reference);if((scope.visibility==='public'&&a.reference.visibility!=='public')||!['harness','ontology'].includes(a.reference.product)||!Array.isArray(a.normativePaths)||a.normativePaths.length>128||new Set(a.normativePaths).size!==a.normativePaths.length)fail('USABILITY_SCHEMA');for(const p of a.normativePaths)if(typeof p!=='string'||p.length>512||p.startsWith('/')||p.includes('\\')||p.includes(':')||p.split('/').some(v=>!v||v==='.'||v==='..'))fail('USABILITY_PATH');}
    if(!same([...inventory.pins.assetDigests].sort(),input.assets.map(a=>a.reference.digest).sort()))fail('USABILITY_ASSET_PIN');
    const {reviewReference:_ref,...definition}=inventory,reviewDigest=usabilityDigest({inventory:definition,assets:input.assets});
    return nativeFrozenClone({inventory,assets:input.assets,reviewDigest,digest:usabilityDigest(inventory)});
  }
  function semanticReview(scope:UsabilityScope,raw:UsabilitySemanticReport){
    const report=validateSemanticReport(raw),inventory=get<UsabilityInventoryRecord>(scope,'inventory',report.inventoryDigest).inventory;
    const spec=get<UsabilitySpecification>(scope,'specification',report.specificationDigest);
    if(report.workspaceId!==store.identity.id||!same(report.scope,scope)||spec.inventoryDigest!==report.inventoryDigest)fail('USABILITY_SCOPE');
    const required=new Set(semanticCriteria(inventory).map(c=>c.id));if(report.results.some(r=>!required.has(r.criterionId)))fail('USABILITY_UNDECLARED_REQUIREMENT');
    return {report,reviewDigest:semanticReportDigest(report),required:[...required],missing:[...required].filter(id=>!report.results.some(r=>r.criterionId===id)),authority:false};
  }
  function baseResult(a:Assessment,inventory:UsabilityInventory):Omit<UsabilityAssessmentResult,'digest'>{const criteria=semanticCriteria(inventory);return {schema:'evopilot-usability-assessment-result/v1',standardDigest:USABILITY_STANDARD_DIGEST,assessedAt:new Date().toISOString(),assessor:null,workspaceId:store.identity.id,scope:inventory.scope,inventoryDigest:a.inventoryDigest,specificationDigest:a.specificationDigest,slice:inventory.slice,targetLevel:inventory.targetLevel,verifiedLevel:null,assessmentStatus:'INCOMPLETE',pins:inventory.pins,denominator:{questions:inventory.questions.length,behaviorFacets:inventory.targetLevel==='L1'?0:inventory.behaviors.length*BEHAVIOR_FACETS.length,excludedBehaviorFacets:inventory.targetLevel==='L1'?0:inventory.behaviors.reduce((n,b)=>n+b.excludedFacets.length,0),required:criteria.length},gaps:[],semanticReportDigest:null,reconstructionEvidence:[],authority:false,softwareRelease:false};}
  async function currentPins(scope:UsabilityScope,digest:string,inventory:UsabilityInventory,deadline:number):Promise<UsabilityPins>{if(!providers.readUsabilityPins)fail('USABILITY_UNSUPPORTED');return validateUsabilityPins(await bounded(signal=>providers.readUsabilityPins!({workspaceId:store.identity.id,scope,inventoryDigest:digest,inventory:nativeFrozenClone(inventory)},signal),deadline));}
  async function reconstructionEvidence(a:Assessment,scope:UsabilityScope,deadline:number):Promise<string[]>{
    if(!a.reconstructionEvaluationIds||a.reconstructionEvaluationIds.length<2)fail('USABILITY_INDEPENDENT_RECONSTRUCTION_REQUIRED');
    const oracle=createUsabilityOracle(store,providers),proofs=[];
    for(const id of a.reconstructionEvaluationIds!){
      const proof=await oracle.currentEvaluation(scope,id,deadline),r=proof.observation;
      if(proof.binding.inventoryDigest!==a.inventoryDigest||proof.binding.specificationDigest!==a.specificationDigest)fail('USABILITY_RECONSTRUCTION_SCOPE');
      if(!r.execution||r.origin!=='ACTUAL'||r.inputMode!=='ASSETS_ONLY'||!r.independent||!r.isolated||r.status!=='SUCCEEDED')fail('USABILITY_RECONSTRUCTION_IDENTITY_REQUIRED');
      proofs.push(proof);
    }
    const observations=proofs.map(p=>p.observation);
    for(const values of [observations.map(r=>r.attemptId),observations.map(r=>r.execution!.claimId),observations.map(r=>r.execution!.cleanWorkspaceId),observations.map(r=>r.execution!.receiptDigest)])if(new Set(values).size!==observations.length)fail('USABILITY_RECONSTRUCTION_NOT_INDEPENDENT');
    if(new Set(observations.map(r=>r.execution!.planDigest)).size!==1||new Set(observations.map(r=>r.executorDigest)).size!==1||new Set(proofs.map(p=>p.binding.digest)).size!==1)fail('USABILITY_RECONSTRUCTION_BINDING');
    return proofs.map(p=>p.evaluation.result!.digest);
  }
  async function evaluate(a:Assessment,scope:UsabilityScope):Promise<UsabilityAssessmentResult>{
    const record=get<UsabilityInventoryRecord>(scope,'inventory',a.inventoryDigest),inventory=record.inventory,spec=get<UsabilitySpecification>(scope,'specification',a.specificationDigest),body=baseResult(a,inventory),deadline=performance.now()+USABILITY_LIMITS.totalTimeoutMs;
    try{
      verifyDecisionEvidence(inventory.reviewReference,{owner:'harness',operation:'usability.inventory.freeze',workspaceId:store.identity.id,scope,reviewDigest:record.reviewDigest,decision:'APPROVE'});
      const pins=await currentPins(scope,a.inventoryDigest,inventory,deadline);
      const preflight=await preflightUsability({workspaceId:store.identity.id,scope,inventoryDigest:a.inventoryDigest,currentPins:pins,specification:spec},{authorize:()=>true,readInventory:async()=>inventory,readCitation:async(context,signal)=>{
        const binding=record.assets.find(a=>a.reference.digest===context.citation.assetDigest);if(!binding||!providers.resolveFeedbackMaterial)fail('USABILITY_EVIDENCE_UNAVAILABLE');
        const material=await bounded(()=>Promise.resolve(providers.resolveFeedbackMaterial!({scope,reference:binding.reference})),deadline);
        if(signal.aborted)fail('USABILITY_TIMEOUT');
        const permittedScope=material.reference.visibility==='private'?same(material.scope,scope):material.scope.visibility==='public'&&[scope.projectId,'shared'].includes(material.scope.projectId);
        if(!same(material.reference,binding.reference)||material.workspaceId!==store.identity.id||!permittedScope||material.published!==true||nativePackageDigest(material.package)!==material.reference.digest)fail('USABILITY_SCOPE');
        const content=material.package.files[context.citation.path];return {workspaceId:material.workspaceId,scope,assetDigest:material.reference.digest,path:context.citation.path,content,published:true,authority:binding.normativePaths.includes(context.citation.path)?'normative':'informative',access:'PERMITTED'};
      }});
      body.gaps=preflight.gaps.map(g=>({requirementId:g.requirementId,code:g.code}));
      const semanticHead=records.get<SemanticHead>(scope,'usability-semantic-head',usabilityDigest([a.inventoryDigest,a.specificationDigest]));
      const semantic=semanticHead?get<SemanticRecord>(scope,'semantic',semanticHead.digest):null;
      let l1=true,l2=inventory.behaviors.length>0,failed=false,unsupported=false;
      if(!semantic){body.gaps.push({requirementId:'semantics',code:'USABILITY_SEMANTIC_REVIEW_REQUIRED'});l1=false;l2=false;}
      else{
        const report=validateSemanticReport(semantic.report);body.semanticReportDigest=semanticReportDigest(report);body.assessor={actor:report.actor,independent:report.independent,origin:report.origin};
        if(report.workspaceId!==store.identity.id||!same(report.scope,scope)||report.inventoryDigest!==a.inventoryDigest||report.specificationDigest!==a.specificationDigest||semantic.digest!==body.semanticReportDigest)fail('USABILITY_SCOPE');
        verifyDecisionEvidence(semantic.humanEvidenceRef,{owner:'harness',operation:'usability.semantic.record',workspaceId:store.identity.id,scope,reviewDigest:body.semanticReportDigest,decision:'APPROVE'});
        if(!report.independent||report.origin!=='ACTUAL'){body.gaps.push({requirementId:'semantics',code:'USABILITY_INDEPENDENT_ACTUAL_EVIDENCE_REQUIRED'});l1=false;l2=false;}
        for(const c of semanticCriteria(inventory)){
          const row=report.results.find(r=>r.criterionId===c.id);
          const question=inventory.questions.find(q=>c.id==='question:'+q.id);
          const statement=question?spec.answers.find(x=>x.questionId===question.id)?.statement:inventory.behaviors.flatMap(b=>BEHAVIOR_FACETS.map(f=>({id:'behavior:'+b.id+':'+f,statement:spec.behaviors.find(x=>x.behaviorId===b.id)?.facets[f]}))).find(x=>x.id===c.id)?.statement;
          const allowed=new Set(statement?.citations.map(c=>c.contentDigest)??[]);
          const valid=row?.status==='PASS'&&row.evidenceDigests.length>0&&row.evidenceDigests.every(d=>allowed.has(d)&&preflight.evidenceDigests.includes(d));
          if(!valid){if(c.level==='L1')l1=false;else l2=false;body.gaps.push({requirementId:c.id,code:row?.status==='PASS'?'USABILITY_SEMANTIC_EVIDENCE_REQUIRED':'USABILITY_SEMANTIC_'+(row?.status??'MISSING')});failed ||= row?.status==='FAIL';unsupported ||= row?.status==='UNSUPPORTED';}
        }
      }
      // Coverage failures still prevent semantic evidence from certifying absent material.
      if(preflight.gaps.some(g=>inventory.questions.some(q=>g.requirementId===q.id)||g.requirementId.startsWith('pins:')))l1=false;
      if(preflight.gaps.some(g=>g.requirementId!=='reconstruction'))l2=false;
      body.verifiedLevel=l1?(inventory.targetLevel!=='L1'&&l2?'L2':'L1'):null;
      if(inventory.targetLevel==='L3'&&l1&&l2){
        try{body.reconstructionEvidence=await reconstructionEvidence(a,scope,deadline);body.verifiedLevel='L3';body.gaps=body.gaps.filter(g=>g.requirementId!=='reconstruction');}
        catch(error){const code=error&&typeof error==='object'&&'code'in error?String(error.code):'';failed ||= code==='ORACLE_BEHAVIOR_FAILED';unsupported ||= code==='ORACLE_UNSUPPORTED';body.gaps.push({requirementId:'reconstruction',code:code.startsWith('USABILITY_RECONSTRUCTION_')||['USABILITY_INDEPENDENT_RECONSTRUCTION_REQUIRED','ORACLE_RESULT_REQUIRED','ORACLE_BEHAVIOR_FAILED','ORACLE_STALE','ORACLE_TIMEOUT','ORACLE_UNSUPPORTED','ORACLE_OBSERVATION_DRIFT'].includes(code)?code:'USABILITY_RECONSTRUCTION_EVIDENCE_UNAVAILABLE'});}
      }
      const finalPins=await currentPins(scope,a.inventoryDigest,inventory,deadline);
      const finalSemantic=records.get<SemanticHead>(scope,'usability-semantic-head',usabilityDigest([a.inventoryDigest,a.specificationDigest]));
      if(!same(pins,inventory.pins)||!same(finalPins,pins)||(semanticHead?.digest??null)!==(finalSemantic?.digest??null)){body.assessmentStatus='STALE';body.verifiedLevel=null;body.gaps.push({requirementId:'pins',code:'USABILITY_STALE'});}
      else if(body.verifiedLevel===inventory.targetLevel)body.assessmentStatus='VERIFIED';
      else body.assessmentStatus=failed?'FAILED':unsupported||(inventory.targetLevel==='L3'&&!a.reconstructionEvaluationIds)?'UNSUPPORTED':'INCOMPLETE';
    }catch(error){const code=error&&typeof error==='object'&&'code'in error?String(error.code):'';body.verifiedLevel=null;body.assessmentStatus=code==='USABILITY_UNSUPPORTED'?'UNSUPPORTED':'INCOMPLETE';body.gaps.push({requirementId:'assessment',code:['USABILITY_UNSUPPORTED','USABILITY_TIMEOUT','HUMAN_EVIDENCE_REQUIRED'].includes(code)?code:'USABILITY_EVIDENCE_UNAVAILABLE'});}
    return nativeFrozenClone({...body,digest:usabilityDigest(body)});
  }
  function finish(scope:UsabilityScope,evaluationId:string,result:UsabilityAssessmentResult,status:'COMPLETE'|'RECONCILED'){
    const evaluation=get<Evaluation>(scope,'evaluation',evaluationId),a=get<Assessment>(scope,'assessment',evaluation.assessmentId);
    if(evaluation.status!=='IN_PROGRESS'||a.evaluationId!==evaluationId)fail('USABILITY_RECONCILED');
    retain(scope,'version',result.digest,result);put(scope,'evaluation',evaluationId,{...evaluation,status,result});put(scope,'assessment',a.id,{...a,status:result.assessmentStatus,history:[...a.history,result.digest]});
  }
  async function usability(raw:UsabilityRequest):Promise<unknown>{
    if(raw.operation==='usability.oracle.review'||raw.operation==='usability.oracle.freeze'||raw.operation==='usability.oracle.read'||raw.operation==='usability.oracle.evaluate'||raw.operation==='usability.oracle.evaluation'||raw.operation==='usability.oracle.version'||raw.operation==='usability.oracle.reconcile')return createUsabilityOracle(store,providers).oracle(raw);
    usabilityStable(raw);const r=nativeFrozenClone(raw),op=r.operation,write=mutations.has(op);
    if(!Object.hasOwn(fields,op))fail('USABILITY_UNSUPPORTED');nativeExact(r,['operation','scope','input',...(write?['requestId','expectedRevision']:[])]);feedbackScope(r.scope);nativeExact(r.input,fields[op],op==='usability.assessment.start'?['reconstructionEvaluationIds']:[]);store.guard();
    if(op==='usability.standard.inspect')return {standardDigest:USABILITY_STANDARD_DIGEST,levels:USABILITY_LEVELS,states:ASSESSMENT_STATES,authority:false};
    if(op==='usability.inspect')return records.inspect(r.scope);
    if(op==='usability.receipt.inspect'){const found=records.receipt(r.scope,r.input.requestId);if(!found)fail('USABILITY_NOT_FOUND');return found;}
    if(op==='usability.inventory.review')return inventoryReview(r.scope,r.input);
    if(op==='usability.inventory.read')return get<UsabilityInventoryRecord>(r.scope,'inventory',r.input.digest);
    if(op==='usability.specification.read')return get<UsabilitySpecification>(r.scope,'specification',r.input.digest);
    if(op==='usability.semantic.review')return semanticReview(r.scope,r.input.report);
    if(op==='usability.assessment.version')return get<UsabilityAssessmentResult>(r.scope,'version',r.input.digest);
    if(op==='usability.assessment.list')return {items:records.list<Assessment>(r.scope,'usability-assessment').map(a=>({id:a.id,inventoryDigest:a.inventoryDigest,specificationDigest:a.specificationDigest,recordedStatus:a.status,versions:a.history.length})),aggregateVerifiedLevel:null,authority:false};
    if(op==='usability.assessment.read'){
      const a=get<Assessment>(r.scope,'assessment',r.input.id),inventory=get<UsabilityInventoryRecord>(r.scope,'inventory',a.inventoryDigest).inventory,version=a.history.length?get<UsabilityAssessmentResult>(r.scope,'version',a.history.at(-1)!):null;
      let freshness:'CURRENT'|'STALE'|'UNKNOWN'='UNKNOWN';try{freshness=same(await currentPins(r.scope,a.inventoryDigest,inventory,performance.now()+USABILITY_LIMITS.totalTimeoutMs),inventory.pins)?'CURRENT':'STALE';}catch{/* Reading unavailable freshness never upgrades historical evidence. */}
      const semanticHead=records.get<SemanticHead>(r.scope,'usability-semantic-head',usabilityDigest([a.inventoryDigest,a.specificationDigest]));
      if(version?.semanticReportDigest&&version.semanticReportDigest!==(semanticHead?.digest??null))freshness='STALE';
      if(freshness==='CURRENT'&&version?.verifiedLevel==='L3'){
        try{
          const semantic=get<SemanticRecord>(r.scope,'semantic',version.semanticReportDigest!);verifyDecisionEvidence(semantic.humanEvidenceRef,{owner:'harness',operation:'usability.semantic.record',workspaceId:store.identity.id,scope:r.scope,reviewDigest:semantic.digest,decision:'APPROVE'});
          if(!same(await reconstructionEvidence(a,r.scope,performance.now()+USABILITY_LIMITS.totalTimeoutMs),version.reconstructionEvidence))freshness='STALE';
        }catch(error){freshness=error&&typeof error==='object'&&'code'in error&&['ORACLE_STALE','ORACLE_OBSERVATION_DRIFT'].includes(String(error.code))?'STALE':'UNKNOWN';}
      }
      return {assessment:a,version,targetLevel:inventory.targetLevel,verifiedLevel:freshness==='CURRENT'&&a.status!=='IN_PROGRESS'?version?.verifiedLevel??null:null,assessmentStatus:freshness==='STALE'?'STALE':freshness==='UNKNOWN'&&version?'INCOMPLETE':a.status,freshness,authority:false};
    }
    const request=r as FeedbackEnvelope;
    if(op==='usability.assessment.evaluate'){
      let admittedHere=false;
      const admission=records.mutate(request,()=>{admittedHere=true;const a=get<Assessment>(r.scope,'assessment',r.input.id);if(a.status==='IN_PROGRESS')fail('USABILITY_BUSY');mark();put(r.scope,'evaluation',r.requestId,{id:r.requestId,assessmentId:a.id,status:'IN_PROGRESS',result:null} satisfies Evaluation);put(r.scope,'assessment',a.id,{...a,status:'IN_PROGRESS',evaluationId:r.requestId});return {id:a.id,evaluationId:r.requestId};});
      const claim=get<Evaluation>(r.scope,'evaluation',r.requestId);
      // The transaction callback runs only on first admission, including after restart.
      if(!admittedHere)return {admission,evaluation:claim};
      try{const a=get<Assessment>(r.scope,'assessment',r.input.id),result=await evaluate(a,r.scope);store.db.exec('BEGIN IMMEDIATE');try{finish(r.scope,r.requestId,result,'COMPLETE');records.recordTransition({operation:'usability.assessment.finish',scope:r.scope,evaluationId:r.requestId},result);store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}return {admission,evaluation:get<Evaluation>(r.scope,'evaluation',r.requestId)};}catch(error){throw error;}
    }
    return records.mutate(request,()=>{
      mark();
      if(op==='usability.inventory.freeze'){const value=inventoryReview(r.scope,r.input);verifyDecisionEvidence(value.inventory.reviewReference,{owner:'harness',operation:op,workspaceId:store.identity.id,scope:r.scope,reviewDigest:value.reviewDigest,decision:'APPROVE'});retain(r.scope,'inventory',value.digest,value);return value;}
      if(op==='usability.specification.put'){const value=validateUsabilitySpecification(r.input.specification);get(r.scope,'inventory',value.inventoryDigest);const digest=usabilityDigest(value);retain(r.scope,'specification',digest,value);return {digest};}
      if(op==='usability.semantic.record'){const review=semanticReview(r.scope,r.input.report);verifyDecisionEvidence(r.input.humanEvidenceRef,{owner:'harness',operation:op,workspaceId:store.identity.id,scope:r.scope,reviewDigest:review.reviewDigest,decision:'APPROVE'});const value={report:review.report,humanEvidenceRef:r.input.humanEvidenceRef,digest:review.reviewDigest};const key=usabilityDigest([review.report.inventoryDigest,review.report.specificationDigest]),head=records.get<SemanticHead>(r.scope,'usability-semantic-head',key);retain(r.scope,'semantic',value.digest,value);put(r.scope,'semantic-head',key,{digest:value.digest,history:[...new Set([...(head?.history??[]),value.digest])]});return value;}
      if(op==='usability.assessment.start'){
        nativeText(r.input.id);validateUsabilityDigest(r.input.inventoryDigest);validateUsabilityDigest(r.input.specificationDigest);const inventory=get<UsabilityInventoryRecord>(r.scope,'inventory',r.input.inventoryDigest).inventory;
        const spec=get<UsabilitySpecification>(r.scope,'specification',r.input.specificationDigest);if(spec.inventoryDigest!==r.input.inventoryDigest)fail('USABILITY_INVENTORY_DRIFT');
        const ids=r.input.reconstructionEvaluationIds;
        if(ids!==undefined){if(inventory.targetLevel!=='L3'||!Array.isArray(ids)||ids.length<2||ids.length>4||new Set(ids).size!==ids.length)fail('USABILITY_RECONSTRUCTION_SELECTION');for(const id of ids)if(typeof id!=='string'||!/^[a-z0-9][a-z0-9:._-]{0,127}$/.test(id))fail('USABILITY_RECONSTRUCTION_SELECTION');}
        const a:Assessment={...r.input,status:'NOT_EVALUATED',evaluationId:null,history:[]};retain(r.scope,'assessment',a.id,a);return a;
      }
      if(op==='usability.assessment.reconcile'){const e=get<Evaluation>(r.scope,'evaluation',r.input.evaluationId);if(e.assessmentId!==r.input.id)fail('USABILITY_SCOPE');if(e.status!=='IN_PROGRESS')return e;const a=get<Assessment>(r.scope,'assessment',r.input.id),inventory=get<UsabilityInventoryRecord>(r.scope,'inventory',a.inventoryDigest).inventory,body=baseResult(a,inventory);body.gaps=[{requirementId:'evaluation',code:'USABILITY_INTERRUPTED'}];const result={...body,digest:usabilityDigest(body)};finish(r.scope,r.input.evaluationId,result,'RECONCILED');return get<Evaluation>(r.scope,'evaluation',r.input.evaluationId);}
      fail('USABILITY_UNSUPPORTED');
    });
  }
  return {usability:usability as <K extends UsabilityOperation>(request:UsabilityRequest<K>)=>Promise<UsabilityResponse<K>>};
}
