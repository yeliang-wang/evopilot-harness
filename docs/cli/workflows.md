# EvoPilot Harness CLI Workflows

These workflows describe how Harness administrators and AI agents use the CLI.

## Publish Current Source Packs

```bash
node src/index.mjs harness list --source harnesses --json
node src/index.mjs harness validate --source harnesses --json
node src/index.mjs catalog publish --source harnesses --out published --json
node src/index.mjs catalog validate --source published --json
```

Success evidence:

```text
catalog publish status=PUBLISHED
catalog validate status=VALIDATED
published/CATALOG.md exists
entries[].digest is present
```

## One-Command Source Project Evolution

```bash
node src/index.mjs evolve \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable domain Harness from this project." \
  --json
```

The CLI scans the source project, computes source coverage, auto-matches existing packs by signals, generates a draft pack, validates it, and stops for review when the result is valid.

Expected review fields:

```text
status=REVIEW_REQUIRED
nextAction=review-approve-harness
autoMatch.decision
autoMatch.targetHarnessId
draft.harnessId
draft.version
validation.status=VALIDATED
```

Review generated files:

```text
.evopilot-harness/evolutions/<evolution-id>/draft/template.yaml
.evopilot-harness/evolutions/<evolution-id>/draft/README.md
.evopilot-harness/evolutions/<evolution-id>/draft/CHANGELOG.md
.evopilot-harness/evolutions/<evolution-id>/draft/examples/selected-harness-binding.yaml
```

## Review-Gated Atomic Evolution

```bash
node src/index.mjs evolution create \
  --source-project /path/to/source-project \
  --file ./architecture.md \
  --production-log ./production.log \
  --goal "Evolve the distributed cache Harness with failover diagnostics." \
  --json

node src/index.mjs evolution advance <evolution-id> --json
node src/index.mjs evolution review <evolution-id> --json
node src/index.mjs evolution impact <evolution-id> --json
```

After administrator review:

```bash
node src/index.mjs evolution approve <evolution-id> \
  --confirmed-by <administrator> \
  --confirmation "Reviewed source coverage, draft diff, validation, and impact." \
  --json

node src/index.mjs evolution publish <evolution-id> --json
node src/index.mjs catalog validate --source published --json
```

## Attachment And Log Driven Evolution

Use attachments when the best domain material is not source code:

```bash
node src/index.mjs evolve \
  --attachment ./domain-design.pdf \
  --file ./runbook.md \
  --goal "Create a scheduling system Harness from supplied design material." \
  --json
```

Use production logs for operational learning:

```bash
node src/index.mjs evolve \
  --source-project /path/to/project \
  --production-log ./incident.log \
  --goal "Evolve the Harness with incident diagnostics and release blockers." \
  --json
```

Binary attachments are digested and recorded. Text attachments and text logs contribute text to the local corpus. Production logs receive common-pattern redaction before storage.

## Run Harness Hub

```bash
node src/index.mjs hub snapshot --catalog published --source harnesses --json
node src/index.mjs hub serve --catalog published --source harnesses
```

The Hub serves:

```text
GET /api/hub/snapshot
GET /
```

It can run without EvoPilot or Dashboard.

## EvoPilot Consumption

After publication:

```bash
EVOPILOT_HARNESS_REGISTRY_CONFIG=/path/to/evopilot-harness/harness-registry.yaml
```

EvoPilot reads the Registry, resolves enabled Catalog roots, reads `CATALOG.md` at planning time, and records `plan.selectedHarness`. Existing plans remain immutable and keep their old digests.
