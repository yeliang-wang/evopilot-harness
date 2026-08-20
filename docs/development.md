# Development

This guide covers changes to the `evopilot-harness` Engine, CLI, schemas, Packs, tests, and Harness Hub. For operating an installed Engine against user assets, start with the [CLI quickstart](cli/quickstart.md).

## Prerequisites

- Node.js 22 or newer
- npm
- Git
- Optional: Docker for container checks
- Optional: `pdftotext` for PDF evidence extraction

## Setup

```bash
npm ci

export EVOPILOT_HARNESS_HOME="$(mktemp -d)"
node src/index.mjs workspace init --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs workspace status --workspace "$EVOPILOT_HARNESS_HOME" --json
```

Use a disposable Workspace for development. Do not point tests at a user's production Harness asset library.

## Source Layout

| Path | Responsibility |
|---|---|
| `src/v3/` | Workspace, evidence, reasoning, Advisor, lifecycle, Catalog, migration, and Hub runtime. |
| `src/index.mjs` | CLI entry point and legacy v2 compatibility commands. |
| `schemas/` | Formal Asset, Ontology, Policy, Advisor, and Evaluation schemas. |
| `assets/v3/` | Built-in Component, Profile, Bundle, and export assets shipped with the Engine. |
| `ontology/` | Built-in Ontology Packs. |
| `policies/` | Built-in Matcher and Advisor Policy Packs. |
| `ui/harness-hub/` | Standalone Harness Hub frontend. |
| `tests/` | v3 behavior, safety, lifecycle, and v2 compatibility tests. |
| `eval/` | Contract, unknown-source, adversarial, and Advisor replay fixtures. |
| `scripts/` | Validation, generated snapshot, architecture, and release tooling. |
| `harnesses/`, `published/` | Legacy v2 source packs and published compatibility Catalog. |

The accepted ownership contract is [ADR 0001](architecture/adr/0001-product-and-module-boundaries.md). A change that crosses that contract requires an explicit replacement ADR, migration analysis, updated executable guards, and user approval.

## Common Change Flows

### CLI Or Lifecycle

1. Verify the current command behavior from `src/index.mjs` and `src/v3/`.
2. Preserve JSON response fields, stop conditions, approval gates, and immutable publication.
3. Add or update tests under `tests/`.
4. Update `docs/cli/` and the relevant lifecycle or reference page.

### Schema, Ontology, Or Policy

1. Keep concepts, weights, thresholds, and Advisor authority in versioned Packs rather than hard-coding domain policy in the matcher.
2. Version changed assets and preserve old immutable versions.
3. Validate references and digests through `npm run v3:check`.
4. Document migration and evaluation impact.

### Harness Hub

1. Keep state server-derived from the Workspace.
2. Do not add browser-local approval or publication authority.
3. Verify `/api/health`, `/api/hub/snapshot`, and `/api/v3/snapshot`.
4. Check desktop and mobile layouts with representative Workspace data.

### Documentation

Keep the root README as a concise product entry. Put normative details in one focused page and route other pages to it. Current v3 behavior belongs in generic pages; legacy behavior belongs under explicit v2 compatibility pages.

## Validation Matrix

| Change | Minimum validation |
|---|---|
| Documentation only | `npm run docs:links`, documentation audit, `git diff --check` |
| Boundaries or modules | `npm run verify:architecture`, `npm test` |
| CLI or lifecycle | `npm test`, `npm run v3:check`, targeted CLI smoke |
| Schemas, assets, Packs | `npm run v3:check`, `npm run check` |
| Hub | Hub API smoke plus desktop and mobile browser checks |
| npm or Agent distribution | `npm run package:verify`, `npm run package:smoke`, and actual-host conformance when support is claimed |
| Release | `npm run check`, `npm run package:workbuddy`, `npm run release:artifact`, `npm run verify:release-artifact` |

Before submission, run the complete local gate:

```bash
npm run check
git diff --check
```

`npm run check` regenerates the legacy published Catalog, Registry, and Hub snapshots before validating them. Inspect `git status` afterward and include only intentional changes.

## Secrets And Test Material

- `models.json` is manually maintained, read-only application input. Never print or commit it.
- Never use production logs without redaction and authorization.
- Never copy source projects into Built-in Catalog assets or treat local validation corpora as published templates.
- Never run project-provided commands during static source ingestion.
- Use fixture repositories and disposable Workspaces for tests.

See [Contributing](../CONTRIBUTING.md), [Testing](operations/testing.md), and [Security](../SECURITY.md) before submitting changes.
