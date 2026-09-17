# ADR: Professional Reasoning And Ontology Grounding

## Status

Accepted for implementation by evopilot-harness v4.6.0 Evolution Target revision 1 (`sha256:202ce651fa0ad4f5d417dc99c67e7d39d6344028f52b39f3246be2cc6aea9810`). Formal acceptance and release remain separate decisions.

## Context

v4.5 identifies a Source in one user-owned business classification scheme and then hands the exact Source into the cumulative Harness producer lifecycle. The next quality gap is narrower: professional reasoning needs stable business-semantic concepts, and immutable Bundles need an optional way to state which concepts they require or prohibit. Neither need grants a new approval, publication, Eligibility, or runtime authority plane.

## Decision

Extend existing module 8 with four contracts:

1. `OntologyFoundation/v1` is an Engine-owned, business-neutral meta-model. Its exact meta-types are Entity, Attribute, Relationship, Rule, Event, Action, Actor, Role, Permission, State, Workflow, Capability, System, and DataAsset; professional analysis dimensions remain outside this Foundation. It contains only bounded meta-types and relation primitives, never enterprise or vertical business values.
2. `SemanticCandidateSet/v1` records evidence-bound professional candidates extracted from static Source material. Deterministic signals and LLM advice remain separate.
3. `OntologyGroundingResolver/v1` produces immutable `OntologyGroundingResult/v1` records with exactly six outcomes: `RESOLVED`, `UNRESOLVED_CONCEPT`, `AMBIGUOUS_CONCEPT`, `CONFLICTING_CONCEPT`, `EXTENSION_REQUIRED`, and `EVIDENCE_INSUFFICIENT`.
4. `HarnessSemanticRequirements/v1` may be embedded in a `HarnessBundle`. `SemanticCompatibilityReport/v1` evaluates the requirements against one immutable grounding result, independently from Harness Eligibility.

Grounding uses deterministic precedence, at least two independent non-LLM Source evidence families for a positive claim, finite user actions, resource bounds, digest-bound context, explicit drift rejection, and append-only re-analysis. LLM advice may explain or challenge evidence but may not supply an authoritative concept identifier. A grounding or compatibility result cannot prove Eligibility, create or approve a Proposal, publish an asset, or activate Catalog state.

Professional analysis additionally projects business objects, capabilities, tasks, roles, constraints, workflows, failure modes, recovery strategies, validators, positive and negative cases, alternatives, risks, expected effects, and missing evidence. Empty facets remain explicit rather than being invented.

## Alternatives

- A new ontology authority service was rejected because v4.6 needs no independent lifecycle or deployment unit.
- LLM-selected concept identifiers were rejected because they are not deterministic authority.
- Embedding semantic compatibility into Eligibility was rejected because “the Source supports a reusable Harness” and “the Source satisfies this Bundle's semantic requirements” are different decisions.
- Project ontology assets, OWL/RDF/SWRL/SHACL projections, multi-Pack merge, and external reasoners are deferred to later Roadmap milestones.

## Compatibility And Migration

The change is additive. Existing v4.5 Bundles remain valid because `semanticRequirements` is optional. Fresh v4.6 Sessions use the v4.6 Digital Expert binding; preserved v4.5 Protocol v3 Sessions remain readable and use the existing explicit Core compatibility migration before mutation. No v4.5 product capability, authority gate, or end-to-end obligation is removed.

## Validation

- schema and digest-closure tests for all five contracts;
- exact six-outcome, precedence, drift, append-only history, evidence-family, resource-bound, and LLM non-authority tests;
- semantic compatibility versus Eligibility independence tests;
- optional Bundle closure, Catalog metadata, Hub projection, CLI, MCP, and generated Digital Expert checks;
- full v4.5 regression and the separate Target-bound formal acceptance campaign before release.

## Replacement Conditions

Adding Project Ontology assets, external reasoners, executable rules, a new authority plane, or automatic policy/approval/publication requires its own Roadmap and Evolution Target authority.
