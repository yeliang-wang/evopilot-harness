import {usabilityDigest,usabilityStable,usabilityFail as fail,validateUsabilityDigest,validateUsabilityPins,USABILITY_LIMITS} from '../vendor/usability/v1/contract.mjs';
import type {UsabilityScope,UsabilityInventory,UsabilitySpecification} from '../vendor/usability/v1/contract.mjs';
import {validateBehaviorOracle,behaviorOracleDigest,compareBehavior,validateReconstructionObservation,ORACLE_OBSERVABLE_FACETS} from '../vendor/usability/v1/oracle.mjs';
import type {BehaviorOracle,ReconstructionObservation,BehaviorOracleResult} from '../vendor/usability/v1/oracle.mjs';
import {nativeExact,nativeFrozenClone,nativeText} from '../vendor/compatibility/v1/native.mjs';
import {verifyDecisionEvidence} from '../vendor/compatibility/v1/decision-evidence.mjs';
import {createFeedbackStore,feedbackScope} from '../vendor/compatibility/feedback/v1/feedback.mjs';
import type {FeedbackEnvelope} from '../vendor/compatibility/feedback/v1/feedback.mjs';
import type {Store} from './types.js';
import type {UsabilityInventoryRecord,UsabilityAssessmentProviders,UsabilityReceipt} from './usability-assessment.js';

export interface OracleBinding {inventoryDigest:string;specificationDigest:string;oracle:BehaviorOracle;oracleDigest:string;digest:string}
interface RetainedBinding extends OracleBinding {humanEvidenceRef:string}
export interface OracleEvaluation {id:string;bindingDigest:string;attemptId:string;status:'IN_PROGRESS'|'COMPLETE'|'RECONCILED';result:BehaviorOracleResult|null}
export interface OracleProviders {
  readReconstructionEvidence?:(context:{workspaceId:string;scope:UsabilityScope;attemptId:string},signal:AbortSignal)=>Promise<ReconstructionObservation>;
}
export interface OracleInputs {
  'usability.oracle.review':{inventoryDigest:string;specificationDigest:string;oracle:BehaviorOracle};
  'usability.oracle.freeze':{inventoryDigest:string;specificationDigest:string;oracle:BehaviorOracle;humanEvidenceRef:string};
  'usability.oracle.read':{digest:string};
  'usability.oracle.evaluate':{bindingDigest:string;attemptId:string};
  'usability.oracle.evaluation':{id:string};
  'usability.oracle.version':{digest:string};
  'usability.oracle.reconcile':{id:string};
}
export interface OracleResults {
  'usability.oracle.review':OracleBinding;
  'usability.oracle.freeze':UsabilityReceipt<RetainedBinding>;
  'usability.oracle.read':RetainedBinding;
  'usability.oracle.evaluate':{admission:UsabilityReceipt<OracleEvaluation>;evaluation:OracleEvaluation};
  'usability.oracle.evaluation':{evaluation:OracleEvaluation;freshness:'CURRENT'|'STALE'|'UNKNOWN';status:OracleEvaluation['status']|BehaviorOracleResult['status'];authority:false};
  'usability.oracle.version':BehaviorOracleResult;
  'usability.oracle.reconcile':UsabilityReceipt<OracleEvaluation>;
}
export const ORACLE_FIELDS={
  'usability.oracle.review':['inventoryDigest','specificationDigest','oracle'],
  'usability.oracle.freeze':['inventoryDigest','specificationDigest','oracle','humanEvidenceRef'],
  'usability.oracle.read':['digest'],'usability.oracle.evaluate':['bindingDigest','attemptId'],
  'usability.oracle.evaluation':['id'],'usability.oracle.version':['digest'],'usability.oracle.reconcile':['id'],
};
export const ORACLE_MUTATIONS=['usability.oracle.freeze','usability.oracle.evaluate','usability.oracle.reconcile'] as const;
type OracleOperation=keyof OracleInputs;
type OracleRequest={[K in OracleOperation]:{operation:K;scope:UsabilityScope;input:OracleInputs[K];requestId?:string;expectedRevision?:number}}[OracleOperation];
const same=(a:unknown,b:unknown)=>usabilityStable(a)===usabilityStable(b);
async function bounded<T>(work:(signal:AbortSignal)=>Promise<T>,deadline:number):Promise<T>{
  const ms=Math.min(USABILITY_LIMITS.evidenceTimeoutMs,Math.floor(deadline-performance.now()));if(ms<=0)fail('ORACLE_TIMEOUT');
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('ORACLE_TIMEOUT'),{code:'ORACLE_TIMEOUT'}));},ms);})]);}finally{clearTimeout(timer);}
}
export function createUsabilityOracle(store:Store,providers:UsabilityAssessmentProviders){
  const records=createFeedbackStore(store,'harness');
  function get<T>(scope:UsabilityScope,kind:string,id:string):T{const r=records.get<T>(scope,'usability-'+kind,id);if(!r)fail('ORACLE_NOT_FOUND');return r;}
  function retain(scope:UsabilityScope,kind:string,id:string,value:unknown){const old=records.get(scope,'usability-'+kind,id);if(old&&!same(old,value))fail('ORACLE_IMMUTABLE');if(!old)records.put(scope,'usability-'+kind,id,value);}
  function mark(version=7){if(Number(store.db.prepare('PRAGMA user_version').get()!.user_version)<version)store.db.exec('PRAGMA user_version='+version);}
  function inventory(scope:UsabilityScope,digest:string){return get<UsabilityInventoryRecord>(scope,'inventory',digest);}
  function review(scope:UsabilityScope,input:OracleInputs['usability.oracle.review']):OracleBinding{
    validateUsabilityDigest(input.inventoryDigest);validateUsabilityDigest(input.specificationDigest);
    const oracle=validateBehaviorOracle(input.oracle),oracleDigest=behaviorOracleDigest(oracle),i=inventory(scope,input.inventoryDigest).inventory,s=get<UsabilitySpecification>(scope,'specification',input.specificationDigest);
    if(i.workspaceId!==store.identity.id||!same(i.scope,scope)||s.inventoryDigest!==input.inventoryDigest)fail('ORACLE_SCOPE');
    if(i.pins.oracleDigest!==oracleDigest)fail('ORACLE_PIN');
    if(oracle.cases.some(c=>!i.behaviors.some(b=>b.id===c.behaviorId)))fail('ORACLE_UNDECLARED_BEHAVIOR');
    for(const b of i.behaviors)for(const facet of ORACLE_OBSERVABLE_FACETS){if(b.excludedFacets.some(f=>f.facet===facet))continue;if(!oracle.cases.some(c=>c.behaviorId===b.id&&c.facets.includes(facet)))fail('ORACLE_COVERAGE');}
    const body={inventoryDigest:input.inventoryDigest,specificationDigest:input.specificationDigest,oracle,oracleDigest};return {...body,digest:usabilityDigest(body)};
  }
  function decisions(scope:UsabilityScope,b:RetainedBinding){
    const i=inventory(scope,b.inventoryDigest);verifyDecisionEvidence(i.inventory.reviewReference,{owner:'harness',operation:'usability.inventory.freeze',workspaceId:store.identity.id,scope,reviewDigest:i.reviewDigest,decision:'APPROVE'});
    verifyDecisionEvidence(b.humanEvidenceRef,{owner:'harness',operation:'usability.oracle.freeze',workspaceId:store.identity.id,scope,reviewDigest:b.digest,decision:'APPROVE'});
  }
  async function freshness(scope:UsabilityScope,b:RetainedBinding,deadline:number){
    decisions(scope,b);if(!providers.readUsabilityPins)fail('ORACLE_UNSUPPORTED');const i=inventory(scope,b.inventoryDigest).inventory;
    const pins=validateUsabilityPins(await bounded(signal=>providers.readUsabilityPins!({workspaceId:store.identity.id,scope,inventoryDigest:b.inventoryDigest,inventory:nativeFrozenClone(i)},signal),deadline));return same(pins,i.pins)?'CURRENT' as const:'STALE' as const;
  }
  function base(scope:UsabilityScope,b:RetainedBinding,attemptId:string):Omit<BehaviorOracleResult,'digest'>{return {schema:'evopilot-behavior-oracle-result/v1',workspaceId:store.identity.id,scope,bindingDigest:b.digest,attemptId,oracleDigest:b.oracleDigest,observationDigest:null,outputDigest:null,status:'INCOMPLETE',denominator:b.oracle.cases.length,results:b.oracle.cases.map(c=>({caseId:c.id,status:'INCOMPLETE',differences:['OBSERVATION_MISSING']})),negativeControls:{required:b.oracle.negativeControls.length,rejected:b.oracle.negativeControls.length},gaps:[],assessedAt:new Date().toISOString(),verifiedLevel:null,authority:false,softwareRelease:false};}
  async function evaluate(scope:UsabilityScope,b:RetainedBinding,attemptId:string):Promise<BehaviorOracleResult>{
    const body=base(scope,b,attemptId),i=inventory(scope,b.inventoryDigest).inventory,deadline=performance.now()+USABILITY_LIMITS.totalTimeoutMs;
    try{
      if(await freshness(scope,b,deadline)!=='CURRENT'){body.status='STALE';body.gaps.push('ORACLE_STALE');}
      else{
        if(!providers.readReconstructionEvidence)fail('ORACLE_UNSUPPORTED');
        const r=validateReconstructionObservation(await bounded(signal=>providers.readReconstructionEvidence!({workspaceId:store.identity.id,scope,attemptId},signal),deadline));
        if(r.workspaceId!==store.identity.id||!same(r.scope,scope)||r.attemptId!==attemptId)fail('ORACLE_SCOPE');
        for(const [k,v] of Object.entries({inventoryDigest:b.inventoryDigest,specificationDigest:b.specificationDigest,oracleDigest:b.oracleDigest,inputManifestDigest:i.pins.inputManifestDigest,environmentDigest:i.pins.environmentDigest,dependenciesDigest:i.pins.dependenciesDigest}))if(r[k as keyof ReconstructionObservation]!==v)fail('ORACLE_PIN');
        if(r.schema==='evopilot-reconstruction-observation/v2')mark(8);
        body.observationDigest=r.digest;body.outputDigest=r.outputDigest;
        if(r.cases.some(c=>!b.oracle.cases.some(expected=>c.caseId===expected.id)))fail('ORACLE_UNDECLARED_CASE');
        body.results=b.oracle.cases.map(c=>{
          const actual=r.cases.find(a=>a.caseId===c.id);
          if(!actual||actual.status!=='COMPLETE'||!actual.actual)return {caseId:c.id,status:actual?.status==='FAILED'?'FAIL' as const:'INCOMPLETE' as const,differences:[actual?'OBSERVATION_'+actual.status:'OBSERVATION_MISSING']};
          if(actual.inputDigest!==usabilityDigest(c.input))return {caseId:c.id,status:'FAIL' as const,differences:['ORACLE_INPUT_DRIFT']};
          const differences=compareBehavior(c.expected,actual.actual,c.tolerances);return {caseId:c.id,status:differences.length?'FAIL' as const:'PASS' as const,differences};
        });
        if(b.oracle.author.origin!=='ACTUAL'||!b.oracle.author.independent||r.origin!=='ACTUAL'||r.inputMode!=='ASSETS_ONLY'||!r.independent||!r.isolated)body.gaps.push('ORACLE_INDEPENDENT_ACTUAL_ISOLATION_REQUIRED');
        if(r.status!=='SUCCEEDED')body.gaps.push('ORACLE_EXECUTION_'+r.status);
        body.status=body.results.some(c=>c.status==='FAIL')||r.status==='FAILED'?'FAIL':body.gaps.length||body.results.some(c=>c.status==='INCOMPLETE')?'INCOMPLETE':'PASS';
        if(await freshness(scope,b,deadline)!=='CURRENT'){body.status='STALE';body.gaps.push('ORACLE_STALE');}
      }
    }catch(error){const code=error&&typeof error==='object'&&'code'in error?String(error.code):'';body.status=code==='ORACLE_UNSUPPORTED'?'UNSUPPORTED':'INCOMPLETE';body.gaps.push(['ORACLE_TIMEOUT','ORACLE_UNSUPPORTED','ORACLE_SCOPE','ORACLE_PIN','ORACLE_UNDECLARED_CASE','ORACLE_RECEIPT_DIGEST'].includes(code)?code:'ORACLE_EVIDENCE_UNAVAILABLE');}
    return nativeFrozenClone({...body,digest:usabilityDigest(body)});
  }
  /** Reinspect retained Runtime evidence only; never rerun a reconstruction or silently create a new oracle verdict. */
  async function currentEvaluation(scope:UsabilityScope,id:string,deadline:number){
    const evaluation=get<OracleEvaluation>(scope,'oracle-evaluation',id),b=get<RetainedBinding>(scope,'oracle',evaluation.bindingDigest),result=evaluation.result;
    if(evaluation.status==='COMPLETE'&&result?.status==='FAIL')fail('ORACLE_BEHAVIOR_FAILED');
    if(evaluation.status!=='COMPLETE'||!result||result.status!=='PASS')fail('ORACLE_RESULT_REQUIRED');
    if(await freshness(scope,b,deadline)!=='CURRENT')fail('ORACLE_STALE');
    if(!providers.readReconstructionEvidence)fail('ORACLE_UNSUPPORTED');
    const observation=validateReconstructionObservation(await bounded(signal=>providers.readReconstructionEvidence!({workspaceId:store.identity.id,scope,attemptId:evaluation.attemptId},signal),deadline));
    if(observation.workspaceId!==store.identity.id||!same(observation.scope,scope)||observation.attemptId!==evaluation.attemptId||observation.inventoryDigest!==b.inventoryDigest||observation.specificationDigest!==b.specificationDigest||observation.oracleDigest!==b.oracleDigest)fail('ORACLE_SCOPE');
    if(observation.digest!==result!.observationDigest||observation.outputDigest!==result!.outputDigest)fail('ORACLE_OBSERVATION_DRIFT');
    if(await freshness(scope,b,deadline)!=='CURRENT')fail('ORACLE_STALE');
    return {evaluation,binding:b,observation};
  }
  function finish(scope:UsabilityScope,id:string,result:BehaviorOracleResult,status:'COMPLETE'|'RECONCILED'){
    const e=get<OracleEvaluation>(scope,'oracle-evaluation',id);if(e.status!=='IN_PROGRESS')fail('ORACLE_RECONCILED');retain(scope,'oracle-version',result.digest,result);records.put(scope,'usability-oracle-evaluation',id,{...e,status,result});
  }
  async function oracle(raw:OracleRequest):Promise<unknown>{
    usabilityStable(raw);const r=nativeFrozenClone(raw),write=(ORACLE_MUTATIONS as readonly string[]).includes(r.operation);nativeExact(r,['operation','scope','input',...(write?['requestId','expectedRevision']:[])]);feedbackScope(r.scope);nativeExact(r.input,ORACLE_FIELDS[r.operation]);store.guard();
    if(r.operation==='usability.oracle.review')return review(r.scope,r.input);
    if(r.operation==='usability.oracle.read')return get<RetainedBinding>(r.scope,'oracle',r.input.digest);
    if(r.operation==='usability.oracle.version')return get<BehaviorOracleResult>(r.scope,'oracle-version',r.input.digest);
    if(r.operation==='usability.oracle.evaluation'){
      const e=get<OracleEvaluation>(r.scope,'oracle-evaluation',r.input.id),b=get<RetainedBinding>(r.scope,'oracle',e.bindingDigest);let current:'CURRENT'|'STALE'|'UNKNOWN'='UNKNOWN';try{current=await freshness(r.scope,b,performance.now()+USABILITY_LIMITS.totalTimeoutMs);}catch{/* Missing evidence never implies freshness. */}
      return {evaluation:e,freshness:current,status:current==='STALE'?'STALE':current==='UNKNOWN'?'INCOMPLETE':e.result?.status??e.status,authority:false};
    }
    if(r.operation==='usability.oracle.evaluate'){
      let admitted=false;const id=r.requestId!;
      const admission=records.mutate(r as FeedbackEnvelope,()=>{nativeText(r.input.attemptId);if(r.input.attemptId.length>128||!/^[a-z0-9][a-z0-9:._-]*$/.test(r.input.attemptId))fail('ORACLE_SCHEMA');validateUsabilityDigest(r.input.bindingDigest);get(r.scope,'oracle',r.input.bindingDigest);if(records.list<OracleEvaluation>(r.scope,'usability-oracle-evaluation').some(e=>e.status==='IN_PROGRESS'))fail('ORACLE_BUSY');admitted=true;mark();const e:OracleEvaluation={id,bindingDigest:r.input.bindingDigest,attemptId:r.input.attemptId,status:'IN_PROGRESS',result:null};retain(r.scope,'oracle-evaluation',id,e);return e;});
      if(!admitted)return {admission,evaluation:get<OracleEvaluation>(r.scope,'oracle-evaluation',id)};
      const b=get<RetainedBinding>(r.scope,'oracle',r.input.bindingDigest),result=await evaluate(r.scope,b,r.input.attemptId);
      store.db.exec('BEGIN IMMEDIATE');try{finish(r.scope,id,result,'COMPLETE');records.recordTransition({operation:'usability.oracle.finish',scope:r.scope,evaluationId:id},result);store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}
      return {admission,evaluation:get<OracleEvaluation>(r.scope,'oracle-evaluation',id)};
    }
    return records.mutate(r as FeedbackEnvelope,()=>{
      mark();if(r.operation==='usability.oracle.freeze'){const b=review(r.scope,r.input);verifyDecisionEvidence(r.input.humanEvidenceRef,{owner:'harness',operation:r.operation,workspaceId:store.identity.id,scope:r.scope,reviewDigest:b.digest,decision:'APPROVE'});const value={...b,humanEvidenceRef:r.input.humanEvidenceRef};retain(r.scope,'oracle',b.digest,value);return value;}
      if(r.operation==='usability.oracle.reconcile'){const e=get<OracleEvaluation>(r.scope,'oracle-evaluation',r.input.id);if(e.status!=='IN_PROGRESS')return e;const b=get<RetainedBinding>(r.scope,'oracle',e.bindingDigest),body=base(r.scope,b,e.attemptId);body.gaps=['ORACLE_INTERRUPTED'];finish(r.scope,e.id,{...body,digest:usabilityDigest(body)},'RECONCILED');return get<OracleEvaluation>(r.scope,'oracle-evaluation',e.id);}
      fail('ORACLE_OPERATION');
    });
  }
  return {oracle,currentEvaluation};
}
