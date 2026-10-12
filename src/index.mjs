import { inspectReference } from '../vendor/compatibility/v1/reference.mjs';

export const VERSION = '0.1.0';
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

export function inspectOntologyReference(ref, observed) {
  return inspectReference(ref, observed, { product: 'ontology' });
}

export { validateHarness } from './specification.mjs';
export { evaluateHarness } from './evaluation.mjs';
export { buildDelivery, verifyDelivery } from './delivery.mjs';
export { createHarnessSemanticRequirements, evaluateSemanticCompatibility } from './semantic-consumer.mjs';
