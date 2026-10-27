import { inspectReference } from '../vendor/compatibility/v1/reference.mjs';

export const VERSION = '0.8.3';
export const PRODUCT = 'harness';

export function capabilities() {
  return Object.freeze({
    product: PRODUCT,
    version: VERSION,
    implementationStage: 'NATIVE_STANDARDS',
    businessOperationsReady: true,
    persistence: 'separate/service',
    hostReady: false,
    pluginReady: false,
    productionReady: false,
    softwareRelease: false,
    authority: false,
    nativeApi: './native',
    historicalPureApi: Object.freeze(['validateHarness', 'evaluateHarness', 'buildDelivery', 'verifyDelivery', 'createHarnessSemanticRequirements', 'evaluateSemanticCompatibility']),
    referenceApi: Object.freeze(['inspectOntologyReference']),
  });
}

export function inspectOntologyReference(ref: unknown, observed: unknown) {
  return inspectReference(ref, observed, { product: 'ontology' });
}

export { validateHarness } from './specification.js';
export { evaluateHarness } from './evaluation.js';
export { buildDelivery, verifyDelivery } from './delivery.js';
export { createHarnessSemanticRequirements, evaluateSemanticCompatibility } from './semantic-consumer.js';
export type * from './types.js';

export { inspectHarnessStandard, inspectHarnessPackage, validateNativeHarness } from './native.js';

export {preflightUsability} from './usability.js';
export type {UsabilityReaders,UsabilityPreflight,UsabilityPreflightRequest} from './usability.js';
export {USABILITY_LEVELS,USABILITY_STANDARD_DIGEST,ASSESSMENT_STATES,BEHAVIOR_FACETS,USABILITY_LIMITS,usabilityDigest,usabilityBytesDigest,validateUsabilityInventory,validateUsabilitySpecification} from './usability.js';
export type {UsabilityInventory,UsabilitySpecification,UsabilityCitation,UsabilityPins,UsabilityScope,UsabilityLevel,BehaviorFacet} from './usability.js';

export {semanticCriteria,semanticReportDigest,validateSemanticReport} from '../vendor/usability/v1/assessment.mjs';
export type {UsabilitySemanticReport,UsabilityAssessmentResult} from '../vendor/usability/v1/assessment.mjs';
export type {UsabilityRequest,UsabilityInputs,UsabilityResults,UsabilityResponse,UsabilityOperation,UsabilityAssessmentProviders,UsabilityInventoryRecord,UsabilityAssetBinding} from './usability-assessment.js';

export type {OracleInputs,OracleResults,OracleBinding,OracleEvaluation,OracleProviders} from './usability-oracle.js';
export type {BehaviorOracle,BehaviorObservation,OracleTolerance,ReconstructionObservation,BehaviorOracleResult} from '../vendor/usability/v1/oracle.mjs';
export {behaviorOracleDigest,validateBehaviorOracle,compareBehavior,validateReconstructionObservation} from '../vendor/usability/v1/oracle.mjs';

export {READINESS_CLOSURE,READINESS_FACETS,READINESS_SPEC_PATH,READINESS_STANDARD,READINESS_STANDARD_DIGEST,assertReadinessVersion,boundedReadiness,noReconstruction,readinessBytesDigest,readinessCriteria,readinessDigest,readinessFail,readinessId,readinessPath,readinessText,validateReadinessIntent,validateReadinessReconstruction,validateReadinessReview,validateReadinessSpecification,verifyReadinessProjection} from '../vendor/compatibility/usability/v2/contract.mjs';
export type {ReadinessLevel,ReadinessSource,ReadinessRequirement,ReadinessIntent,ReadinessIntentRecord,ReadinessCitation,ReadinessStatement,ReadinessSpecification,ReadinessProjection,ReadinessReview,ReadinessReconstruction,ReadinessResult} from '../vendor/compatibility/usability/v2/contract.mjs';
export {assessReadinessContent} from './readiness.js';
