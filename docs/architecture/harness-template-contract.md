# Harness Template Contract

Harness templates are EvoPilot-compatible YAML contracts. Source packs live under `harnesses/<id>/template.yaml`; published copies live under `published/<id>/<version>/template.yaml`. v2 publication also writes `asset.yaml`, a Harness Asset envelope that carries provenance, quality, lifecycle, source-reference, and review metadata around the template.

## Required Fields

Every template should provide:

```yaml
schema: evopilot-harness-template/v2
id: database-product-harness
version: 2.3.0
name: Database Product Harness
description: Domain baseline for self-developed database products.
harnessLayer: domain
domain: database-product
productBoundary:
  includes:
    - Self-developed database kernels, SQL engines, storage engines, replication, query optimization, transaction, recovery, and compatibility work.
  excludes:
    - Application data access layers, database clients, migration scripts, and ORM-only projects.
matchPolicy:
  requiredAny:
    - database product
    - sql engine
    - storage engine
  positive:
    dependencies: []
    imports: []
    files:
      - README.md
      - docs/architecture.md
    symbols:
      - optimizer
      - wal
    architectureSignals:
      - database-product
  negative:
    productBoundaryExcludes:
      - database client
      - orm application
    signals:
      - jdbc-only
executionModel:
  phases:
    - detect
    - draft
    - strict-validate
    - review
    - publish
  requiredCommands:
    detect:
      - evopilot-harness detect --source-project <path> --json
    strictValidate:
      - evopilot-harness harness validate <harness-id> --strict --json
qualityGate:
  minTemplateScore: 0.8
definitionQuality:
  schema: evopilot-harness-definition-quality/v1
  objective: more accurate, professional, and fine-grained Harness definition
  nonGoals:
    - large-scale performance optimization
    - throughput expansion
    - runtime performance tuning
```

Domain templates must also define domain execution controls:

```yaml
runtimePatterns:
  harnessLayer: domain
  domain: database-product
  domainExecution:
    requiredActions:
      - id: declare-domain-boundary
        action: Declare domain boundary and release evidence.
        evidence:
          - domain-boundary.md
    evidenceAdapters:
      - id: runtime-log
        artifact: runtime-log
        description: Runtime diagnostic logs.
    releaseBlockers:
      - missing domain runtime evidence
```

The validator checks:

- `id`
- `version`
- Template Quality Standard v1 fields when `--strict` is supplied
- domain `requiredActions`
- domain `evidenceAdapters`
- domain `releaseBlockers`

Runtime templates can omit domain-specific fields when they are language or runtime baselines.

## Match Policy

Templates can still provide `matchSignals.include`, but `matchPolicy` and `productBoundary` are the primary matching contract.

The v2 matching path builds a Source Profile from scanner evidence, retrieves candidate Harness packs, scores positive evidence, subtracts negative signals, checks product-boundary exclusions, records uncertainty, and returns one of:

```text
EVOLVE_EXISTING
CREATE_NEW_WITH_PARENT_REFERENCE
CREATE_NEW
FORK_FROM_MATCH
REVIEW_REQUIRED
```

A confident match evolves an existing Harness. A narrow source role, such as a Redis client library, should create a narrow target and reference a broader parent Harness instead of evolving the full distributed cache product Harness.

## Source Profile And Auto-Match v2

`detect`, `evolve`, and corpus planning expose these v2 schemas:

```text
evopilot-harness-source-profile/v2
evopilot-harness-auto-match/v2
evopilot-harness-candidate-retrieval/v2
evopilot-harness-detect-result/v2
```

The decision is produced by the deterministic aggregator. LLM Advisor can review or, with `--apply-llm-advisor`, influence target selection when confidence is high, but it never approves publication.

Important review fields:

```text
sourceProfile.scannerVersion
sourceProfile.scanners[]
sourceProfile.scannerSummary
sourceProfile.uncertainty
autoMatch.algorithmVersion
autoMatch.candidateRetrieval
autoMatch.conflicts
autoMatch.reviewGate
autoMatch.decisionEvidence
```

## Harness Asset v2

Published Harnesses must validate as:

```text
apiVersion=evopilot.dev/v2
kind=HarnessAsset
metadata.id/version/name present
spec.template present
status.conditions present
status.provenance.generatedBy=evopilot-harness
```

Use:

```bash
node src/index.mjs asset inspect <harness-id> --source harnesses --json
node src/index.mjs asset validate --source published --json
```

## Template Quality Standard v1

Strict validation checks that templates have enough structure for human review, AI Agent automation, and EvoPilot planning:

| Section | Required Shape |
|---|---|
| `productBoundary` | Non-empty `includes[]` and `excludes[]`. |
| `matchPolicy` | Non-empty `requiredAny[]`, at least one positive signal, and at least one negative exclusion. |
| `executionModel` | Non-empty `phases[]` and command groups under `requiredCommands`. |
| `evidenceContract` | Required artifacts and correlation fields. |
| `qualityGate` | `minTemplateScore`, defaulting to `0.8` in generated drafts. |
| `definitionQuality` | Objective, focus areas, required improvements, review questions, and non-goals for generated draft quality. |
| `runtimePatterns.domainExecution` | Required for domain Harnesses. |

```bash
node src/index.mjs harness validate --source harnesses --strict --json
node src/index.mjs catalog publish --source harnesses --out published --strict --json
```

## Source References

Evolution adds `sourceReferences` entries with source name, type, URI, digest, and description. GitHub repository sources also carry repository, ref, resolved commit, and local cache path metadata. These references let reviewers trace why a Harness changed.

## Lifecycle State

Templates can carry lifecycle metadata:

```yaml
lifecycle:
  status: published
```

`harness deprecate` writes:

```yaml
lifecycle:
  status: deprecated
  reason: Deprecated by administrator.
  deprecatedAt: "2026-08-09T00:00:00.000Z"
```

Deprecated packs can still be published into the Catalog with `status: deprecated`; EvoPilot should ignore or de-prioritize them when selecting a Harness.
