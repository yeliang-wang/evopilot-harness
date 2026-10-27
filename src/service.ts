import {legacyReconstructionReadback} from './readiness-reconstruction.js';
import {createHarnessReadiness,READINESS_HARNESS_OPERATIONS} from './readiness.js';
export type * from './readiness.js';
import {createUsabilityAssessment,USABILITY_OPERATIONS} from './usability-assessment.js';
import type {UsabilityRequest,UsabilityOperation,UsabilityResponse} from './usability-assessment.js';
export type {UsabilityRequest,UsabilityInputs,UsabilityResults,UsabilityResponse,UsabilityOperation,UsabilityAssessmentProviders,UsabilityInventoryRecord,UsabilityAssetBinding} from './usability-assessment.js';
import type {NativeHarnessRecord} from './native-types.js';
import type {ReadRequest} from '../vendor/readability/v1/readability.mjs';
import {createReadableAPI,READABLE_OPERATIONS} from '../vendor/readability/v1/readability.mjs';
import {harnessReadSnapshot} from './readable.js';
export type {ReadSnapshot,ReadRow,ReadQuery,ReadRequest,ReadScope} from '../vendor/readability/v1/readability.mjs';
import {createOwnerFeedback,OWNER_FEEDBACK_OPERATIONS} from '../vendor/compatibility/feedback/v1/owner.mjs';
import {createOnlineHarness,ONLINE_OPERATIONS} from './online-service.js';
import {createHarnessResponse,RESPONSE_HARNESS_OPERATIONS} from './response.js';
import type {ResponseEnvelope} from '../vendor/compatibility/response/v1/response.mjs';
export type * from '../vendor/compatibility/response/v1/response.mjs';
export type {ResponseHarnessProviders,ResponseAssessment} from './response.js';
import type {OnlineEnvelope} from '../vendor/compatibility/online/v1/online.mjs';
import type {FeedbackEnvelope} from '../vendor/compatibility/feedback/v1/feedback.mjs';
export type * from '../vendor/compatibility/feedback/v1/feedback.mjs';
import { executeNativeHarness, NATIVE_OPERATIONS } from './native-service.js';
import { inspectHarnessStandard } from './native-standard.js';
import type { NativeRequest, NativeOperation, NativeResponse } from './native-types.js';
import type { Scope, State, Store, AssetRecord, HarnessAsset, Evidence, Providers, Closure, Reference, OntologyResponse, DispatchRequest, DispatchInput, JSONValue, ServiceRequest, WorkspaceOptions, SourceRecord, SourceOrigin, SemanticInput, SemanticRequirementsInput, GroundingResult, ConceptInput, RelationRequirement } from './types.js';
import { errorCode } from './types.js';
import type { Operation, Request, Response } from './types.js';
export type { Operation, OperationInputs, Request, ServiceRequest, Response, ResultMap, Mutation, MutationReceipt, Receipt, Scope, WorkspaceOptions, Providers, HarnessAsset, Evidence, AssetRecord, SourceRecord, EvaluationReport } from './types.js';
import { validateProviders } from './resolution.js';
import { exactFields, frozenClone, sha256, stableSerialize } from '../vendor/compatibility/v1/reference.mjs';
import { openState, bounded, fail, slug, LIMITS, validateState } from './state.js';
import { operations, mutations, validateRequest, operate } from './operations.js';

// Construction and discovery are pure. Persistence begins only at initialize().
export function createHarnessService(options: WorkspaceOptions, trustedProviders: Providers = {}) {
  const providers = validateProviders(trustedProviders);
  bounded(options); exactFields(options, ['workspaceRoot', 'workspaceId']);
  const { workspaceRoot, workspaceId } = options;
  let store: Store | null = null, closed = false, activeNative = 0,activeOnline=0,activeResponse=0;
  let onlineService:ReturnType<typeof createOnlineHarness>|null=null;
  const capabilities = () => frozenClone({ product: 'harness', version: '0.8.3', stage: 'NATIVE_STANDARDS', businessOperationsReady: true, readinessOperations:READINESS_HARNESS_OPERATIONS, readableOperations:READABLE_OPERATIONS, operations: operations.filter(op => !mutations.includes(op)), historicalOperationsReadOnly: true, nativeOperations: NATIVE_OPERATIONS, feedbackOperations: OWNER_FEEDBACK_OPERATIONS, usabilityOperations:USABILITY_OPERATIONS, onlineOperations:ONLINE_OPERATIONS, responseOperations:RESPONSE_HARNESS_OPERATIONS, limits: LIMITS, authority: false, softwareRelease: false, composedEvaluation: true, pending: ['exact-candidate acceptance'] });
  function initialize() {
    if (closed) fail('CLOSED', 'Service is closed');
    if (!store) store = openState(workspaceRoot, workspaceId);
    return frozenClone({ workspaceId, initialized: true, authority: false });
  }
  function executeCore(request: ServiceRequest): unknown {
    let transaction = false;
    try {
      bounded(request);
      const r = frozenClone(request) as DispatchRequest, write = validateRequest(r);
      if (closed) fail('CLOSED', 'Service is closed');
      if (!store) fail('NOT_INITIALIZED', 'Explicit initialize required');
      store.guard();
      if (write) {
        const retained = store.db.prepare('SELECT digest, receipt FROM receipts WHERE scope=? AND request_id=?').get(stableSerialize(r.scope),r.requestId);
        if (retained && retained.digest === sha256({operation:r.operation,scope:r.scope,input:r.input})) return frozenClone(JSON.parse(retained.receipt as string));
        fail('HISTORICAL_READ_ONLY','Retired JSON operations cannot write or certify corrected v1; use native.package.*');
      }
      const { db } = store;
      db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN'); transaction = true;
      const scope = stableSerialize(r.scope);
      // expectedRevision is a CAS precondition, not part of the idempotent intent.
      const digest = write ? sha256({ operation: r.operation, scope: r.scope, input: r.input }) : null;
      if (write) {
        const old = db.prepare('SELECT digest, receipt FROM receipts WHERE scope = ? AND request_id = ?').get(scope, r.requestId);
        if (old) {
          if (old.digest !== digest) fail('REQUEST_CONFLICT', 'Request id already binds different content');
          const result = JSON.parse(old.receipt as string); db.exec('COMMIT'); transaction = false; return frozenClone(result);
        }
      }
      const row = db.prepare('SELECT revision, data FROM state WHERE singleton = 1').get();
      if (!row || !Number.isSafeInteger(row.revision)) fail('CORRUPT_STATE', 'Missing state');
      if (write && row.revision !== r.expectedRevision) fail('REVISION_CONFLICT', 'Global product revision changed');
      const state = validateState(JSON.parse(row.data as string));
      let result;
      if (r.operation === 'workspace.inspect') result = { workspaceId, revision: row.revision, scope: r.scope, assetCount: state.assets.filter(a => stableSerialize(a.scope) === scope).length, authority: false };
      else if (['receipt.inspect', 'evaluation.inspect'].includes(r.operation)) {
        const receipt = db.prepare('SELECT receipt FROM receipts WHERE scope = ? AND request_id = ?').get(scope, r.input.requestId);
        if (!receipt) fail('NOT_FOUND', 'Receipt not found in scope');
        result = JSON.parse(receipt.receipt as string);
        if (r.operation === 'evaluation.inspect') {
          if (result.operation !== 'asset.evaluate') fail('NOT_FOUND', 'Not an evaluation receipt');
          store.verifyBlob(r.scope, result.result.report);
        }
      } else result = operate(store, state, r, providers);
      if (write) {
        if (db.prepare('SELECT count(*) AS n FROM receipts') .get()!.n as number >= LIMITS.receipts || (row.revision as number) >= Number.MAX_SAFE_INTEGER) fail('LIMIT', 'Receipt/revision limit');
        const data = stableSerialize(state);
        if (Buffer.byteLength(data) > LIMITS.stateBytes) fail('LIMIT', 'State byte limit');
        const revision = (row.revision as number) + 1;
        const receipt = { requestId: r.requestId, scope: r.scope, operation: r.operation, requestDigest: digest, revision, uid: store.uid, result };
        const receiptJSON = stableSerialize(receipt);
        if (db.prepare('SELECT coalesce(sum(length(CAST(receipt AS BLOB))),0) AS bytes FROM receipts') .get()!.bytes as number + Buffer.byteLength(receiptJSON) > LIMITS.receiptBytes) fail('LIMIT', 'Receipt byte limit');
        db.prepare('UPDATE state SET revision = ?, data = ? WHERE singleton = 1 AND revision = ?').run(revision, data, row.revision);
        db.prepare('INSERT INTO receipts(scope, request_id, digest, receipt) VALUES(?,?,?,?)').run(scope, r.requestId, digest, receiptJSON);
        db.prepare('INSERT INTO audit(revision, uid, operation, request_digest, result_digest) VALUES(?,?,?,?,?)').run(revision, store.uid, r.operation, digest, sha256(result));
        result = receipt;
      }
      db.exec('COMMIT'); transaction = false;
      return frozenClone(result);
    } catch (e) {
      if (transaction) { try { store!.db.exec('ROLLBACK'); } catch { /* Preserve original failure. */ } }
      if (typeof errorCode(e) === 'string' && !errorCode(e)!.startsWith('ERR_') && !errorCode(e)!.startsWith('SQLITE_')) throw e;
      fail(errorCode(e) === 'ERR_SQLITE_ERROR' ? 'STATE_ERROR' : 'INVALID_REQUEST', 'Service request failed: ' + (errorCode(e) || 'invalid data'));
    }
  }
  function execute<K extends Operation>(request: Request<K>): Response<K>;
  function execute(request: ServiceRequest): Response<Operation> {
    // validateRequest checks the operation and exact envelope before dispatch;
    // native handlers and the transaction wrapper establish this result mapping.
    return executeCore(request) as Response<Operation>;
  }
  function native<K extends NativeOperation>(request: NativeRequest<K>): Promise<NativeResponse<K>>;
  async function native(request: NativeRequest): Promise<NativeResponse<NativeOperation>> {
    if (closed) fail('CLOSED','Service is closed');
    if (request.operation === 'standard.inspect') {
      if (stableSerialize(Object.keys(request).sort()) !== stableSerialize(['input', 'operation', 'scope']) || !request.input || Object.keys(request.input).length || !request.scope || stableSerialize(Object.keys(request.scope).sort()) !== stableSerialize(['projectId', 'visibility']) || !['public', 'private'].includes(request.scope.visibility)) fail('INVALID_REQUEST', 'Exact standard inspection request required');
      slug(request.scope.projectId); return inspectHarnessStandard();
    }
    if (!store) fail('NOT_INITIALIZED','Explicit initialize required');
    activeNative++;
    try { return await executeNativeHarness(store,request,providers) as NativeResponse<NativeOperation>; } finally { activeNative--; }
  }
  let activeFeedback=0;
  async function feedback(request:FeedbackEnvelope):Promise<unknown>{if(closed)fail('CLOSED','Service closed');if(!store)fail('NOT_INITIALIZED','Explicit initialize required');activeFeedback++;try{return await createOwnerFeedback(store,'harness',providers).feedback(request);}finally{activeFeedback--;}}
  async function online(request:OnlineEnvelope):Promise<unknown>{if(closed)fail('CLOSED','Service closed');if(!store)fail('NOT_INITIALIZED','Explicit initialize required');if(!onlineService)onlineService=createOnlineHarness(store,providers);activeOnline++;try{return await onlineService.online(request);}finally{activeOnline--;}}
  async function response(request:ResponseEnvelope):Promise<unknown>{if(closed)fail('CLOSED','Service closed');if(!store)fail('NOT_INITIALIZED','Explicit initialize required');activeResponse++;try{return await createHarnessResponse(store,providers).response(request);}finally{activeResponse--;}}
  let activeReadable=0;
  const readableAPI=createReadableAPI({kind:'asset',list:async scope=>(await native({operation:'native.package.list',scope,input:{}})).map(r=>({id:r.reference.id,version:r.reference.version,published:r.published,packageDigest:r.reference.digest})),get:async(scope,identity)=>harnessReadSnapshot(await native({operation:'native.package.inspect',scope,input:{id:identity.id,version:identity.version!}}) as NativeHarnessRecord,options.workspaceId,scope)});
  async function readable(request:ReadRequest):Promise<unknown>{if(closed)fail('CLOSED','Service is closed');if(!store)fail('NOT_INITIALIZED','Explicit initialize required');activeReadable++;try{return await readableAPI(request);}finally{activeReadable--;}}
  let activeUsability=0;
  async function usability<K extends UsabilityOperation>(request:UsabilityRequest<K>):Promise<UsabilityResponse<K>>{if(closed)fail('CLOSED','Service closed');if(!store)fail('NOT_INITIALIZED','Explicit initialize required');activeUsability++;try{return await createUsabilityAssessment(store,providers).usability(request);}finally{activeUsability--;}}
  let activeReadiness=0;
  async function readiness(request:FeedbackEnvelope):Promise<unknown>{if(closed)fail('CLOSED','Service closed');if(!store)fail('NOT_INITIALIZED','Explicit initialize required');activeReadiness++;try{return await createHarnessReadiness(store,{...providers,readReadinessReconstruction:providers.readReadinessReconstruction??(context=>legacyReconstructionReadback(context,usability))}).readiness(request);}finally{activeReadiness--;}}
  function close() { if(activeReadiness)fail('BUSY','Readiness operation in progress'); if(activeUsability)fail('BUSY','Usability assessment in progress'); if(activeReadable)fail('BUSY','Readable snapshot is in progress'); if(activeResponse)fail('BUSY','Response operation is still in progress'); if(activeOnline)fail('BUSY','Online operation is still in progress'); if(activeFeedback)fail('BUSY','Feedback operation is still in progress'); if (activeNative) fail('BUSY', 'Native operation is still in progress'); if (store) { store.db.close(); store = null; } closed = true; }
  return Object.freeze({ readiness, capabilities, initialize, execute, native, readable, feedback, online, response, usability, close });
}

export type {OracleInputs,OracleResults,OracleBinding,OracleEvaluation,OracleProviders} from './usability-oracle.js';
export type {BehaviorOracle,BehaviorObservation,OracleTolerance,ReconstructionObservation,BehaviorOracleResult} from '../vendor/usability/v1/oracle.mjs';
