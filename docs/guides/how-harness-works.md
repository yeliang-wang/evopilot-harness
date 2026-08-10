# How Harness Works

> This page describes the v2.1 compatibility model. For v3, start with [v3 Product Boundary](../architecture/v3-product-boundary.md), [v3 Asset Model](../architecture/v3-asset-model.md), [v3 Reasoning Contract](../reference/v3-reasoning-contract.md), and [v3 Production Lifecycle](v3-production-lifecycle.md).

> A technical overview of how `evopilot-harness` manages, evolves, matches, publishes, and exposes Harness definitions to EvoPilot-compatible control planes.

This guide follows the documentation shape used by mature open-source projects such as [OpenHands](https://github.com/OpenHands/OpenHands): the README is the product front door, quick starts come first, and deeper mechanics live in focused guide and reference pages.

## Fastest Path

Start from an existing project source:

```bash
node src/index.mjs detect \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable domain Harness from this project." \
  --json

node src/index.mjs evolve \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable domain Harness from this project." \
  --json
```

Review the generated draft:

```text
.evopilot-harness/evolutions/<evolution-id>/draft/
  template.yaml
  asset.yaml
  README.md
  CHANGELOG.md
  examples/selected-harness-binding.yaml
```

Approve and publish only after administrator review:

```bash
node src/index.mjs evolution approve <evolution-id> \
  --confirmed-by <administrator> \
  --confirmation "Reviewed source coverage, draft diff, validation, and impact." \
  --json

node src/index.mjs evolution publish <evolution-id> --json
```

Validate the result before a control plane consumes it:

```bash
node src/index.mjs catalog validate --source published --json
node src/index.mjs registry validate --registry harness-registry.yaml --json
node src/index.mjs asset validate --source published --json
```

## Boundary

`evopilot-harness` produces usable Harness definitions. It owns authoring, source-driven evolution, review, approval, versioning, publication, Registry generation, Catalog generation, and the standalone Harness Hub UI.

EvoPilot is a consumer and executor. It reads published Harness definitions at goal-plan time, records the selected Harness as evidence, and executes the project goal loop with that Harness contract. EvoPilot must not write, import, approve, publish, or evolve Harness definitions.

Dashboard can embed the Harness Hub through an iframe-style integration, but Dashboard does not own Harness state.

## 1. Harness Management

Harness source packs live under:

```text
harnesses/<harness-id>/
  template.yaml
  asset.yaml
  README.md
  CHANGELOG.md
  examples/selected-harness-binding.yaml
```

The source pack is the editable, reviewed Harness baseline. The published Catalog is generated from source packs:

```text
published/
  CATALOG.md
  <harness-id>/<version>/template.yaml
  <harness-id>/<version>/asset.yaml
  <harness-id>/<version>/README.md
  <harness-id>/<version>/CHANGELOG.md
  <harness-id>/<version>/examples/selected-harness-binding.yaml
```

Use the lifecycle CLI for management:

```bash
node src/index.mjs harness list --source harnesses --json
node src/index.mjs harness inspect <harness-id> --source harnesses --json
node src/index.mjs harness validate <harness-id> --source harnesses --strict --json
node src/index.mjs harness deprecate <harness-id> --source harnesses --reason "..." --json
node src/index.mjs catalog publish --source harnesses --out published --strict --json
node src/index.mjs registry publish --catalog published --registry harness-registry.yaml --json
```

The Registry is a discovery file. It points to one or more Catalog roots. It does not duplicate Harness entries.

## 2. Harness Evolution

Harness evolution is a local lifecycle:

```text
CREATED -> REVIEW_REQUIRED -> APPROVED -> PUBLISHED
              |
              v
           BLOCKED
```

Single-source evolution uses:

```bash
node src/index.mjs evolution create --source-project /path/to/project --goal "..." --json
node src/index.mjs evolution advance <evolution-id> --json
node src/index.mjs evolution review <evolution-id> --json
node src/index.mjs evolution approve <evolution-id> --confirmed-by <admin> --confirmation <text> --json
node src/index.mjs evolution publish <evolution-id> --json
```

The one-command wrapper runs create, advance, matching, draft generation, validation, and the review stop:

```bash
node src/index.mjs evolve \
  --source-project /path/to/project \
  --goal "Create or evolve a reusable domain Harness." \
  --json
```

The generated `autoMatch.decision` determines whether the run upgrades an existing Harness or creates a new one:

| Decision | Effect |
|---|---|
| `EVOLVE_EXISTING` | Update an existing source pack and bump its patch version after approval. |
| `CREATE_NEW_WITH_PARENT_REFERENCE` | Create a narrower Harness and record related existing Harnesses as parent context. |
| `CREATE_NEW` | Create a new Harness because no confident existing candidate exists. |
| `FORK_FROM_MATCH` | Use a matched pack as a seed when an explicit different target is requested. |
| `REVIEW_REQUIRED` | Stop before final target selection because candidates are ambiguous or evidence needs review. |

Publication writes the approved draft into `harnesses/<harness-id>/`, regenerates `published/`, and leaves EvoPilot unchanged. EvoPilot sees the new Harness only on a later planning request when it reads the configured Registry or Catalog.

## 3. Matching And Classification Algorithm

Matching is not a single LLM decision. The default path is deterministic and reviewable, with an optional LLM Advisor after auto-match.

The algorithm is:

```text
bounded source scan
-> sourceCoverage
-> Source Profile v2
-> candidate retrieval from current Harness packs
-> deterministic scoring
-> conflict, uncertainty, and review-gate calculation
-> optional LLM Advisor semantic review
-> draft generation
```

`sourceCoverage` records each input source, digest, source type, GitHub metadata when available, redaction state, sensitive-material findings, and source-specific actions.

`sourceProfile` extracts:

```text
sourceProfile.primaryRole
sourceProfile.languages[]
sourceProfile.buildTools[]
sourceProfile.frameworks[]
sourceProfile.dependencies[]
sourceProfile.imports[]
sourceProfile.symbols[]
sourceProfile.architectureSignals[]
sourceProfile.recommendedHarness
sourceProfile.negativeSignals[]
sourceProfile.scannerSummary
sourceProfile.uncertainty
sourceProfile.githubRepositories[]
```

Candidate scoring uses each existing Harness pack's contract:

```text
productBoundary.includes
productBoundary.excludes
matchPolicy.requiredAny
matchPolicy.positive.dependencies
matchPolicy.positive.imports
matchPolicy.positive.files
matchPolicy.positive.symbols
matchPolicy.positive.architectureSignals
matchPolicy.negative.productBoundaryExcludes
matchPolicy.negative.signals
roleFit
boundaryFit
```

The default `--match-threshold` is `0.45`. Catalog priority is only a tie breaker when scores are otherwise equivalent.

The matcher is intentionally narrow-boundary aware. For example, a Redis client wrapper should become or evolve a Redis client Harness and may reference `distributed-cache-harness` as parent context. It should not evolve the full distributed cache product Harness unless the source owns cache-server runtime, clustering, replication, failover, persistence, eviction, and release evidence.

The LLM Advisor can run after deterministic auto-match:

```bash
node src/index.mjs evolve \
  --source-project /path/to/project \
  --goal "Create or evolve a reusable domain Harness." \
  --llm-advisor required \
  --json
```

The Advisor reads redacted source excerpts, deterministic matching output, and available Harness metadata. It returns source classification, recommendation, alternatives, review warnings, definition-quality advice, provider/model metadata, and token usage. It does not approve or publish. Use `--apply-llm-advisor` only when policy allows a high-confidence Advisor recommendation to change the generated draft target.

## 4. Supported Sources

Supported source inputs:

| Source | CLI option | Purpose |
|---|---|---|
| Local project | `--source-project <path>` | Scan code, architecture docs, manifests, tests, and runbooks. |
| GitHub or git repository | `--github-repo <url-or-owner/repo>` | Clone or fetch into local cache, then scan as project source. |
| Source corpus | `--source-root <path>` | Discover many project roots, group by target Harness, dedupe nested modules, and generate grouped drafts. |
| Supporting file | `--file <path>` | Add text source material or binary attachment digest. |
| Attachment | `--attachment <path>` | Add PPT, PDF, Word, spreadsheet, Markdown, text, or binary material as supporting evidence. |
| Production log | `--production-log <path>` | Add redacted runtime logs, incident diagnostics, failures, latency, request, trace, or correlation evidence. |
| Administrator note | `--note <text>` | Add human context, constraints, or domain intent. |
| Goal or intent | `--goal <text>` or `--intent <text>` | State the evolution objective. |

GitHub repository sources support:

```text
owner/repo
https://github.com/owner/repo
git@github.com:owner/repo.git
other git URL reachable by local git
```

Do not put raw GitHub tokens in `--github-repo`. Use public HTTPS, local Git credentials, or SSH.

Corpus flow is for unknown historical project collections:

```bash
node src/index.mjs corpus scan --source-root /path/to/project-root --include-modules --json
node src/index.mjs corpus plan --source-root /path/to/project-root --include-modules --json
node src/index.mjs corpus review <corpus-id> --json
```

The corpus flow uses projects as input material. It does not copy source projects into Harness templates.

## 5. Published Harness Definition

The execution contract is `template.yaml`:

```yaml
schema: evopilot-harness-template/v2
id: distributed-cache-harness
version: 0.2.0
name: Distributed Cache Harness
domain: distributed-cache
harnessLayer: domain
productBoundary: {}
matchPolicy: {}
runtimePatterns:
  domainExecution: {}
executionModel: {}
validationBaseline: {}
evidenceContract: {}
qualityGate: {}
definitionQuality: {}
sourceReferences: []
changelog: []
```

Important sections:

| Section | Meaning |
|---|---|
| `productBoundary` | What this Harness owns and explicitly excludes. |
| `matchPolicy` | Deterministic matching rules and negative signals. |
| `runtimePatterns.domainExecution` | Domain-specific required actions, evidence adapters, and release blockers. |
| `executionModel` | Expected phases and command groups. |
| `validationBaseline` | Required validation behavior and evidence rules. |
| `evidenceContract` | Required artifact format and correlation fields. |
| `qualityGate` | Minimum template-quality score and review requirements. |
| `definitionQuality` | The evolution objective: more accurate, professional, and fine-grained Harness definitions. |
| `sourceReferences` | Source material digests and provenance used by evolution. |
| `changelog` | Structured version history. |

The publication envelope is `asset.yaml`:

```yaml
apiVersion: evopilot.dev/v2
kind: HarnessAsset
metadata:
  id: distributed-cache-harness
  name: Distributed Cache Harness
  version: 0.2.0
  domain: distributed-cache
  layer: domain
spec:
  templateSchema: evopilot-harness-template/v2
  template: {}
  match: {}
  execution: {}
  evidence: {}
  qualityGate: {}
  lifecycle:
    status: published
relations:
  parents: []
  sourceReferences: []
status:
  phase: published
  conditions: []
  provenance:
    generatedBy: evopilot-harness
```

The Catalog index is `published/CATALOG.md`. It contains a fenced `yaml evopilot-harness-catalog` block with version, compatibility, quality report, entries, template digests, asset digests, and provenance.

The Registry is `harness-registry.yaml`. It contains enabled Catalog roots, priority, release, and optional expected Catalog digest. It is not a Harness index.

## 6. Control-Plane Consumption

A control plane such as EvoPilot reads the published Harnesses dynamically:

```bash
EVOPILOT_HARNESS_REGISTRY_CONFIG=/path/to/evopilot-harness/harness-registry.yaml
```

End-to-end consumption:

```text
EvoPilot receives project onboarding and goal-loop target
-> reads harness-registry.yaml
-> resolves enabled Catalog roots
-> reads each Catalog's CATALOG.md
-> selects a Harness using goal and project metadata
-> reads entries[].path template.yaml and, when v2-aware, entries[].assetPath asset.yaml
-> records selectedHarness with harness id, version, domain, Catalog digest, entry path, and entry digest
-> runs the goal loop using the selected Harness execution and evidence contract
```

`selectedHarness` is written by EvoPilot, not by `evopilot-harness`.

Existing EvoPilot plans keep the selected Harness digest they used. Republishing a Catalog does not rewrite old plans. New or regenerated plans can bind newer Harness versions.

## Validation Gates

Before publication or release, run:

```bash
node --check src/index.mjs
npm run check
npm run release:artifact
npm run verify:release-artifact
git diff --check
```

`npm run check` publishes and validates Catalog and Registry, validates Harness Assets, runs unknown-source matching evals, replays LLM Advisor fixtures, builds the Harness Hub snapshot, checks documentation links, and runs node tests.

## Related Docs

- [CLI Quickstart](../cli/quickstart.md)
- [CLI Commands](../cli/commands.md)
- [Source To Harness](source-to-harness.md)
- [Harness Evolution](harness-evolution.md)
- [Template Schema](../reference/template-schema.md)
- [Catalog Contract](../reference/catalog-contract.md)
- [Registry Contract](../reference/registry-contract.md)
- [Selected Harness Binding](../reference/selected-harness-binding.md)
