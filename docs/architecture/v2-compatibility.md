# v2 Architecture Compatibility

This page preserves the architecture map for existing v2 automation. The current product architecture is [v3](overview.md).

## Status

The v2 CLI, source packs, Harness Asset envelope, Catalog, and Registry remain available as a compatibility layer in Engine `4.1.0`. EvaluationPack v1 and v2 remain readable while new Proposals use EvaluationPack v3. These legacy surfaces are not the canonical v3 asset and Delta model.

| v2 concept | Current role | v3 direction |
|---|---|---|
| `harnesses/<id>/template.yaml` | Editable legacy source pack | Migrate to `HarnessProfile` and immutable `HarnessBundle`. |
| `asset.yaml` with `evopilot.dev/v2` | Legacy publication envelope | Use `harness.evopilot.io/v3` assets. |
| `published/CATALOG.md` | Offline v2 Catalog | Use Workspace Catalogs for v3 production. |
| Root `harness-registry.yaml` | v2 Catalog discovery | Use Workspace Registry for v3 Catalog roots. |
| `detect`, `evolve`, `corpus` | Legacy matching and lifecycle | Use `produce` and `proposal` commands. |
| `.evopilot-harness/evolutions/` | Legacy local run state | Use `EVOPILOT_HARNESS_HOME/evolution-runs/`. |

## Legacy Flow

```mermaid
flowchart LR
  Source["Project, GitHub, attachment, log, note"] --> Profile["Source Profile v2"]
  Profile --> Match["Auto-Match v2"]
  Match --> Draft["Template and Harness Asset v2 draft"]
  Draft --> Review["Administrator review and approval"]
  Review --> Pack["harnesses source pack"]
  Pack --> Catalog["published/CATALOG.md"]
```

The v2 Registry discovers Catalog roots and does not duplicate individual Harness entries. Dashboard may embed Harness Hub, but it never owns v2 or v3 Harness state.

## Storage Boundaries

| Path | Owner | Rule |
|---|---|---|
| `harnesses/` | Legacy maintainers | Reviewed source packs only. |
| `published/` | v2 Catalog publisher | Generated offline compatibility Catalog. |
| `.evopilot-harness/` | v2 lifecycle | Local ignored run state. |
| `ui/harness-hub/` | Harness Hub | Shared frontend, no browser-local publication authority. |

Evidence sources and tests must not generate or overwrite Built-in v3 assets. Existing v2 published records remain historical compatibility artifacts; new production asset design should use v3.

## Migration Boundary

`migrate v2-to-v3` reads v2 packs and creates versioned v3 assets in a writable Workspace. Dry-run is non-mutating; `--apply` writes migration output and a rollback journal. The migration does not modify EvoPilot or publish into an external control plane.

v4.1.0 requires no destructive Workspace migration. `workspace init` adds missing `policies/comparison/` and `comparisons/` directories and copies the built-in versioned `ComparisonPolicyPack` without rewriting Organization Catalog assets, accepted comparison history, or active user policy. Existing v4 Sessions without `evidenceReports` are initialized with an empty runtime collection when read or resumed; historical Session files are not bulk-rewritten. Legacy Proposals remain reviewable without comparison evidence unless an explicitly reviewed policy requires it for their risk class.

See [v2 Compatibility Guide](../guides/v2-compatibility.md) and [v3 Workspace And Migration](../operations/v3-workspace.md).
