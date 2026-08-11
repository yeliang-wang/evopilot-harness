# Contributing To EvoPilot Harness

Contributions must preserve the product boundary: this repository produces and publishes Harness assets; it does not onboard EvoPilot projects or execute EvoPilot goal loops.

## Before You Start

1. Read [AGENTS.md](AGENTS.md) and [ADR 0001](docs/architecture/adr/0001-product-and-module-boundaries.md).
2. Search existing issues and changes before opening overlapping work.
3. For architecture, schema, lifecycle, or compatibility changes, describe the boundary and migration impact before implementation.
4. Never include source-project code, production logs, credentials, private endpoints, or a real `models.json` in a contribution.

## Local Setup

```bash
npm ci

export EVOPILOT_HARNESS_HOME="$(mktemp -d)"
node src/index.mjs workspace init --workspace "$EVOPILOT_HARNESS_HOME" --json
npm run check
```

Node.js 22 or newer is required. See the [development guide](docs/development.md) for source layout and targeted checks.

## Change Rules

- Keep the Engine checkout read-only during Harness production. Mutable runs and user assets belong under `EVOPILOT_HARNESS_HOME`.
- Treat source projects, attachments, logs, historical Harnesses, and research as evidence only. They must not overwrite Built-in Catalog assets.
- Keep GLM Advisor output advisory and evidence-bound. It cannot approve, publish, execute project commands, or override deterministic gates.
- Preserve immutable published versions. Publish a new asset version instead of replacing an existing one.
- Keep current v3 documentation separate from legacy v2 compatibility guidance.
- Update tests and documentation when CLI, schema, policy, lifecycle, or Hub behavior changes.

## Validation

Run the smallest relevant checks while developing, then run the complete gate before submitting:

```bash
npm run docs:links
npm run verify:architecture
npm test
npm run v3:check
npm run check
git diff --check
```

`npm run check` regenerates tracked Catalog and Hub snapshots. Review the resulting diff and do not commit unrelated generated changes.

## Pull Request Content

Describe:

- the problem and intended behavior;
- changed contracts, commands, assets, or documentation;
- product-boundary and compatibility impact;
- validation commands and results;
- any migration, rollback, or human-review requirement.

By submitting a contribution, you agree that it is licensed under the repository's [Apache License 2.0](LICENSE).
