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
```

Runtime templates can act as fallback baselines when a domain Harness does not match.

## Minimal Domain Template

```yaml
schema: evopilot-harness-template/v1
id: distributed-cache-harness
version: 0.1.0
name: Distributed Cache Harness
description: Domain baseline for self-developed distributed cache and key-value storage products.
scope: platform
languageFamily: generic
harnessLayer: domain
domain: distributed-cache
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
| `matchSignals` | Terms used by auto-match. |
| `runtimePatterns` | Runtime profiles and domain execution controls. |
| `validationBaseline` | Required command groups and evidence rules. |
| `evidenceContract` | Required artifact format and correlation fields. |
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
```

Domain validation requires:

- at least one `runtimePatterns.domainExecution.requiredActions[]`
- at least one `runtimePatterns.domainExecution.evidenceAdapters[]`
- at least one non-empty `runtimePatterns.domainExecution.releaseBlockers[]`
