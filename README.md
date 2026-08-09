# EvoPilot Harness

`evopilot-harness` owns EvoPilot-compatible Harness lifecycle outside the EvoPilot runtime. It manages source Harness packs, scans projects or supplied materials, evolves Harness definitions, reviews drafts, and publishes a usable Harness Catalog directory.

Current release: `1.1.0`, compatible with EvoPilot `>=3.0.0`.

## Quick Start

```bash
npm install
npm run catalog:publish
npm run catalog:validate
npm run hub:serve
```

One-command Harness evolution from a source project:

```bash
evopilot-harness evolve \
  --source-project /path/to/source-project \
  --goal "Create or evolve a distributed cache Harness from this project." \
  --approve-and-publish \
  --confirmed-by admin@example.com \
  --confirmation "Reviewed source coverage, draft diff, and validation." \
  --json
```

## Boundary

- `evopilot-harness` owns Harness lifecycle management, source collection, matching, draft generation, review, approval, versioning, and publication.
- `evopilot-harness` owns its browser UI. The Harness Hub can run by itself and does not require EvoPilot or Dashboard.
- EvoPilot owns project registration, RBAC, goal planning, selected Harness binding, loop execution, evidence, and release decisions.
- EvoPilot does not import, mount, publish, or evolve Harness definitions. It reads configured Catalog directories at use time.
- Dashboard may embed the independent Harness Hub in an iframe, but it does not own Harness UI state and does not read this repository or local files directly.
- Harness definitions are EvoPilot-compatible contracts. They are intentionally not a universal harness format for every control plane.

## Catalog Contract

Publishing creates a usable Harness Catalog directory. The directory must contain `CATALOG.md` with a machine-readable fenced block named `evopilot-harness-catalog`. EvoPilot parses that block and then reads each referenced `template.yaml` or `harness.yaml`.

```text
published/
  CATALOG.md
  database-product-harness/2.2.0/template.yaml
  api-gateway-harness/2.2.0/template.yaml
  distributed-cache-harness/0.1.0/template.yaml
```

Configure EvoPilot with the published directory:

```bash
EVOPILOT_HARNESS_CATALOG_DIRS=/path/to/evopilot-harness/published
```

Multiple Catalog directories can be separated with `:` on macOS/Linux. EvoPilot dynamically reads every configured directory when listing Catalogs or planning a goal, then records the selected Harness id, version, Catalog id, path, and digests in `selectedHarness`.

## CLI Model

Atomic lifecycle commands stay available for administrators and automation:

```bash
evopilot-harness harness list --json
evopilot-harness harness inspect database-product-harness --json
evopilot-harness harness validate database-product-harness --json
evopilot-harness catalog publish --source harnesses --out published --json
evopilot-harness catalog validate --source published --json
evopilot-harness evolution create --source-project /path/to/project --goal "..." --json
evopilot-harness evolution advance <evolution-id> --json
evopilot-harness evolution approve <evolution-id> --confirmed-by <actor> --confirmation <text> --json
evopilot-harness evolution publish <evolution-id> --json
```

The user-facing shortcut is `evopilot-harness evolve`, which runs source scan, auto-match or new Harness creation, draft generation, validation, optional approval, and publication.

## Harness Hub UI

Run the independent Harness Hub:

```bash
evopilot-harness hub serve --catalog published --source harnesses
```

Open `http://127.0.0.1:4176`. The UI displays the published Catalog, Harness contracts, lifecycle commands, source types, local evolution runs, and a one-command evolve builder. It reads local state from `evopilot-harness` through `/api/hub/snapshot`; it does not call EvoPilot or Dashboard.

## Source Inputs

Harness evolution can use:

- `--source-project` for local project code and documentation.
- `--file` or `--attachment` for supporting material such as Markdown, text exports, PDFs, Word, PowerPoint, or design notes. Binary attachments are digested and recorded even when their full text cannot be extracted.
- `--production-log` for runtime logs. The CLI redacts common token, password, secret, API key, authorization, and email patterns before adding them to the source corpus.
- `--note` for administrator context.

## Release Flow

1. Edit source packs under `harnesses/<harness-id>/` or run `evopilot-harness evolve`.
2. Review generated drafts under `.evopilot-harness/evolutions/<evolution-id>/draft/`.
3. Approve and publish only after source coverage, validation, and impact are acceptable.
4. Run `npm run catalog:publish`, `npm run catalog:validate`, and `npm test`.
5. Release `evopilot-harness` independently when Harness definitions or lifecycle tooling change.

EvoPilot automatically picks up Catalog content changes the next time it reads the configured directory. Active goal plans keep their recorded `selectedHarness` digest; new or regenerated plans can bind newer Harness versions.
