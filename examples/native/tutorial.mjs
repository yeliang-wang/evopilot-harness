// A self-contained synthetic SDK tutorial; never opens a user's project/Workspace.
import { readFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { createHarnessService } from '@evopilot-next/harness/service';
import { syntheticHarnessPackage } from './package.mjs';

if (process.argv.length !== 3 || !isAbsolute(process.argv[2])) {
  throw new TypeError('Usage: node examples/native/tutorial.mjs /absolute/path/to/verified/native-toolchain.json');
}
const nativeToolchain = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const root = mkdtempSync(join(realpathSync(tmpdir()), 'evopilot-native-tutorial-'));
const service = createHarnessService({ workspaceRoot: join(root, 'workspace'), workspaceId: 'synthetic-tutorial' }, { nativeToolchain });
const scope = { visibility: 'private', projectId: 'synthetic' };
service.initialize();
try {
  const write = async (operation, input, requestId) => {
    const expectedRevision = service.execute({ operation: 'workspace.inspect', scope, input: {} }).revision;
    const receipt = await service.native({ operation, scope, input, requestId, expectedRevision });
    if (receipt.status !== 'SUCCEEDED') throw new Error('Unresolved synthetic operation: ' + requestId);
    return receipt.result;
  };
  const pkg = syntheticHarnessPackage(), identity = { id: pkg.manifest.id, version: pkg.manifest.version };
  await write('native.package.put', { package: pkg }, 'put');
  const report = await write('native.package.validate', identity, 'validate');
  if (report.executionStatus !== 'SUCCEEDED' || report.qualityStatus !== 'PASS') throw new Error(report.issues.join('; '));
  const review = await write('native.package.review', identity, 'review');
  await write('native.package.decide', { ...identity, reviewDigest: review.reviewDigest, decision: 'APPROVE', humanEvidenceRef: 'synthetic:test-fixture-only-no-project-authority' }, 'decide');
  await write('native.package.publish', identity, 'publish');
  const readback = await service.native({ operation: 'native.package.readback', scope, input: identity });
  console.log(JSON.stringify({ synthetic: true, temporaryWorkspaceRemoved: true, reference: readback.reference, criteria: report.criteria, reportDigest: report.reportDigest, authority: false }, null, 2));
} finally {
  service.close(); rmSync(root, { recursive: true, force: true });
}
