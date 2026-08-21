# Asset Delta And Evaluation

Introduced in Engine 3.4.0 and retained in v4, Harness evolution is represented as an evidence-linked `AssetDeltaProposal` plus a portable `EvaluationPack v3`. These contracts make the proposed change, its expected effect, its affected dependencies, and its rollback path reviewable before approval or immutable publication.

The published v4.1.2 release includes this contract. Asset publication remains a separate user lifecycle and does not require another Engine release.

## Supported Delta Assets

One Proposal can carry typed deltas for:

- `HarnessComponent`
- `HarnessProfile`
- `HarnessBundle`
- `OntologyPack`
- `MatchPolicyPack`
- `AdvisorPolicyPack`
- `EvaluationPack`

Every Delta contains:

- `operation`: `CREATE`, `UPDATE`, `COMPOSE`, or `NO_CHANGE`;
- exact `before[]` and `after` documents with id, version, kind, and SHA-256 digest;
- JSON-pointer `changes[]` with immutable Evidence Graph ids;
- compatibility and dependency findings;
- bounded blast radius;
- evidence-backed expected effect without a causal-improvement claim;
- positive/negative regression case coverage;
- an explicit rollback strategy and prior target reference when one exists.

The closure validator validates every embedded before/after document with its asset schema, binds each proposed asset and the EvaluationPack to exactly one Delta after-state, resolves before-states against the current immutable Catalog, and deterministically recomputes changes, compatibility, dependencies, blast radius, expected effect, regression coverage, rollback, status, and references. It rejects any digest, identity, operation, derived-impact, Evaluation, proposed-asset, Catalog-baseline, or decision/publication mismatch.

## Five Proposal Decisions

| Decision | Proposed change | Publication boundary | Next operator action |
|---|---|---|---|
| `EVOLVE_EXISTING` | New immutable version of the selected Profile and its Evaluation | Allowed only after validation, independent review, and human approval | Review the evidence-backed update and dependency impact. |
| `COMPOSE_NEW_BUNDLE` | New Bundle composed from multiple strong Profile relationships | Allowed only after validation, independent review, and human approval | Review the complete resolved composition and blast radius. |
| `PROPOSE_NEW_PROFILE` | New review-stage Profile and Evaluation | Allowed only after validation, required Advisor completion, independent review, and human approval | Review domain, role, task, boundary, evidence, and overlap. |
| `NO_CHANGE` | Auditable retention of the current immutable state | `publicationAllowed=false`; approval and publication are blocked | Record the conclusion or collect evidence for a different change. |
| `NEED_MORE_EVIDENCE` | No asset version is created | `publicationAllowed=false`; approval and publication are blocked | Supply more discriminating source or approved feedback evidence. |

`NOT_HARNESS_ELIGIBLE` is an earlier Eligibility Gate stop. It is not one of the five Proposal Delta decisions and does not create an asset candidate.

## Decision Rules

The Engine applies versioned Ontology and Match Policy data:

1. Static evidence must first prove a repeatable engineering action or model-external execution boundary.
2. BM25 and structured concepts retrieve published Profile candidates.
3. Role, boundary, capability, execution, evidence coverage, negative conflict, and novelty factors are scored with Policy weights.
4. A strong existing match with novel concepts or evidence kinds becomes `EVOLVE_EXISTING`; the same match with no justified delta becomes `NO_CHANGE`.
5. Two independently strong relationships may become `COMPOSE_NEW_BUNDLE`.
6. A supported Ontology role without a published Profile may become `PROPOSE_NEW_PROFILE`.
7. Missing domain evidence, insufficient thresholds, or ambiguous top candidates become `NEED_MORE_EVIDENCE`.

GLM receives a redacted, Policy-budgeted projection after the deterministic result. It may recommend or explain a Delta, but it cannot change the deterministic decision, supply missing evidence, pass closure, approve, or publish.

## EvaluationPack v3

Each mutating Proposal includes an Evaluation asset Delta and a portable pack with at least one positive and one negative case. Every case binds:

- source context and constraints;
- immutable input and Evidence Graph references;
- expected decision and expected outcome;
- path-based assertions and blocking severity;
- validator ids and versions;
- scorer ids and versions;
- an optional immutable baseline asset reference;
- regression boundaries and review status.

A generated pack starts at `INSUFFICIENT_EVAL_EVIDENCE`. Contract closure proves that the cases are complete and portable; it does not claim matching accuracy or measured causal improvement.

Compatibility is additive:

| Version | Purpose | Read status in Engine 4.1.0 |
|---|---|---|
| `EvaluationPack v1` | Reviewed expected-decision cases | Supported. |
| `EvaluationPack v2` | Outcome, Process, Safety, and Cost feedback criteria | Supported. |
| `EvaluationPack v3` | Portable positive/negative Delta cases and regression boundaries | Canonical for new 3.4 Proposals. |

## Operator Workflow

Produce and inspect the Proposal:

```bash
evopilot-harness produce \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source-project /path/to/project \
  --goal "Produce or evolve a reusable Harness asset." \
  --json

evopilot-harness proposal inspect <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --json
```

Validate deterministic closure before requesting semantic review:

```bash
evopilot-harness proposal validate <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --json
```

Required JSON fields include:

```text
decision
assetDelta.spec.deltas[]
assetDelta.spec.publicationAllowed
evaluationPack.spec.cases[]
closure.status
closure.checks[]
closure.blockers[]
nextAction
```

Continue only when closure is `VALIDATED` and the decision is mutating. Run `proposal review`, present the complete Review Report, and stop for a separate human decision. When a current governed comparison is bound, the report includes `comparisonAssessment` and separates expected effect from comparatively supported effect. `proposal approve` requires the current report file to match the report id and digest bound into the Proposal, the comparison snapshot to remain current, explicit confirmation, `--evaluation-reviewed`, every Evaluation case marked approved, all required polarities, and `EvaluationPack.status=READY`. Approval stores a digest of the complete approved content. Publication recomputes that digest, revalidates the report, comparison snapshot, and Evaluation closure, rebuilds Delta after-states from the exact published assets and Evaluation, and performs immutable path preflight before writing any asset, Evaluation, Delta, or Catalog state.

## Explicit Exclusions

The Asset Delta and Evaluation contracts themselves do not add:

- causal-improvement claims or automatic promotion;
- long-horizon curriculum learning or unrestricted external research;
- source-project build, test, deploy, benchmark, or business execution;
- EvoPilot project matching, Goal Loop execution, or project release decisions;
- automatic approval, publication, or Catalog mutation.

Engine v4.1 adds controlled Baseline/Candidate evidence as a separate governed input to Proposal Review; it does not change the Delta or Evaluation publication authority and does not claim causality. See [Controlled Comparative Evidence](controlled-comparative-evidence.md). Professional asset learning and bounded external research remain in the planned v4.2.0 milestone.
