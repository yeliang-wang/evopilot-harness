import type {ReadinessHarnessProviders as importReadinessProviders} from './readiness.js';
import type {UsabilityAssessmentProviders} from './usability-assessment.js';
import type { NativeHarnessProviders } from './native-types.js';
import type { ResponseHarnessProviders as importResponseProviders } from './response.js';
import type { buildDelivery } from './delivery.js';
import type { evaluateHarness } from './evaluation.js';
import type { openState } from './state.js';
export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export type Visibility = 'public' | 'private';
export interface Scope { visibility: Visibility; projectId: string }
export interface WorkspaceOptions { workspaceRoot: string; workspaceId: string }
export interface WorkspaceIdentity { schema: string; id: string; canonicalRoot: string; ownerUid: number }
export interface Reference { product: 'harness' | 'ontology'; id: string; version: string; specVersion: 'v1'; visibility: Visibility; digest: string }
export interface Source { id: string; kind: string; locator: string; revision: string; digest: string; status: string }
export interface NamedRow { id: string; description: string }
export interface Input { id: string; type: string }
export interface Parameter extends Input { default: JSONValue }
export interface Rule { id: string; target: string; evidenceKey: string; operator: string; severity: string; blocking: boolean; expected?: JSONValue; parameterRef?: string }
export interface SourceMapping { id: string; targetRef: string; sourceRef: string; sourceLocator: string; sourceRevision: string; status: string }
export interface HarnessAsset { id: string; version: string; product: 'harness'; specVersion: 'v1'; visibility: Visibility; provenance: { direction: string; sources: Source[] }; extensions: { namespace: string; version: string; required: boolean; data: Record<string, JSONValue> }[]; dependencies: Reference[]; kind: 'HarnessComponent' | 'HarnessProfile' | 'HarnessBundle' | 'EvaluationPack'; applicability: { enabled: boolean; domains: string[] }; objectives: NamedRow[]; deliverables: NamedRow[]; inputs: Input[]; parameters: Parameter[]; rules: Rule[]; preconditions: (NamedRow & { evidenceKey: string })[]; sourceMappings: SourceMapping[] }
export interface Evidence { id: string; version: string; source: { locator: string; revision: string; digest: string }; values: Record<string, JSONValue> }
export interface Validation { valid: boolean; status: string; errors: { code: string; path: string; message: string }[]; extensions?: { namespace: string; version: string; status: string }[]; authority: boolean; released: boolean }
export type Delivery = ReturnType<typeof buildDelivery>;
export interface OntologyResponse { reference: Reference; published: boolean; workspaceId: string; projectId: string }
export interface Providers extends importReadinessProviders, NativeHarnessProviders, importResponseProviders, UsabilityAssessmentProviders { resolveOntology?: (request: { workspaceId: string; scope: Scope; reference: Reference }) => unknown }
export interface Closure { workspaceId: string; scope: Scope; status: string; nodes: { scope: Scope; assetDigest: string; pins: Reference[]; reference: Reference | null }[]; external: OntologyResponse[]; authority: boolean; closureDigest: string }
export interface AssetRecord { scope: Scope; model: HarnessAsset; digest: string; validation: Validation; review: ({ workspace: WorkspaceIdentity; scope: Scope; assetDigest: string; validation: Validation; resolution: Closure; uid: number; reviewDigest: string }) | null; decision: { reviewDigest: string; decision: string; humanEvidenceRef: string; uid: number } | null; delivery: Delivery | null; resolution?: Closure }
export interface Inspection { recognized: boolean; valid: boolean; schemaValidation: string; structuralIssues: string[]; reason: string; authority: boolean }
export interface SourceOrigin { sourceLocator: string; sourceRevision: string; sourceVisibility: Visibility }
export interface SourceRecord extends SourceOrigin { sourceId: string; scope: Scope; format: string; rawDigest: string; documentDigest: string; document: unknown; inspection: Inspection; observed: Record<string, unknown>; status: string; authority: boolean; inspectionHistory?: { before: { inspection: Inspection; status: string }; after: { inspection: Inspection; status: string }; beforeInspectionDigest: string; afterInspectionDigest: string; uid: number; time: string; requestId: string }[] }
export interface State { assets: AssetRecord[]; sources?: SourceRecord[] }
export type Store = ReturnType<typeof openState>;
export interface ConceptInput { conceptId: string; metaType: string; rationale?: string; evidenceRefs?: JSONValue[] }
export interface RelationRequirement { subjectConceptId: string; relationType: string; objectConceptId: string }
export interface SemanticRequirementsInput { foundationDigest: string; requiredConcepts?: ConceptInput[]; prohibitedConcepts?: ConceptInput[]; relationRequirements?: RelationRequirement[]; evidenceRequirements?: JSONValue[]; schema?: string; authority?: unknown; requirementsDigest?: string }
export interface GroundingRow { candidateId: string; outcome: string; resolvedConceptId: string | null; candidateConceptIds: string[]; conflictConceptIds: string[]; evidenceIds: string[]; evidenceFamilies: string[]; uncertainty: string; explanation: string; userActions: string[]; proposedExtension: { parentConceptId: string; definition: string } | null; decisionSignals: { exactOrAliasMatches: string[]; explicitAuthoritativeMatches: string[]; independentEvidenceFamilyCount: number; llmAdviceObserved: boolean; llmAdviceAuthoritative: boolean } }
export interface GroundingResult { schema: string; foundationDigest: string; candidateSetDigest: string; sourceSnapshotDigest: string; evidenceGraphDigest: string; conceptSetDigest: string; results: GroundingRow[]; outcomeCounts: Record<string, number>; precedence: string[]; priorResultDigests: string[]; presentation: { schema: string; locale: string; title: string; items: { candidateId: string; conclusion: string; reason: string; nextChoices: string[] }[]; auditTermsHiddenFromPrimaryView: string[]; hostAuthored: boolean }; authority: unknown; groundingResultDigest: string }
export interface SemanticInput { requirements: SemanticRequirementsInput; groundingResult: GroundingResult; eligibility?: Record<string, unknown> | null }
export interface OperationInputs {
 'source.install': { sourcePath: string }; 'source.inspect': { sourceId: string }; 'source.list': Record<string, never>; 'source.reinspect': { sourceId: string; expectedInspectionDigest: string }; 'legacy.import': SourceOrigin & { raw: string; format: string };
 'semantic.compatibility.inspect': SemanticInput; 'workspace.inspect': Record<string, never>; 'receipt.inspect': { requestId: string }; 'evaluation.inspect': { requestId: string }; 'asset.put': { asset: HarnessAsset }; 'asset.inspect': { id: string; version: string }; 'asset.list': Record<string, never>; 'asset.review': { id: string; version: string }; 'asset.decide': { id: string; version: string; reviewDigest: string; decision: 'APPROVE' | 'REJECT'; humanEvidenceRef: string }; 'asset.publish': { id: string; version: string }; 'asset.evaluate': { id: string; version: string; evidence: Evidence | Record<string, Evidence>; configuration: Record<string, JSONValue> };
}
export type Mutation = 'source.install' | 'source.reinspect' | 'legacy.import' | 'asset.put' | 'asset.review' | 'asset.decide' | 'asset.publish' | 'asset.evaluate';
export type Operation = keyof OperationInputs;
export type Request<K extends Operation = Operation> = { [P in K]: { operation: P; scope: Scope; input: OperationInputs[P] } & (P extends Mutation ? { requestId: string; expectedRevision: number } : {}) }[K];
export type ServiceRequest = Request;
export interface DispatchRequest { operation: keyof OperationInputs; scope: Scope; requestId: string; expectedRevision: number; input: DispatchInput }
export interface DispatchInput extends SourceOrigin, SemanticInput { sourcePath: string; sourceId: string; expectedInspectionDigest: string; raw: string; format: string; requestId: string; asset: HarnessAsset; id: string; version: string; reviewDigest: string; decision: string; humanEvidenceRef: string; evidence: Evidence & Record<string, Evidence>; configuration: Record<string, JSONValue> & Record<string, Record<string, JSONValue>> }
export interface Receipt<T = unknown> { requestId: string; scope: Scope; operation: string; requestDigest: string; revision: number; uid: number; result: T }
/** Native results before the service wraps mutations in durable receipts. */
export type Evaluation = ReturnType<typeof evaluateHarness>;
export interface ComposedEvaluationMember {
  rootReference: Reference; closureDigest: string; reference: Reference; scope: Scope;
  evidenceDigest: string | null; configurationDigest: string | null;
  evaluation: Evaluation | { status: string; reason: string; authority: boolean; actions: never[] };
  evaluationDigest: string; status: string; reason?: string;
}
export interface ComposedEvaluation {
  status: string; results: ComposedEvaluationMember[]; reason?: string; authority: boolean; actions: never[];
}
export interface EvaluationReport {
  workspaceId: string; scope: Scope; reference: Reference; pins: Reference[];
  closureDigest: string; evidenceDigest: string; configurationDigest: string;
  evaluation: Evaluation | ComposedEvaluation; evaluationDigest: string;
  status: string; authority: boolean; actions: never[];
}
export interface ResultMap {
  'workspace.inspect': { workspaceId: string; revision: number; scope: Scope; assetCount: number; authority: boolean };
  'asset.list': { id: string; version: string; digest: string; published: boolean }[];
  'asset.inspect': AssetRecord;
  'asset.put': { id: string; version: string; digest: string; validation: Validation };
  'asset.review': NonNullable<AssetRecord['review']>;
  'asset.decide': NonNullable<AssetRecord['decision']>;
  'asset.publish': { reference: Reference; blobDigest: string; delivery: Delivery; resolution: Closure };
  'asset.evaluate': { report: EvaluationReport; reportDigest: string };
  'source.install': SourceRecord;
  'source.reinspect': SourceRecord;
  'legacy.import': SourceRecord;
  'source.inspect': SourceRecord & { raw: string };
  'source.list': (Pick<SourceRecord, 'sourceId' | 'rawDigest' | 'observed' | 'status'> & SourceOrigin)[];
  // Legacy semantic payloads remain opaque at this compatibility boundary.
  'semantic.compatibility.inspect': { workspaceId: string; scope: Scope; report: unknown; authority: boolean };
  'receipt.inspect': MutationReceipt;
  'evaluation.inspect': MutationReceipt<'asset.evaluate'>;
}
export type MutationReceipt<K extends Mutation = Mutation> = {
  [P in K]: Omit<Receipt<ResultMap[P]>, 'operation'> & { operation: P }
}[K];
export type Response<K extends Operation> = K extends Mutation ? MutationReceipt<K> : ResultMap[K];
export function errorCode(error: unknown): string | undefined { return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined; }
