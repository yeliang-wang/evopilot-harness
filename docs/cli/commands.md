# EvoPilot Harness CLI Commands

> Command reference for `evopilot-harness`.

From the repository, use `node src/index.mjs`. If the command is installed on the shell path, use `evopilot-harness`.

## Global Options

| Option | Meaning |
|---|---|
| `--json` | Print machine-readable JSON. |
| `--source <dir>` | Source Harness pack directory. Default: `harnesses`. |
| `--out <dir>` | Output Catalog directory. Default: `published`. |
| `--registry <file>` | Registry config file. Default: `harness-registry.yaml`. |
| `--data-root <dir>` | Evolution run state directory. Default: `.evopilot-harness`. |
| `--generated-at <iso>` | Deterministic Catalog timestamp for publication. |
| `--compatible-evopilot <range>` | Compatibility range written to Catalog. Default: `>=3.0.0`. |

## Catalog

Publish all source packs:

```bash
node src/index.mjs catalog publish --source harnesses --out published --json
```

Publish one named pack:

```bash
node src/index.mjs catalog publish --source harnesses --out published --name database-product-harness --json
```

Validate a published Catalog:

```bash
node src/index.mjs catalog validate --source published --json
```

JSON schema:

```text
evopilot-harness-catalog-publish-result/v1
evopilot-harness-catalog-validation-result/v1
```

## Registry

Publish or update a Registry entry for a Catalog:

```bash
node src/index.mjs registry publish \
  --catalog published \
  --registry harness-registry.yaml \
  --id evopilot-public-harness-catalog \
  --priority 100 \
  --json
```

Validate the Registry and all enabled Catalog roots:

```bash
node src/index.mjs registry validate --registry harness-registry.yaml --json
```

The Registry is a discovery layer. It must not contain Harness `entries`; those remain only in each Catalog's `CATALOG.md`.

JSON schema:

```text
evopilot-harness-registry-publish-result/v1
evopilot-harness-registry-validation-result/v1
```

## Harness

List packs:

```bash
node src/index.mjs harness list --source harnesses --json
```

Inspect a pack:

```bash
node src/index.mjs harness inspect database-product-harness --source harnesses --json
```

Validate one or all packs:

```bash
node src/index.mjs harness validate database-product-harness --source harnesses --json
node src/index.mjs harness validate --source harnesses --json
```

Publish one pack through the Catalog publisher:

```bash
node src/index.mjs harness publish database-product-harness --source harnesses --out published --json
```

Deprecate a pack:

```bash
node src/index.mjs harness deprecate database-product-harness --source harnesses --reason "Replaced by database-product-harness@2.3.0" --json
```

`deprecate` mutates `harnesses/<id>/template.yaml`. Review the diff before publishing.

JSON schema:

```text
evopilot-harness-list/v1
evopilot-harness-inspect/v1
evopilot-harness-validation-result/v1
evopilot-harness-deprecate-result/v1
```

## Evolution

Create a run:

```bash
node src/index.mjs evolution create \
  --source-project /path/to/source-project \
  --goal "Create or evolve a distributed cache Harness." \
  --json
```

Add more sources:

```bash
node src/index.mjs evolution sources <evolution-id> \
  --file ./architecture.md \
  --production-log ./production.log \
  --note "Focus on failover diagnostics." \
  --json
```

Advance to draft review:

```bash
node src/index.mjs evolution advance <evolution-id> --json
```

Review details:

```bash
node src/index.mjs evolution review <evolution-id> --json
```

Approve:

```bash
node src/index.mjs evolution approve <evolution-id> \
  --confirmed-by <administrator> \
  --confirmation "Reviewed source coverage, draft diff, validation, and impact." \
  --json
```

Publish:

```bash
node src/index.mjs evolution publish <evolution-id> --json
```

Generate or refresh impact:

```bash
node src/index.mjs evolution impact <evolution-id> --json
```

Accepted source inputs:

| Option | Meaning |
|---|---|
| `--source-project <path>` | Local code and documentation directory. |
| `--file <path>` | Supporting text or binary material. |
| `--attachment <path>` | Alias for supporting material. |
| `--production-log <path>` | Runtime log input with common-pattern redaction. |
| `--note <text>` | Administrator context. |
| `--goal <text>` or `--intent <text>` | Evolution objective. |
| `--target-id <id>` | Force the target Harness id. |
| `--match-threshold <number>` | Override auto-match threshold. Default: `0.08`. |

JSON schema:

```text
evopilot-harness-evolution/v1
evopilot-harness-evolution-detail/v1
evopilot-harness-evolution-impact/v1
```

## One-Command Evolve

Run create, advance, validation, and optional approval/publication:

```bash
node src/index.mjs evolve \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable Harness definition." \
  --json
```

Approve and publish in the same run only when an administrator has already reviewed the source and accepts the generated result:

```bash
node src/index.mjs evolve \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable Harness definition." \
  --approve-and-publish \
  --confirmed-by <administrator> \
  --confirmation "Reviewed source coverage, draft diff, validation, and impact." \
  --json
```

JSON schema:

```text
evopilot-harness-evolve-result/v1
```

## Hub

Generate a static snapshot:

```bash
node src/index.mjs hub snapshot \
  --catalog published \
  --registry harness-registry.yaml \
  --source harnesses \
  --out ui/harness-hub/catalog-snapshot.json \
  --json
```

Serve the browser UI:

```bash
node src/index.mjs hub serve \
  --host 127.0.0.1 \
  --port 4176 \
  --catalog published \
  --registry harness-registry.yaml \
  --source harnesses
```

Environment variables:

| Variable | Meaning |
|---|---|
| `EVOPILOT_HARNESS_HUB_HOST` | Hub bind host. Default: `127.0.0.1`. |
| `EVOPILOT_HARNESS_HUB_PORT` | Hub port. Default: `4176`. |
| `EVOPILOT_HARNESS_CATALOG_ROOT` | Catalog root used by Hub. |
| `EVOPILOT_HARNESS_REGISTRY_CONFIG` | Registry file used by Hub snapshot and EvoPilot hand-off. |
| `EVOPILOT_HARNESS_SOURCE_ROOT` | Source pack root used by Hub. |

JSON schema:

```text
evopilot-harness-hub-snapshot/v1
evopilot-harness-hub-serve-result/v1
```
