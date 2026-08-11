# How Harness Works

This guide explains the current v3 lifecycle from evidence input to an immutable, consumable Harness Bundle. For existing v2 automation, use the [v2 compatibility guide](v2-compatibility.md).

## Operating Model

`evopilot-harness` is the system of record for Harness assets. It manages the complete production lifecycle:

```text
evidence -> reasoning -> proposal -> review -> approval -> publication -> Catalog
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

Supporting Ontology, Matcher Policy, Advisor Policy, and Evaluation Packs are independently versioned. The Registry lists Catalog roots in priority order; each Catalog remains responsible for its own asset index.

Inspect the current state with JSON output:

```bash
node src/index.mjs workspace status --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs asset v3-inspect --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs catalog v3-validate --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs registry v3-validate --workspace "$EVOPILOT_HARNESS_HOME" --json
```

Harness Hub provides a standalone read-only operational view of assets, proposals, governance Packs, evaluation status, evidence-source types, and Advisor token usage.

## 2. How Harnesses Evolve

The main command is `produce`. It builds evidence and reasoning, then stops at a Proposal review gate:

```bash
node src/index.mjs produce \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source-project /path/to/project \
  --goal "Produce or evolve a reusable Harness asset for this engineering task." \
  --json
```

Reasoning selects one of six outcomes:

| Decision | Result |
|---|---|
| `EVOLVE_EXISTING` | Propose a new version of the selected Profile with evidence-backed boundary or acceptance changes. |
| `COMPOSE_NEW_BUNDLE` | Propose a Bundle when evidence spans multiple strong Profile relationships. |
| `PROPOSE_NEW_PROFILE` | Propose a new Profile and its Ontology, Policy, and Evaluation implications. |
| `REVIEW_REQUIRED` | Stop because candidates are ambiguous or thresholds are not decisive. |
| `INSUFFICIENT_EVIDENCE` | Stop and request stronger evidence. |
| `NOT_HARNESS_ELIGIBLE` | Stop because the material is not reusable Harness execution knowledge. |

No decision publishes automatically. Review the Proposal and its evidence closure:

```bash
node src/index.mjs proposal review <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --json
```

Approval requires a real reviewer, a review statement, resolved blockers, and evaluation review where required. Publication rejects an existing immutable version rather than overwriting it.

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
9. Call GLM only where the policy requires semantic review.
10. Produce a human-reviewable Profile or Bundle Proposal.

Every candidate includes factor scores, rejection reasons, and supporting evidence ids. Strong negative conflicts cannot be treated as normal evolution. Shared concepts such as `executable-engineering` establish eligibility but do not manufacture a domain classification.

GLM receives redacted evidence, the deterministic result, relevant Packs, and a strict response contract. It may recommend a decision or asset delta and must cite valid evidence ids. It cannot change the deterministic decision, approve, publish, execute source commands, mutate configuration, or invent evidence.

The Engine records provider, model, token usage, prompt and response digests, Pack versions, validation state, and replay evidence without returning raw API keys.

## 4. Which Evidence Sources Are Supported

| Source | Option | Use |
|---|---|---|
| Local project | `--source-project <path>` | Code, manifests, architecture, tests, and runbook evidence. |
| Project root | `--source-root <path>` | Discover, deduplicate, reason about, and group multiple projects into review-stage proposals. |
| GitHub or Git repository | `--github-repo <repo>` | Resolve a repository revision into local static evidence. |
| Attachment | `--attachment <file>` | PDF, PPTX, DOCX, text, and other supporting material. |
| Production log | `--production-log <file>` | Redacted runtime behavior, failure, latency, trace, and incident evidence. |
| Historical Harness | `--historical-harness <file>` | Prior asset intent and evolution context. |
| Operator note | `--note <text>` | Human constraints and task intent. |
| Research | `--research-url <https-url>` with `--allow-internet-research` | Supplemental cited public evidence. |

Source projects and project roots are material for reasoning; they are not copied into the Harness asset library. Internet research and historical Harnesses are supplemental and cannot independently satisfy local engineering-evidence eligibility.

The default source path is static. The Engine does not run project builds, tests, deployments, or business commands. Any future Evidence Runner requires a separate sandbox, explicit authorization, and a new reviewed contract.

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
- Inspect the [v3 Asset Model](../architecture/v3-asset-model.md).
- Use [CLI Agent Instructions](../cli/AGENTS.md) for automation.
