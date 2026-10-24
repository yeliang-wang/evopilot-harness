import type {NativeAuthoringResolver, NativeAuthoringAdmission} from '../vendor/usability/v1/authoring.mjs';
import type {FeedbackOwnerProviders as importFeedbackProviders} from '../vendor/compatibility/feedback/v1/feedback.mjs';
import type {OnlineHarnessProviders} from '../vendor/compatibility/online/v1/online.mjs';
import type { inspectHarnessStandard } from './native-standard.js';
import type { NativePackage, NativeReference, NativeScope, NativeToolchain, NativeValidationContext, NativeJSON } from '../vendor/compatibility/v1/native.mjs';
export type { NativePackage, NativeReference, NativeScope, NativeToolchain, NativeValidationContext } from '../vendor/compatibility/v1/native.mjs';
export interface HarnessObservation {
    schema: 'evopilot-observation/v1';
    origin: 'execution-result' | 'synthetic' | 'source-declaration' | 'design-declaration' | 'runtime-observation' | 'imported';
    source: {
        revision: string;
        digest: string;
    };
    values: Record<string, NativeJSON>;
    collectionReceiptRef?: {
        id: string;
        digest: string;
        claimId: string;
    };
    sourceScopeDigest?: string;
}
export interface NativeHarnessProviders extends importFeedbackProviders,OnlineHarnessProviders {
    resolveNativeAuthoring?: NativeAuthoringResolver;
    nativeToolchain?: NativeToolchain;
    resolveNativeDependency?: (request: {
        workspaceId: string;
        scope: NativeScope;
        reference: NativeReference;
    }) => Promise<{
        reference: NativeReference;
        published: boolean;
        workspaceId: string;
        scope: NativeScope;
    }>;
}
export interface HarnessRule {
    ruleId: string;
    query: string;
    namespace: string;
    required: boolean;
    qualityDomain: string;
    sourceIds: string[];
    targets: string[];
    inputRefs: string[];
    parameterRefs: string[];
    testIds: string[];
    caseIds: string[];
}
export interface HarnessCase {
    id: string;
    input: string;
    expected: 'PASS' | 'FAIL' | 'WARN';
    expectedRuleIds: string[];
    missingInputRefs?: string[];
}
export interface HarnessCoverage {
    schema: 'evopilot-harness-coverage/v1';
    requiredRuleIds: string[];
    requiredTestIds: string[];
    requiredCaseIds: string[];
    requirements: {
        id: string;
        required: boolean;
        ruleIds: string[];
        caseIds: string[];
    }[];
    cases: HarnessCase[];
}
export interface HarnessCommand {
    id: string;
    tool: 'conftest' | 'opa';
    argv: string[];
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    outputLimit: boolean;
    durationMs: number;
}
export interface NativeHarnessReport {
    schema: 'evopilot-native-validation/v1';
    owner: 'harness';
    reference: NativeReference;
    context: NativeValidationContext | null;
    toolchainLockDigest: string;
    executionStatus: 'SUCCEEDED' | 'ERROR' | 'UNKNOWN';
    qualityStatus: 'PASS' | 'FAIL' | 'ERROR';
    observationDigest: string;
    effectiveConfigDigest: string;
    effectiveConfiguration: {
        params: Record<string, NativeJSON>;
    };
    engines: {
        conftest: '0.71.1';
        embeddedOPA: '1.21.1';
        opaCLI: '1.21.2';
    };
    sourceBindingsDigest: string;
    coverageDigest: string;
    criteria: {
        criterionId: string;
        variantId: string;
        status: 'PASS' | 'FAIL' | 'ERROR';
        evidenceDigest: string;
    }[];
    rawReports: {
        path: string;
        sha256: string;
        mediaType: string;
    }[];
    commands: HarnessCommand[];
    issues: string[];
    reportDigest: string;
    authority: false;
}
export interface NativeHarnessReview {
    reviewDigest: string;
    packageDigest: string;
    reportDigest: string;
    standardDigest: string;
    dependencyDigest: string;
    authority: false;
}
export interface NativeHarnessDecision {
    reviewDigest: string;
    decision: 'APPROVE' | 'REJECT';
    humanEvidenceRef: string;
}
export interface NativeHarnessRecord {
    authoring?: NativeAuthoringAdmission;
    scope: NativeScope;
    package: NativePackage;
    reference: NativeReference;
    validation: NativeHarnessReport | null;
    review: NativeHarnessReview | null;
    decision: NativeHarnessDecision | null;
    published: boolean;
    dependencyDigest: string | null;
}
export interface NativeInputs {
    'standard.inspect': Record<string, never>;
    'native.package.put': {
        package: NativePackage;
    };
    'native.package.inspect': {
        id: string;
        version: string;
    };
    'native.package.list': Record<string, never>;
    'native.package.validate': {
        id: string;
        version: string;
        observation?: HarnessObservation;
        context?: NativeValidationContext;
    };
    'native.package.review': {
        id: string;
        version: string;
    };
    'native.package.decide': {
        id: string;
        version: string;
        reviewDigest: string;
        decision: 'APPROVE' | 'REJECT';
        humanEvidenceRef: string;
    };
    'native.package.publish': {
        id: string;
        version: string;
    };
    'native.package.readback': {
        id: string;
        version: string;
    };
    'native.receipt.inspect': {
        requestId: string;
    };
}
export type NativeOperation = keyof NativeInputs;
export type NativeMutation = 'native.package.put' | 'native.package.validate' | 'native.package.review' | 'native.package.decide' | 'native.package.publish';
export type NativeRequest<K extends NativeOperation = NativeOperation> = {
    [P in K]: {
        operation: P;
        scope: NativeScope;
        input: NativeInputs[P];
    } & (P extends NativeMutation ? {
        requestId: string;
        expectedRevision: number;
    } : {});
}[K];
export interface NativeHarnessReceipt {
    requestId: string;
    operation: NativeMutation;
    scope: NativeScope;
    requestDigest: string;
    revision: number;
    status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
    result: unknown;
    authority: false;
}
export interface NativeResultMap {
    'standard.inspect': ReturnType<typeof inspectHarnessStandard>;
    'native.package.put': {
        reference: NativeReference;
    };
    'native.package.inspect': NativeHarnessRecord;
    'native.package.list': {
        reference: NativeReference;
        published: boolean;
    }[];
    'native.package.validate': NativeHarnessReport;
    'native.package.review': NativeHarnessReview;
    'native.package.decide': NativeHarnessDecision;
    'native.package.publish': {
        reference: NativeReference;
        published: true;
        workspaceId: string;
        scope: NativeScope;
        package: NativePackage;
        validation: NativeHarnessReport;
    };
    'native.package.readback': {
        reference: NativeReference;
        published: true;
        workspaceId: string;
        scope: NativeScope;
        package: NativePackage;
        validation: NativeHarnessReport;
    };
    'native.receipt.inspect': NativeMutationReceipt;
}
export type NativeMutationReceipt<K extends NativeMutation = NativeMutation> = {
    [P in K]: Omit<NativeHarnessReceipt, 'operation' | 'result' | 'status'> & {
        operation: P;
    } & ({
        status: 'SUCCEEDED';
        result: NativeResultMap[P];
    } | {
        status: 'RUNNING' | 'UNKNOWN';
        result: null;
    } | {
        status: 'FAILED';
        result: {
            error: {
                code: string;
                message: string;
            };
        };
    });
}[K];
export type NativeResponse<K extends NativeOperation> = K extends NativeMutation ? NativeMutationReceipt<K> : NativeResultMap[K];
