import {inspectHarnessStandard,CANONICAL_CONFTEST,nativeBytesDigest} from '@evopilot-next/harness/native';
export function syntheticHarnessPackage({id='synthetic-quality',version='1.0.0',visibility='private',direction='forward'}={}){
 const files={}; const add=(path,value)=>{files[path]=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';};
 const sourceBytes='Synthetic requirement H001: tests must succeed.\nSynthetic requirement H002: evidence digest must exist.\nSynthetic requirement H003: warning count must be present and zero.\n';const sourceDigest=nativeBytesDigest(sourceBytes);add('sources/requirements.txt',sourceBytes);
 const observation=values=>({schema:'evopilot-observation/v1',origin:'synthetic',source:{revision:'synthetic-v1',digest:sourceDigest},values});
 add('conftest.toml',CANONICAL_CONFTEST);
 add('policy/quality.rego',`package project.quality

deny_H001 contains {"msg":"checks failed or missing","ruleId":"H001"} if {
  object.get(object.get(input.values,"tests",{}),"exitCode",-1) != 0
}
violation_H002 contains {"msg":"evidence digest missing","ruleId":"H002"} if {
  not input.values.evidenceDigest
}
warn_H003 contains {"msg":"warning threshold exceeded","ruleId":"H003"} if {
  object.get(input.values,"warnings",-1) > data.params.maxWarnings
}
warn_H003 contains {"msg":"warning observation missing","ruleId":"H003"} if {
  object.get(input.values,"warnings",-1) < 0
}
`);
 add('policy/quality_test.rego',`package project.quality

test_H001_positive if { count(deny_H001) == 0 with input as {"values":{"tests":{"exitCode":0}}} }
test_H001_negative if { count(deny_H001) == 1 with input as {"values":{"tests":{"exitCode":1}}} }
test_H002_positive if { count(violation_H002) == 0 with input as {"values":{"evidenceDigest":"abc"}} }
test_H002_negative if { count(violation_H002) == 1 with input as {"values":{}} }
test_H003_positive if { count(warn_H003) == 0 with input as {"values":{"warnings":0}} }
test_H003_negative if { count(warn_H003) == 1 with input as {"values":{"warnings":1}} }
`);
 add('data/parameters.json',{params:{maxWarnings:0}});
 add('parameter-schema.json',{schema:'evopilot-parameters/v1',properties:{maxWarnings:{type:'integer',minimum:0,maximum:0,default:0}},required:['maxWarnings']});
 const inputs={positive:{tests:{exitCode:0},evidenceDigest:'abc',warnings:0},deny:{tests:{exitCode:1},evidenceDigest:'abc',warnings:0},violation:{tests:{exitCode:0},warnings:0},warn:{tests:{exitCode:0},evidenceDigest:'abc',warnings:1}};
 inputs['missing-H001']={evidenceDigest:'abc',warnings:0};inputs['missing-H002']={tests:{exitCode:0},warnings:0};inputs['missing-H003']={tests:{exitCode:0},evidenceDigest:'abc'};
 for(const [key,value]of Object.entries(inputs))add('tests/fixtures/'+key+'.json',observation(value));
 add('observations/current.json',observation(inputs.positive));
 const definitions=[['H001','deny',['positive','deny','missing-H001']],['H002','violation',['positive','violation','missing-H002']],['H003','warn',['positive','warn','missing-H003']]];
 add('rule-catalog.json',{schema:'evopilot-rule-catalog/v1',rules:definitions.map(([ruleId,kind,caseIds])=>({ruleId,query:`data.project.quality.${kind}_${ruleId}`,namespace:'project.quality',required:true,qualityDomain:'synthetic-delivery',sourceIds:['requirements'],targets:['synthetic-project'],inputRefs:[{H001:'/values/tests/exitCode',H002:'/values/evidenceDigest',H003:'/values/warnings'}[ruleId]],parameterRefs:ruleId==='H003'?['maxWarnings']:[],testIds:[`test_${ruleId}_positive`,`test_${ruleId}_negative`],caseIds}))});
 add('coverage.json',{schema:'evopilot-harness-coverage/v1',requiredRuleIds:definitions.map(x=>x[0]),requiredTestIds:definitions.flatMap(([id])=>[`test_${id}_positive`,`test_${id}_negative`]),requiredCaseIds:['positive','deny','violation','warn','missing-H001','missing-H002','missing-H003'],requirements:definitions.map(([id,,caseIds])=>({id:'requirement-'+id,required:true,ruleIds:[id],caseIds})),cases:[{id:'positive',input:'tests/fixtures/positive.json',expected:'PASS',expectedRuleIds:[]},{id:'deny',input:'tests/fixtures/deny.json',expected:'FAIL',expectedRuleIds:['H001']},{id:'violation',input:'tests/fixtures/violation.json',expected:'FAIL',expectedRuleIds:['H002']},{id:'warn',input:'tests/fixtures/warn.json',expected:'WARN',expectedRuleIds:['H003']},...['H001','H002','H003'].map(id=>({id:'missing-'+id,input:'tests/fixtures/missing-'+id+'.json',expected:id==='H003'?'WARN':'FAIL',expectedRuleIds:[id],missingInputRefs:[{H001:'/values/tests/exitCode',H002:'/values/evidenceDigest',H003:'/values/warnings'}[id]]}))]});
 add('source-bindings.json',{schema:'evopilot-source-bindings/v1',direction,sources:[{id:'requirements',locator:'synthetic://delivery-requirements',revision:'synthetic-v1',digest:sourceDigest,status:'observed',visibility,contentPath:'sources/requirements.txt'}],mappings:definitions.map(([id],i)=>({revision:'synthetic-v1',fileDigest:sourceDigest,selector:{kind:'lines',start:i+1,end:i+1},fragmentDigest:nativeBytesDigest(sourceBytes.split('\n')[i]),requirementId:'requirement-'+id,targetId:id,sourceId:'requirements',status:'inferred',rationale:'Synthetic design illustrates explicit quality requirements.'})),requirements:definitions.map(([id])=>({id:'requirement-'+id,required:true,disposition:'covered'}))});
 const standard=inspectHarnessStandard();return {manifest:{schema:'evopilot-native-package/v1',specVersion:'v1',owner:'harness',id,version,visibility,standardPins:{standardDigest:standard.standardDigest,standardLockDigest:standard.standardLockDigest},contractDigest:standard.contractDigest,producer:{product:'harness',version:'0.3.0'},entrypoints:{policy:['policy/quality.rego'],tests:['policy/quality_test.rego'],data:['data/parameters.json'],config:'conftest.toml',ruleCatalog:'rule-catalog.json',coverage:'coverage.json',parameterSchema:'parameter-schema.json',observation:'observations/current.json'},files:Object.entries(files).sort(([a],[b])=>a.localeCompare(b,'en')).map(([path,value])=>({path,mediaType:path.endsWith('.json')?'application/json':path.endsWith('.rego')?'text/x-rego':'application/toml',sha256:nativeBytesDigest(value).slice(7)})),dependencies:[],sourceBindingRef:'source-bindings.json'},files};
}
export function replaceNativeFile(pkg,path,value){pkg.files[path]=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';const row=pkg.manifest.files.find(x=>x.path===path);if(row)row.sha256=nativeBytesDigest(pkg.files[path]).slice(7);else pkg.manifest.files.push({path,mediaType:path.endsWith('.rego')?'text/x-rego':'application/json',sha256:nativeBytesDigest(pkg.files[path]).slice(7)});pkg.manifest.files.sort((a,b)=>a.path.localeCompare(b.path,'en'));return pkg;}
