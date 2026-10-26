import {nativeSha256,nativeStableSerialize} from '../vendor/compatibility/v1/native.mjs';
import {readinessFail as fail} from '../vendor/compatibility/usability/v2/contract.mjs';
import type {ReadinessReconstruction} from '../vendor/compatibility/usability/v2/contract.mjs';
import type {ReadinessHarnessProviders} from './readiness.js';
import type {UsabilityOperation,UsabilityRequest,UsabilityResponse} from './usability-assessment.js';
/** Existing v1 verification is read, never executed or relabeled. Explicit linking is scoped to identical asset bytes. */
export async function legacyReconstructionReadback(context:Parameters<NonNullable<ReadinessHarnessProviders['readReadinessReconstruction']>>[0],read:<K extends UsabilityOperation>(request:UsabilityRequest<K>)=>Promise<UsabilityResponse<K>>):Promise<ReadinessReconstruction>{
  if(context.evidenceIds.length!==1||!context.evidenceIds[0].startsWith('v1-assessment:'))fail('READINESS_RECONSTRUCTION_REFERENCE');
  const id=context.evidenceIds[0].slice('v1-assessment:'.length),view=await read({operation:'usability.assessment.read',scope:context.scope,input:{id}}),v=view.version;
  if(!v)return {status:'NOT_EXECUTED',evidenceDigests:[],artifactDigest:null,environmentDigest:null,standardVersion:'v1',scopeDescription:null};
  if(v.workspaceId!==context.workspaceId||nativeStableSerialize(v.scope)!==nativeStableSerialize(context.scope)||!v.pins.assetDigests.includes(context.reference.digest))fail('READINESS_RECONSTRUCTION_SCOPE');
  const outputs:string[]=[],evidence=[v.digest];
  for(const evaluationId of view.assessment.reconstructionEvaluationIds??[]){const e=await read({operation:'usability.oracle.evaluation',scope:context.scope,input:{id:evaluationId}});if(e.evaluation.result){evidence.push(e.evaluation.result.digest);if(e.evaluation.result.outputDigest)outputs.push(e.evaluation.result.outputDigest);}}
  const status:ReadinessReconstruction['status']=view.freshness==='STALE'?'STALE':view.freshness!=='CURRENT'?'INCOMPLETE':v.verifiedLevel==='L3'&&v.assessmentStatus==='VERIFIED'&&outputs.length>=2?'VERIFIED':v.assessmentStatus==='FAILED'?'FAILED':v.assessmentStatus==='UNSUPPORTED'?'UNSUPPORTED':'INCOMPLETE';
  return {status,evidenceDigests:evidence,artifactDigest:outputs.length?nativeSha256(outputs):null,environmentDigest:v.pins.environmentDigest,standardVersion:'v1',scopeDescription:v.slice.title};
}
