import { assertJSON, exactFields, sha256, frozenClone, stableSerialize } from '../vendor/compatibility/v1/reference.mjs';
import { validateHarness, configurationFor, failure } from './specification.mjs';

export function buildDelivery(asset) {
  const validationReport = validateHarness(asset);
  if (!validationReport.valid) throw new TypeError('Cannot deliver invalid Harness');
  const dependencyState = asset.dependencies.length ? 'NOT_RESOLVED' : 'NOT_REQUIRED';
  const dependencyRole = { HarnessComponent: 'OPTIONAL_SEMANTIC', HarnessProfile: 'HarnessComponent', HarnessBundle: 'HarnessProfile', EvaluationPack: 'APPLICABLE_HARNESS' }[asset.kind];
  const content = {
    definition: asset,
    configuration: configurationFor(asset),
    rules: asset.rules,
    evidenceRequirements: { inputs: asset.inputs, preconditions: asset.preconditions, sourceRequired: true, envelope: ['id', 'version', 'source', 'values'] },
    evaluationReport: { status: 'NOT_RUN', authority: false, released: false },
    validationReport,
    dependencyReport: { status: dependencyState, harnessRole: dependencyRole, kindVerification: asset.dependencies.some(d => d.product === 'harness') ? 'NOT_RESOLVED' : 'NOT_REQUIRED', pins: asset.dependencies },
  };
  const manifest = { product: 'harness', productVersion: '0.1.0', specVersion: 'v1', id: asset.id, version: asset.version, visibility: asset.visibility, modelDigest: sha256(asset), contentDigest: sha256(content), dependencies: asset.dependencies, dependencyState };
  return frozenClone({ ...content, manifest, digest: sha256({ ...content, manifest }), authority: false, released: false });
}
export function verifyDelivery(delivery) {
  try {
    assertJSON(delivery);
    exactFields(delivery, ['definition', 'configuration', 'rules', 'evidenceRequirements', 'evaluationReport', 'validationReport', 'dependencyReport', 'manifest', 'digest', 'authority', 'released']);
    const expected = buildDelivery(delivery.definition);
    if (stableSerialize(expected) !== stableSerialize(delivery)) throw new TypeError('Delivery content, manifest or report mismatch');
    return frozenClone({ valid: true, status: 'VALID', digest: expected.digest, authority: false, released: false });
  } catch (error) { return failure(error); }
}
