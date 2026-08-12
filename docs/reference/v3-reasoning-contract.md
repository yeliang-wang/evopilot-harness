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
10. Produce a review-stage Profile or Bundle proposal and supporting Evaluation Pack.
11. Run deterministic Proposal gates plus an independent evidence-bound semantic review.
12. Synthesize and persist a structured Review Report, then stop for human decision.

## Eligibility

The gate asks whether evidence supports a repeatable engineering task with model-external actions, constraints, evidence, or validators. It does not ask which general software category the source belongs to.

Outcomes before candidate matching:

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

`executable-engineering` is a shared eligibility concept, not domain evidence. It contributes to execution readiness but is excluded from role detection. When no domain-specific concept is evidenced, the result is `unclassified-engineering` and remains review-blocking instead of assigning the first available domain role.

## Final Decisions

| Decision | Effect |
|---|---|
| `EVOLVE_EXISTING` | Draft a new version of the selected Profile. |
| `COMPOSE_NEW_BUNDLE` | Draft a Bundle from multiple strong Profile relationships. |
| `PROPOSE_NEW_PROFILE` | Draft a review-stage Profile and Ontology/Policy implications; never auto-publish. |
| `INSUFFICIENT_EVIDENCE` | Stop and request more source evidence. |
| `NOT_HARNESS_ELIGIBLE` | Stop; do not create a Harness asset. |
| `REVIEW_REQUIRED` | Stop on ambiguity or a threshold gap. |

A detected Ontology role with no published Profile becomes `PROPOSE_NEW_PROFILE`. A strong negative boundary conflict cannot be treated as a normal existing-Profile evolution.

## Proposal Quality

A new Profile proposal is assembled from deterministic intent and the Evidence Graph. It includes:

- the exact Ontology role and task class;
- positive and conflicting concepts as explicit match boundaries;
- source-kind-specific evidence requirements, such as immutable source revisions, build-manifest snapshots, architecture review, or redacted runtime evidence;
- isolation, operator-approval, evidence-citation, domain-conflict, and validation blockers;
- source, Ontology, Match Policy, and successful Advisor response digests.

An existing-Profile evolution must change evidence-backed matching or acceptance coverage in addition to version and provenance metadata. All such deltas remain review-stage until human approval.

## Proposal Review Contract

`proposal inspect` reads the draft and does not perform a review. `proposal review` loads the immutable Evidence Graph and reasoning result, the generated Proposal, current Catalog relationships, Advisor Policy, and a manually maintained GLM profile. It emits `evopilot-harness-proposal-review/v1` with one verdict:

- `READY_FOR_HUMAN_APPROVAL`
- `REVISE`
- `SPLIT`
- `REJECT`
- `NEED_MORE_EVIDENCE`

Deterministic gates validate Proposal shape, evidence/reasoning digests, required Advisor completion, definition-contract completeness, and Evaluation Pack presence. The semantic reviewer independently evaluates product ownership versus dependency/use, corpus coherence and every source membership, new-versus-existing asset relationships, boundary quality, professional definition completeness, and evaluation sufficiency. Synthesis cannot turn a failed blocking gate into `READY_FOR_HUMAN_APPROVAL`.

The Review Report records findings, reasons, evidence ids, actions, original Proposal blockers, Review blockers, model and token usage, attempts, policy and algorithm versions, Proposal/report digests, and `nextAction`. It is advisory to the human lifecycle gate: neither the Review Engine nor `READY_FOR_HUMAN_APPROVAL` is approval. `proposal approve` rejects a missing, invalid, stale, blocked, or non-ready report.

## LLM Boundary

GLM receives only a Policy-budgeted projection of the redacted Evidence Graph, the deterministic result, Ontology Pack, relevant Match Policy fields, and Advisor output contract. Projection preserves deterministic reasoning citations first and then source/kind diversity; it records Graph and projection digests plus coverage counts. Every conclusion must cite an `evidenceId` present in that projection. Advisor Policy may authorize one repair attempt after invalid JSON or citation validation failure. The repair receives the exact projected ids and failed checks, may repair only structure/citations, and cannot replace deterministic reasoning or bypass final validation.

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

The Proposal semantic reviewer has the same authority limits. It may produce a structured review verdict, but it cannot approve or publish.

The run stores provider, model, input/output/total tokens, prompt and response digests, Ontology and Policy versions, validation, and a replay record. Raw API keys are never returned.

## Evaluation Claims

`eval v3-run` covers schema, Advisor citation, adversarial response, and unknown-domain proposal contracts. It reports `INSUFFICIENT_EVAL_EVIDENCE` until enough independently reviewed cases exist. Contract tests are not represented as general matching accuracy.
