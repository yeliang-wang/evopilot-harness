import { createHarnessService } from '@evopilot-next/harness/service';
import { evaluateHarness, buildDelivery, inspectOntologyReference } from '@evopilot-next/harness';
import type { HarnessAsset, Evidence, Scope } from '@evopilot-next/harness';

const scope: Scope = { visibility: 'private', projectId: 'consumer' };
const service = createHarnessService({ workspaceRoot: '/explicit/workspace', workspaceId: 'consumer' });
service.execute({ operation: 'asset.list', scope, input: {} });
// @ts-expect-error Scope must carry a supported visibility.
service.execute({ operation: 'asset.list', scope: { visibility: 'global', projectId: 'consumer' }, input: {} });
// @ts-expect-error The inspect request requires an exact asset identity.
service.execute({ operation: 'asset.inspect', scope, input: { sourceId: 'wrong' } });
// @ts-expect-error Mutations require revision and idempotency fields.
service.execute({ operation: 'asset.publish', scope, input: { id: 'example', version: '1.0.0' } });
export function consume(asset: HarnessAsset, evidence: Evidence) {
  const delivery = buildDelivery(asset);
  const report = evaluateHarness(asset, evidence);
  const reference = inspectOntologyReference(asset.dependencies[0], asset.dependencies[0]);
  return { digest: delivery.digest, status: report.status, exactMatch: reference.exactMatch };
}

const workspace = service.execute({ operation: 'workspace.inspect', scope, input: {} });
const revision: number = workspace.revision;
// @ts-expect-error Reads do not return mutation receipt envelopes.
workspace.result;
// @ts-expect-error Workspace inspection does not invent acceptance fields.
workspace.accepted;
const published = service.execute({ operation: 'asset.publish', scope,
  input: { id: 'example', version: '1.0.0' }, requestId: 'publish-1', expectedRevision: revision });
const nextRevision: number = published.revision;
const digest: string = published.result.delivery.digest;
const operation: 'asset.publish' = published.operation;
// @ts-expect-error A publication result has no evaluation report.
published.result.report;
// @ts-expect-error A receipt has no invented acceptance flag.
published.accepted;
const listed = service.execute({ operation: 'asset.list', scope, input: {} });
const isPublished: boolean = listed[0].published;
// @ts-expect-error Asset summaries do not contain full definitions.
listed[0].model;
const reviewed = service.execute({ operation: 'asset.review', scope,
  input: { id: 'example', version: '1.0.0' }, requestId: 'review-1', expectedRevision: nextRevision });
const reviewDigest: string = reviewed.result.reviewDigest;
// @ts-expect-error A review is not a publication delivery.
reviewed.result.delivery;
// @ts-expect-error Operation generics cannot prescribe an arbitrary output shape.
service.execute<{ fabricated: true }>({ operation: 'workspace.inspect', scope, input: {} });


export async function consumeNative() {
  const standard = await service.native({operation:'standard.inspect',scope,input:{}});
  const standardDigest: string = standard.standardDigest;
  const validation = await service.native({operation:'native.package.validate',scope,input:{id:'example',version:'1.0.0'},requestId:'native-validation',expectedRevision:0});
  if (validation.status === 'SUCCEEDED') {
    const reportDigest: string = validation.result.reportDigest;
    const quality: 'PASS' | 'FAIL' | 'ERROR' = validation.result.qualityStatus;
    // @ts-expect-error A native validation is not a package publication.
    validation.result.published;
    return { standardDigest, reportDigest, quality };
  }
  // @ts-expect-error Nonterminal and failed receipts do not guarantee a report.
  validation.result.reportDigest;
  // @ts-expect-error A native mutation requires an idempotency key and CAS revision.
  service.native({operation:'native.package.validate',scope,input:{id:'example',version:'1.0.0'}});
  // @ts-expect-error The request cannot replace the trusted binary executable.
  service.native({operation:'native.package.validate',scope,input:{id:'example',version:'1.0.0',executable:'/tmp/opa'},requestId:'bad',expectedRevision:0});
}

import { preflightUsability } from '@evopilot-next/harness';
import type { UsabilityPreflightRequest, UsabilityReaders, UsabilityLevel } from '@evopilot-next/harness';
export async function consumeUsability(request: UsabilityPreflightRequest, readers: UsabilityReaders) {
  const result = await preflightUsability(request, readers);
  const level: UsabilityLevel = result.targetLevel;
  const verified: null = result.verifiedLevel;
  const authority: false = result.authority;
  // @ts-expect-error Preflight cannot award a level.
  const awarded: 'L3' = result.verifiedLevel;
  // @ts-expect-error Preflight status is never a verification certificate.
  const certified: 'VERIFIED' = result.assessmentStatus;
  return {level, verified, authority};
}

// Authoring callbacks are trusted host configuration, never a boolean bypass.
createHarnessService({workspaceRoot:'/explicit/workspace',workspaceId:'consumer'},{resolveNativeAuthoring:request=>({...request,schema:'evopilot-native-authoring-admission/v1',candidateDigest:'sha256:'+'a'.repeat(64),sourceInventoryDigest:'sha256:'+'b'.repeat(64),requirementsDigest:'sha256:'+'c'.repeat(64),modelingIntentDigest:null,targetLevel:null,authority:false})});
// @ts-expect-error A caller flag cannot replace a typed trusted authoring resolver.
createHarnessService({workspaceRoot:'/explicit/workspace',workspaceId:'consumer'},{resolveNativeAuthoring:true});

export async function consumeAssessment() {
  const start=await service.usability({operation:'usability.assessment.start',scope,input:{id:'l3-slice',inventoryDigest:'sha256:'+'a'.repeat(64),specificationDigest:'sha256:'+'b'.repeat(64),reconstructionEvaluationIds:['first','second']},requestId:'start-l3',expectedRevision:0});
  const selected:string[]|undefined=start.result.reconstructionEvaluationIds;
  // @ts-expect-error Reconstruction selection is an ID list, not an inline result or grade.
  service.usability({operation:'usability.assessment.start',scope,input:{id:'l3-slice',inventoryDigest:'sha256:'+'a'.repeat(64),specificationDigest:'sha256:'+'b'.repeat(64),reconstructionEvaluationIds:[{verifiedLevel:'L3'}]},requestId:'bad-l3',expectedRevision:0});
  const result=await service.usability({operation:'usability.assessment.read',scope,input:{id:'slice'}});
  const target:UsabilityLevel=result.targetLevel;
  const verified:UsabilityLevel|null=result.verifiedLevel;
  const authority:false=result.authority;
  // @ts-expect-error Read-only assessment is not a mutation receipt.
  result.result;
  // @ts-expect-error A request flag cannot certify a level.
  service.usability({operation:'usability.assessment.read',scope,input:{id:'slice',verifiedLevel:'L3'}});
  // @ts-expect-error Evaluation requires request identity and CAS.
  service.usability({operation:'usability.assessment.evaluate',scope,input:{id:'slice'}});
  const evaluated=await service.usability({operation:'usability.assessment.evaluate',scope,input:{id:'slice'},requestId:'evaluation',expectedRevision:0});
  const resultDigest:string|null=evaluated.evaluation.result?.digest??null;
  // @ts-expect-error A retained claim is not itself a release decision.
  evaluated.evaluation.releaseApproved;
  return {target,verified,authority,resultDigest};
}

export async function consumeBehaviorOracle() {
  const view = await service.usability({operation:'usability.oracle.evaluation',scope,input:{id:'evaluation'}});
  const freshness: 'CURRENT'|'STALE'|'UNKNOWN' = view.freshness;
  const result = await service.usability({operation:'usability.oracle.version',scope,input:{digest:'sha256:'+'a'.repeat(64)}});
  const level: null = result.verifiedLevel;
  // @ts-expect-error Raw caller observations cannot substitute for protected Runtime evidence.
  service.usability({operation:'usability.oracle.evaluate',scope,input:{bindingDigest:'pin',attemptId:'attempt',observations:[]},requestId:'evaluate',expectedRevision:0});
  // @ts-expect-error Oracle mutation requires an exact request identity and revision.
  service.usability({operation:'usability.oracle.reconcile',scope,input:{id:'evaluation'}});
  // @ts-expect-error An oracle verdict never has release authority.
  const released: true = result.softwareRelease;
  return {freshness,level};
}
