# EvoPilot Harness Roadmap

## Status And Authority

This Roadmap is the human-readable evolution plan for `evopilot-harness`. The machine-readable authority is [`governance/roadmap.yaml`](../../governance/roadmap.yaml). The accepted [product and module boundary ADR](../architecture/adr/0001-product-and-module-boundaries.md) is a harder constraint than any milestone.

Every feature, architecture, contract, version, and release task must pass the Roadmap Gate before implementation. Only `ALIGNED` work may proceed automatically. `UNPLANNED`, `DEVIATION`, `BOUNDARY_CHANGE`, and `UNKNOWN` require user review before files are changed.

The Roadmap governs the Engine, not the contents of a user's Organization Catalog. A reviewed Harness Asset, Ontology, Policy, Evaluation, or Catalog version can evolve independently without an Engine release.

## Product Direction

`evopilot-harness` is the user's Harness asset library and independent Harness producer. It converts evidence into model-external execution environments that are reusable, constrained, reviewable, and verifiable.

Its next evolution is to use governed production feedback to improve Harness precision and professional completeness:

```text
Source evidence + approved execution feedback
  -> Evidence Graph and effectiveness evidence
  -> deterministic matching and LLM advice
  -> Profile/Component/Bundle/Evaluation delta Proposal
  -> independent review and human approval
  -> immutable published Harness version
```

It does not onboard EvoPilot projects, execute Goal Loops, run source projects, or train model weights.

## Versioned Milestones

### v3.3.0: Feedback Evidence Foundation

- Define and statically read `HarnessExecutionFeedbackPackage`.
- Reject unapproved, unredacted, stale, tampered, or unresolved feedback.
- Aggregate effectiveness by Profile, Component, Bundle, and version with uncertainty and provenance.
- Extend `EvaluationPack` for Outcome, Process, Safety, and Cost evidence.

Feedback remains evidence only. It cannot directly change or publish an asset.

### v3.4.0: Production Feedback Evolution

- Reason about Profile, Component, Bundle, Ontology, Policy, and Evaluation deltas from real outcomes.
- Consume Pairwise experiment evidence without allowing it to override deterministic or human gates.
- Improve new-versus-existing-versus-composed decisions.
- Add compatibility, blast-radius, expected-effect, regression, and rollback analysis to Proposal Review.

### v3.5.0: Professional Asset Learning

- Build an evidence-backed curriculum from unresolved boundaries, conflicts, and Evaluation gaps.
- Calibrate matching and Proposal quality using independently reviewed cases.
- Maintain cross-version regression suites for Asset and governance Pack changes.
- Accept external research evidence only with provenance and strict authority limits.

The objective is more accurate, professional, and fine-grained Harness definitions. It is not large-scale training throughput or an ever-growing hard-coded domain list.

## Cross-Project Feedback

The v3.3.0 consumer contract is active and offline. A compatible external exporter is still pending, so the complete cross-project production loop is not yet claimed:

```text
EvoPilot exports approved HarnessExecutionFeedbackPackage
  -> evopilot-harness validates and reads it as Evidence Source
  -> Proposal / Evaluation / Review / human approval
  -> evopilot-harness publishes a new immutable asset version
  -> a future consumer may discover that version from Catalog/Registry
```

`evopilot-harness` does not call back into a project loop or rewrite the historical Bundle binding used by EvoPilot.

## Standing Work

Bug fixes, security repairs, documentation synchronization, dependency maintenance, compatibility work, and regressions are continuously allowed when they do not add an unplanned capability or change an accepted boundary.

## Change Control

1. Run `npm run roadmap:gate -- --intent "<requested change>" --json` before implementation.
2. Continue only for `ALIGNED`.
3. Present `UNPLANNED` and `DEVIATION` with reason, milestone and version impact, alternatives, and wait for explicit approval.
4. A one-task exception does not rewrite the Roadmap and cannot authorize a Release containing an undeclared product capability.
5. Permanent changes update this document, `governance/roadmap.yaml`, relevant ADRs, executable gates, compatibility notes, and EvoPilot-series memory.
6. `BOUNDARY_CHANGE` always requires a replacement ADR and formal Roadmap revision before implementation.

Release tags must be declared by the machine Roadmap and pass `npm run roadmap:release -- <version>`.
