# ADR: Source-first Business Classification And Cumulative Harness Handoff

## Status

Accepted and released in v4.5.0. Product implementation was originally authorized by Evolution Target revision 8; final acceptance and release use Target revision 15 (`sha256:51aef4c43bc4fb808fd115c5735cea7556d52b693affcb9eab6e60197a678abc`). Revision 15 retains the architecture, cumulative v4.4 capabilities, five-journey WorkBuddy contract, and complete machine coverage while reducing the live GitHub acceptance cohort to one independently selected pinned Source.

This ADR replaces ADR 0001 module 8 (`OntologyPack`) with the v4.5 Semantic Foundation and Taxonomy Resolution boundary. All other ADR 0001 boundaries remain accepted. Pre-v4.5 representations are not migration inputs, while released product capabilities remain cumulative.

## Context

An ordinary user can supply a static Source without knowing what business area or product type it represents. The Harness must explain the best supported classification in the user's own classification scheme, distinguish a missing category from weak evidence and ambiguity, and only then offer a separately authorized continuation into the existing Harness producer lifecycle.

Three architectural concerns must remain independent:

1. business classification answers “what kind of Source is this?”;
2. Harness Eligibility answers “does the evidence support reusable model-external engineering knowledge?”;
3. Proposal approval and publication decide whether governed Harness assets may change.

The v4.5.0 Roadmap establishes a clean pre-production representation baseline. This permits replacement contracts but does not permit deletion of v4.4.0 user outcomes, safety gates, authority boundaries, recovery, or publication controls.

## Decision

### Module 8 replacement

Module 8 is `Semantic Foundation and Taxonomy Resolution`.

It owns the minimal semantic axes `Domain` and `Product`, hierarchy relation primitives, validation and canonicalization of one user-authored non-executable `Taxonomy/v1`, immutable `ResolvedTaxonomySnapshot/v1` construction, and resource, namespace, alias, hierarchy and assignability validation.

It must not own built-in business values, classifier thresholds, executable policy, Harness Eligibility, Proposal decisions, approval, publication, or active Taxonomy mutation.

### Classification pipeline

```text
SourceDescriptor/v1
  -> bounded Source Resolver
  -> immutable static Source snapshot
  -> Snapshot and redaction
  -> taxonomy-blind SourceConceptHypothesis/v1
  -> resolved user Taxonomy
  -> exact + BM25 + deterministic embedding + structured retrieval signals
  -> exactly one evidence-bound AdvisorCandidateAnalysis/v1 call per new attempt
  -> deterministic hierarchy-aware Decision Aggregator
  -> per-axis result and aggregate TaxonomyAnalysisResult/v1
  -> explicit human stop / revise / re-analyze / continue decision
  -> independent Harness Eligibility and retained v4.4 producer lifecycle
```

The Source hypothesis is created before the selected Taxonomy is exposed. Retrieval signals and Advisor output remain separate immutable evidence. A `MATCHED` or `EXTENSION_SUGGESTED` result requires citations from at least two semantically independent non-LLM Source evidence families. A lexical citation and a semantic projection derived from the same content do not become independent merely because they have different family labels. The Advisor is required for a new analysis attempt, is called at most once, and cannot directly select the result. `CONTRADICT` may reject a supplied candidate but cannot create a Taxonomy gap or satisfy the non-LLM evidence minimum; a gap still requires an independently corroborated taxonomy-blind concept or a validated unresolved-concept record. Failure produces `ANALYSIS_BLOCKED_ADVISOR`, not a fallback classification.

### Source contract and acquisition

`SourceDescriptor/v1` is the single v4.5 classification input abstraction. It represents `LOCAL_FILE`, `LOCAL_DIRECTORY`, `LOCAL_GIT_REPOSITORY`, `GITHUB_REPOSITORY`, `CONTROLLED_FIXTURE`, and `ORDERED_ATTACHMENT_SET`; binds a stable Source id, locator class, acquisition and redaction policies; fixes ordered-set membership and order; and always sets `sourceExecutionAllowed=false`.

Modules 5 and 6 retain their accepted ownership. Source Ingestion normalizes and resolves descriptors; Snapshot/Redaction creates the immutable content view used by classification and later Harness reasoning. A GitHub locator is normalized to a canonical repository identity, resolved to a full commit through bounded read-only Git acquisition in the external Workspace, and materialized without Source commands. Acquisition time and network/cache replay status are provenance outside the deterministic content snapshot. Embedded credentials, unavailable network/repository/ref, missing operator-managed ambient authentication, submodules, and Git LFS fail with typed blockers before reasoning. Source-discovered URLs, dependencies, hooks, builds, tests, workflows, scripts, and business commands are never executed.

Per-axis and aggregate outcomes are exactly `TAXONOMY_MATCHED`, `TAXONOMY_EXTENSION_SUGGESTED`, `TAXONOMY_EVIDENCE_INSUFFICIENT`, and `TAXONOMY_AMBIGUOUS`. Aggregate precedence is `AMBIGUOUS > EVIDENCE_INSUFFICIENT > EXTENSION_SUGGESTED > MATCHED` while retaining both axis results.

### Session and handoff

`ANALYZE_TAXONOMY` is carried by the generic persistent `AgentOperationSession`. Its classification lifecycle binds an append-only classification-attempt projection with immutable attempt and result digests, MCP presentation receipts, retry/resume state, and finite choices. `TAXONOMY_MATCHED` only enables two choices: stop or explicitly continue. Continuing creates a digest-bound `ClassificationHandoff/v1` referencing the exact SourceDescriptor, resolved Source binding, static Source snapshot, resolved Taxonomy, hypothesis, per-axis results, and classification Evolution Context on that same AgentOperationSession. Harness planning automatically reuses that resolved Source; it does not ask for or fetch a replacement. Locator, ordered membership, ref, commit, or content drift requires explicit re-analysis and invalidates the handoff.

The handoff changes the same Agent Operation Session's next operation from classification to independent Eligibility and retained planning. It never proves eligibility and never creates, approves, or publishes a Profile, Bundle, or Proposal. Every other classification result blocks handoff and presents a finite corrective action.

### Compatibility and cumulative capability

The Engine does not require or migrate pre-v4.5 Workspace, Session, configuration, Taxonomy/Ontology, Catalog, Asset, package, or protocol representations for this baseline. The retained Harness lifecycle is exercised from fresh v4.5 state. Compatibility governance resumes from v4.5.0 forward.

## Alternatives

### Extend the Eligibility Gate to classify business type

Rejected. It collapses two user questions, makes `NOT_HARNESS_ELIGIBLE` indistinguishable from classification insufficiency, and expands module 10 authority.

### Let the LLM select a label directly

Rejected. It is not replayable, makes model availability an authority dependency, weakens abstention, and cannot enforce user-owned vocabulary or independent Source corroboration.

### Hard-code a universal business ontology

Rejected. It requires Engine releases for user vocabulary changes, embeds vertical authority in the package, and cannot represent two organizations' different Domain and Product hierarchies.

### Rewrite the v4.4 producer lifecycle around classification

Rejected. Classification is a new precondition, not a replacement for Eligibility, professional reasoning, Proposal Review, approval, publication, recovery, or safe close. A bounded handoff preserves those released capabilities with lower regression risk.

## Consequences

- Users can change classification vocabulary without an Engine release.
- Classification remains deterministic and replayable after one recorded Advisor response.
- Advisor failure blocks safely and cannot broaden a result.
- The generic AgentOperationSession gains a classification lifecycle binding and append-only attempt projection, while the retained producer lifecycle stays independently testable.
- Unit tests alone cannot close Target acceptance; real WorkBuddy and independent-Host journeys remain mandatory.

## Validation

- schema and canonicalization golden tests, including boundary and boundary-plus-one cases;
- taxonomy-blind hypothesis invariance when only the selected Taxonomy changes;
- per-signal retrieval, two-family corroboration, hierarchy, threshold, margin, fold, and replay tests;
- exactly-one Advisor invocation and failure-path tests;
- classification handoff authority and stale-digest tests;
- full v4.4 regression plus real WorkBuddy and independent-Host classification-to-publication evidence;
- six-type SourceDescriptor vectors, ordered-member drift, local and GitHub resolution, same-commit replay, moving-ref context change, bounded network and typed Git blocker tests;
- five composite RC01–RC05 journeys containing the complete fixed Source Portfolio and machine-variant matrix, plus one Target-bound live GitHub Source with a candidate-blind oracle and no-replacement accounting;
- executable guards for Source non-execution, LLM non-authority, Eligibility independence, and publication separation.

## Replacement Conditions

Replacing this decision requires a new Roadmap revision, replacement ADR, migration and compatibility impact, executable guard changes, and explicit user approval. Multi-Pack merge, Organization ownership, automatic learning, executable knowledge plugins, or LLM-owned decisions are not authorized by this ADR.
