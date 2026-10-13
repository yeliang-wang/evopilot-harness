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
