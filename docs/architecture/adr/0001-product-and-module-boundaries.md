# ADR: Product And Module Boundaries

## Status

Accepted

## Context

`evopilot-harness` is the user's Harness asset system: the model-external execution-environment knowledge that turns uncertain model output into reusable, constrained, and verifiable engineering workflows. It produces Harness assets; EvoPilot consumes published assets and executes third-party project goal loops.

The source domain is intentionally open, so ownership must be stricter than the classification taxonomy. Evidence collection, reasoning, LLM advice, asset construction, approval, publication, and downstream execution are separate decisions.

## Product Decision

1. `evopilot-harness` independently produces, evolves, reviews, approves, evaluates, and publishes Harness assets.
2. EvoPilot dynamically and read-only reads Registry/Catalog outputs. It does not author, import, approve, publish, or mutate Harness assets.
3. evopilot-dashboard can embed Harness Hub but does not own its state.
4. Producer matching and EvoPilot project matching are different algorithms and bounded contexts.
5. Evidence Sources are not assets. Proposal generation is not publication.

## Confirmed Cross-Project Decisions

- Matching may read `HarnessProfile` metadata. Downstream v3 execution must bind a published, immutable `HarnessBundle` with pinned Profile/Component versions, digests, and execution plan.
- Source ingestion is static and may use reviewed acquisition/extraction tools. It must not execute source-project build, test, deploy, or business commands. A future Evidence Runner requires a separate boundary and explicit operator authorization.
- Signing and verification are optional capabilities. They are not mandatory in the current EvoPilot consumption contract.

## Module Boundaries

| # | Module | Owns | Must not own |
|---|---|---|---|
| 1 | Engine | Versioned code, schemas, built-in bootstrap assets | Mutable organization lifecycle state |
| 2 | Workspace | Organization Catalog, proposals, evidence, evaluations, cache, keys | Engine source mutation |
| 3 | CLI | Parse and orchestrate explicit commands, JSON output, stop status | Bypass policy, review, approval, or validation |
| 4 | Harness Hub | Read-only Workspace/Catalog projection and operator guidance | Browser-local approval/publication or EvoPilot state |
| 5 | Source Ingestion | Local project/root discovery, dedupe/grouping, GitHub checkout, attachment/log/history/note/research intake | Asset publication or source-project execution |
| 6 | Snapshot/Redaction | Bounded excerpts, secret/private-data redaction, stable source digests | Raw secret publication or semantic decisions |
| 7 | Evidence Graph | Stable `evidenceId`, node authority, concepts, graph digest | Final matching or approval authority |
| 8 | OntologyPack | Versioned concepts, roles, conflicts, task/evidence kinds | Hard-coded matcher thresholds |
| 9 | MatchPolicyPack | Eligibility minimums, BM25 configuration, weights, thresholds, risk/Advisor triggers | Source parsing or approval |
| 10 | Eligibility Gate | Decide whether evidence supports a repeatable model-external engineering task | General software taxonomy classification |
| 11 | Candidate Retrieval/Scoring | BM25 and role, boundary, capability, execution, evidence, conflict, novelty factors | Publication or LLM-only decisions |
| 12 | Decision Aggregator | `EVOLVE_EXISTING`, `COMPOSE_NEW_BUNDLE`, `PROPOSE_NEW_PROFILE`, stop/review decisions | Human approval |
| 13 | AdvisorPolicyPack | LLM input projection, output, repair, citation, recommendation, and authority contract | Model configuration secrets |
| 14 | GLM Advisor | Evidence-bound ambiguity/risk/delta advice, per-attempt token and replay evidence | Execute, approve, publish, mutate configuration, override deterministic gates |
| 15 | Proposal Review Engine | Deterministic review gates, independent evidence-bound semantic assessment, structured verdict synthesis, and auditable Review Reports | Human approval, publication, source execution, or replacing the original reasoning record |
| 16 | HarnessComponent | Atomic environment, action, constraint, evidence, validator contract | Domain-wide classification |
| 17 | HarnessProfile | Domain/role/task composition, positive/negative boundary, Component references | Mutable dependency resolution at execution time |
| 18 | HarnessBundle/Export | Immutable resolved publication with pinned Profile/Components and optional consumer exports | Treat an EvoPilot export as canonical source truth |
| 19 | EvaluationPack | Reviewed cases, expected decisions, minimum evidence and readiness | Claim accuracy from contract tests alone |
| 20 | Proposal Lifecycle | Inspect, explicit approval, immutable publication into Organization Catalog | Produce-and-publish in one step or write Built-in assets |
| 21 | Schema Validator | Asset/Pack and Review Report shape plus cross-reference validation | Business approval |
| 22 | Catalog Publisher/Optional Signing | Catalog index/lock/digests and optional signing/verification | Registry asset duplication or mandatory consumer trust policy |
| 23 | Registry | Enabled Catalog roots, priority, release and optional digest metadata | Concrete Harness asset entries |
| 24 | Migration/Rollback | Non-mutating source migration plan, journaled apply and created-file rollback | Destructive source rewrite or unjournaled deletion |

## Dependency Direction

```text
Evidence Sources
  -> Source Ingestion -> Snapshot/Redaction -> Evidence Graph
  -> Ontology + Match Policy -> Eligibility -> Retrieval/Scoring -> Aggregator
  -> Advisor Policy + GLM Advisor
  -> Proposal -> Proposal Review Engine -> Component/Profile/Bundle + Evaluation
  -> Human Review/Approval -> Organization Catalog -> Registry discovery
  -> downstream read-only consumer
```

Dependencies may point from later lifecycle stages to immutable outputs of earlier stages. Earlier stages must not call approval, publication, or downstream project execution.

## Test-Corpus And Asset Separation

- External projects such as `/Users/wangyejing/project/howbuy_project` are local Evidence Sources used to validate and improve Engine behavior.
- Their code, names, paths, generated Proposals, and temporary Workspace outputs are not built-in, source-pack, or published Harness assets.
- Tests may publish fixture assets only inside disposable temporary Workspaces.
- Only explicit human-reviewed publication writes Organization Catalog assets. Built-in assets come only from reviewed Engine bootstrap source.

## Enforcement

- Root `AGENTS.md` and CLI agent instructions define agent behavior.
- `npm run verify:architecture` checks all 23 module anchors, source-tool allowlists, read-only Hub behavior, Advisor authority, Proposal gates, Organization-only publication, and local-path leakage from asset trees.
- `npm run check` includes architecture verification and is run by GitHub CI and release workflows.
- Schema tests and v3 tests verify immutable references, Proposal lifecycle, Advisor citations, migration rollback, and Catalog behavior.

## Change Rule

A boundary change requires all of:

1. explicit user approval;
2. a replacement ADR with compatibility and migration effects;
3. AGENTS and documentation updates;
4. executable architecture-guard changes;
5. validation evidence before release.

## Consequences

- New domains and Harness assets can evolve without changing Engine or EvoPilot releases.
- The open input domain does not grant the LLM or scanner publication authority.
- Downstream v3 consumers have one stable execution unit: immutable `HarnessBundle`.
- Signature verification remains available but optional.
