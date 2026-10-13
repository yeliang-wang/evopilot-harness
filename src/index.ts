import { inspectReference } from '../vendor/compatibility/v1/reference.mjs';

export const VERSION = '0.1.1';
export const PRODUCT = 'harness';

export function capabilities() {
  return Object.freeze({
    product: PRODUCT,
    version: VERSION,
    implementationStage: 'M2_OWNED_SERVICE',
    businessOperationsReady: true,
    persistence: 'separate/service',
    hostReady: false,
    pluginReady: false,
    productionReady: false,
    softwareRelease: false,
    authority: false,
    pureApi: Object.freeze(['validateHarness', 'evaluateHarness', 'buildDelivery', 'verifyDelivery', 'createHarnessSemanticRequirements', 'evaluateSemanticCompatibility']),
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
