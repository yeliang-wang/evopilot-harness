import {requireReadinessAuthoring} from '../vendor/compatibility/usability/v2/authoring.mjs';
import { nativeExact, nativeSha256, nativeStableSerialize, nativeFrozenClone, nativeText, nativePackageDigest, referenceForPackage, validateNativeReference, validateNativePackage } from '../vendor/compatibility/v1/native.mjs';
import type { NativeReference, NativeScope } from '../vendor/compatibility/v1/native.mjs';
import type { NativeRequest, NativeOperation, NativeHarnessProviders, NativeHarnessRecord, NativeHarnessReceipt, NativeHarnessReport, NativeHarnessReview, NativeHarnessDecision } from './native-types.js';
import type { Store } from './types.js';
import { fail, slug } from './state.js';
import { inspectHarnessStandard } from './native-standard.js';
import { inspectHarnessPackage } from './native-package.js';
import { validateNativeHarness } from './native-evaluation.js';
import { verifyDecisionEvidence } from '../vendor/compatibility/v1/decision-evidence.mjs';
import {requireNativeAuthoring, type NativeAuthoringAdmission} from '../vendor/usability/v1/authoring.mjs';
export const NATIVE_OPERATIONS: NativeOperation[] = ['standard.inspect', 'native.package.put', 'native.package.inspect', 'native.package.list', 'native.package.validate', 'native.package.review', 'native.package.decide', 'native.package.publish', 'native.package.readback', 'native.receipt.inspect'];
const mutations = new Set(['native.package.put', 'native.package.validate', 'native.package.review', 'native.package.decide', 'native.package.publish']);
const fields: Record<NativeOperation, string[]> = { 'standard.inspect': [], 'native.package.put': ['package'], 'native.package.inspect': ['id', 'version'], 'native.package.list': [], 'native.package.validate': ['id', 'version'], 'native.package.review': ['id', 'version'], 'native.package.decide': ['id', 'version', 'reviewDigest', 'decision', 'humanEvidenceRef'], 'native.package.publish': ['id', 'version'], 'native.package.readback': ['id', 'version'], 'native.receipt.inspect': ['requestId'] };
function table(store: Store) { return !!store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='native_packages'").get(); }
function initializeTables(store: Store) { store.db.exec('CREATE TABLE IF NOT EXISTS native_packages(scope TEXT NOT NULL,id TEXT NOT NULL,version TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(scope,id,version)); CREATE TABLE IF NOT EXISTS native_receipts(scope TEXT NOT NULL,request_id TEXT NOT NULL,intent_digest TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(scope,request_id)); CREATE TABLE IF NOT EXISTS native_audit(revision INTEGER PRIMARY KEY,scope TEXT NOT NULL,request_id TEXT NOT NULL,receipt TEXT NOT NULL);'); if(Number(store.db.prepare('PRAGMA user_version').get()!.user_version)<2)store.db.exec('PRAGMA user_version=2'); }
function audit(store: Store, r: NativeHarnessReceipt) { store.db.prepare('INSERT INTO native_audit VALUES(?,?,?,?)').run(r.revision, nativeStableSerialize(r.scope), r.requestId, nativeStableSerialize(r)); }
function revision(store: Store) { return store.db.prepare('SELECT revision FROM state WHERE singleton=1').get()!.revision as number; }
function advance(store: Store) { store.db.prepare('UPDATE state SET revision=revision+1 WHERE singleton=1').run(); return revision(store); }
function readRecord(store: Store, scope: NativeScope, id: string, version: string) { const row = table(store) ? store.db.prepare('SELECT record FROM native_packages WHERE scope=? AND id=? AND version=?').get(nativeStableSerialize(scope), id, version) : undefined; if (!row)
    fail('NOT_FOUND', 'Native package not found'); const r = JSON.parse(row.record as string) as NativeHarnessRecord; store.verifyBlob(scope, r.package); validateNativePackage(r.package, { owner: 'harness' }); if (nativeStableSerialize(referenceForPackage(r.package)) !== nativeStableSerialize(r.reference))
    fail('CORRUPT_STATE', 'Native package identity differs'); if (r.validation) {
    const { reportDigest, ...body } = r.validation;
    if (reportDigest !== nativeSha256(body))
        fail('CORRUPT_STATE', 'Native validation digest differs');
    store.verifyBlob(scope, r.validation);
} return r; }
function saveRecord(store: Store, r: NativeHarnessRecord) { store.db.prepare('INSERT INTO native_packages(scope,id,version,record) VALUES(?,?,?,?) ON CONFLICT(scope,id,version) DO UPDATE SET record=excluded.record').run(nativeStableSerialize(r.scope), r.reference.id, r.reference.version, nativeStableSerialize(r)); }
function readReceipt(store: Store, scope: NativeScope, id: string) { const row = table(store) ? store.db.prepare('SELECT intent_digest,receipt FROM native_receipts WHERE scope=? AND request_id=?').get(nativeStableSerialize(scope), id) : undefined; return row ? { digest: row.intent_digest as string, receipt: JSON.parse(row.receipt as string) as NativeHarnessReceipt } : null; }
function authoring(store:Store,providers:NativeHarnessProviders,scope:NativeScope,pkg:NativeHarnessRecord['package'],retained?:NativeAuthoringAdmission):NativeAuthoringAdmission {
    const bindings=JSON.parse(pkg.files[pkg.manifest.sourceBindingRef]);
    requireReadinessAuthoring(pkg,store.identity.id,scope,providers.resolveReadinessAuthoring);
  return requireNativeAuthoring(providers.resolveNativeAuthoring,{workspaceId:store.identity.id,scope,owner:'harness',packageDigest:nativePackageDigest(pkg),sourceBindingsDigest:nativeSha256(bindings),sourceDirection:bindings.direction},retained);
}
async function dependencies(store: Store, r: NativeHarnessRecord, p: NativeHarnessProviders) { const values: unknown[] = []; for (const ref of r.package.manifest.dependencies) {
    if (ref.product === 'harness') {
        const resolved = readRecord(store, { visibility: ref.visibility, projectId: r.scope.projectId }, ref.id, ref.version);
        if (!resolved.published || nativeStableSerialize(resolved.reference) !== nativeStableSerialize(ref))
            fail('DEPENDENCY_MISMATCH', 'Published exact native dependency required');
        values.push(resolved.reference);
    }
    else {
        if (!p.resolveNativeDependency)
            fail('UNAVAILABLE_DEPENDENCY', 'Trusted native dependency resolver required');
        const observed = await p.resolveNativeDependency({ workspaceId: store.identity.id, scope: r.scope, reference: ref });
        validateNativeReference(observed.reference, { product: ref.product });
        if (observed.published !== true || observed.workspaceId !== store.identity.id || observed.scope.projectId !== r.scope.projectId && observed.scope.projectId !== 'shared' || ref.visibility === 'private' && observed.scope.projectId !== r.scope.projectId || observed.scope.visibility !== ref.visibility || nativeStableSerialize(observed.reference) !== nativeStableSerialize(ref))
            fail('DEPENDENCY_MISMATCH', 'Exact published scoped reference required');
        values.push(observed);
    }
} return nativeSha256(values); }
export async function executeNativeHarness(store: Store, request: NativeRequest, providers: NativeHarnessProviders): Promise<unknown> {
    const r = nativeFrozenClone(request) as NativeRequest;
    if (!NATIVE_OPERATIONS.includes(r.operation))
        fail('UNSUPPORTED_OPERATION', 'Unknown native operation');
    const write = mutations.has(r.operation);
    nativeExact(r, ['operation', 'scope', 'input', ...(write ? ['requestId', 'expectedRevision'] : [])]);
    nativeExact(r.scope, ['visibility', 'projectId']);
    slug(r.scope.projectId);
    if (!['public', 'private'].includes(r.scope.visibility))
        fail('SCOPE_MISMATCH', 'Explicit native visibility required');
    nativeExact(r.input, fields[r.operation], r.operation === 'native.package.validate' ? ['observation', 'context'] : []);
    store.guard();
    if (r.operation === 'standard.inspect')
        return inspectHarnessStandard();
    if (r.operation === 'native.receipt.inspect') {
        slug(r.input.requestId);
        const found = readReceipt(store, r.scope, r.input.requestId);
        if (!found)
            fail('NOT_FOUND', 'Native receipt not found');
        return nativeFrozenClone(found.receipt);
    }
    if (r.operation === 'native.package.list')
        return nativeFrozenClone(table(store) ? store.db.prepare('SELECT record FROM native_packages WHERE scope=? ORDER BY id,version').all(nativeStableSerialize(r.scope)).map(row => { const p = JSON.parse(row.record as string) as NativeHarnessRecord; return { reference: p.reference, published: p.published }; }) : []);
    if (!write && ('id' in r.input)) {
        const record = readRecord(store, r.scope, r.input.id, r.input.version);
        if (r.operation === 'native.package.readback') {
            if (!record.published)
                fail('NOT_PUBLISHED', 'Native published readback required');
            return nativeFrozenClone({ reference: record.reference, published: true, workspaceId: store.identity.id, scope: r.scope, package: record.package, validation: record.validation });
        }
        return nativeFrozenClone(record);
    }
    if (!('requestId' in r) || !('expectedRevision' in r))
        fail('INVALID_REQUEST', 'Native mutation identity required');
    slug(r.requestId);
    if (!Number.isSafeInteger(r.expectedRevision) || r.expectedRevision < 0)
        fail('INVALID_REQUEST', 'Expected revision required');
    const intent = nativeSha256({ operation: r.operation, scope: r.scope, input: r.input }), prior = readReceipt(store, r.scope, r.requestId);
    if (prior) {
        if (prior.digest !== intent)
            fail('REQUEST_CONFLICT', 'Native request ID binds another intent');
        return nativeFrozenClone(prior.receipt);
    }
    // Fail admission before any durable claim or asset bytes. Published validation
    // consumes existing immutable material; it does not start new authoring.
    let admittedAuthoring:NativeAuthoringAdmission|undefined;
    if(r.operation==='native.package.put') {
        const {pkg}=inspectHarnessPackage(r.input.package);
        if(pkg.manifest.visibility!==r.scope.visibility)fail('SCOPE_MISMATCH','Package visibility differs');
        admittedAuthoring=authoring(store,providers,r.scope,pkg);
    } else if('id' in r.input) {
        const record=readRecord(store,r.scope,r.input.id,r.input.version);
        if(!record.published){
            if(!record.authoring)fail('AUTHORING_CONTEXT_REQUIRED','Legacy draft requires a new bound authoring admission');
            admittedAuthoring=authoring(store,providers,r.scope,record.package,record.authoring);
        }
    }
    // A durable claim precedes all native subprocess activity. A process crash leaves RUNNING;
    // replay reads that claim and never redispatches it. The host reconciles explicitly.
    store.db.exec('BEGIN IMMEDIATE');
    let transaction = true;
    let claim: NativeHarnessReceipt;
    try {
        if (revision(store) !== r.expectedRevision)
            fail('REVISION_CONFLICT', 'Global product revision changed');
        initializeTables(store);
        if(admittedAuthoring&&Number(store.db.prepare('PRAGMA user_version').get()!.user_version)<6)store.db.exec('PRAGMA user_version=6');
        if(r.operation==='native.package.put'&&Object.hasOwn(r.input.package.files,'readiness/specification-v2.json'))store.db.exec('PRAGMA user_version=8');
        claim = { requestId: r.requestId, operation: r.operation, scope: r.scope, requestDigest: intent, revision: advance(store), status: 'RUNNING', result: null, authority: false };
        store.db.prepare('INSERT INTO native_receipts VALUES(?,?,?,?)').run(nativeStableSerialize(r.scope), r.requestId, intent, nativeStableSerialize(claim));
        audit(store, claim);
        store.db.exec('COMMIT');
        transaction = false;
    }
    catch (e) {
        if (transaction)
            store.db.exec('ROLLBACK');
        throw e;
    }
    let result: unknown;
    let candidate: NativeHarnessRecord | undefined;
    let baseRecordDigest: string | null = null;
    try {
        if (r.operation === 'native.package.put') {
            const { pkg } = inspectHarnessPackage(r.input.package);
            if (pkg.manifest.visibility !== r.scope.visibility)
                fail('SCOPE_MISMATCH', 'Package visibility differs');
            let old: NativeHarnessRecord | undefined;
            try {
                old = readRecord(store, r.scope, pkg.manifest.id, pkg.manifest.version);
            }
            catch (e) {
                if (!(e && typeof e === 'object' && 'code' in e && e.code === 'NOT_FOUND'))
                    throw e;
            }
            baseRecordDigest = old ? nativeSha256(old) : null;
            if (old?.published)
                fail('IMMUTABLE_VERSION', 'Published native version cannot change');
            store.blob(r.scope, pkg);
            candidate = { authoring: admittedAuthoring!, scope: r.scope, package: pkg, reference: referenceForPackage(pkg) as NativeReference, validation: null, review: null, decision: null, published: false, dependencyDigest: null };
            result = { reference: candidate.reference };
        }
        else if ('id' in r.input) {
            candidate = readRecord(store, r.scope, r.input.id, r.input.version);
            baseRecordDigest = nativeSha256(candidate);
            const inspectedPackage = inspectHarnessPackage(candidate.package);
            if (candidate.published && r.operation !== 'native.package.validate')
                fail('IMMUTABLE_VERSION', 'Published native package immutable');
            const depDigest = await dependencies(store, candidate, providers);
            if (r.operation === 'native.package.validate') {
                if (!providers.nativeToolchain)
                    fail('TOOLCHAIN_REQUIRED', 'Installed native toolchain required');
                if (r.input.context && (r.input.context.workspaceId !== store.identity.id || r.scope.visibility === 'private' && nativeStableSerialize(r.input.context.scope) !== nativeStableSerialize(r.scope)))
                    fail('SCOPE_MISMATCH', 'Validation context scope mismatch');
                const report = await validateNativeHarness(candidate.package, providers.nativeToolchain, { ...(r.input.observation ? { observation: r.input.observation } : {}), ...(r.input.context ? { context: r.input.context } : {}) });
                store.blob(r.scope, report);
                result = report;
                if (!candidate.published) {
                    candidate.validation = report;
                    candidate.review = null;
                    candidate.decision = null;
                    candidate.dependencyDigest = depDigest;
                }
            }
            else if (r.operation === 'native.package.review') {
                if (!candidate.validation || candidate.validation.qualityStatus !== 'PASS' || candidate.validation.executionStatus !== 'SUCCEEDED' || candidate.validation.context !== null || candidate.validation.observationDigest !== nativeSha256(inspectedPackage.observation) || candidate.validation.effectiveConfigDigest !== inspectedPackage.effectiveConfigDigest || candidate.validation.toolchainLockDigest !== providers.nativeToolchain?.lockDigest)
                    fail('VALIDATION_REQUIRED', 'Passing asset baseline validation required');
                if (candidate.validation.reference.digest !== candidate.reference.digest || candidate.dependencyDigest !== depDigest)
                    fail('REVIEW_REQUIRED', 'Validation input/dependency changed');
                const subject = { packageDigest: candidate.reference.digest, reportDigest: candidate.validation.reportDigest, standardDigest: candidate.reference.standardDigest, dependencyDigest: depDigest, authority: false as const };
                candidate.review = { ...subject, reviewDigest: nativeSha256(subject) };
                candidate.decision = null;
                result = candidate.review;
            }
            else {
                const review = candidate.review;
                if (!review || review.packageDigest !== candidate.reference.digest || review.dependencyDigest !== depDigest || review.reportDigest !== candidate.validation?.reportDigest)
                    fail('REVIEW_REQUIRED', 'Exact current native review required');
                if (r.operation === 'native.package.decide') {
                    if (r.input.reviewDigest !== review.reviewDigest || !['APPROVE', 'REJECT'].includes(r.input.decision))
                        fail('REVIEW_MISMATCH', 'Decision must bind exact review');
                    verifyDecisionEvidence(r.input.humanEvidenceRef,{owner:'harness',operation:'native.package.decide',workspaceId:store.identity.id,scope:r.scope,reviewDigest:review.reviewDigest,decision:r.input.decision});
                    candidate.decision = { reviewDigest: r.input.reviewDigest, decision: r.input.decision, humanEvidenceRef: r.input.humanEvidenceRef };
                    result = candidate.decision;
                }
                else if (r.operation === 'native.package.publish') {
                    if (candidate.decision?.decision !== 'APPROVE' || candidate.decision.reviewDigest !== review.reviewDigest)
                        fail('APPROVAL_REQUIRED', 'Exact domain approval required');
                    verifyDecisionEvidence(candidate.decision.humanEvidenceRef,{owner:'harness',operation:'native.package.decide',workspaceId:store.identity.id,scope:r.scope,reviewDigest:review.reviewDigest,decision:'APPROVE'});
                    candidate.published = true;
                    result = { reference: candidate.reference, published: true, workspaceId: store.identity.id, scope: r.scope, package: candidate.package, validation: candidate.validation };
                }
            }
        }
        if (result === undefined)
            fail('UNSUPPORTED_OPERATION', 'Native dispatch missing result');
        store.guard();
        store.db.exec('BEGIN IMMEDIATE');
        transaction = true;
        if (candidate) {
            if(admittedAuthoring)authoring(store,providers,r.scope,candidate.package,admittedAuthoring);
            let current: NativeHarnessRecord | undefined;
            try {
                current = readRecord(store, r.scope, candidate.reference.id, candidate.reference.version);
            }
            catch (e) {
                if (!(e && typeof e === 'object' && 'code' in e && e.code === 'NOT_FOUND'))
                    throw e;
            }
            if ((current ? nativeSha256(current) : null) !== baseRecordDigest)
                fail('REVIEW_REQUIRED', 'Package state changed during native operation');
        }
        if (candidate)
            saveRecord(store, candidate);
        claim = { ...claim!, revision: advance(store), status: 'SUCCEEDED', result };
        store.db.prepare('UPDATE native_receipts SET receipt=? WHERE scope=? AND request_id=?').run(nativeStableSerialize(claim), nativeStableSerialize(r.scope), r.requestId);
        audit(store, claim);
        store.db.exec('COMMIT');
        transaction = false;
        return nativeFrozenClone(claim);
    }
    catch (e) {
        if (transaction) {
            store.db.exec('ROLLBACK');
            transaction = false;
        }
        const error = { code: e && typeof e === 'object' && 'code' in e ? String(e.code) : 'NATIVE_VALIDATION_ERROR', message: e instanceof Error ? e.message : 'Native failure' };
        store.db.exec('BEGIN IMMEDIATE');
        claim = { ...claim!, revision: advance(store), status: 'FAILED', result: { error } };
        store.db.prepare('UPDATE native_receipts SET receipt=? WHERE scope=? AND request_id=?').run(nativeStableSerialize(claim), nativeStableSerialize(r.scope), r.requestId);
        audit(store, claim);
        store.db.exec('COMMIT');
        throw Object.assign(new Error(error.message), { code: error.code, receipt: claim });
    }
}
