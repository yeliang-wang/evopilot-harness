# Source To Harness

This guide explains how source material becomes a Harness draft.

## Supported Inputs

| Input | CLI Option | Behavior |
|---|---|---|
| Source project | `--source-project <path>` | Scans code, docs, manifests, and selected text files. |
| Supporting file | `--file <path>` | Adds text material or records binary attachment digest. |
| Attachment | `--attachment <path>` | Alias for supporting file. |
| Production log | `--production-log <path>` | Adds text after common-pattern redaction. |
| Administrator note | `--note <text>` | Adds human context. |

## Source Project Scan

The scan skips generated or heavy directories such as `.git`, `node_modules`, `dist`, `build`, `target`, `.next`, `coverage`, and `.evopilot-harness`.

It reads common source and documentation files, including:

```text
README
architecture/design/overview files
docs/
.github/
package manifests
Dockerfile and Compose files
*.md, *.txt, *.yaml, *.json, *.toml, *.xml
*.go, *.java, *.rs, *.py, *.ts, *.js
```

The scan is bounded. It records file counts, selected files, top extensions, and extracted text excerpts.

## Unknown Source Matching v2

Before draft generation, the CLI runs unknown-source matching. This makes the matching step explicit and reviewable instead of letting a model silently decide whether to update an existing Harness or create a new one.

```bash
node src/index.mjs detect \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable domain Harness from this project." \
  --json
```

For a directory that contains many historical projects, run batch detection first:

```bash
node src/index.mjs detect batch \
  --source-root /path/to/project-root \
  --include-modules \
  --limit 50 \
  --json
```

Batch detection is a validation and planning tool. It does not copy source projects, publish templates, or turn the detected projects into fixed Harness packs.

When the operator wants the CLI to continue from detection into grouped draft generation, use the corpus lifecycle:

```bash
node src/index.mjs corpus plan \
  --source-root /path/to/project-root \
  --include-modules \
  --max-projects-per-group 5 \
  --goal "Batch evolve Harness definitions from this historical project corpus." \
  --json
```

Corpus planning performs:

1. discovers valid project roots under `--source-root`
2. runs the same Source Profile v2 and auto-match v2 path for each project
3. groups projects by target Harness id
4. dedupes nested modules and lower-priority same-target projects
5. selects representative projects per group
6. generates one draft pack per group
7. validates every draft against Template Quality Standard v1
8. stops at `REVIEW_REQUIRED`

The historical projects remain input material only. The CLI records source coverage and digests, but it does not copy those projects into committed Harness templates.

The detector builds a `sourceProfile` from:

- languages, build tools, frameworks, imports, dependencies, symbols, and selected filenames
- architecture signals such as cache, Redis client, proxy, workflow engine, logging SDK, RPC framework, frontend admin app, and enterprise admin software
- negative signals that keep a narrow library from being misclassified as a full product
- source coverage and sensitive material findings
- the human `--goal` or `--intent`
- scanner evidence, scanner summary, and uncertainty reasons

The profile then scores each existing Harness using:

- `productBoundary.includes` and `productBoundary.excludes`
- `matchPolicy.requiredAny`
- positive dependency, import, file, symbol, and architecture signals
- negative product-boundary exclusions
- role fit and boundary fit
- Catalog priority only as a tie breaker

The default match threshold is `0.45`. Use `--match-threshold` only for controlled experiments or policy tuning.

The matching algorithm is not hard-coded to a fixed business domain list. It combines:

- bounded source scanning for files, manifests, dependencies, imports, symbols, docs, logs, and attachments
- semantic architecture signal extraction from the scanned material and goal
- Source Profile v2 role inference and recommended target generation
- candidate retrieval from current Harness packs
- deterministic scoring against `productBoundary` and `matchPolicy`
- conflict, uncertainty, and review-gate calculation
- optional LLM Advisor semantic review through manually configured EvoPilot GLM

Fixtures under `eval/` are release gates for representative unknown-source mistakes. They are not production matching rules and do not force future user projects into a predefined domain.

## Match Decisions

Possible `autoMatch.decision` values:

| Decision | Meaning |
|---|---|
| `EVOLVE_EXISTING` | The best match meets the threshold and its product boundary fits the source. |
| `CREATE_NEW_WITH_PARENT_REFERENCE` | A narrower target is needed and an existing Harness should be referenced as parent context. |
| `CREATE_NEW` | No confident existing Harness or parent candidate exists. |
| `FORK_FROM_MATCH` | `--target-id` requested a different target while an existing pack can seed the draft. |
| `REVIEW_REQUIRED` | The detector found ambiguous candidates or a target choice that must be confirmed before generation. |

For example, a Java Spring Data Redis/Jedis wrapper should be classified as `redis-client-library`, target `redis-client-harness`, and reference `distributed-cache-harness` as a parent candidate when that parent exists. It should not evolve the full distributed cache product Harness unless the source itself owns cache-server behavior, clustering, replication, failover, persistence, and release evidence.

## LLM Advisor

After deterministic auto-match, the LLM Advisor can review whether the source project truly belongs to the matched Harness domain. It is optional by default and uses the same GLM as EvoPilot through a manually maintained CodeBuddy-style `models.json`; the CLI only reads this file and never writes model configuration.

Inspect the selected model without printing the API key:

```bash
node src/index.mjs llm models --json
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

Use a required Advisor call when semantic review is mandatory:

```bash
node src/index.mjs evolve \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable domain Harness from this project." \
  --llm-advisor required \
  --json
```

The Advisor returns `llmAdvisor.sourceClassification`, `llmAdvisor.recommendation`, `llmAdvisor.alternatives`, `llmAdvisor.reviewWarnings`, `llmAdvisor.llmProfileId`, and token usage. It is advisory by default: `autoMatch` still drives the draft. Add `--apply-llm-advisor` only when a high-confidence recommendation is allowed to change the draft target.

Replay stored Advisor cases without model access:

```bash
node src/index.mjs llm replay --json
```

## Draft Output

Draft files are written under:

```text
.evopilot-harness/evolutions/<evolution-id>/draft/
  template.yaml
  asset.yaml
  README.md
  CHANGELOG.md
  examples/selected-harness-binding.yaml
```

Review these files before approval.

Generated `template.yaml` files include Template Quality Standard v1 sections:

```text
productBoundary
matchPolicy
executionModel
evidenceContract
qualityGate
runtimePatterns.domainExecution
```

Run strict validation before approving or publishing a Harness baseline:

```bash
node src/index.mjs harness validate --source harnesses --strict --json
node src/index.mjs catalog publish --source harnesses --out published --strict --json
node src/index.mjs asset validate --source published --json
```

## Publication

Publication copies the draft into `harnesses/<harness-id>/`, writes `asset.yaml`, republishes `published/`, and updates `CATALOG.md`.

```bash
node src/index.mjs evolution publish <evolution-id> --json
node src/index.mjs catalog validate --source published --json
node src/index.mjs asset validate --source published --json
```

For corpus publication:

```bash
node src/index.mjs corpus approve <corpus-id> \
  --confirmed-by <administrator> \
  --confirmation "Reviewed corpus grouping, dedupe decisions, generated drafts, validation, and publication impact." \
  --json

node src/index.mjs corpus publish <corpus-id> --json
node src/index.mjs catalog validate --source published --json
```

## Release Evaluation

Before publishing an `evopilot-harness` release, run:

```bash
node src/index.mjs eval run --json
node src/index.mjs llm replay --json
```

`eval run` validates unknown-source matching decisions and corpus grouping. `llm replay` validates Advisor response parsing and recommendation semantics without calling the live model.
