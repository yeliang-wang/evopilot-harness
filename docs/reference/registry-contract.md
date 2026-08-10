# Registry Contract

> v3 Workspace registries use `evopilot-harness-registry/v2` and still list Catalog roots only. Asset entries remain exclusively in each Catalog. Signature commands are documented in [v3 Production Lifecycle](../guides/v3-production-lifecycle.md). The detailed v1 fields below remain compatible guidance.

`harness-registry.yaml` is the multi-Catalog discovery file published by `evopilot-harness` and read by EvoPilot.

It is not a Harness index. Harness entries stay in each Catalog's `CATALOG.md`; Harness behavior stays in each `template.yaml` or `harness.yaml`.

## File Shape

```yaml
schema: evopilot-harness-registry/v1
generatedBy: evopilot-harness
generatedAt: 2026-08-09T05:24:19.115Z
catalogs:
  - id: evopilot-public-harness-catalog
    enabled: true
    priority: 100
    root: ./published
    release: v1.3.0
    expectedCatalogDigest: sha256:...
    description: Published Harness Catalog evopilot-public-harness-catalog
```

## Catalog Fields

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Registry-visible Catalog id. It should match the `CATALOG.md` `catalogId`. |
| `enabled` | yes | `true` means EvoPilot should scan this Catalog. |
| `priority` | yes | Higher priority wins only when Harness detect scores tie. |
| `root` | yes | Catalog directory. Relative paths resolve from the Registry file directory. |
| `release` | recommended | `evopilot-harness` release that published the Catalog reference. |
| `expectedCatalogDigest` | recommended | Optional SHA-256 digest of `CATALOG.md` used for drift detection. |
| `description` | optional | Human-readable Catalog purpose. |
| `owner` | optional | Owning team or operator. |

## Validation

```bash
node src/index.mjs registry validate --registry harness-registry.yaml --json
```

Validation checks:

- Registry file exists and is valid YAML.
- `schema` is `evopilot-harness-registry/v1`.
- The Registry does not contain Harness `entries`.
- Each enabled Catalog root exists and contains `CATALOG.md`.
- Each enabled `CATALOG.md` has the `yaml evopilot-harness-catalog` block.
- `expectedCatalogDigest` matches when provided.

## EvoPilot Read Rule

EvoPilot reads the Registry dynamically through `EVOPILOT_HARNESS_REGISTRY_CONFIG`. It resolves enabled Catalog roots, reads each Catalog's `CATALOG.md`, and records the selected Harness plus registry/catalog digests in `plan.selectedHarness`.

EvoPilot must not write, import, approve, publish, or evolve Registry, Catalog, or Harness definitions.
