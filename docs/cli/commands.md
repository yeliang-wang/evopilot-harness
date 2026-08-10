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
| `--strict` | Enforce Template Quality Standard v1 during `harness validate` or `catalog publish`. |

## Catalog

Publish all source packs:

```bash
node src/index.mjs catalog publish --source harnesses --out published --json
```

Publish one named pack:

```bash
node src/index.mjs catalog publish --source harnesses --out published --name database-product-harness --json
```

Publish only when source templates pass Template Quality Standard v1:

```bash
node src/index.mjs catalog publish --source harnesses --out published --strict --json
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
node src/index.mjs harness validate --source harnesses --strict --json
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

## Asset

Harness Asset v2 is the professional release envelope around each template. It keeps EvoPilot-compatible `template.yaml` available while adding API version, kind, metadata, provenance, lifecycle, quality status, and source-reference metadata for review and Catalog publication.

Inspect one asset from source packs or a published Catalog directory:

```bash
node src/index.mjs asset inspect database-product-harness --source harnesses --json
node src/index.mjs asset inspect database-product-harness --source published --json
```

Validate all assets. When a source pack does not yet contain `asset.yaml`, validation generates the v2 envelope in memory from `template.yaml`; published Catalog directories validate the written `asset.yaml` files.

```bash
node src/index.mjs asset validate --source harnesses --json
node src/index.mjs asset validate --source published --json
```

JSON schema:

```text
evopilot-harness-asset-inspect/v2
evopilot-harness-asset-validation-result/v2
```

## Detect

Run unknown-source Harness matching before creating an evolution draft:

```bash
node src/index.mjs detect \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable domain Harness from this project." \
  --json
```

Detect from a GitHub repository or Git remote:

```bash
node src/index.mjs detect \
  --github-repo owner/repo \
  --github-ref main \
  --goal "Create or evolve a reusable domain Harness from this GitHub repository." \
  --json
```

Run detection across many candidate project roots:

```bash
node src/index.mjs detect batch \
  --source-root /path/to/project-root \
  --include-modules \
  --limit 50 \
  --json
```

Accepted source inputs are the same as evolution: `--source-project`, `--github-repo`, `--file`, `--attachment`, `--production-log`, `--note`, and `--goal`.

Detection options:

| Option | Meaning |
|---|---|
| `--match-threshold <number>` | Override deterministic match threshold. Default: `0.45`. |
| `--source-root <path>` | Root scanned by `detect batch`. |
| `--github-repo <url-or-owner/repo>` | Repository source cloned or fetched into the local cache before scanning. Supports `owner/repo`, GitHub HTTPS, GitHub SSH, and other git URLs reachable by local `git`. |
| `--github-ref <branch|tag|sha>` | Optional branch, tag, or commit to check out before scanning. |
| `--github-cache-root <path>` | Local cache for cloned repository sources. Default: `.evopilot-harness/github-sources` or `<data-root>/github-sources`. |
| `--github-depth <number>` | Clone/fetch depth. Default: `1`. |
| `--include-modules` | Include nested module roots discovered under a project root. |
| `--limit <number>` | Maximum batch detections. Default: `50`. |
| `--max-depth <number>` | Maximum source-root discovery depth. Default: `5`. |

The detector produces a Source Profile v2 from code, manifests, filenames, imports, dependencies, symbols, logs, attachments, and notes. The profile includes:

```text
sourceProfile.primaryRole
sourceProfile.languages[]
sourceProfile.buildTools[]
sourceProfile.frameworks[]
sourceProfile.dependencies[]
sourceProfile.architectureSignals[]
sourceProfile.recommendedHarness
sourceProfile.negativeSignals[]
sourceProfile.sensitiveMaterialFindings[]
sourceProfile.scannerVersion
sourceProfile.scanners[]
sourceProfile.scannerSummary
sourceProfile.uncertainty
sourceProfile.githubRepositories[]
```

`autoMatch` is the decision used again by `evolve`. It is produced by scanner evidence, candidate retrieval, deterministic scoring, conflict detection, and review gates. LLM Advisor can review it later, but approval remains manual.

| Decision | Meaning |
|---|---|
| `EVOLVE_EXISTING` | A published source pack matches the source role and product boundary. |
| `CREATE_NEW_WITH_PARENT_REFERENCE` | The source needs a narrower Harness that does not exist yet, while one or more existing packs should be referenced as parents. |
| `CREATE_NEW` | No confident existing Harness or parent reference was found. |
| `FORK_FROM_MATCH` | `--target-id` requested a new target while another pack is a useful base. |
| `REVIEW_REQUIRED` | Candidate scores are ambiguous or the recommended target needs human selection before draft generation. |

JSON schema:

```text
evopilot-harness-detect-result/v2
evopilot-harness-detect-batch-result/v1
evopilot-harness-source-profile/v2
evopilot-harness-auto-match/v2
evopilot-harness-candidate-retrieval/v2
```

## Corpus

Use `corpus` commands when one root directory contains many valid historical projects and the operator wants grouped Harness evolution instead of selecting one `--source-project` manually.

Scan only:

```bash
node src/index.mjs corpus scan \
  --source-root /path/to/project-root \
  --include-modules \
  --limit 50 \
  --json
```

Create a reviewable corpus run with one generated draft per target Harness group:

```bash
node src/index.mjs corpus plan \
  --source-root /path/to/project-root \
  --include-modules \
  --max-projects-per-group 5 \
  --goal "Batch evolve Harness definitions from this historical project corpus." \
  --json
```

Review, approve, and publish:

```bash
node src/index.mjs corpus review <corpus-id> --json

node src/index.mjs corpus approve <corpus-id> \
  --confirmed-by <administrator> \
  --confirmation "Reviewed corpus grouping, dedupe decisions, generated drafts, validation, and publication impact." \
  --json

node src/index.mjs corpus publish <corpus-id> --json
```

List stored corpus runs:

```bash
node src/index.mjs corpus list --json
```

Corpus options:

| Option | Meaning |
|---|---|
| `--source-root <path>` | Root directory scanned for valid source projects. |
| `--include-modules` | Include nested module roots, then mark nested duplicates during grouping. |
| `--max-depth <number>` | Maximum discovery depth. Default: `5`. |
| `--limit <number>` | Maximum discovered projects evaluated. Default: `50`. |
| `--max-projects-per-group <number>` | Representative projects included in one Harness group draft. Default: `5`. |
| `--data-root <dir>` | Corpus state root. Default: `.evopilot-harness`. |

Corpus planning writes:

```text
.evopilot-harness/corpora/<corpus-id>/run.json
.evopilot-harness/corpora/<corpus-id>/drafts/<target-harness-id>/template.yaml
.evopilot-harness/corpora/<corpus-id>/drafts/<target-harness-id>/asset.yaml
.evopilot-harness/corpora/<corpus-id>/drafts/<target-harness-id>/README.md
.evopilot-harness/corpora/<corpus-id>/drafts/<target-harness-id>/CHANGELOG.md
.evopilot-harness/corpora/<corpus-id>/drafts/<target-harness-id>/examples/selected-harness-binding.yaml
```

JSON schema:

```text
evopilot-harness-corpus-scan-result/v1
evopilot-harness-corpus-detail/v1
evopilot-harness-corpus-list/v1
evopilot-harness-corpus-evolve-result/v1
```

`corpus plan` stops at `REVIEW_REQUIRED` when validation succeeds. `corpus approve` requires administrator confirmation. `corpus publish` mutates `harnesses/` and republishes the Catalog.

## Evolution

Create a run:

```bash
node src/index.mjs evolution create \
  --source-project /path/to/source-project \
  --goal "Create or evolve a distributed cache Harness." \
  --json
```

Create a run from a GitHub repository source:

```bash
node src/index.mjs evolution create \
  --github-repo https://github.com/owner/repo \
  --github-ref main \
  --goal "Create or evolve a reusable domain Harness from this GitHub repository." \
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
| `--github-repo <url-or-owner/repo>` | GitHub repository or Git remote used as a project source after local clone/fetch. Do not pass raw tokens; use local Git credentials or SSH. |
| `--github-ref <branch|tag|sha>` | Optional Git ref checked out before scanning. |
| `--github-cache-root <path>` | Cache root for cloned repository sources. |
| `--github-depth <number>` | Clone/fetch depth. Default: `1`. |
| `--file <path>` | Supporting text or binary material. |
| `--attachment <path>` | Alias for supporting material. |
| `--production-log <path>` | Runtime log input with common-pattern redaction. |
| `--note <text>` | Administrator context. |
| `--goal <text>` or `--intent <text>` | Evolution objective. |
| `--target-id <id>` | Force the target Harness id. |
| `--match-threshold <number>` | Override deterministic detect threshold. Default: `0.45`. |
| `--llm-advisor [optional|required]` | Run semantic LLM Advisor review after deterministic auto-match. Default: `optional`. |
| `--require-llm-advisor` | Block review when the Advisor cannot run successfully. |
| `--no-llm-advisor` | Disable Advisor and use deterministic auto-match only. |
| `--apply-llm-advisor` | Use a high-confidence Advisor recommendation for draft target selection. |
| `--llm-models-file <file>` | CodeBuddy-style model file. Default: `./models.json`. |
| `--llm-profile <id>` | Select a model entry by `id`, `name`, or `modelName`. Default: GLM profile. |
| `--llm-provider-preset glm` | Override provider preset. Built-in fallback is EvoPilot GLM: provider `zhipu`, model `glm-5.1`, base URL `https://open.bigmodel.cn/api/coding/paas/v4`. |
| `--llm-base-url <url>` | Override OpenAI-compatible chat completions base URL. |
| `--llm-model <id>` | Override model name for the Advisor. |
| `--llm-api-key-env <env>` | Environment variable that holds the API key when `models.json` does not hold one. Default: `EVOPILOT_HARNESS_LLM_API_KEY`. |

JSON schema:

```text
evopilot-harness-evolution/v1
evopilot-harness-evolution-detail/v1
evopilot-harness-evolution-impact/v1
```

Evolution responses include the same `sourceProfile` and `autoMatch` that `detect` returns, so administrators can compare preflight detection with the generated draft target.

Generated drafts include `draft.template.definitionQuality`. The default objective is a more accurate, professional, and fine-grained Harness definition. The focus is product boundary precision, match-policy specificity, evidence-contract completeness, domain-action granularity, and reviewable negative signals. Large-scale performance optimization, throughput expansion, and runtime tuning are non-goals unless explicitly requested with source evidence.

## LLM Models And Advisor

`evopilot-harness` reads EvoPilot GLM from a local CodeBuddy-style `models.json`. The file is manually maintained by an operator and ignored by Git. The CLI does not create, update, import, or publish model configuration. The format matches CodeBuddy, but the content should contain only the GLM used by EvoPilot.

Inspect selected model metadata without printing API keys:

```bash
node src/index.mjs llm models --json
node src/index.mjs llm models --llm-models-file /path/to/models.json --llm-profile glm-5.1 --json
```

Expected `models.json` shape:

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

The Advisor is optional by default. It is a semantic review stage, not an approval gate. It reads redacted source excerpts, deterministic `autoMatch`, and available Harness metadata, then returns `llmAdvisor`:

```text
llmAdvisor.status
llmAdvisor.llmProfileId
llmAdvisor.sourceClassification
llmAdvisor.recommendation.action
llmAdvisor.recommendation.targetHarnessId
llmAdvisor.alternatives[]
llmAdvisor.reviewWarnings[]
llmAdvisor.definitionQualityAdvice
llmAdvisor.provider
llmAdvisor.model
llmAdvisor.usage.totalTokens
```

Use `required` for production policies that demand model review before draft approval:

```bash
node src/index.mjs evolve \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable domain Harness." \
  --llm-advisor required \
  --json
```

Use `--no-llm-advisor` for deterministic-only evolution. Use `--apply-llm-advisor` only when policy allows the Advisor to change the generated draft target. Explicit `--target-id` still wins over Advisor output.

Replay stored Advisor responses without calling a model:

```bash
node src/index.mjs llm replay --json
node src/index.mjs llm replay --fixture-root eval/llm-replay/cases --json
```

JSON schema:

```text
evopilot-harness-llm-models/v1
evopilot-harness-llm-advisor/v1
evopilot-harness-llm-replay-report/v2
```

## Evaluation

Unknown-source eval fixtures are hidden-oracle tests for the matching algorithm. They are not production rules and they do not predefine what a user's future source project must be. They verify that scanner evidence, candidate retrieval, conflict handling, and review gates stay stable for representative ambiguous inputs.

Run the eval suite:

```bash
node src/index.mjs eval run --json
node src/index.mjs eval run --fixture-root eval/unknown-source/cases --json
```

The release gate passes only when all cases pass and the decision matrix contains the expected mix of existing-Harness evolution, new Harness with parent reference, and grouped corpus planning.

JSON schema:

```text
evopilot-harness-unknown-source-eval-report/v2
```

## One-Command Evolve

Run create, advance, validation, and optional approval/publication:

```bash
node src/index.mjs evolve \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable Harness definition." \
  --json
```

Use the same one-command path with a GitHub repository source:

```bash
node src/index.mjs evolve \
  --github-repo owner/repo \
  --github-ref main \
  --goal "Create or evolve a reusable Harness definition from this GitHub repository." \
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
evopilot-harness-corpus-evolve-result/v1
```

Batch root-directory evolution is available through:

```bash
node src/index.mjs evolve corpus \
  --source-root /path/to/project-root \
  --include-modules \
  --json
```

This is a one-command wrapper around `corpus plan`. It still stops at `REVIEW_REQUIRED` unless `--approve-and-publish`, `--confirmed-by`, and `--confirmation` are supplied.

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
