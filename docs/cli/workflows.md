# EvoPilot Harness CLI Workflows

These workflows describe how Harness administrators and AI agents use the CLI.

## v3 Primary Workflow

```bash
node src/index.mjs workspace init --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs produce \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source-project /path/to/project \
  --goal "Produce or evolve a reusable Harness asset." \
  --json
node src/index.mjs proposal validate <proposal-id> --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs proposal review <proposal-id> --workspace "$EVOPILOT_HARNESS_HOME" --models-file /path/to/models.json --json
```

Present all five-way decisions and run `proposal validate` for every Proposal. `NO_CHANGE` and `NEED_MORE_EVIDENCE` stop without approval or publication. For a Source Root, execute `proposal review` for every validated mutating Proposal and present every report. Stop after review. Only when the CLI returns `verdict=READY_FOR_HUMAN_APPROVAL` may a real reviewer separately approve evidence, candidate reasoning, Advisor citations, typed Delta, impact analysis, asset boundary, Review Report, and every Evaluation case. This applies to `EVOLVE_EXISTING`, `COMPOSE_NEW_BUNDLE`, and `PROPOSE_NEW_PROFILE`:

```bash
node src/index.mjs proposal approve <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --confirmed-by <reviewer> \
  --confirmation <reviewer-confirmation> \
  --evaluation-reviewed \
  --json
node src/index.mjs proposal publish <proposal-id> --workspace "$EVOPILOT_HARNESS_HOME" --json
```

Detailed single-project, project-root, GitHub, attachment, log, research, signing, and migration workflows are in [v3 Production Lifecycle](../guides/v3-production-lifecycle.md).

## Legacy v2 Workflows

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
draft.template.definitionQuality
validation.status=VALIDATED
```

Review generated files:

```text
.evopilot-harness/evolutions/<evolution-id>/draft/template.yaml
.evopilot-harness/evolutions/<evolution-id>/draft/README.md
.evopilot-harness/evolutions/<evolution-id>/draft/CHANGELOG.md
.evopilot-harness/evolutions/<evolution-id>/draft/examples/selected-harness-binding.yaml
```

## One-Command GitHub Repository Evolution

Use this workflow when the source material is a GitHub repository or another Git remote reachable by local `git`. The CLI checks out the repository into the local cache, then runs the same scanner, Source Profile v2, Auto-Match v2, LLM Advisor, draft generation, validation, and review gates as `--source-project`.

```bash
node src/index.mjs detect \
  --github-repo owner/repo \
  --github-ref main \
  --goal "Create or evolve a reusable domain Harness from this GitHub repository." \
  --json
```

Review:

```text
sourceCoverage.sources[].type=github-repository
sourceCoverage.sources[].github.repository
sourceCoverage.sources[].github.ref
sourceCoverage.sources[].github.resolvedCommit
sourceCoverage.sources[].github.cachePath
sourceProfile.primaryRole
autoMatch.targetHarnessId
autoMatch.reviewGate
```

Then generate a draft:

```bash
node src/index.mjs evolve \
  --github-repo https://github.com/owner/repo \
  --github-ref main \
  --goal "Create or evolve a reusable domain Harness from this GitHub repository." \
  --json
```

Do not pass raw GitHub tokens in `--github-repo`. Public repositories use HTTPS without credentials. Private access should rely on local Git credentials or SSH.

Expected draft quality target:

```text
draft.template.definitionQuality.objective=more accurate, professional, and fine-grained Harness definition
draft.template.definitionQuality.focusAreas present
draft.template.definitionQuality.nonGoals includes large-scale performance optimization, throughput expansion, runtime performance tuning
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
