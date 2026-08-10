# v3 Workspace And Migration

## Directory Layout

```text
$EVOPILOT_HARNESS_HOME/
├── config.yaml
├── harness-registry.yaml
├── catalogs/
│   ├── builtin/
│   └── organization/
├── ontology/
├── policies/
│   ├── matcher/
│   └── advisor/
├── evidence/
├── evaluations/
├── evolution-runs/
├── migrations/
├── keys/
└── cache/
```

`catalogs/builtin` is synchronized from the Engine's bootstrap assets. User changes belong in `catalogs/organization`; do not edit built-in files in place.

Workspace status reports `engine.mutationAllowed=false` separately from `engine.filesystemWritable`. A source checkout may be physically writable while the product contract still forbids Engine mutation. The production Compose service additionally uses a read-only root filesystem and keeps `/data` as its writable volume.

## Model Configuration

`models.json` is manual and read-only to the application. Its object format is CodeBuddy-style, but v3 selects only a Zhipu GLM profile:

```json
{
  "models": [
    {
      "id": "glm-5.1",
      "name": "EvoPilot GLM",
      "vendor": "zhipu",
      "apiKey": "<manual-local-key>",
      "url": "https://open.bigmodel.cn/api/coding/paas/v4"
    }
  ]
}
```

The CLI never writes, imports, or publishes this file.

## v2 Migration

Dry run:

```bash
node src/index.mjs migrate v2-to-v3 \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source /path/to/v2/harnesses \
  --json
```

Apply:

```bash
node src/index.mjs migrate v2-to-v3 \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source /path/to/v2/harnesses \
  --apply \
  --json
```

The migration never mutates the source directory. It creates a Profile and Bundle for every valid v2 template, references the shared validation Component, and copies the original template to the Bundle's optional EvoPilot export.

Rollback from the returned journal:

```bash
node src/index.mjs migrate rollback <migration-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --json
```

Rollback removes only files recorded as created by that migration.

## Pack Lifecycle

Inspect and validate installed knowledge:

```bash
node src/index.mjs ontology inspect --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs ontology validate --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs policy inspect --type matcher --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs policy validate --type advisor --workspace "$EVOPILOT_HARNESS_HOME" --json
```

Diff before publishing:

```bash
node src/index.mjs ontology diff --left old.yaml --right new.yaml --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs policy diff --left old.yaml --right new.yaml --type matcher --workspace "$EVOPILOT_HARNESS_HOME" --json
```

Only `approved` or `published` pack documents may be published as a new immutable version.
