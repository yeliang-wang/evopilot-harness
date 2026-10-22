import {valueText} from '../vendor/readability/v1/presentation.mjs';
import {inspectHarnessPackage} from './native-package.js';
import {conftestResults} from './native-evaluation.js';
import type {NativeHarnessRecord} from './native-types.js';
import {nativeSha256,nativePackageDigest} from '../vendor/compatibility/v1/native.mjs';
import {readSnapshot,readFail} from '../vendor/readability/v1/readability.mjs';
import type {ReadRow,ReadScope,ReadSnapshot,JSONValue} from '../vendor/readability/v1/readability.mjs';
export function harnessReadSnapshot(record:NativeHarnessRecord,workspaceId:string,scope:ReadScope):ReadSnapshot {
 if(nativeSha256(record.scope)!==nativeSha256(scope))readFail('READABLE_SCOPE');
 const {pkg,catalog,coverage,parameters,observation}=inspectHarnessPackage(record.package),report=record.validation;
 if(report){const {reportDigest,...body}=report;if(nativeSha256(body)!==reportDigest||report.reference.digest!==nativePackageDigest(pkg))readFail('READABLE_EVIDENCE_DRIFT');}
 const rows:ReadRow[]=[];
 function actual(id:string):{failures:string[];warnings:string[]}|null {
  const command=report?.commands.find(c=>c.id===id+'-conftest');if(!command||command.timedOut||command.outputLimit||command.signal||![0,1,2].includes(command.exitCode??-1))return null;
  try{return conftestResults(JSON.parse(command.stdout),catalog);}catch{return null;}
 }
 function add(criterionId:string,variantId:string,expected:JSONValue,origin:string,input:string,ruleIds:string[]){
  const result=actual(variantId==='actual-observation'?'actual':'case-'+variantId),criterion=report?.criteria.find(c=>c.criterionId===criterionId&&c.variantId===variantId);
  if(criterion&&result&&criterion.evidenceDigest!==nativeSha256(result))readFail('READABLE_EVIDENCE_DRIFT');
  const value=result?{status:result.failures.length?'FAIL':result.warnings.length?'WARN':'PASS',ruleIds:[...result.failures,...result.warnings].sort()}:null;
  rows.push({id:'case:'+criterionId+':'+variantId,kind:'case',label:criterionId+' / '+variantId,expected,actual:value,verdict:result&&criterion?criterion.status:report?.executionStatus==='ERROR'?'ERROR':report?'UNKNOWN':'NOT_EXECUTED',origin,
   references:[{kind:'input',id:input,digest:variantId==='actual-observation'?report?.observationDigest??nativeSha256(observation):nativeSha256(JSON.parse(pkg.files[input]))},{kind:'native-report',id:report?.reference.id??pkg.manifest.id,digest:report?.reportDigest??null}],
   details:{criterionId,variantId,ruleIds,inputRefs:[...new Set(catalog.filter(r=>ruleIds.includes(r.ruleId)).flatMap(r=>r.inputRefs))],parameters:parameters as JSONValue,
    resultMeaning:variantId==='actual-observation'?'Evaluation of the supplied observation; its origin controls what this proves':'Verdict measures whether the fixed fixture produced the expected rejection or acceptance; PASS does not mean the fixture was valid'}});
 }
 for(const requirement of coverage.requirements){
  for(const id of requirement.caseIds){const c=coverage.cases.find(x=>x.id===id)!;add(requirement.id,id,{status:c.expected,ruleIds:[...c.expectedRuleIds].sort()},'synthetic',c.input,requirement.ruleIds);}
  add(requirement.id,'actual-observation',{status:'PASS',ruleIds:[]},report&&report.observationDigest!==nativeSha256(observation)?'not-retained-in-package':observation.origin,'observation',requirement.ruleIds);
 }
 for(const rule of catalog)rows.push({id:'rule:'+rule.ruleId,kind:'rule',label:rule.ruleId+' — '+rule.qualityDomain,verdict:'DECLARED',expected:null,actual:null,origin:'source-declaration',references:rule.sourceIds.map(id=>({kind:'source',id,digest:null})),details:JSON.parse(JSON.stringify(rule)) as JSONValue,presentation:{section:'rules',cells:{name:rule.ruleId,purpose:rule.qualityDomain,inputs:rule.inputRefs.join('；')||'未提供',parameters:rule.parameterRefs.map(ref=>ref+' = '+valueText((report?.effectiveConfiguration.params??parameters)[ref]??null)).join('；')||'无参数引用',severity:'目录未提供独立严重程度；查询：'+rule.query,policy:rule.required?'required=true；具体结论按原生用例与执行结果判断':'required=false；不改变原生判定逻辑'}}});
 return readSnapshot({owner:'harness',workspaceId,scope,subject:{kind:'asset',id:pkg.manifest.id,version:pkg.manifest.version},pins:{packageDigest:nativePackageDigest(pkg),standardDigest:pkg.manifest.standardPins.standardDigest,reportDigest:report?.reportDigest??null,observationDigest:report?.observationDigest??null,sourceBindingsDigest:nativeSha256(pkg.files[pkg.manifest.sourceBindingRef])},rows,
 denominator:{requirements:coverage.requirements.length,variants:coverage.requirements.reduce((n,r)=>n+r.caseIds.length+1,0)},
 stages:[{id:'asset-conformance',status:report?.qualityStatus??'NOT_EVALUATED',reason:'Fixed package cases and supplied observation are distinct rows'},{id:'owner-review',status:record.decision?.decision??'PENDING',reason:record.published?'Published owner asset':'Publication not established'},{id:'software-release',status:'NOT_ASSERTED',reason:'An asset report does not authorize a software release'}],
 limitations:['Missing native result stays UNKNOWN','A source declaration, synthetic fixture, runtime observation and business end-to-end execution are different evidence origins','No SRE production-health or business acceptance claim is inferred from package conformance']});
}
