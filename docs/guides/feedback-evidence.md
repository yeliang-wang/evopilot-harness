# Feedback Evidence

v3.3.0 accepts execution feedback only as a static, governed Evidence Source. It measures the observed effectiveness of already published immutable assets; it does not control the originating project or evolve an asset automatically.

## Feedback Package Versus Production Log

| Input | Meaning | Authority |
|---|---|---|
| `--production-log` | Redacted, unstructured operational material used during normal Evidence Graph and Proposal reasoning. | May support a reviewed Proposal; never proves an immutable execution binding by itself. |
| `HarnessExecutionFeedbackPackage` | Approved, redacted, time-bounded, digest-protected Outcome, Process, Safety, and Cost evidence bound to an exact published Bundle closure. | May be ingested and aggregated; cannot create, approve, mutate, or publish an asset. |

## Required Contract

```yaml
apiVersion: feedback.evopilot.io/v1
kind: HarnessExecutionFeedbackPackage
metadata:
  packageId: feedback-20260813-001
  version: 1.0.0
  generatedAt: 2026-08-13T07:00:00.000Z
  expiresAt: 2026-09-13T07:00:00.000Z
  producer: { name: control-plane, version: 1.0.0, instanceId: workspace-a }
  packageDigest: sha256:...
approval:
  status: APPROVED
  approvedBy: reviewer-id
  approvedAt: 2026-08-13T07:30:00.000Z
  purpose: Harness effectiveness evaluation
redaction:
  status: REDACTED
  policyVersion: redaction-v1
  removedFieldCount: 2
  payloadDigest: sha256:...
harnessBinding:
  bundleRef: { id: bundle-id, version: 1.0.0, digest: sha256:... }
  profileRef: { id: profile-id, version: 1.0.0, digest: sha256:... }
  componentRefs:
    - { id: component-id, version: 1.0.0, digest: sha256:... }
executionContext:
  taskClass: engineering-task
  complexity: MEDIUM
  environmentDigest: sha256:...
  trajectoryRefs: [trajectory:one]
dimensions:
  outcome: { status: SUCCEEDED, score: 0.9 }
  process: { status: COMPLETED, stepCount: 8, retryCount: 1, durationMs: 540000 }
  safety: { status: SAFE, violationCount: 0, incidentCount: 0 }
  cost: { status: RECORDED, inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCost: 0.0015, currency: USD }
provenance:
  sourceType: evopilot-goal-loop
  sourceId: workspace-a
  requestIds: [request:one]
  model: { provider: provider-id, name: model-id }
  evidenceRefs: [evidence:one]
```

`redaction.payloadDigest` is SHA-256 over canonical `harnessBinding`, `executionContext`, `dimensions`, and `provenance`. `metadata.packageDigest` is SHA-256 over the canonical complete document after removing only `metadata.packageDigest`. These exclusions prevent digest recursion while keeping approval and redaction metadata inside package integrity.

## Processing

```bash
evopilot-harness feedback inspect feedback.yaml --json
evopilot-harness feedback validate feedback.yaml --workspace "$EVOPILOT_HARNESS_HOME" --json
evopilot-harness feedback process feedback.yaml --workspace "$EVOPILOT_HARNESS_HOME" --json
```

`process` executes:

```text
inspect -> validate -> resolve immutable binding -> content-addressed ingest -> aggregate -> stop
```

It returns `proposalCreated=false`, `assetMutation=false`, and `sourceExecution=false`. A repeated package id with the same digest is `DUPLICATE` and not counted twice. The same id with a different digest is rejected as `package-id-conflict`.

## Validation Gates

A package is rejected when any required Schema field is invalid, approval is not `APPROVED`, redaction is not `REDACTED`, timestamps are invalid or expired, either digest differs, or the Bundle/Profile/Component binding cannot be resolved exactly to published assets. Component references must equal the complete Bundle closure; a partial or additional list is not accepted.

Rejected package metadata and failure reasons are written under `feedback/rejected`; accepted immutable packages live under `feedback/packages`; aggregate reports live under `feedback/reports`. All are Workspace state outside Catalogs.

## Effectiveness Report

`feedback aggregate` creates `HarnessEffectivenessReport v1` groups for each exact Bundle, Profile, Component, and version. Each aggregate carries:

- Outcome status, success rate, and score;
- Process status, steps, retries, and duration;
- Safety status, safe rate, violations, and incidents;
- Cost availability, tokens, and estimated-cost averages separated by currency;
- sample count, independent source count, task/complexity/environment contexts;
- missing-field counts, uncertainty level, and Wilson 95% rate intervals.

The report records `algorithmVersion=effectiveness-aggregate/v1`. A single-currency aggregate exposes an overall estimated-cost average; mixed currencies set that field to null and retain separate `estimatedCostByCurrency` values. The report is descriptive evidence, not a causal claim or automatic evolution decision. v3.4.0 is the planned milestone for reviewed feedback-linked asset delta reasoning.

## Current Integration Status

The v3.3.0 consumer contract can be accepted with independent fixtures. Until a compatible control plane exports real approved packages, do not claim that a cross-project production-feedback loop is closed.
