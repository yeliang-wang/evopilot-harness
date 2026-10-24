import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHarnessService} from '@evopilot-next/harness/service';
import {referenceForPackage} from '../../vendor/compatibility/v1/native.mjs';
import {BEHAVIOR_FACETS,usabilityDigest,usabilityBytesDigest,semanticCriteria} from '@evopilot-next/harness';
import {syntheticHarnessPackage} from '../../examples/native/package.mjs';
import {syntheticDecisionEvidence} from './native/decision-evidence.mjs';

// All approvals, normative material and semantic reports here are synthetic
// fixture attestations. None is real project acceptance or publication evidence.
export async function assessmentFixture(t,{level='L2',scope={visibility:'private',projectId:'synthetic-one'},prepare=true,pinsOverrides={},workspaceOptions}={}){
  const root=mkdtempSync(join(realpathSync(tmpdir()),'evopilot-assessment-'));
  const options=workspaceOptions??{workspaceRoot:join(root,'state'),workspaceId:'synthetic-assessment'};
  const pkg=syntheticHarnessPackage(),reference=referenceForPackage(pkg),path='sources/requirements.txt',content=pkg.files[path];
  const pins={sourceDigest:usabilityDigest('synthetic-source'),assetDigests:[reference.digest],environmentDigest:usabilityDigest('synthetic-environment'),dependenciesDigest:usabilityDigest('synthetic-dependencies'),oracleDigest:null,inputManifestDigest:null,...pinsOverrides};
  const inventory={schema:'evopilot-usability-inventory/v1',workspaceId:options.workspaceId,scope,slice:{id:'slice',version:'1',title:'Synthetic assessment slice',exclusions:['Real-project evidence']},targetLevel:level,pins,reviewReference:'synthetic-review-placeholder',questions:[{id:'q1',question:'What are the requirements?'}],behaviors:[{id:'b1',description:'A synthetic behavior',excludedFacets:[]}]};
  const material={reference,workspaceId:options.workspaceId,scope,package:pkg,published:true};
  let reads=0,currentPins=structuredClone(pins),service;
  const providers={resolveFeedbackMaterial:async()=>{reads++;return structuredClone(material);},readUsabilityPins:async()=>structuredClone(currentPins)};
  const open=()=>{service=createHarnessService(options,providers);service.initialize();return service;};open();
  t.after(()=>{service.close();rmSync(root,{recursive:true,force:true});});
  let seq=0;
  const call=(operation,input={},extra={})=>service.usability({operation,scope,input,...extra});
  const request=async(operation,input,requestId='synthetic-'+ ++seq)=>({operation,scope,input,requestId,expectedRevision:(await call('usability.inspect')).revision});
  const write=async(operation,input,requestId)=>call(operation,input,await request(operation,input,requestId));
  const decision=(operation,reviewDigest)=>syntheticDecisionEvidence(root,{owner:'harness',operation,workspaceId:options.workspaceId,scope,reviewDigest,decision:'APPROVE'});
  const assets=[{reference,normativePaths:[path]}];
  const draft=await call('usability.inventory.review',{inventory,assets});
  inventory.reviewReference=decision('usability.inventory.freeze',draft.reviewDigest);
  const inventoryDigest=usabilityDigest(inventory),citation={assetDigest:reference.digest,path,contentDigest:usabilityBytesDigest(content)};
  const statement={text:'Synthetic reviewed statement.',citations:[citation]};
  const spec={schema:'evopilot-usability-specification/v1',inventoryDigest,answers:[{questionId:'q1',status:'RESOLVED',statement}],behaviors:[{behaviorId:'b1',facets:Object.fromEntries(BEHAVIOR_FACETS.map(f=>[f,structuredClone(statement)]))}]};
  const specificationDigest=usabilityDigest(spec);
  const report={schema:'evopilot-usability-semantic-report/v1',workspaceId:options.workspaceId,scope,inventoryDigest,specificationDigest,actor:'synthetic-test-reviewer',inputMode:'ASSETS_ONLY',independent:true,origin:'ACTUAL',results:semanticCriteria(inventory).map(c=>({criterionId:c.id,status:'PASS',reason:'Synthetic fixture attestation only',evidenceDigests:[citation.contentDigest]}))};
  const record=async(reportValue=report)=>{const review=await call('usability.semantic.review',{report:reportValue});return write('usability.semantic.record',{report:reportValue,humanEvidenceRef:decision('usability.semantic.record',review.reviewDigest)});};
  const start=(id='assessment')=>write('usability.assessment.start',{id,inventoryDigest,specificationDigest});
  if(prepare){await write('usability.inventory.freeze',{inventory,assets});await write('usability.specification.put',{specification:spec});await start();}
  return{root,options,scope,inventory,inventoryDigest,spec,specificationDigest,report,assets,pins,material,providers,call,request,write,record,start,decision,open,close:()=>service.close(),reads:()=>reads,setPins:value=>{currentPins=value;},evaluate:async()=>{const r=await write('usability.assessment.evaluate',{id:'assessment'});return r.evaluation.result;}};
}

if(process.argv[2]==='interrupted-evaluation'){
  const {options,request}=JSON.parse(process.argv[3]);
  const service=createHarnessService(options,{readUsabilityPins:async()=>{process.send('claimed');return new Promise(()=>{});}});service.initialize();
  await service.usability(request);
}

if(process.argv[2]==='interrupted-oracle'){
  const {options,request}=JSON.parse(process.argv[3]);
  const service=createHarnessService(options,{readUsabilityPins:async c=>c.inventory.pins,readReconstructionEvidence:async()=>{process.send('oracle-claimed');return new Promise(()=>{});}});service.initialize();
  await service.usability(request);
}
