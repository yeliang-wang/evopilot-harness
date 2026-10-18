import fs from 'node:fs';import {fileURLToPath} from 'node:url';import path from 'node:path';import {createHash} from 'node:crypto';
import {nativeExact,nativeSha256,nativeFrozenClone} from '../vendor/compatibility/v1/native.mjs';
import {onlineFail} from '../vendor/compatibility/online/v1/online.mjs';
export function inspectOnlineStandard(){
 const root=fileURLToPath(new URL('../specifications/online/v1/',import.meta.url));const bytes=fs.readFileSync(path.join(root,'manifest.json')),manifest:unknown=JSON.parse(bytes.toString());
 nativeExact(manifest,['schema','profile','files']);
 if(manifest.schema!=='evopilot-online-standard/v1'||manifest.profile!=='openslo-v1-ratio-timeslices')onlineFail('ONLINE_STANDARD_MANIFEST');
 const records=manifest.files;if(!records||typeof records!=='object'||Array.isArray(records)||Object.keys(records).sort().join('|')!=='example.json|profile.schema.json|sources.json')onlineFail('ONLINE_STANDARD_MANIFEST');
 for(const [name,expected]of Object.entries(records)){const file=path.join(root,name);if(fs.lstatSync(file).isSymbolicLink()||createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==expected)onlineFail('ONLINE_STANDARD_DRIFT');}
 return nativeFrozenClone({schema:manifest.schema,profile:manifest.profile,digest:nativeSha256(manifest),files:records,fullOpenSLOCompliance:false,nativeV03StandardUnchanged:true});
}
