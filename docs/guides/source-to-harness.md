# Source To Harness

> New v3 production uses `produce` and Evidence Graphs as documented in [v3 Production Lifecycle](v3-production-lifecycle.md). The commands below are the v2 compatibility flow.

This guide explains how source material becomes a Harness draft.

## Supported Inputs

| Input | CLI Option | Behavior |
|---|---|---|
| Source project | `--source-project <path>` | Scans code, docs, manifests, and selected text files. |
| GitHub repository | `--github-repo <url-or-owner/repo>` | Clones or fetches a Git repository into the local cache, checks out `--github-ref` when supplied, then scans it as project source. |
| Supporting file | `--file <path>` | Adds text material or records binary attachment digest. |
| Attachment | `--attachment <path>` | Alias for supporting file. |
| Production log | `--production-log <path>` | Adds text after common-pattern redaction. |
| Administrator note | `--note <text>` | Adds human context. |

## Source Project Scan

The same bounded scanner is used for local `--source-project` directories and cached `--github-repo` checkouts. The scan skips generated or heavy directories such as `.git`, `node_modules`, `dist`, `build`, `target`, `.next`, `coverage`, and `.evopilot-harness`.

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

## GitHub Repository Source

Use `--github-repo` when the project source is an open-source GitHub repository or another Git remote reachable by the local `git` command:

```bash
node src/index.mjs detect \
  --github-repo owner/repo \
  --github-ref main \
  --goal "Create or evolve a reusable domain Harness from this GitHub repository." \
  --json

node src/index.mjs evolve \
  --github-repo https://github.com/owner/repo \
  --github-ref v1.2.3 \
  --goal "Create or evolve a reusable domain Harness from this GitHub repository." \
  --json
```

Supported repository forms:

```text
owner/repo
https://github.com/owner/repo
git@github.com:owner/repo.git
other git URL reachable by local git
```

The CLI stores cloned repositories under `.evopilot-harness/github-sources/` by default. Override with `--github-cache-root <path>` when the cache must live elsewhere. Use `--github-depth <number>` to change clone/fetch depth; the default is `1`.

The generated JSON records `sourceCoverage.sources[].type=github-repository`, `sourceCoverage.sources[].github.repository`, `ref`, `resolvedCommit`, and `cachePath`. The source then enters the same Source Profile v2, Auto-Match v2, LLM Advisor, draft generation, and review gates as a local project.

Do not pass raw GitHub tokens in `--github-repo`. Public repositories use HTTPS without a token. Private or rate-limited access should rely on local SSH or Git credential configuration. CLI output masks common secret patterns, but operators remain responsible for the supplied URL.

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

The next evolution target is definition quality: generated drafts should become more accurate, professional, and fine-grained. The default focus areas are product boundary precision, match policy specificity, evidence contract completeness, domain execution action granularity, and review warnings or negative signal coverage. Large-scale performance optimization, throughput expansion, and runtime performance tuning are non-goals unless the operator explicitly asks for them with source evidence.

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

After deterministic auto-match, the LLM Advisor can review whether the source project truly belongs to the matched Harness domain. It is optional by default and uses only an explicitly configured, operator-owned external Workspace profile; the CLI never supplies a provider/model fallback or writes model credentials.

Inspect the selected model without printing the API key:

```bash
node src/index.mjs llm models --json
```

`models.json` format:

```json
{
  "models": [
    {
      "id": "operator-model",
      "name": "Operator-selected model",
      "vendor": "openai-compatible",
      "apiKeyEnv": "MY_LLM_API_KEY",
      "url": "https://provider.example/v1",
      "modelName": "operator-model",
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

Generated `template.yaml` files include Template Quality Standard v1 and definition-quality sections:

```text
productBoundary
matchPolicy
executionModel
evidenceContract
qualityGate
definitionQuality
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
