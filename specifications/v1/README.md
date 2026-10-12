# EvoPilot Harness v1 — normative minimal core

This native JSON format is an EvoPilot standard, not an industry-certified Harness format. [JSON Schema 2020-12](asset.schema.json) defines closed syntax. The pure validator additionally enforces globally unique row IDs, typed references/comparisons, complete source coverage, extension support, dependency visibility and role restrictions. Schema validation alone is insufficient. [Sources and adoption](sources.json) distinguish borrowed ideas from native decisions.

The envelope is exactly id/version/product/specVersion/visibility/provenance/extensions/dependencies. Product is harness, specVersion is v1, and versions are strict SemVer core. Shared reference/envelope/hash code is the single canonical compatibility module, vendored by the parent build. There is no separate identity or digest scheme. Inputs must be finite, acyclic plain JSON with enumerable data descriptors and dense arrays. Accessors, symbols, functions and decorated/sparse arrays are rejected before traversal. Reports and deliveries are deeply frozen clones; caller objects remain unchanged.

All assets additionally require kind, applicability, objectives, preconditions, inputs, parameters, deliverables, rules and sourceMappings. No unknown fields are permitted.

- kind: HarnessComponent declares checks; HarnessProfile groups pinned Components; HarnessBundle groups pinned Profiles; EvaluationPack declares checks and pins applicable Harness material. Profiles/Bundles require Harness pins and have empty rules/preconditions/inputs/parameters. Components cannot group Harness pins. EvaluationPacks require Harness pins.
- applicability: exactly enabled (boolean) and domains (nonempty unique text array). Domains are descriptive; only enabled:false explicitly disables evaluation.
- objectives and deliverables: both arrays must be nonempty for all four kinds, including Profiles/Bundles, declaring at least one concrete objective and one expected deliverable. Each row has nonempty id/description.
- inputs: id/type, where type is string, number, integer, boolean or array.
- parameters: id/type/default with a default matching the declared type. Supplied configuration is an object containing only declared parameter keys; omitted keys use defaults.
- preconditions: id/description/evidenceKey, referencing a BOOLEAN input. False preconditions report FAIL and block rule execution; missing ones report INDETERMINATE. Blocked checks remain INDETERMINATE.
- rules: id/target/evidenceKey/operator/severity/blocking and exactly one expected or parameterRef. Target is nonempty descriptive text. Evidence keys reference inputs, parameter refs reference declared parameters. Operators are eq, lte, gte, contains. Bounds require numeric inputs and expected values; eq requires matching primitive type; contains requires a string with string expected, or an array whose observed elements match the primitive expected type. Arrays are never coerced to primitive values.
- sourceMappings: id/targetRef/sourceRef/sourceLocator/sourceRevision/status. Every objective, precondition, input, parameter, deliverable and rule must be covered. Mapping rows are provenance links, not recursively mapped semantic rows.

IDs are globally unique across provenance sources and all model rows, including mappings. Each mapping references a declared source and semantic row; locator/revision/status must match exactly. Duplicate target/source mappings fail. Shared provenance requires forward|reverse and nonempty sources with id/kind/locator/revision/digest/status. Status uses the shared design-proposed, design-confirmed, source-observed, inferred, runtime-observed, human-reviewed, synthetic vocabulary. Pins are declarations, not authentication of external bytes. The asset envelope and applicability inherit the asset's declared provenance.

Dependencies use exact immutable six-field references, including supported product/specVersion, strict version and SHA256 digest. Public assets cannot depend on private material. Duplicate product/id pins fail. Harness can run without any Ontology; optional Ontology pins supply semantic context only. Ontology owns semantic modeling and instance validation; Harness owns declarative checks and evidence evaluation. Harness never imports or authors the Ontology engine.

Six-field pins do not encode kind. Delivery therefore records dependencies as NOT_RESOLVED and declares expected Harness roles without claiming to have verified them. No-dependency assets report NOT_REQUIRED. Full immutable material closure, actual kind verification and publication/lifecycle ownership belong to M2 services. Valid hashes alone do not establish complete bundles.

Extensions are additive inert namespace/version/required/data records validated by the shared envelope. Duplicate namespaces and base-field overrides fail. local.notes@1.0.0 supports exactly annotation:{text,language?}; unknown required extensions fail. Unknown optional extensions are retained and reported NOT_EVALUATED.

## Evaluation

evaluateHarness(asset, evidence, configuration={}) never executes commands or repairs. Evidence is exactly {id,version,source:{locator,revision,digest},values:{...}}. Identity/version and source fields are mandatory even when values is empty or no inputs exist. Values may contain only declared input keys. Metadata pins identify supplied observations; the core does not fetch or authenticate external source material.

The report binds assetDigest, rulesDigest, effective configurationDigest, evidenceDigest and evidence identity/version/source. Malformed models, configuration, metadata or observed types yield ERROR. Missing rule or precondition observations yield INDETERMINATE; false comparisons yield FAIL; correct comparisons yield PASS. Operator errors yield ERROR. Explicit disabled applicability yields N/A for well-formed inputs, never PASS. Malformed data still yields ERROR. Zero checks yield INDETERMINATE, even with satisfied preconditions. A valid metadata envelope with empty values yields INDETERMINATE when applicable.

Aggregate priority is ERROR > FAIL > INDETERMINATE > PASS; N/A is reserved for explicit inapplicability. Per-rule status, reason, severity and blocking are independent fields. A failed nonblocking warning remains FAIL, does not change versions, and never launches repair or publication. False preconditions block comparisons; they do not turn unexecuted checks into PASS. Reports carry authority:false and released:false and provide no business or Runtime acceptance.

## Delivery

buildDelivery(asset) validates the model, without fabricating observations or evaluating rules. It returns definition, effective default configuration, rules, evidenceRequirements, evaluationReport (NOT_RUN), validationReport, dependencyReport, manifest, digest, authority:false and released:false. Manifest pins product/version/specVersion, model identity/visibility, modelDigest, contentDigest, dependencies and dependencyState. Content is every output preceding manifest; outer digest covers content plus manifest. Outer authority/released are fixed false and checked by full reconstruction.

verifyDelivery recomputes validation, default configuration, requirements, reports, manifest and all hashes, then compares the entire artifact. Unknown fields and tampered reports fail. Determinism is local integrity, not trusted publication identity or lifecycle approval.

## Reproduction and boundaries

Use the [template](templates/harness.json) and [eight synthetic cases](../../examples/synthetic-harnesses.json): orchard/observatory × forward/reverse × public/private. Each has independent synthetic source/evidence pins and contains no real repository or private data. Source digest bytes are UTF-8 "Synthetic <case-name> record-1"; evidence digest bytes are "Synthetic observation <case-name>".

From this standalone source checkout run `npm run check`, `npm run build` and `npm test` using its own locked dependencies and pinned vendor. No parent checkout or parent build is required. Only the parent canonical generator may regenerate vendor bytes. Installed packages omit development scripts and tests. Native pure APIs and local M2 persistent lifecycle/material resolution are implemented; retained legacy operational migration and Host E2E remain pending. The separate [semantic compatibility consumer](../../docs/semantic-consumer.md) does not extend this normative core or claim Ontology schema ownership. Nothing here establishes E01–E19 completion or release authority.
