import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {inspectOnlineSLO} from '../../dist/online.js';
const root=new URL('../../specifications/online/v1/',import.meta.url);
const example=JSON.parse(fs.readFileSync(new URL('example.json',root)));
const schema=JSON.parse(fs.readFileSync(new URL('profile.schema.json',root)));
const validate=new Ajv2020({strict:true}).compile(schema);
test('OpenSLO online profile: complete declared ratio-timeslice semantics and limits',()=>{
 assert.equal(validate(example),true);const s=inspectOnlineSLO(example);assert.equal(s.windowSeconds,10);assert.equal(s.stepSeconds,1);assert.equal(s.target,0.95);assert.equal(s.good.unit,'events');assert.equal(s.profile,'openslo-v1-ratio-timeslices');assert.match(s.digest,/^sha256:[a-f0-9]{64}$/);
 assert.equal(Object.hasOwn(s,'measuredRatio'),false,'Configuration is not a measurement');
});
for(const [name,change]of Object.entries({
 'unsupported version':x=>x.apiVersion='openslo/v2',
 'RFC1123 trailing hyphen':x=>x.metadata.name='wrong-',
 'RFC1123 length':x=>x.metadata.name='a'.repeat(64),
 'unknown field':x=>x.spec.alertPolicies=[],
 'unsupported method':x=>x.spec.budgetingMethod='Occurrences',
 'calendar window':x=>x.spec.timeWindow[0].isRolling=false,
 'percent ambiguity':x=>x.spec.objectives[0].targetPercent=95,
 'out-of-range target':x=>x.spec.objectives[0].target=95,
 'unknown units':x=>x.spec.indicator.spec.ratioMetric.good.metricSource.spec.unit='percent',
 'missing freshness':x=>delete x.spec.indicator.spec.ratioMetric.good.metricSource.spec.freshnessQuery,
 'empty queries':x=>x.spec.indicator.spec.ratioMetric.total.metricSource.spec.query='',
 'unknown metric provider':x=>x.spec.indicator.spec.ratioMetric.good.metricSource.type='ArbitraryHTTP',
 'composite objective':x=>x.spec.objectives.push({...x.spec.objectives[0]}),
 'ambiguous numeric duration':x=>x.spec.objectives[0].timeSliceWindow=1,
}))test('OpenSLO schema and code reject '+name,()=>{const x=structuredClone(example);change(x);assert.equal(validate(x),false);assert.throws(()=>inspectOnlineSLO(x));});
for(const [name,change,code]of [
 ['mixed units',x=>x.spec.indicator.spec.ratioMetric.good.metricSource.spec.unit='events_per_second','OPENSLO_UNIT'],
 ['partial slices',x=>x.spec.objectives[0].timeSliceWindow='3s','OPENSLO_WINDOW'],
 ['too many samples',x=>x.spec.timeWindow[0].duration='30d','OPENSLO_WINDOW'],
 ['unbounded window',x=>x.spec.timeWindow[0].duration='999d','ONLINE_DURATION'],
])test('OpenSLO cross-field rejection: '+name,()=>{const x=structuredClone(example);change(x);assert.throws(()=>inspectOnlineSLO(x),{code});});
