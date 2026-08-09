# EvoPilot Integration

EvoPilot consumes published Harness Catalog directories. It does not manage Harness lifecycle.

## Publish A Catalog

In `evopilot-harness`:

```bash
node src/index.mjs catalog publish --source harnesses --out published --json
node src/index.mjs catalog validate --source published --json
```

The usable artifact is the `published/` directory, especially `published/CATALOG.md`.

## Configure EvoPilot

Start EvoPilot with one or more Catalog roots:

```bash
EVOPILOT_HARNESS_CATALOG_DIRS=/path/to/evopilot-harness/published
```

For multiple roots on macOS or Linux:

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
plan.selectedHarness.selectionReasons
```

If `selectedHarness` is missing, stop and repair the Catalog configuration or publish a better Harness.

## Change Behavior

Publishing a new Catalog does not rewrite active EvoPilot plans. Existing plans keep their recorded digests. New or regenerated plans can select the updated Harness version.

## What EvoPilot Must Not Do

EvoPilot must not:

- write to `harnesses/`
- write to `published/`
- approve Harness evolution runs
- expose Harness lifecycle CLI commands
- import Harness files into its own mutable lifecycle store

EvoPilot is a consumer. `evopilot-harness` is the Harness source of truth.
