import {
  BEHAVIOR_FACETS, USABILITY_LIMITS, USABILITY_STANDARD_DIGEST, usabilityDigest, usabilityBytesDigest,
  usabilityStable, usabilityFail, validateUsabilityDigest, validateUsabilityInventory,
  validateUsabilitySpecification, validateUsabilityScope, validateUsabilityPins,
} from '../vendor/usability/v1/contract.mjs';
import type {UsabilityScope, UsabilityPins, UsabilityInventory, UsabilityCitation, UsabilityStatement} from '../vendor/usability/v1/contract.mjs';
export * from '../vendor/usability/v1/contract.mjs';

/** Trusted SDK wiring. Do not expose provider registration in an untrusted request. */
export interface UsabilityReaders {
  authorize(context: {workspaceId: string; scope: UsabilityScope}): boolean;
  readInventory(digest: string, signal: AbortSignal): Promise<unknown>;
  readCitation(context: {workspaceId: string; scope: UsabilityScope; citation: UsabilityCitation}, signal: AbortSignal): Promise<{
    workspaceId: string; scope: UsabilityScope; assetDigest: string; path: string;
    content: string; published: boolean; authority: 'normative'|'informative'; access: 'PERMITTED'|'DENIED'|'UNKNOWN';
  }>;
}
export interface UsabilityPreflightRequest {
  workspaceId: string; scope: UsabilityScope; inventoryDigest: string;
  currentPins: UsabilityPins; specification: unknown;
}
export interface UsabilityGap {requirementId: string; code: string; citation: UsabilityCitation|null}
export interface UsabilityPreflight {
  schema: 'evopilot-usability-preflight/v1'; standardDigest: string; inventoryDigest: string;
  workspaceId: string; scope: UsabilityScope; slice: UsabilityInventory['slice'];
  targetLevel: UsabilityInventory['targetLevel']; verifiedLevel: null; assessmentStatus: 'NOT_EVALUATED';
  readiness: 'READY_FOR_ASSESSMENT'|'INCOMPLETE'|'STALE'|'UNSUPPORTED';
  denominator: {questions: number; behaviors: number; behaviorFacets: number};
  gaps: UsabilityGap[]; currentPins: UsabilityPins; evidenceDigests: string[];
  authority: false; softwareRelease: false; limitations: string[]; digest: string;
}
async function bounded<T>(read: (signal: AbortSignal)=>Promise<T>,deadline: number): Promise<T> {
  const remaining=Math.min(USABILITY_LIMITS.evidenceTimeoutMs,Math.floor(deadline-performance.now()));
  if(remaining<1) usabilityFail('USABILITY_TIMEOUT');
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try {return await Promise.race([Promise.resolve().then(()=>read(controller.signal)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('USABILITY_TIMEOUT'),{code:'USABILITY_TIMEOUT'}));},remaining);})]);}
  finally {clearTimeout(timer);}
}
/** Read-only completeness checks. READY never awards L1, L2 or L3. */
export async function preflightUsability(request: UsabilityPreflightRequest,readers: UsabilityReaders): Promise<UsabilityPreflight> {
  request=JSON.parse(usabilityStable(request)) as UsabilityPreflightRequest;
  if(Object.keys(request).sort().join(',')!=='currentPins,inventoryDigest,scope,specification,workspaceId'||typeof request.workspaceId!=='string'||!/^[a-z0-9][a-z0-9:._-]{0,127}$/.test(request.workspaceId)) usabilityFail('USABILITY_SCHEMA');
  const scope=validateUsabilityScope(request.scope);validateUsabilityDigest(request.inventoryDigest);
  const currentPins=validateUsabilityPins(request.currentPins), specification=validateUsabilitySpecification(request.specification);
  if(readers.authorize({workspaceId:request.workspaceId,scope})!==true) usabilityFail('USABILITY_ACCESS_DENIED');
  const deadline=performance.now()+USABILITY_LIMITS.totalTimeoutMs;
  const inventory=validateUsabilityInventory(await bounded(signal=>readers.readInventory(request.inventoryDigest,signal),deadline));
  if(usabilityDigest(inventory)!==request.inventoryDigest||specification.inventoryDigest!==request.inventoryDigest) usabilityFail('USABILITY_INVENTORY_DRIFT');
  if(inventory.workspaceId!==request.workspaceId||usabilityStable(inventory.scope)!==usabilityStable(scope)) usabilityFail('USABILITY_SCOPE');
  if(specification.answers.some(a=>!inventory.questions.some(q=>q.id===a.questionId))||specification.behaviors.some(b=>!inventory.behaviors.some(q=>q.id===b.behaviorId))) usabilityFail('USABILITY_UNDECLARED_REQUIREMENT');
  const gaps:UsabilityGap[]=[],evidenceDigests=new Set<string>(),cache=new Map<string,string|null>();let evidenceBytes=0;
  const gap=(requirementId:string,code:string,citation:UsabilityCitation|null=null)=>gaps.push({requirementId,code,citation});
  for(const key of Object.keys(inventory.pins) as (keyof UsabilityPins)[]) if(usabilityStable(inventory.pins[key])!==usabilityStable(currentPins[key])) gap('pins:'+key,'USABILITY_STALE');
  async function checkStatement(id: string,statement: UsabilityStatement|null|undefined): Promise<void> {
    if(!statement||!statement.citations.length){gap(id,'USABILITY_MISSING_SPECIFICATION');return;}
    for(const citation of statement.citations){
      const key=usabilityStable(citation);let failure=cache.get(key);
      if(failure===undefined){
        failure=null;
        if(!inventory.pins.assetDigests.includes(citation.assetDigest)) failure='USABILITY_ASSET_PIN';
        else try {
          const e=await bounded(signal=>readers.readCitation({workspaceId:request.workspaceId,scope,citation},signal),deadline);
          if(e.workspaceId!==request.workspaceId||usabilityStable(e.scope)!==usabilityStable(scope)) failure='USABILITY_SCOPE';
          else if(e.assetDigest!==citation.assetDigest||e.path!==citation.path) failure='USABILITY_EVIDENCE_PIN';
          else if(e.access!=='PERMITTED') failure='USABILITY_EVIDENCE_UNAVAILABLE';
          else if(e.published!==true) failure='USABILITY_DRAFT_ONLY';
          else if(e.authority!=='normative') failure='USABILITY_NON_NORMATIVE';
          else if(typeof e.content!=='string') failure='USABILITY_EVIDENCE_UNAVAILABLE';
          else {
            const bytes=Buffer.byteLength(e.content);evidenceBytes+=bytes;
            if(bytes>USABILITY_LIMITS.evidenceBytes||evidenceBytes>USABILITY_LIMITS.totalEvidenceBytes) failure='USABILITY_LIMIT';
            else if(usabilityBytesDigest(e.content)!==citation.contentDigest) failure='USABILITY_CONTENT_DRIFT';
            else evidenceDigests.add(citation.contentDigest);
          }
        } catch(e) {failure=e&&typeof e==='object'&&'code'in e&&e.code==='USABILITY_TIMEOUT'?'USABILITY_TIMEOUT':'USABILITY_EVIDENCE_UNAVAILABLE';}
        cache.set(key,failure);
      }
      if(failure)gap(id,failure,citation);
    }
  }
  for(const q of inventory.questions){const a=specification.answers.find(a=>a.questionId===q.id);if(!a||a.status!=='RESOLVED')gap(q.id,'USABILITY_QUESTION_'+(a?.status??'MISSING'));else await checkStatement(q.id,a.statement);}
  if(inventory.targetLevel!=='L1'){
    if(!inventory.behaviors.length)gap('behaviors','USABILITY_EMPTY_BEHAVIOR_INVENTORY');
    for(const b of inventory.behaviors){const supplied=specification.behaviors.find(s=>s.behaviorId===b.id);for(const facet of BEHAVIOR_FACETS){
      const excluded=b.excludedFacets.find(e=>e.facet===facet);
      if(excluded){if(supplied?.facets[facet])gap(b.id+':'+facet,'USABILITY_APPLICABILITY_CONFLICT');}
      else await checkStatement(b.id+':'+facet,supplied?.facets[facet]);
    }}
  }
  if(inventory.targetLevel==='L3')gap('reconstruction','USABILITY_INDEPENDENT_RECONSTRUCTION_REQUIRED');
  const readiness=gaps.some(g=>g.code==='USABILITY_STALE')?'STALE':inventory.targetLevel==='L3'?'UNSUPPORTED':gaps.length?'INCOMPLETE':'READY_FOR_ASSESSMENT';
  const body:Omit<UsabilityPreflight,'digest'>={schema:'evopilot-usability-preflight/v1',standardDigest:USABILITY_STANDARD_DIGEST,inventoryDigest:request.inventoryDigest,workspaceId:inventory.workspaceId,scope,slice:inventory.slice,targetLevel:inventory.targetLevel,verifiedLevel:null,assessmentStatus:'NOT_EVALUATED',readiness,denominator:{questions:inventory.questions.length,behaviors:inventory.behaviors.length,behaviorFacets:inventory.behaviors.length*BEHAVIOR_FACETS.length},gaps,currentPins,evidenceDigests:[...evidenceDigests].sort(),authority:false,softwareRelease:false,limitations:['EvoPilot conventions; not industry certification','Preflight checks declared coverage, provenance and accessible bytes, not semantic correctness or functional equivalence','Independent reviewed assessment and protected reconstruction evidence are separate; no level is awarded','Scope exclusions and reviewed applicability remain explicit; no averaging or whole-project promotion']};
  return structuredClone({...body,digest:usabilityDigest(body)});
}
