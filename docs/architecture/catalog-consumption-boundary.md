# Catalog Consumption Boundary

This document defines the boundary between `evopilot-harness`, EvoPilot, and Dashboard.

## Ownership

| Component | Owns |
|---|---|
| `evopilot-harness` | Harness source packs, evolution runs, draft generation, review, approval, versioning, publication, `harness-registry.yaml`, `CATALOG.md`, and Harness Hub UI. |
| EvoPilot | Project registry, credentials, LLM profiles, goal planning, loop execution, evidence, release decisions, audit, and read-only Catalog consumption. |
| Dashboard | EvoPilot UI and optional iframe embedding of Harness Hub. |

## Registry And Published Directory Contract

`evopilot-harness` publishes a Registry file and one or more Catalog directories:

```text
harness-registry.yaml
published/
  CATALOG.md
  database-product-harness/2.3.0/template.yaml
  api-gateway-harness/2.3.0/template.yaml
```

The Registry lists enabled Catalog roots and their priority. It must not duplicate Harness entries. The Catalog index is maintained by `evopilot-harness`; EvoPilot reads the Registry and Catalog directories dynamically.

## EvoPilot Configuration

```bash
EVOPILOT_HARNESS_REGISTRY_CONFIG=/path/to/evopilot-harness/harness-registry.yaml
EVOPILOT_HARNESS_CATALOG_DIR=/path/to/evopilot-harness/published
EVOPILOT_HARNESS_CATALOG_DIRS=/path/to/catalog-a:/path/to/catalog-b
```

`EVOPILOT_HARNESS_REGISTRY_CONFIG` is preferred. `EVOPILOT_HARNESS_CATALOG_DIR(S)` is a legacy fallback when no Registry is configured.

EvoPilot must not import or copy the Registry or Catalog into a Harness lifecycle store. It may cache read projections for a request, but the source of truth remains the configured file and directories.

## Goal Planning

At goal-plan time, EvoPilot should:

1. Read `harness-registry.yaml` when configured.
2. Resolve enabled Catalog roots by priority.
3. Read each configured `CATALOG.md`.
4. Extract the `yaml evopilot-harness-catalog` block.
5. Read each referenced `template.yaml` or `harness.yaml`.
6. Score entries against project metadata and the goal loop target.
7. Use Catalog priority only as a detect tie breaker.
8. Record the selected entry as `plan.selectedHarness`.

Existing plans must keep the digest they used. Republished Catalog content affects only new or regenerated plans.

## Dashboard Integration

Dashboard should not read local `harnesses/`, `published/`, or `.evopilot-harness/` directories directly. It can:

- call EvoPilot read-only Catalog projections for selected Harness evidence
- embed Harness Hub in an iframe
- link users to `evopilot-harness` CLI commands

Dashboard must not approve or publish Harness definitions unless it is actually operating the independent `evopilot-harness` Hub surface.
