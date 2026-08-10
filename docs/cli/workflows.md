# EvoPilot Harness CLI Workflows

These workflows describe how Harness administrators and AI agents use the CLI.

## Publish Current Source Packs

```bash
node src/index.mjs harness list --source harnesses --json
node src/index.mjs harness validate --source harnesses --strict --json
node src/index.mjs catalog publish --source harnesses --out published --strict --json
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

Detect first:

```bash
node src/index.mjs detect \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable domain Harness from this project." \
  --json
```

Continue only after reviewing `sourceProfile.primaryRole`, `autoMatch.decision`, `autoMatch.targetHarnessId`, `autoMatch.parentCandidates`, and `nextAction`.

```bash
node src/index.mjs evolve \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable domain Harness from this project." \
  --json
```

The CLI scans the source project, computes source coverage, builds a Source Profile v2, runs Auto-Match v2, generates a draft pack, validates Template Quality Standard v1 and Harness Asset v2, and stops for review when the result is valid.

Expected review fields:

```text
status=REVIEW_REQUIRED
nextAction=review-approve-harness
autoMatch.decision
autoMatch.targetHarnessId
sourceProfile.primaryRole
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

## Batch Source Detection

Use batch detection to evaluate many historical project directories without publishing anything:

```bash
node src/index.mjs detect batch \
  --source-root /path/to/source-root \
  --include-modules \
  --limit 50 \
  --json
```

Review `detections[]` and choose which source project should enter `evolve`. This workflow is for upgrading the algorithm and operator decision quality; it does not copy source code or convert every detected project into a Harness template.

## Corpus Evolution From A Source Root

Use corpus evolution when the operator wants the CLI to continue beyond batch detection and create grouped review drafts:

```bash
node src/index.mjs corpus plan \
  --source-root /path/to/source-root \
  --include-modules \
  --max-projects-per-group 5 \
  --goal "Batch evolve Harness definitions from this historical project corpus." \
  --json
```

Expected review fields:

```text
status=REVIEW_REQUIRED
nextAction=review-approve-corpus-plan
discovery.discoveredCount
discovery.evaluatedCount
duplicateCount
groups[].targetHarnessId
groups[].selectedProjects[]
groups[].duplicateProjects[]
groups[].validation.status=VALIDATED
validation.status=VALIDATED
```

Review generated files:

```text
.evopilot-harness/corpora/<corpus-id>/drafts/<target-harness-id>/template.yaml
.evopilot-harness/corpora/<corpus-id>/drafts/<target-harness-id>/README.md
.evopilot-harness/corpora/<corpus-id>/drafts/<target-harness-id>/CHANGELOG.md
.evopilot-harness/corpora/<corpus-id>/drafts/<target-harness-id>/examples/selected-harness-binding.yaml
```

After administrator review:

```bash
node src/index.mjs corpus approve <corpus-id> \
  --confirmed-by <administrator> \
  --confirmation "Reviewed corpus grouping, dedupe decisions, generated drafts, validation, and publication impact." \
  --json

node src/index.mjs corpus publish <corpus-id> --json
node src/index.mjs catalog validate --source published --json
```

For one-command operation:

```bash
node src/index.mjs evolve corpus \
  --source-root /path/to/source-root \
  --include-modules \
  --json
```

`evolve corpus` is a wrapper around `corpus plan`. It does not approve or publish unless `--approve-and-publish`, `--confirmed-by`, and `--confirmation` are supplied.

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
