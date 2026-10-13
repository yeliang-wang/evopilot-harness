import type { Scope, State, Store, AssetRecord, HarnessAsset, Evidence, Providers, Closure, Reference, OntologyResponse, DispatchRequest, DispatchInput, JSONValue, ServiceRequest, WorkspaceOptions, SourceRecord, SourceOrigin, SemanticInput, SemanticRequirementsInput, GroundingResult, ConceptInput, RelationRequirement } from './types.js';
import { errorCode } from './types.js';
import type { Operation, Request, Response } from './types.js';
export type { Operation, OperationInputs, Request, ServiceRequest, Response, ResultMap, Mutation, MutationReceipt, Receipt, Scope, WorkspaceOptions, Providers, HarnessAsset, Evidence, AssetRecord, SourceRecord, EvaluationReport } from './types.js';
import { validateProviders } from './resolution.js';
import { exactFields, frozenClone, sha256, stableSerialize } from '../vendor/compatibility/v1/reference.mjs';
import { openState, bounded, fail, LIMITS, validateState } from './state.js';
import { operations, validateRequest, operate } from './operations.js';

// Construction and discovery are pure. Persistence begins only at initialize().
export function createHarnessService(options: WorkspaceOptions, trustedProviders: Providers = {}) {
  const providers = validateProviders(trustedProviders);
  bounded(options); exactFields(options, ['workspaceRoot', 'workspaceId']);
  const { workspaceRoot, workspaceId } = options;
  let store: Store | null = null, closed = false;
  const capabilities = () => frozenClone({ product: 'harness', version: '0.2.0', stage: 'M2_OWNED_SERVICE', businessOperationsReady: true, operations, limits: LIMITS, authority: false, softwareRelease: false, composedEvaluation: true, pending: ['MCP', 'Expert', 'Host acceptance'] });
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
  function close() { if (store) { store.db.close(); store = null; } closed = true; }
  return Object.freeze({ capabilities, initialize, execute, close });
}
