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

## Detect

Run deterministic Harness detection before creating an evolution draft:

```bash
node src/index.mjs detect \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable domain Harness from this project." \
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

Accepted source inputs are the same as evolution: `--source-project`, `--file`, `--attachment`, `--production-log`, `--note`, and `--goal`.

Detection options:

| Option | Meaning |
|---|---|
| `--match-threshold <number>` | Override deterministic match threshold. Default: `0.45`. |
| `--source-root <path>` | Root scanned by `detect batch`. |
| `--include-modules` | Include nested module roots discovered under a project root. |
| `--limit <number>` | Maximum batch detections. Default: `50`. |
| `--max-depth <number>` | Maximum source-root discovery depth. Default: `5`. |

The detector produces a `sourceProfile` from code, manifests, filenames, imports, dependencies, symbols, logs, attachments, and notes. The profile includes:

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
```

`autoMatch` is the deterministic decision used again by `evolve`:

| Decision | Meaning |
|---|---|
| `EVOLVE_EXISTING` | A published source pack matches the source role and product boundary. |
| `CREATE_NEW_WITH_PARENT_REFERENCE` | The source needs a narrower Harness that does not exist yet, while one or more existing packs should be referenced as parents. |
| `CREATE_NEW` | No confident existing Harness or parent reference was found. |
| `FORK_FROM_MATCH` | `--target-id` requested a new target while another pack is a useful base. |
| `REVIEW_REQUIRED` | Candidate scores are ambiguous or the recommended target needs human selection before draft generation. |

JSON schema:

```text
evopilot-harness-detect-result/v1
evopilot-harness-detect-batch-result/v1
evopilot-harness-source-profile/v1
evopilot-harness-auto-match/v1
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
| `--match-threshold <number>` | Override deterministic detect threshold. Default: `0.45`. |
| `--llm-advisor [optional|required]` | Run semantic LLM Advisor review after deterministic auto-match. |
| `--require-llm-advisor` | Block review when the Advisor cannot run successfully. |
| `--apply-llm-advisor` | Use a high-confidence Advisor recommendation for draft target selection. |
| `--llm-provider-preset glm` | Use GLM-compatible defaults: provider `zhipu`, model `glm-5.2`, base URL `https://open.bigmodel.cn/api/paas/v4`. |
| `--llm-base-url <url>` | OpenAI-compatible chat completions base URL. |
| `--llm-model <id>` | Model name for the Advisor. |
| `--llm-api-key-env <env>` | Environment variable that holds the API key. Default: `EVOPILOT_HARNESS_LLM_API_KEY`. |

JSON schema:

```text
evopilot-harness-evolution/v1
evopilot-harness-evolution-detail/v1
evopilot-harness-evolution-impact/v1
```

Evolution responses include the same `sourceProfile` and `autoMatch` that `detect` returns, so administrators can compare preflight detection with the generated draft target.

## LLM Advisor

The Advisor is off by default. It is a semantic review stage, not an approval gate. It reads redacted source excerpts, deterministic `autoMatch`, and available Harness metadata, then returns `llmAdvisor`:

```text
llmAdvisor.status
llmAdvisor.sourceClassification
llmAdvisor.recommendation.action
llmAdvisor.recommendation.targetHarnessId
llmAdvisor.alternatives[]
llmAdvisor.reviewWarnings[]
llmAdvisor.provider
llmAdvisor.model
llmAdvisor.usage.totalTokens
```

Use `optional` when a model outage should not block deterministic evolution:

```bash
export EVOPILOT_HARNESS_LLM_ADVISOR=optional
export EVOPILOT_HARNESS_LLM_PROVIDER_PRESET=glm
export EVOPILOT_HARNESS_LLM_API_KEY="<secret>"

node src/index.mjs evolve \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable domain Harness." \
  --json
```

Use `required` for production policies that demand model review before draft approval:

```bash
node src/index.mjs evolve \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable domain Harness." \
  --llm-advisor required \
  --llm-provider-preset glm \
  --json
```

Use `--apply-llm-advisor` only when policy allows the Advisor to change the generated draft target. Explicit `--target-id` still wins over Advisor output.

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
