# EvoPilot Harness CLI Quickstart

> Shortest successful path to publish Harness definitions, validate them, and run the Harness Hub.

## 1. Prepare The Repository

```bash
cd /path/to/evopilot-harness
npm install
node src/index.mjs --help
```

Continue only when Node.js is `>=22` and the CLI prints the expected command groups.

## 2. Publish And Validate The Catalog And Registry

```bash
node src/index.mjs catalog publish --source harnesses --out published --json
node src/index.mjs catalog validate --source published --json
node src/index.mjs registry publish --catalog published --registry harness-registry.yaml --json
node src/index.mjs registry validate --registry harness-registry.yaml --json
node src/index.mjs asset validate --source published --json
```

Expected result:

```text
catalog publish status=PUBLISHED
catalog validate status=VALIDATED
registry publish status=PUBLISHED
registry validate status=VALIDATED
asset validate status=VALIDATED
```

The `published/` directory must contain `CATALOG.md` with a fenced `yaml evopilot-harness-catalog` block, `catalogVersion: 2`, and `entries[].assetPath` pointing to Harness Asset v2 envelopes. `harness-registry.yaml` points EvoPilot at one or more Catalog roots and must not duplicate Harness entries.

## 3. Start Harness Hub

```bash
node src/index.mjs hub serve --catalog published --registry harness-registry.yaml --source harnesses
```

Open:

```text
http://127.0.0.1:4176
```

The Hub reads `/api/hub/snapshot` from the local `evopilot-harness` server. It does not require EvoPilot or Dashboard.

## 4. Evolve From A Source Project

Detect the source role and candidate Harness first:

```bash
node src/index.mjs detect \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable domain Harness from this project." \
  --json
```

Review `sourceProfile.primaryRole`, `autoMatch.decision`, `autoMatch.targetHarnessId`, and `autoMatch.parentCandidates`.

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

The draft includes `template.yaml` and `asset.yaml`. The template is the EvoPilot-compatible Harness contract; the asset is the v2 review and publication envelope.

Every generated draft includes `template.definitionQuality`. The default objective is a more accurate, professional, and fine-grained Harness definition. It improves boundary precision, match-policy specificity, evidence contracts, domain execution actions, and negative-signal review. Large-scale performance optimization, throughput expansion, and runtime tuning are non-goals unless an operator explicitly asks for them with source evidence.

Approve and publish after administrator review:

```bash
node src/index.mjs evolution approve <evolution-id> \
  --confirmed-by <administrator> \
  --confirmation "Reviewed source coverage, draft diff, validation, and impact." \
  --json

node src/index.mjs evolution publish <evolution-id> --json
```

## 5. Evolve From A GitHub Repository

Use this path when the source material is a public GitHub repository or another Git remote reachable by local `git`.

```bash
node src/index.mjs detect \
  --github-repo owner/repo \
  --github-ref main \
  --goal "Create or evolve a reusable domain Harness from this GitHub repository." \
  --json

node src/index.mjs evolve \
  --github-repo https://github.com/owner/repo \
  --github-ref main \
  --goal "Create or evolve a reusable domain Harness from this GitHub repository." \
  --json
```

The CLI clones or fetches the repository into `.evopilot-harness/github-sources/`, records `sourceCoverage.sources[].type=github-repository`, `github.repository`, `github.ref`, `github.resolvedCommit`, and `github.cachePath`, then runs the same Source Profile v2 and Auto-Match v2 flow as a local `--source-project`.

Do not put GitHub tokens in the URL. Use public HTTPS, local Git credentials, or SSH.

## 6. Evolve From A Source Root Corpus

Use this path when a directory contains many historical projects and the operator wants `evopilot-harness` to scan, group, dedupe, and generate grouped Harness drafts.

```bash
node src/index.mjs corpus scan \
  --source-root /path/to/project-root \
  --include-modules \
  --json
```

Review `groups[]`, `selectedProjects[]`, and `duplicateProjects[]`, then generate draft packs:

```bash
node src/index.mjs corpus plan \
  --source-root /path/to/project-root \
  --include-modules \
  --max-projects-per-group 5 \
  --json
```

If validation succeeds, the run stops at `REVIEW_REQUIRED`. Review the generated files under:

```text
.evopilot-harness/corpora/<corpus-id>/drafts/<target-harness-id>/
```

Approve and publish after administrator review:

```bash
node src/index.mjs corpus approve <corpus-id> \
  --confirmed-by <administrator> \
  --confirmation "Reviewed corpus grouping, dedupe decisions, generated drafts, validation, and publication impact." \
  --json

node src/index.mjs corpus publish <corpus-id> --json
```

For a one-command wrapper that still stops at review:

```bash
node src/index.mjs evolve corpus \
  --source-root /path/to/project-root \
  --include-modules \
  --json
```

## 7. Run Release-Gate Evaluations

```bash
node src/index.mjs eval run --json
node src/index.mjs llm replay --json
```

Both commands must return `status=PASSED` before a v2 release.

## 8. Configure EvoPilot

EvoPilot reads the Registry at use time:

```bash
EVOPILOT_HARNESS_REGISTRY_CONFIG=/path/to/evopilot-harness/harness-registry.yaml
```

New or regenerated EvoPilot plans can bind newer Harness versions. Existing plans keep their recorded `selectedHarness` digests.
