# How Harness Works

This guide explains the current v3 lifecycle from evidence input to an immutable, consumable Harness Bundle. For existing v2 automation, use the [v2 compatibility guide](v2-compatibility.md).

## Operating Model

`evopilot-harness` is the system of record for Harness assets. It manages the complete production lifecycle:

```text
evidence -> reasoning -> typed Delta + Evaluation -> independent Review Engine -> human approval -> publication -> Catalog
```

The Engine is installed read-only. The user's Workspace holds mutable evidence, proposals, organization assets, evaluations, keys, Catalogs, and Registry. Publishing a Harness changes the Workspace Catalog; it does not require a new Engine release.

## 1. How Harnesses Are Managed

Initialize the Workspace once:

```bash
export EVOPILOT_HARNESS_HOME="$HOME/.evopilot-harness"
node src/index.mjs workspace init --workspace "$EVOPILOT_HARNESS_HOME" --json
```

The Workspace separates two Catalogs by default:

| Catalog | Content | Mutation rule |
|---|---|---|
| Built-in | Assets distributed with the Engine | Synchronized from Engine; evidence cannot overwrite it. |
| Organization | User-produced Components, Profiles, Bundles, and proposals | Written only after review, approval, and validation. |

Supporting Ontology, Matcher Policy, Advisor Policy, Comparison Policy, and Evaluation Packs are independently versioned. The Registry lists Catalog roots in priority order; each Catalog remains responsible for its own asset index.

Inspect the current state with JSON output:

```bash
node src/index.mjs workspace status --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs asset v3-inspect --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs catalog v3-validate --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs registry v3-validate --workspace "$EVOPILOT_HARNESS_HOME" --json
```

Harness Hub provides a standalone read-only operational view of assets, proposals, governance Packs, evaluation status, evidence-source types, and Advisor token usage. Before required Advisor production, use `llm v3-models` for configuration-only inspection and `llm v3-doctor` for a minimal live connectivity check.

v3.3.0 introduced approved structured execution feedback under `feedback/`. The v3.4 asset-delta contract may cite that feedback as one Evidence Source when producing a typed Delta, but feedback never directly mutates or enters the Catalog. v4 changes the ordinary operation surface, not this authority boundary. v4.1 stores approved Baseline/Candidate evidence and calibration history under `comparisons/`; those reports may support review but never enter the Catalog or acquire lifecycle authority.

## 2. How Harnesses Evolve

The main command is `produce`. It builds evidence and reasoning, then stops at a Proposal review gate:

```bash
node src/index.mjs produce \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source-project /path/to/project \
  --goal "Produce or evolve a reusable Harness asset for this engineering task." \
  --json
```

Reasoning selects one of five Proposal decisions:

| Decision | Result |
|---|---|
| `EVOLVE_EXISTING` | Propose a new version of the selected Profile with evidence-backed boundary or acceptance changes. |
| `COMPOSE_NEW_BUNDLE` | Propose a Bundle when evidence spans multiple strong Profile relationships. |
| `PROPOSE_NEW_PROFILE` | Propose a new Profile and its Ontology, Policy, and Evaluation implications. |
| `NO_CHANGE` | Record that the evidence fits the current asset without a justified change; block approval and publication. |
| `NEED_MORE_EVIDENCE` | Stop because evidence, domain discrimination, or candidate separation is insufficient; block approval and publication. |

`NOT_HARNESS_ELIGIBLE` remains an earlier stop because the material is not reusable Harness execution knowledge. No decision publishes automatically. `proposal inspect` reads the generated draft. `proposal validate` checks Delta/Evaluation and impact closure without a model call. `proposal review` then performs a new, independent assessment using deterministic gates and an evidence-bound semantic reviewer:

```bash
node src/index.mjs proposal validate <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --json

node src/index.mjs proposal review <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --models-file /path/to/models.json \
  --json
```

The Review Engine checks source/corpus coherence, each project membership, product-versus-dependency boundaries, new-versus-existing asset relationships, Profile/Bundle definition quality, exact Delta state, compatibility and blast radius, rollback, evidence closure, evaluation sufficiency, and any current governed comparison assessment. It distinguishes expected effect from comparatively supported effect. It returns `READY_FOR_HUMAN_APPROVAL`, `REVISE`, `SPLIT`, `REJECT`, or `NEED_MORE_EVIDENCE`, with reasons, citations, findings, actions, blockers, and Reviewer usage. Approval requires a mutating decision, valid closure, a current `READY_FOR_HUMAN_APPROVAL` report, a real reviewer, a review statement, resolved blockers, and evaluation review. Approval and publication fail closed when accepted comparison evidence, report content, or Proposal binding changed after Review. Publication rejects any existing immutable asset, Evaluation, or Delta destination before writing state.

## 3. How Classification And Matching Are Decided

Matching is not delegated to an LLM. The decision path is:

1. Statically ingest only the sources explicitly supplied by the operator.
2. Redact common credentials, personal identifiers, and private endpoints.
3. Write immutable snapshots and an Evidence Graph with stable `evidenceId` values.
4. Gate on evidence for a repeatable engineering task, model-external actions, constraints, evidence, or validators.
5. Map terms to concepts and roles in the versioned `OntologyPack`.
6. Retrieve published Profile candidates with BM25 and structured concept matches.
7. Score role, boundary, capability, execution, evidence coverage, negative conflict, and novelty.
8. Apply thresholds and risk rules from the versioned `MatchPolicyPack`.
9. Call GLM only where the policy or operator requires semantic review.
10. Persist a redacted Advisor Run for success, failure, rejection, unavailable, or skipped outcomes.
11. Produce a human-reviewable typed Asset Delta and EvaluationPack v3, a terminal no-change/evidence Proposal, or a blocked diagnostic Proposal when required advice failed.
12. Validate exact state, positive/negative cases, impact, regression, rollback, and publication boundaries.
13. Independently review a validated mutating Proposal with deterministic gates and a second evidence-bound semantic contract.
14. Persist a Review Report and stop for a separate human decision.

Every candidate includes factor scores, rejection reasons, and supporting evidence ids. Strong negative conflicts cannot be treated as normal evolution. Shared concepts such as `executable-engineering` establish eligibility but do not manufacture a domain classification.

GLM receives redacted evidence, the deterministic result, relevant Packs, and a strict response contract. It may recommend a decision or asset delta and must cite valid evidence ids. It cannot change the deterministic decision, approve, publish, execute source commands, mutate configuration, or invent evidence.

The Engine records provider, model, aggregate token usage, prompt and response digests, Pack versions, validation state, timing, failure type, redacted reason, attempt history, and replay evidence without returning raw API keys. The same Advisor Run Contract applies to local projects, Source Roots, Git repositories, attachments, logs, historical Harnesses, notes, and mixed evidence. Before an Advisor call, a deterministic Policy-budgeted projection keeps reasoning-cited nodes first, then round-robins across source and evidence-kind buckets. The complete Evidence Graph remains unchanged and auditable; the Run records projection digest, budget, selected/omitted counts, ids, kinds, and source coverage. Advisor Policy may allow one structure/citation-only repair after invalid JSON or a rejected citation contract. The repair receives only the exact projected Evidence ids, cannot change the deterministic decision, and is subject to the same validation and stop gates.

`llm v3-models` does not call the provider. `llm v3-doctor` performs a minimal live JSON-contract request. When `advisor=required` fails, `produce` retains Evidence Graph and Proposal artifacts, returns `status=BLOCKED` with a non-zero exit code, and requires a fresh run after the Advisor problem is repaired.

## 4. Which Evidence Sources Are Supported

| Source | Option | Use |
|---|---|---|
| Local project | `--source-project <path>` | Code, manifests, architecture, tests, and runbook evidence. |
| Project root | `--source-root <path>` | Discover, deduplicate, reason about, and group multiple projects into review-stage proposals. |
| GitHub or Git repository | `--github-repo <repo>` | Resolve a repository revision into local static evidence. |
| Attachment | `--attachment <file>` | PDF, PPTX, DOCX, text, and other supporting material. |
| Production log | `--production-log <file>` | Redacted runtime behavior, failure, latency, trace, and incident evidence. |
| Execution feedback | `feedback process <file>` | Approved, redacted Outcome/Process/Safety/Cost evidence bound to one immutable published Bundle closure. |
| Baseline/Candidate comparison | `comparison process <file>` | Approved, redacted paired observations bound to exact assets, task, environment, Evaluation, scorer, and metric versions. |
| Calibration cases | `calibration ingest <file>` | Independently reviewed matching or Proposal cases for explicit Baseline/Candidate policy replay. |
| Historical Harness | `--historical-harness <file>` | Prior asset intent and evolution context. |
| Operator note | `--note <text>` | Human constraints and task intent. |
| Research | `--research-url <https-url>` with `--allow-internet-research` | Supplemental cited public evidence. |

Source projects and project roots are material for reasoning; they are not copied into the Harness asset library. Internet research and historical Harnesses are supplemental and cannot independently satisfy local engineering-evidence eligibility.

A Production Log, an Execution Feedback Package, and a Comparison Package are deliberately different. The log is unstructured material for normal Proposal reasoning. The Feedback Package measures one immutable published Bundle closure. The Comparison Package contains externally executed, paired Baseline/Candidate observations under one exact governed context. Both structured packages require approval, redaction, expiry, provenance, integrity, and immutable references; neither executes a project or directly mutates an asset.

The default source path is static. The Engine does not run project builds, tests, deployments, or business commands. Any future Evidence Runner requires a separate sandbox, explicit authorization, and a new reviewed contract.

See [Feedback Evidence](feedback-evidence.md) for digest calculation, rejection gates, idempotency, four-dimensional aggregation, and current cross-project integration status.

See [Controlled Comparative Evidence](controlled-comparative-evidence.md) for comparison recommendations, exact-context strata, immutable rescoring, Proposal binding, calibration, Agent operation, and authority limits.

## 5. What Gets Published

The v3 hierarchy is:

```text
HarnessComponent -> HarnessProfile -> HarnessBundle
```

### Component

Defines an atomic environment and action capability, including required tools and services, allowed executors, inputs, outputs, timeouts, network policy, constraints, evidence artifacts, and validators.

### Profile

Defines one domain, role, and repeatable task class. It contains explicit in-scope and out-of-scope boundaries, positive and negative matching concepts, required evidence kinds, immutable Component references, acceptance evidence, blocking validators, and an Evaluation Pack reference.

### Bundle

Pins a Profile and all resolved Components by id, version, and SHA-256 digest. It contains the stable execution plan, aggregate constraints, evidence contract, validators, and optional control-plane exports. The Bundle is the executable publication unit.

A published asset records provenance, source digests, Ontology and Policy versions, lifecycle state, and validation closure. Organization Catalog publication cannot overwrite an existing asset version. Catalog signing is optional under the current cross-project contract; digest and schema validation remain required.

## 6. How A Control Plane Uses A Published Harness

A compatible control plane reads the Registry and enabled Catalogs without importing or copying Harness lifecycle state:

```text
Registry -> Catalog roots -> published Profile metadata -> project match
         -> immutable Bundle resolution -> digest validation -> execution binding
```

Project matching may inspect Profile metadata, boundaries, and evidence requirements. Before execution, the control plane must resolve and bind a published immutable Bundle with pinned dependencies and digests. It records that selection in project evidence so later Harness evolution cannot rewrite a historical run.

For EvoPilot, the ownership line remains strict:

- `evopilot-harness` produces, reviews, approves, evaluates, and publishes Harness assets.
- EvoPilot onboards projects, matches a project to published assets, binds a Bundle for a goal loop, collects project evidence, and decides project release readiness.
- Dashboard may embed Harness Hub but does not own or mutate Harness state.

The canonical v3 asset remains product-neutral. An `exports/evopilot/template.yaml` file is an optional projection for a compatible EvoPilot consumer, not the Harness source of truth.

## Next Steps

- Follow the [v3 Production Lifecycle](v3-production-lifecycle.md).
- Review the [v3 Reasoning Contract](../reference/v3-reasoning-contract.md).
- Review [Controlled Comparative Evidence](controlled-comparative-evidence.md).
- Inspect the [v3 Asset Model](../architecture/v3-asset-model.md).
- Use [CLI Agent Instructions](../cli/AGENTS.md) for automation.
