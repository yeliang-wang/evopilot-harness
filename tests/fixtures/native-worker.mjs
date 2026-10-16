import {createHarnessService} from '@evopilot-next/harness/service';
import {readFileSync} from 'node:fs';
const [raw,toolchain,revision]=process.argv.slice(2);const s=createHarnessService(JSON.parse(raw),{nativeToolchain:JSON.parse(readFileSync(toolchain))});s.initialize();await s.native({operation:'native.package.validate',scope:{visibility:'private',projectId:'synthetic'},input:{id:'synthetic-quality',version:'1.0.0'},requestId:'interrupted',expectedRevision:Number(revision)});s.close();
