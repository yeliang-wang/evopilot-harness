import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { PACKAGE_ROOT } from "./constants.mjs";
import { digest, readYaml, walkFiles } from "./utils.mjs";

const SCHEMAS = {
  HarnessComponent: "harness-asset-v3.schema.json",
  HarnessProfile: "harness-asset-v3.schema.json",
  HarnessBundle: "harness-asset-v3.schema.json",
  OntologyPack: "ontology-pack-v1.schema.json",
  MatchPolicyPack: "match-policy-pack-v1.schema.json",
  AdvisorPolicyPack: "advisor-policy-pack-v1.schema.json",
  ComparisonPolicyPack: "comparison-policy-pack-v1.schema.json",
  AssetDeltaProposal: "asset-delta-proposal-v1.schema.json",
  HarnessExecutionFeedbackPackage: "harness-execution-feedback-package-v1.schema.json",
  HarnessEffectivenessReport: "harness-effectiveness-report-v1.schema.json",
  HarnessComparisonEvidencePackage: "harness-comparison-evidence-package-v1.schema.json",
  HarnessComparisonReport: "harness-comparison-report-v1.schema.json",
  HarnessComparisonRescoreRecord: "harness-comparison-rescore-record-v1.schema.json",
  HarnessCalibrationCaseSet: "harness-calibration-case-set-v1.schema.json",
  HarnessCalibrationReport: "harness-calibration-report-v1.schema.json",
  ResearchAdapterManifest: "research-adapter-manifest-v1.schema.json",
  ResearchEvidencePackage: "research-evidence-package-v1.schema.json",
  EvidenceRunManifest: "evidence-run-manifest-v1.schema.json",
  AssetCurriculumEntry: "asset-curriculum-entry-v1.schema.json",
  AssetCurriculumSnapshot: "asset-curriculum-snapshot-v1.schema.json",
  ProfessionalCompletenessPolicyPack: "professional-completeness-policy-pack-v1.schema.json",
  ProfessionalCompletenessReport: "professional-completeness-report-v1.schema.json",
  ProfessionalCompletenessRescoreRecord: "professional-completeness-rescore-record-v1.schema.json",
  ContributionEvidencePackage: "contribution-evidence-package-v1.schema.json",
  DomainRoleProposal: "domain-role-proposal-v1.schema.json",
  DomainOntologyPack: "professional-pack-v1.schema.json",
  ProductOntologyPack: "professional-pack-v1.schema.json",
  OrganizationOntologyPack: "professional-pack-v1.schema.json",
  ProjectOntologyOverlay: "professional-pack-v1.schema.json",
  DomainHarnessPack: "professional-pack-v1.schema.json",
  ProjectOntologyArtifactSet: "project-ontology-artifact-set-v1.schema.json",
  ProjectOntologySkill: "project-ontology-skill-v1.schema.json"
};

const VERSIONED_SCHEMAS = {
  EvaluationPack: {
    "harness.evopilot.io/v1": "evaluation-pack-v1.schema.json",
    "harness.evopilot.io/v2": "evaluation-pack-v2.schema.json",
    "harness.evopilot.io/v3": "evaluation-pack-v3.schema.json"
  }
};

const CONTRACT_SCHEMAS = {
  "evopilot-harness-ontology-foundation/v1": "ontology-foundation-v1.schema.json",
  "evopilot-harness-semantic-candidate-set/v1": "semantic-candidate-set-v1.schema.json",
  "evopilot-harness-ontology-grounding-result/v1": "ontology-grounding-result-v1.schema.json",
  "evopilot-harness-semantic-requirements/v1": "harness-semantic-requirements-v1.schema.json",
  "evopilot-harness-semantic-compatibility-report/v1": "semantic-compatibility-report-v1.schema.json",
  "evopilot-harness-resolved-professional-pack-set/v1": "resolved-professional-pack-set-v1.schema.json",
  "evopilot-harness-pack-lifecycle-record/v1": "pack-lifecycle-record-v1.schema.json",
  "evopilot-harness-pack-certification/v1": "pack-certification-v1.schema.json",
  "evopilot-harness-external-semantic-evidence/v1": "external-semantic-evidence-v1.schema.json",
  "evopilot-harness-project-ontology-proposal/v1": "project-ontology-proposal-v1.schema.json",
  "evopilot-harness-resolved-project-ontology-snapshot/v1": "resolved-project-ontology-snapshot-v1.schema.json",
  "evopilot-harness-project-ontology-projection-set/v1": "project-ontology-projection-set-v1.schema.json",
  "evopilot-harness-project-ontology-artifact-set/v1": "project-ontology-artifact-set-v1.schema.json",
  "evopilot-harness-project-ontology-skill/v1": "project-ontology-skill-v1.schema.json",
  "evopilot-harness-project-ontology-artifact-lifecycle/v1": "project-ontology-artifact-lifecycle-v1.schema.json",
  "evopilot-harness-professional-pack-inspection/v1": "professional-pack-inspection-v1.schema.json",
  "evopilot-harness-pack-benchmark/v1": "pack-benchmark-v1.schema.json",
  "evopilot-harness-pack-gold-case/v1": "pack-gold-case-v1.schema.json",
  "evopilot-harness-external-semantic-evidence-adapter/v1": "external-semantic-evidence-adapter-v1.schema.json"
};

const validatorCache = new Map();
const FUTURE_ONTOLOGY_ASSET_KINDS = new Set(["OntologyReasoningProfile", "SemanticIndex", "FederatedPackDiscovery"]);

export function validateDocument(document, file = "<memory>") {
  if (FUTURE_ONTOLOGY_ASSET_KINDS.has(document?.kind)) return { status: "FAILED", valid: false, file, kind: document.kind, errors: [{ path: "/kind", message: "v4.8 semantic interoperability asset kinds are outside the v4.7 product boundary" }] };
  const schemaName = CONTRACT_SCHEMAS[document?.schema] ?? VERSIONED_SCHEMAS[document?.kind]?.[document?.apiVersion] ?? SCHEMAS[document?.kind];
  if (!schemaName) return { status: "FAILED", valid: false, file, kind: document?.kind ?? null, errors: [{ path: "/kind", message: "unsupported Harness document kind or contract schema" }] };
  let validate = validatorCache.get(schemaName);
  if (!validate) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "schemas", schemaName), "utf8")));
    validatorCache.set(schemaName, validate);
  }
  const valid = Boolean(validate(document));
  const semanticErrors = valid ? semanticClosureErrors(document) : [];
  const complete = valid && semanticErrors.length === 0;
  return {
    status: complete ? "VALIDATED" : "FAILED",
    valid: complete,
    file,
    kind: document.kind,
    id: document?.metadata?.id ?? null,
    version: document?.metadata?.version ?? null,
    errors: !valid ? (validate.errors ?? []).map((error) => ({
      path: error.instancePath || "/",
      keyword: error.keyword,
      message: error.message,
      params: error.params
    })) : semanticErrors
  };
}

function semanticClosureErrors(document) {
  const requirements = document?.kind === "HarnessBundle" ? document.spec?.semanticRequirements : null;
  if (!requirements) return [];
  const copy = structuredClone(requirements);
  delete copy.requirementsDigest;
  const actual = digest(copy);
  return actual === requirements.requirementsDigest ? [] : [{ path: "/spec/semanticRequirements/requirementsDigest", keyword: "immutableClosure", message: "must bind the canonical semantic requirements", params: { expected: actual } }];
}

export function validateFile(file) {
  try {
    return validateDocument(readYaml(file), file);
  } catch (error) {
    return { status: "FAILED", valid: false, file, kind: null, errors: [{ path: "/", message: error instanceof Error ? error.message : String(error) }] };
  }
}

export function validateTree(root) {
  const files = walkFiles(root, (file) => /(?:asset|ontology|policy)\.ya?ml$/i.test(path.basename(file)) || file.endsWith(".yaml"));
  const documents = files.map(validateFile);
  return {
    schema: "evopilot-harness-schema-validation/v3",
    status: documents.length > 0 && documents.every((item) => item.valid) ? "VALIDATED" : "FAILED",
    root: path.resolve(root),
    documentCount: documents.length,
    passedCount: documents.filter((item) => item.valid).length,
    failedCount: documents.filter((item) => !item.valid).length,
    documents
  };
}
