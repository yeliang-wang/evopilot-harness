# EvoPilot Harness

`evopilot-harness` manages EvoPilot-compatible Harness definitions outside the EvoPilot runtime. It evolves, reviews, and publishes usable Harness assets. EvoPilot consumes the published catalog dynamically and executes goal loops from the selected Harness digest.

Current release: `0.1.0`, compatible with EvoPilot `>=2.5.0`.

## Quick Start

```bash
npm install
npm run catalog:publish
npm run catalog:validate
```

Mount the published catalog in EvoPilot:

```bash
evopilot harness catalog mount --source /path/to/evopilot-harness/published --json
```

## Boundary

- This project owns Harness authoring, versioning, provenance, and catalog publication.
- EvoPilot owns RBAC, project matching, `ProjectHarnessProfile` generation, goal loop execution, evidence, and release decisions.
- Dashboard shows Harness Hub through EvoPilot APIs; it does not read this repository or local files directly.
- Harness definitions are EvoPilot-compatible contracts. They are intentionally not a universal harness format for every control plane.

## Catalog Contract

Published catalogs contain a human-readable `CATALOG.md` with a machine-readable fenced block named `evopilot-harness-catalog`. EvoPilot parses only that block, then reads each referenced `harness.yaml` or `template.yaml`.

`npm run catalog:validate` verifies the catalog block, every referenced template path, and the domain Harness execution contract. Domain Harness definitions must provide structured `requiredActions`, structured `evidenceAdapters`, and non-empty `releaseBlockers` before publication is considered valid.

```text
published/
  CATALOG.md
  database-product-harness/2.2.0/template.yaml
  api-gateway-harness/2.2.0/template.yaml
  distributed-cache-harness/0.1.0/template.yaml
```

## Release Flow

1. Edit source packs under `harnesses/<harness-id>/`.
2. Run `npm run catalog:publish` to rebuild the usable Catalog directory.
3. Run `npm run catalog:validate` and `npm test`.
4. Release this project independently from EvoPilot when Harness definitions change.
5. Mount or rescan the published directory from EvoPilot:

```bash
evopilot harness catalog mount --source /path/to/evopilot-harness/published --json
evopilot harness catalog scan evopilot-public-harness-catalog --json
```

EvoPilot locks selected template and Catalog digests when it generates a project profile. Later Harness Catalog changes require a reviewed project profile regeneration or upgrade before affecting active projects.
