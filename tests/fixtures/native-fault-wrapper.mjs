// Synthetic subprocess fault injection only. All unaffected invocations execute
// the pinned real engine; no product option or production validator is replaced.
export function wrapperSource({ node, executable, tool, fault }) {
  return `#!${node}
import {spawnSync} from 'node:child_process';
const executable=${JSON.stringify(executable)},tool=${JSON.stringify(tool)},fault=${JSON.stringify(fault)};
const args=process.argv.slice(2),actual=args.includes('_effective/observation.json');
const target=fault.startsWith('tests-')?tool==='opa'&&args[0]==='test':fault.startsWith('verify-')?tool==='conftest'&&args[0]==='verify':fault==='engine-disagreement'?tool==='opa'&&args[0]==='eval'&&actual:tool==='conftest'&&args[0]==='test'&&actual;
if(target&&fault==='signal')process.kill(process.pid,'SIGKILL');
if(target&&fault==='exit'){process.stderr.write('synthetic native crash');process.exit(73);}
const r=spawnSync(executable,args,{encoding:'utf8',env:process.env});
if(r.error)throw r.error;
let output=r.stdout,code=r.status;
if(target){
 if(fault==='truncated')output=output.slice(0,-4);
 else if(fault==='unknown-structure')output='{"status":"PASS"}';
 else {
  const d=JSON.parse(output);
  if(fault==='unknown-status')d[0].status='UNKNOWN';
  if(fault==='tests-unknown-status')d[0].status='ERROR';
  if(fault==='verify-unknown-status')d[0].status='ERROR';
  if(fault==='tests-duplicate')d[1]=d[0];
  if(fault==='tests-missing')d.pop();
  if(fault==='tests-skip')d[0].skip=true;
  if(fault==='tests-error')d[0].error={message:'synthetic execution error'};
  if(fault==='engine-disagreement')d.result[0].expressions[0].value[0]=[{ruleId:'H001',msg:'synthetic disagreement'}];
  if(fault==='exit-report-mismatch')code=2;
  output=JSON.stringify(d);
 }
}
process.stdout.write(output);process.stderr.write(r.stderr);process.exit(code??74);
`;
}
