# v3 Reasoning Contract

## Pipeline

The v3 reasoning pipeline is deterministic at its decision boundary:

1. Ingest explicitly supplied sources.
2. Redact common credential, token, email, and private-endpoint patterns.
3. Write a redacted snapshot and Evidence Graph with stable `evidenceId` values.
4. Run the Harness Eligibility Gate.
5. Map evidence terms to versioned Ontology concepts and roles.
6. Retrieve Profile candidates with BM25 and structured concepts.
7. Score every candidate by role, boundary, capability, execution, evidence coverage, negative conflict, and novelty.
8. Apply versioned thresholds and risk policy.
9. Call GLM only for ambiguity, conflict, or new-Profile decisions.
10. Produce one of five Proposal decisions with a typed Asset Delta and EvaluationPack v3.
11. Validate exact state, decision/publication semantics, positive/negative Evaluation coverage, and deterministic impact closure.
12. Run remaining deterministic Proposal gates plus an independent evidence-bound semantic review.
13. Resolve any current governed comparison snapshot and distinguish expected effect from comparatively supported effect.
14. Synthesize and persist a structured Review Report, then stop for human decision.

## Eligibility

The gate asks whether evidence supports a repeatable engineering task with model-external actions, constraints, evidence, or validators. It does not ask which general software category the source belongs to.

Eligibility outcomes before candidate matching:

- `NOT_HARNESS_ELIGIBLE`: no relevant engineering boundary or explicit reject signals.
- `INSUFFICIENT_EVIDENCE`: engineering intent exists, but minimum evidence or action signals are missing.
- `ELIGIBLE`: proceed to candidate retrieval and decision aggregation.

Internet research and historical Harnesses are supplemental. They cannot independently satisfy the local engineering-evidence gate or override source code and runtime logs.

## Candidate Factors

Each candidate returns:

| Factor | Meaning |
|---|---|
| `role` | Detected Ontology role versus Profile role/domain. |
| `boundary` | Positive concept overlap. |
| `capability` | Normalized BM25 relevance. |
| `execution` | Evidence for executable engineering actions. |
| `evidenceCoverage` | Required evidence-kind coverage. |
| `negativeConflict` | Explicit Profile or Ontology conflict. |
| `novelty` | Evidence not explained by the candidate boundary. |

Weights and thresholds come from `MatchPolicyPack`; they are not constants in v3 reasoning code. Results include `rejectionReasons` and the exact `evidenceIds` supporting the decision.

For `PROPOSE_NEW_PROFILE`, the deterministic result also emits `proposedProfile`: the Ontology-derived Profile id, domain, exact role, task class, positive concepts, negative concepts, and evidenced source kinds. Proposal generation must preserve this intent. It must not replace a specific role such as `redis-client-library` with a generic `<domain>-engineering` role.

`executable-engineering` is a shared eligibility concept, not domain evidence. It contributes to execution readiness but is excluded from role detection. When no domain-specific concept is evidenced, the Proposal decision is `NEED_MORE_EVIDENCE`; the Engine does not generate a generic `unclassified` Profile.

## Final Decisions

| Decision | Effect |
|---|---|
| `EVOLVE_EXISTING` | Draft a new version of the selected Profile. |
| `COMPOSE_NEW_BUNDLE` | Draft a Bundle from multiple strong Profile relationships. |
| `PROPOSE_NEW_PROFILE` | Draft a review-stage Profile and Ontology/Policy implications; never auto-publish. |
| `NO_CHANGE` | Preserve an auditable finding that current evidence adds no justified asset delta; approval and publication are blocked. |
| `NEED_MORE_EVIDENCE` | Preserve an auditable stop when evidence, domain discrimination, score, or candidate separation is insufficient; approval and publication are blocked. |

`NOT_HARNESS_ELIGIBLE` remains an earlier Eligibility Gate stop and is not one of the five Proposal decisions. A detected Ontology role with no published Profile becomes `PROPOSE_NEW_PROFILE`. A strong negative boundary conflict cannot be treated as a normal existing-Profile evolution. A strong existing match becomes `NO_CHANGE` when evidence adds neither a new domain concept nor a new required evidence kind; otherwise it may become `EVOLVE_EXISTING`. Ambiguous or sub-threshold candidates become `NEED_MORE_EVIDENCE`.

## Proposal Quality

A new Profile proposal is assembled from deterministic intent and the Evidence Graph. It includes:

- the exact Ontology role and task class;
- positive and conflicting concepts as explicit match boundaries;
- source-kind-specific evidence requirements, such as immutable source revisions, build-manifest snapshots, architecture review, or redacted runtime evidence;
- isolation, operator-approval, evidence-citation, domain-conflict, and validation blockers;
- source, Ontology, Match Policy, and successful Advisor response digests.

An existing-Profile evolution must change evidence-backed matching or acceptance coverage in addition to version and provenance metadata. All such deltas remain review-stage until human approval. Every mutating Proposal also carries an EvaluationPack v3 Delta.

## Asset Delta Closure

`AssetDeltaProposal v1` supports Component, Profile, Bundle, Ontology, Matcher Policy, Advisor Policy, and Evaluation assets. It records exact before/after documents and digests, JSON-pointer changes, evidence ids, operation semantics, and deterministic impact findings for compatibility, dependency, blast radius, expected effect, regression, and rollback.

`proposal validate` recomputes and checks the Delta and Evaluation closure without invoking the semantic reviewer. It fails on malformed contracts, missing positive/negative cases, stale Evaluation digests, altered asset identity, invalid create/update/compose/no-change semantics, blocked impact analysis, or a terminal decision that permits publication.

## Proposal Review Contract

`proposal inspect` reads the draft and does not perform a review. `proposal review` loads the immutable Evidence Graph and reasoning result, the generated Proposal, current Catalog relationships, Advisor Policy, and a manually maintained GLM profile. It emits `evopilot-harness-proposal-review/v1` with one verdict:

- `READY_FOR_HUMAN_APPROVAL`
- `REVISE`
- `SPLIT`
- `REJECT`
- `NEED_MORE_EVIDENCE`

Deterministic gates validate Proposal shape, evidence/reasoning digests, required Advisor completion, definition-contract completeness, typed Delta closure, impact closure, Evaluation Pack presence, and any governed comparison assessment. The semantic reviewer independently evaluates product ownership versus dependency/use, corpus coherence and every source membership, new-versus-existing asset relationships, boundary quality, professional definition completeness, and evaluation sufficiency. Synthesis cannot turn a failed blocking or comparison gate into `READY_FOR_HUMAN_APPROVAL`.

The Review Report records findings, reasons, evidence ids, actions, original Proposal blockers, Review blockers, model and token usage, attempts, policy and algorithm versions, Proposal/report digests, and `nextAction`. Source-derived project membership, boundary, Advisor, and multi-source coherence conclusions require valid Evidence Graph citations. Catalog overlap, Proposal structure, definition quality, evaluation sufficiency, and findings derived only from those non-Graph inputs may use an empty `evidenceIds` array; the reviewer must not invent source citations for them. String-form definition-quality checks are normalized into structured report entries before validation, but normalization cannot add evidence or change a verdict.

The report is advisory to the human lifecycle gate: neither the Review Engine nor `READY_FOR_HUMAN_APPROVAL` is approval. `proposal approve` rejects a missing, invalid, stale, blocked, or non-ready report. When comparison evidence is bound, approval and publication recompute its package/report/Proposal digest snapshot and reject new evidence, conflict, tamper, expiry, or binding drift. An LLM cannot override `NON_COMPARABLE`, safety regression, uncertainty, conflict, or snapshot drift.

## LLM Boundary

GLM receives only a Policy-budgeted projection of the redacted Evidence Graph, the deterministic result, Ontology Pack, relevant Match Policy fields, and Advisor output contract. Projection preserves deterministic reasoning citations first and then source/kind diversity; it records Graph and projection digests plus coverage counts. Every source-derived conclusion must cite an `evidenceId` present in that projection. Advisor Policy may authorize one repair attempt after invalid JSON or citation validation failure. The repair receives the exact projected ids and failed checks, may repair only structure/citations, and cannot replace deterministic reasoning or bypass final validation.

GLM may:

- recommend one allowed decision;
- explain ambiguity and risks;
- suggest Profile, Ontology, Policy, or Evaluation deltas.

GLM may not:

- approve or publish;
- execute source code or commands;
- mutate `models.json`;
- invent evidence IDs;
- override eligibility, signature, schema, or human-approval gates;
- use self-reported confidence as the final deterministic decision.
- replace `NO_CHANGE` or `NEED_MORE_EVIDENCE` with a mutating decision.

The Proposal semantic reviewer has the same authority limits. It may produce a structured review verdict, but it cannot approve or publish.

The run stores provider, model, input/output/total tokens, prompt and response digests, Ontology and Policy versions, validation, and a replay record. Raw API keys are never returned.

## Evaluation Claims

`eval v3-run` covers schema, Advisor citation, adversarial response, unknown-domain stops, all supported Delta asset kinds, positive/negative Evaluation cases, and blocked impact closure. EvaluationPack v1, v2, and v3 remain readable. Generated packs report `INSUFFICIENT_EVAL_EVIDENCE` until enough independently reviewed cases exist. Contract tests are not represented as general matching accuracy or causal improvement.
