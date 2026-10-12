import { inspectReference } from '../vendor/compatibility/v1/reference.mjs';

export const VERSION = '0.1.0';
export const PRODUCT = 'harness';

export function capabilities() {
  return Object.freeze({
    product: PRODUCT,
    version: VERSION,
    implementationStage: 'M1_FOUNDATION',
    businessOperationsReady: false,
    authority: false,
    pureApi: Object.freeze(['validateHarness', 'evaluateHarness', 'buildDelivery', 'verifyDelivery']),
    referenceApi: Object.freeze(['inspectOntologyReference']),
  });
}

export function inspectOntologyReference(ref, observed) {
  return inspectReference(ref, observed, { product: 'ontology' });
}

export { validateHarness } from './specification.mjs';
export { evaluateHarness } from './evaluation.mjs';
export { buildDelivery, verifyDelivery } from './delivery.mjs';
