import {syntheticHarnessPackage,replaceNativeFile} from './package.mjs';
import {nativeBytesDigest} from '@evopilot-next/harness/native';
/** Illustrative transport SLO policy, not a business or production acceptance. */
export function syntheticOnlinePackage({id='synthetic-online',version='1.0.0',visibility='private',target=0.95}={}){
 const pkg=syntheticHarnessPackage({id,version,visibility});pkg.files={};pkg.manifest.files=[];
 const add=(p,v)=>replaceNativeFile(pkg,p,v);
 const requirement='Synthetic example: the mean of complete good/total time-slice ratios must meet the reviewed onlineTarget.\n',digest=nativeBytesDigest(requirement);
 add('sources/requirements.txt',requirement);
 // Retain the canonical engine options from the native v1 example.
 add('conftest.toml',syntheticHarnessPackage().files['conftest.toml']);
 add('policy/quality.rego',`package project.online
deny_ONLINE contains {"msg":"online ratio below reviewed target or missing","ruleId":"ONLINE"} if {
  object.get(object.get(input.values,"online",{}),"ratio",-1) < data.params.onlineTarget
}
`);
 add('policy/quality_test.rego',`package project.online
test_ONLINE_positive if { count(deny_ONLINE) == 0 with input as {"values":{"online":{"ratio":1}}} }
test_ONLINE_negative if { count(deny_ONLINE) == 1 with input as {"values":{"online":{"ratio":0}}} }
`);
 add('data/parameters.json',{params:{onlineTarget:target}});
 add('parameter-schema.json',{schema:'evopilot-parameters/v1',properties:{onlineTarget:{type:'number',minimum:target,maximum:target,default:target}},required:['onlineTarget']});
 const obs=values=>({schema:'evopilot-observation/v1',origin:'synthetic',source:{revision:'synthetic-online-v1',digest},values});
 for(const [id,values]of Object.entries({positive:{online:{ratio:1}},fault:{online:{ratio:0}},missing:{online:{}}}))add('tests/fixtures/'+id+'.json',obs(values));
 add('observations/current.json',obs({online:{ratio:1}}));
 add('rule-catalog.json',{schema:'evopilot-rule-catalog/v1',rules:[{ruleId:'ONLINE',query:'data.project.online.deny_ONLINE',namespace:'project.online',required:true,qualityDomain:'synthetic-availability',sourceIds:['requirements'],targets:['synthetic-service'],inputRefs:['/values/online/ratio'],parameterRefs:['onlineTarget'],testIds:['test_ONLINE_positive','test_ONLINE_negative'],caseIds:['positive','fault','missing']}]});
 add('coverage.json',{schema:'evopilot-harness-coverage/v1',requiredRuleIds:['ONLINE'],requiredTestIds:['test_ONLINE_positive','test_ONLINE_negative'],requiredCaseIds:['positive','fault','missing'],requirements:[{id:'online-ratio',required:true,ruleIds:['ONLINE'],caseIds:['positive','fault','missing']}],cases:[{id:'positive',input:'tests/fixtures/positive.json',expected:'PASS',expectedRuleIds:[]},{id:'fault',input:'tests/fixtures/fault.json',expected:'FAIL',expectedRuleIds:['ONLINE']},{id:'missing',input:'tests/fixtures/missing.json',expected:'FAIL',expectedRuleIds:['ONLINE'],missingInputRefs:['/values/online/ratio']}]});
 add('source-bindings.json',{schema:'evopilot-source-bindings/v1',direction:'forward',sources:[{id:'requirements',locator:'synthetic://online-requirement',revision:'synthetic-online-v1',digest,status:'observed',visibility,contentPath:'sources/requirements.txt'}],mappings:[{revision:'synthetic-online-v1',fileDigest:digest,selector:{kind:'lines',start:1,end:1},fragmentDigest:nativeBytesDigest(requirement.trimEnd()),requirementId:'online-ratio',targetId:'ONLINE',sourceId:'requirements',status:'inferred',rationale:'Synthetic demonstration; threshold needs review for each real service.'}],requirements:[{id:'online-ratio',required:true,disposition:'covered'}]});
 return pkg;
}
