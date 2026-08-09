# EvoPilot Integration

EvoPilot consumes the Harness Registry and the published Catalog directories it points to. It does not manage Harness lifecycle.

## Publish A Catalog

In `evopilot-harness`:

```bash
node src/index.mjs catalog publish --source harnesses --out published --json
node src/index.mjs catalog validate --source published --json
node src/index.mjs registry publish --catalog published --registry harness-registry.yaml --json
node src/index.mjs registry validate --registry harness-registry.yaml --json
```

The usable Harness publication has two parts:

- `harness-registry.yaml` discovers one or more Catalog roots.
- `published/`, especially `published/CATALOG.md`, indexes Harness entries for that Catalog.

## Configure EvoPilot

Start EvoPilot with the Registry file:

```bash
EVOPILOT_HARNESS_REGISTRY_CONFIG=/path/to/evopilot-harness/harness-registry.yaml
```

Legacy direct Catalog roots remain supported only as a fallback when no Registry is configured:

```bash
EVOPILOT_HARNESS_CATALOG_DIRS=/path/to/catalog-a:/path/to/catalog-b
```

## Planning Behavior

At goal-plan time, EvoPilot reads the current Catalog content and selects a published Harness. The plan should include:

```text
plan.selectedHarness.harnessId
plan.selectedHarness.version
plan.selectedHarness.domain
plan.selectedHarness.catalogId
plan.selectedHarness.catalogDigest
plan.selectedHarness.entryPath
plan.selectedHarness.entryDigest
plan.selectedHarness.registryPath
plan.selectedHarness.registryDigest
plan.selectedHarness.registryCatalogPriority
plan.selectedHarness.selectionReasons
```

If `selectedHarness` is missing, stop and repair the Registry/Catalog configuration or publish a better Harness.

## Change Behavior

Publishing a new Catalog does not rewrite active EvoPilot plans. Existing plans keep their recorded digests. New or regenerated plans can select the updated Harness version.

Adding a Catalog to `harness-registry.yaml` also does not require an EvoPilot release. EvoPilot observes the new enabled Catalog on the next Catalog read or goal-plan request.

## What EvoPilot Must Not Do

EvoPilot must not:

- write to `harnesses/`
- write to `published/`
- approve Harness evolution runs
- expose Harness lifecycle CLI commands
- import Harness files into its own mutable lifecycle store

EvoPilot is a consumer. `evopilot-harness` is the Harness source of truth.
