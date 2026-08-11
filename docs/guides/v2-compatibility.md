# v2 Compatibility Guide

Use this guide only for existing automation built on v2 source packs, `detect`, `evolve`, `corpus`, or `published/CATALOG.md`. New Harness production should use the [v3 lifecycle](v3-production-lifecycle.md).

## Validate Existing v2 Assets

```bash
node src/index.mjs harness list --source harnesses --json
node src/index.mjs harness validate --source harnesses --strict --json
node src/index.mjs asset validate --source harnesses --json
node src/index.mjs catalog validate --source published --json
node src/index.mjs registry validate --registry harness-registry.yaml --json
```

## Legacy Evolution

```bash
node src/index.mjs evolve \
  --source-project /path/to/project \
  --goal "Create or evolve a reusable domain Harness." \
  --json
```

The command creates a review-stage v2 draft. It does not publish without approval. Existing atomic commands remain documented in [CLI Commands](../cli/commands.md) and [Harness Evolution](harness-evolution.md).

## Migrate To v3

Initialize a writable Workspace:

```bash
export EVOPILOT_HARNESS_HOME="$HOME/.evopilot-harness"
node src/index.mjs workspace init --workspace "$EVOPILOT_HARNESS_HOME" --json
```

Run a dry-run first:

```bash
node src/index.mjs migrate v2-to-v3 \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source harnesses \
  --json
```

After reviewing the migration plan, apply it explicitly:

```bash
node src/index.mjs migrate v2-to-v3 \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source harnesses \
  --apply \
  --json
```

The migration writes v3 Profiles, Bundles, optional EvoPilot exports, and a rollback journal under the Workspace. It does not overwrite the v2 source packs.

Rollback requires the exact migration id returned by the applied run:

```bash
node src/index.mjs migrate rollback <migration-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --json
```

## Do Not Mix Authorities

- Do not present a v2 `template.yaml` as a canonical v3 Bundle.
- Do not copy a v2 asset into the v3 Catalog without migration and validation.
- Do not let evidence inputs overwrite `assets/v3/`.
- Do not make EvoPilot the owner of migration, review, or publication.
- Do not delete v2 assets until dependent automation and consumers have moved to immutable v3 Bundles.

For the data model mapping, see [v2 Architecture Compatibility](../architecture/v2-compatibility.md).
