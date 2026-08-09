# Template Schema

Harness templates are YAML files with schema `evopilot-harness-template/v1`.

## Minimal Runtime Template

```yaml
schema: evopilot-harness-template/v1
id: python-enterprise-harness
version: 1.1.0
name: Python Enterprise Harness
description: Enterprise Python baseline for API services, platform tools, and async workers.
scope: platform
languageFamily: python
harnessLayer: runtime
productBoundary:
  includes:
    - Python API services, platform tools, and async workers.
  excludes:
    - Domain-specific product behavior owned by a narrower Harness.
matchPolicy:
  requiredAny:
    - python
  positive:
    dependencies: []
    imports: []
    files:
      - pyproject.toml
      - requirements.txt
    symbols: []
    architectureSignals:
      - python
  negative:
    productBoundaryExcludes:
      - database kernel
      - api gateway product
    signals: []
executionModel:
  phases:
    - inspect
    - plan
    - validate
  requiredCommands:
    detect:
      - evopilot-harness detect --source-project <path> --json
    strictValidate:
      - evopilot-harness harness validate <harness-id> --strict --json
qualityGate:
  minTemplateScore: 0.8
```

Runtime templates can act as fallback baselines when a domain Harness does not match.

## Minimal Domain Template

```yaml
schema: evopilot-harness-template/v1
id: distributed-cache-harness
version: 0.2.0
name: Distributed Cache Harness
description: Domain baseline for self-developed distributed cache and key-value storage products.
scope: platform
languageFamily: generic
harnessLayer: domain
domain: distributed-cache
productBoundary:
  includes:
    - Self-developed cache server, key-value storage, clustering, replication, failover, persistence, eviction, and protocol compatibility.
  excludes:
    - Redis client libraries, cache SDKs, proxy-only monitors, and application-only cache usage.
matchPolicy:
  requiredAny:
    - distributed cache
    - key-value storage
  positive:
    dependencies: []
    imports: []
    files:
      - README.md
      - docs/architecture.md
    symbols:
      - shard
      - replica
    architectureSignals:
      - distributed-cache-product
  negative:
    productBoundaryExcludes:
      - redis client library
      - proxy monitor
    signals:
      - spring-data-redis only
runtimePatterns:
  harnessLayer: domain
  domain: distributed-cache
  runtimeProfiles:
    - generic
  domainExecution:
    requiredActions:
      - id: declare-domain-boundary
        action: Declare the domain boundary, core workflows, failure modes, and release criteria.
        evidence:
          - domain-boundary.md
    evidenceAdapters:
      - id: runtime-log
        artifact: runtime-log
        description: Runtime logs with request, error, and owner context.
    releaseBlockers:
      - missing domain boundary evidence
      - missing runtime evidence
```

## Recommended Sections

| Section | Purpose |
|---|---|
| `capabilities` | Product capabilities and evidence requirements. |
| `matchSignals` | Legacy terms still available to detect scoring. |
| `productBoundary` | What the Harness owns and explicitly does not own. |
| `matchPolicy` | Deterministic detect policy: required signals, positive evidence, and negative exclusions. |
| `executionModel` | Expected evolution phases and commands operators should run. |
| `runtimePatterns` | Runtime profiles and domain execution controls. |
| `validationBaseline` | Required command groups and evidence rules. |
| `evidenceContract` | Required artifact format and correlation fields. |
| `qualityGate` | Minimum template quality score and review expectations. |
| `failureTaxonomy` | Failure categories used in diagnostics. |
| `diagnosticsBaseline` | Required diagnostic signals. |
| `observabilityBaseline` | Required health, readiness, log, and metric signals. |
| `governanceRules` | Review, profile, and promotion rules. |
| `phaseMapping` | Alpha/Beta/RC/GA evidence mapping. |
| `sourceReferences` | Source material used to evolve the template. |
| `changelog` | Structured version history. |

## Validation

```bash
node src/index.mjs harness validate <harness-id> --source harnesses --json
node src/index.mjs harness validate <harness-id> --source harnesses --strict --json
```

Domain validation requires:

- at least one `runtimePatterns.domainExecution.requiredActions[]`
- at least one `runtimePatterns.domainExecution.evidenceAdapters[]`
- at least one non-empty `runtimePatterns.domainExecution.releaseBlockers[]`

Strict validation also enforces Template Quality Standard v1:

- `productBoundary.includes[]` and `productBoundary.excludes[]`
- `matchPolicy.requiredAny[]`, positive signals, and negative exclusions
- `executionModel.phases[]` and `executionModel.requiredCommands`
- `evidenceContract.requiredArtifacts[]` and `evidenceContract.correlationFields[]`
- `qualityGate.minTemplateScore`
- total `templateQuality.score >= qualityGate.minTemplateScore` where the default minimum is `0.8`
