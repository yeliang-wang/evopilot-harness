# Harness asset readiness v2 API

Call the public service's `readiness(envelope)` method. This is additive; existing `usability.*` and native package APIs retain their old meaning. Every envelope carries exact project scope and `input.standardVersion: "v2"`. Mutations require `requestId` and `expectedRevision`; reads reject mutation fields. Responses retain `authority: false`.

| Operation | Inputs and meaning |
|---|---|
| `readiness.standard.inspect` | Inspect exact v2 definition and digest. |
| `readiness.inspect` | Read current owner revision. |
| `readiness.review.prepare` | Check report against exact reference and current intent; returns candidateContent, not a published grade. |
| `readiness.review.record` | Retain criterion-level report and its ACTUAL/SYNTHETIC origin. |
| `readiness.assessment.evaluate` | Compute result from id, intentDigest, reference, reviewDigest and explicit reconstructionEvidenceIds (normally []). |
| `readiness.assessment.read` | Read id with current content freshness, defects and separately refreshed optional reconstruction state. |
| `readiness.assessment.version` | Read immutable recorded result by digest. |
| `readiness.assessment.list` | List heads without an inferred aggregate level. |
| `readiness.gap.record` | Record confirmed defect with projectionDigest, criterionId, reason and evidenceDigest. |
| `readiness.receipt.inspect` | Read retained receipt by requestId. |

L1 is domain understanding, L2 is implementation specification, and L3 is complete reconstruction specification for the selected scope. The grade depends on independently fixed requirements, source-grounded or design-declared content, provenance and criterion-level semantic review. Mechanical validation alone cannot establish semantic correctness.

`assetAssessment` contains level, status, freshness, gaps and evidence origin. `reconstructionVerification` is independent and defaults to NOT_REQUESTED. A qualified v2 L3 never proves that generated software has actually been reconstructed, is functionally equivalent or is production ready. Actual linked evidence retains its original standard and scope.

Intent/specification drift or a confirmed semantic defect reopens content qualification. External execution environment unavailability affects optional reconstruction freshness, not the content grade. Missing version, unresolved content, source/scope mismatch, missing native publication and altered file hashes are rejected or retained as incomplete as appropriate. No readiness operation invokes an execution adapter, business database or SSH.

The parent supplies trusted cross-owner providers through public APIs. The request payload cannot select a provider or claim a grade. Missing providers fail closed. Native asset publication and actual human semantic decisions remain independent of assessment and technical validation.

[Workflow and field meanings](https://github.com/yeliang-wang/evopilot/blob/v0.8.1/docs/asset-readiness-v081-workflow.md) · [Migration and rollback](https://github.com/yeliang-wang/evopilot/blob/v0.8.1/docs/migration-v080-v081.md).

The built-in optional reader supports one `v1-assessment:<id>` reference to preserved usability v1 evidence for identical asset bytes. `artifactDigest` in this bridge hashes the ordered retained output-digest list; it is not a fabricated single artifact. Evidence must remain current and contain the original complete evaluations. No reader dispatches a rebuild.
