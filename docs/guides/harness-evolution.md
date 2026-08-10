# Harness Evolution

> New v3 lifecycle uses Profile/Bundle Proposals under a writable Workspace. See [v3 Production Lifecycle](v3-production-lifecycle.md). The lifecycle below is retained for v2 compatibility.

Harness evolution is a local lifecycle managed by `evopilot-harness`. It is independent from EvoPilot releases.

## Lifecycle

```text
CREATED -> REVIEW_REQUIRED -> APPROVED -> PUBLISHED
              |
              v
           BLOCKED
```

## One-Command Flow

Preflight with deterministic detection:

```bash
node src/index.mjs detect \
  --source-project /path/to/project \
  --goal "Create or evolve a reusable domain Harness." \
  --json
```

Review:

```text
sourceProfile.primaryRole
sourceProfile.recommendedHarness
autoMatch.decision
autoMatch.targetHarnessId
autoMatch.parentCandidates
autoMatch.candidates[]
nextAction
```

Then generate the draft:

```bash
node src/index.mjs evolve \
  --source-project /path/to/project \
  --goal "Create or evolve a reusable domain Harness." \
  --json
```

The command performs:

1. source collection
2. source coverage generation
3. Source Profile generation
4. Unknown Source Decision Aggregator v2 matching
5. optional-by-default LLM Advisor semantic review
6. draft generation
7. Template Quality Standard v1 validation
8. Harness Asset v2 validation
9. review stop

Generated drafts also include `template.definitionQuality`. The default evolution target is a more accurate, professional, and fine-grained Harness definition. The target is not large-scale performance optimization, throughput expansion, or runtime performance tuning unless the operator explicitly asks for those goals with source evidence.

If `--approve-and-publish` is supplied, the command also performs approval and publication. Use that only when real administrator approval has already happened.

## GitHub Repository Source Flow

Use `--github-repo` when the project source lives in GitHub or another Git remote reachable by local `git`:

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

The repository is cloned or fetched into `.evopilot-harness/github-sources/` by default, then scanned as project source. Review `sourceCoverage.sources[].github.repository`, `ref`, `resolvedCommit`, and `cachePath` before approval. Do not put GitHub tokens in the URL; use public HTTPS, local Git credentials, or SSH.

## LLM Advisor Review

The LLM Advisor is optional by default. It uses deterministic auto-match as the baseline, then calls the same GLM used by EvoPilot through a manually maintained CodeBuddy-style `models.json`. `evopilot-harness` only reads this file; operators edit it manually, and its content should contain only EvoPilot GLM.

Default lookup:

```text
--llm-models-file <path>
EVOPILOT_HARNESS_LLM_MODELS_FILE
./models.json
built-in evopilot-glm metadata + EVOPILOT_HARNESS_LLM_API_KEY or EVOPILOT_LLM_API_KEY
```

`models.json` format:

```json
{
  "models": [
    {
      "id": "glm-5.1",
      "name": "EvoPilot GLM",
      "vendor": "zhipu",
      "apiKey": "<manual-local-api-key>",
      "url": "https://open.bigmodel.cn/api/coding/paas/v4",
      "supportsToolCall": true,
      "supportsReasoning": true
    }
  ]
}
```

Inspect the selected profile without printing the API key:

```bash
node src/index.mjs llm models --json
```

Run with required GLM review:

```bash
node src/index.mjs evolve \
  --source-project /path/to/project \
  --goal "Create or evolve a reusable domain Harness." \
  --llm-advisor required \
  --json
```

Use `--llm-advisor required` or `--require-llm-advisor` when the run must block if model review cannot complete. Use `--no-llm-advisor` for deterministic-only runs. Use `--apply-llm-advisor` only when a high-confidence Advisor recommendation may change the generated draft target. Explicit `--target-id` still overrides the Advisor.

The Advisor returns:

```text
llmAdvisor.status
llmAdvisor.sourceClassification
llmAdvisor.recommendation
llmAdvisor.alternatives
llmAdvisor.reviewWarnings
llmAdvisor.definitionQualityAdvice
llmAdvisor.sensitiveMaterialFindings
llmAdvisor.provider
llmAdvisor.model
llmAdvisor.llmProfileId
llmAdvisor.usage
```

Advisor output is not approval. Administrators must still review the draft, source coverage, validation, and impact before approving publication.

## Atomic Flow

```bash
node src/index.mjs evolution create --source-project /path/to/project --goal "..." --json
node src/index.mjs evolution advance <evolution-id> --json
node src/index.mjs evolution review <evolution-id> --json
node src/index.mjs evolution impact <evolution-id> --json
node src/index.mjs evolution approve <evolution-id> --confirmed-by <admin> --confirmation <text> --json
node src/index.mjs evolution publish <evolution-id> --json
```

Use the atomic flow for normal administration because it leaves review points between draft generation, approval, and publication.

## Corpus Flow

Use corpus flow when a root directory contains many historical projects and the administrator wants automatic grouping, dedupe, and batch draft generation:

```bash
node src/index.mjs corpus scan --source-root /path/to/project-root --include-modules --json
node src/index.mjs corpus plan --source-root /path/to/project-root --include-modules --json
node src/index.mjs corpus review <corpus-id> --json
node src/index.mjs corpus approve <corpus-id> --confirmed-by <admin> --confirmation <text> --json
node src/index.mjs corpus publish <corpus-id> --json
```

`corpus plan` writes one draft pack per target Harness group:

```text
.evopilot-harness/corpora/<corpus-id>/drafts/<target-harness-id>/
```

It uses the same Source Profile, auto-match, optional LLM Advisor, draft generator, and Template Quality Standard v1 validator as single-project evolution. It differs from single-project evolution in three ways:

- it discovers many projects from `--source-root`
- it groups by target Harness and dedupes nested modules
- it publishes multiple Harness packs in one approved run

The one-command wrapper is:

```bash
node src/index.mjs evolve corpus --source-root /path/to/project-root --include-modules --json
```

This wrapper still stops at `REVIEW_REQUIRED` by default.

## Review Checklist

Before approval, verify:

- source coverage lists every intended source
- production log redaction is acceptable
- `sourceProfile.primaryRole`, recommended Harness, architecture signals, and negative signals are reasonable
- `autoMatch.decision`, confidence, target Harness id, parent candidates, and reasons are reasonable
- `autoMatch.candidateRetrieval`, conflicts, uncertainty, review gate, and decision evidence are understood
- LLM Advisor classification, recommendation, alternatives, warnings, and token usage are understood when enabled
- for corpus runs, `groups[].selectedProjects`, `groups[].duplicateProjects`, and every group draft are reasonable
- target Harness id and version are correct
- `draft/template.yaml` includes `definitionQuality` with the expected objective, focus areas, and non-goals
- `draft/template.yaml` has clear `productBoundary`, `matchPolicy`, `executionModel`, `evidenceContract`, `qualityGate`, domain actions, evidence adapters, and release blockers
- `validation.status=VALIDATED`
- `draft/asset.yaml` validates as Harness Asset v2
- `validation.blockers` is empty
- strict validation passes before a source pack or Catalog is published as a release baseline
- `impactReport` is understood

## Publication Effects

Publication mutates:

```text
harnesses/<harness-id>/template.yaml
harnesses/<harness-id>/asset.yaml
harnesses/<harness-id>/README.md
harnesses/<harness-id>/CHANGELOG.md
harnesses/<harness-id>/examples/selected-harness-binding.yaml
published/CATALOG.md
published/<harness-id>/<version>/
```

Corpus publication can mutate several `harnesses/<harness-id>/` directories in one approved run and republishes the Catalog once after all group drafts are written.

It does not change EvoPilot. EvoPilot sees the new Catalog only when its configured Catalog directory is read during a later planning request.
