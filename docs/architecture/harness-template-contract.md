# Harness Template Contract

Harness templates are EvoPilot-compatible YAML contracts. Source packs live under `harnesses/<id>/template.yaml`; published copies live under `published/<id>/<version>/template.yaml`.

## Required Fields

Every template should provide:

```yaml
schema: evopilot-harness-template/v1
id: database-product-harness
version: 2.2.0
name: Database Product Harness
description: Domain baseline for self-developed database products.
harnessLayer: domain
domain: database-product
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
- domain `requiredActions`
- domain `evidenceAdapters`
- domain `releaseBlockers`

Runtime templates can omit domain-specific fields when they are language or runtime baselines.

## Match Signals

Templates can provide `matchSignals.include`. The current CLI uses deterministic signal matching from template metadata, tags, source text, and goal text. A confident match evolves an existing Harness; otherwise the CLI creates a new domain Harness id.

## Source References

Evolution adds `sourceReferences` entries with source name, type, URI, digest, and description. These references let reviewers trace why a Harness changed.

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
