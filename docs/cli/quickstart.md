# EvoPilot Harness CLI Quickstart

> Shortest successful path to publish Harness definitions, validate them, and run the Harness Hub.

## 1. Prepare The Repository

```bash
cd /path/to/evopilot-harness
npm install
node src/index.mjs --help
```

Continue only when Node.js is `>=22` and the CLI prints the expected command groups.

## 2. Publish And Validate The Catalog

```bash
node src/index.mjs catalog publish --source harnesses --out published --json
node src/index.mjs catalog validate --source published --json
```

Expected result:

```text
catalog publish status=PUBLISHED
catalog validate status=VALIDATED
```

The `published/` directory must contain `CATALOG.md` with a fenced `yaml evopilot-harness-catalog` block.

## 3. Start Harness Hub

```bash
node src/index.mjs hub serve --catalog published --source harnesses
```

Open:

```text
http://127.0.0.1:4176
```

The Hub reads `/api/hub/snapshot` from the local `evopilot-harness` server. It does not require EvoPilot or Dashboard.

## 4. Evolve From A Source Project

```bash
node src/index.mjs evolve \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable domain Harness from this project." \
  --json
```

If validation succeeds, the run stops at `REVIEW_REQUIRED`. Review the generated files under:

```text
.evopilot-harness/evolutions/<evolution-id>/draft/
```

Approve and publish after administrator review:

```bash
node src/index.mjs evolution approve <evolution-id> \
  --confirmed-by <administrator> \
  --confirmation "Reviewed source coverage, draft diff, validation, and impact." \
  --json

node src/index.mjs evolution publish <evolution-id> --json
```

## 5. Configure EvoPilot

EvoPilot reads the published directory at use time:

```bash
EVOPILOT_HARNESS_CATALOG_DIRS=/path/to/evopilot-harness/published
```

New or regenerated EvoPilot plans can bind newer Harness versions. Existing plans keep their recorded `selectedHarness` digests.
