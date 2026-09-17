# ADR 0008: Bounded Scalable Semantic Interoperability

Status: Accepted for implementation in evopilot-harness 4.8.0

## Context

v4.7.0 established the canonical immutable Project Ontology snapshot, declarative Professional Packs, deterministic projections, Artifact Sets, Skills, and independent lifecycle authority. Large Catalogs and external semantic ecosystems additionally require interoperable formats, explicit reasoning profiles, content-addressed indexes, incremental impact analysis, and read-only federation. Those capabilities must not replace the canonical snapshot, make an external reasoner authoritative, or introduce a shared mutable ontology service.

## Decision

Extend the existing Semantic Asset Plane with deterministic, offline contracts:

- `OntologyReasoningProfile/v1` declares exactly one of `NONE`, `RDFS`, `OWL_RL`, `SWRL_SAFE`, or qualified `EXTERNAL_REASONER`, along with supported rules, resource limits, cache requirements, deterministic failure behavior, and proof paths.
- An external reasoner is never executed by Harness. It contributes an exact identity-, version-, qualification-, input-, output-, and proof-bound result that the Engine validates as evidence. It cannot mutate, approve, publish, install, activate, or decide.
- `SemanticIndex/v1` content-addresses Project Ontology concepts, relationships, Harness assets, algorithm, cache policy, and source snapshot. Stale cache, changed digest, or mixed context fails closed.
- `AffectedSubgraph/v1` computes the deterministic bounded graph closure of exact changed concepts. Incremental computation is acceptable only when an independently produced full computation has the same immutable bindings and authoritative outcome digest.
- `FederatedPackDiscovery/v1` reads independently governed Catalog roots without a shared write path. Every result retains its Catalog, root, version, digest, provenance, visibility, permission, and trust context. Conflicting exact identities fail closed.
- `SemanticInteroperabilityProjectionSet/v1` produces versioned JSON-LD, PROV-O-compatible JSON, RDF Turtle, OWL, and SHACL views with inactive external mappings and multilingual terms. Unsupported semantics are `NON_APPLICABLE`; they are never fabricated.
- `TerminalSemanticClosure/v1` binds the exact v4.8.0 ontology snapshot, reasoning profile, index, projection set, round-trip report, HarnessProfile, HarnessComponent, and HarnessBundle closure. It is read-only for consumers and has no live mutable Harness dependency.
- Terminal closure publication remains a separate digest-bound authorization. Creation, validation, or later consumption cannot authorize publication or an Engine Release.

All algorithms remain local, deterministic, bounded, and source-non-executing. EvoPilot Runtime 6.3.0 may later consume the published closure read-only, but its implementation and the cross-product convergence E2E are outside this repository Target.

## Rejected Alternatives

### A general-purpose knowledge graph service

Rejected because it would introduce network availability, tenancy, consistency, operations, and shared mutation beyond the local Harness producer boundary.

### Unbounded OWL or SWRL inference

Rejected because termination, resource budgets, proof completeness, and deterministic failure could not be guaranteed.

### Trust an external reasoner result directly

Rejected because tool output is evidence, not Harness authority. Exact qualification and full-recompute equivalence remain Engine-enforced.

### Merge federated Catalog authority

Rejected because discovery must not erase ownership, provenance, permission, visibility, or trust context.

## Consequences

- Large semantic sets gain content-addressed indexes, bounded incremental analysis, explicit budgets, and deterministic equivalence evidence.
- Interoperability adds governed mappings and multilingual projections without activating external vocabulary.
- Consumers can slice a frozen closure without a live Harness service or mutation capability.
- Incremental performance claims require versioned corpora, exact bindings, budget evidence, and full-recompute comparison.

## Validation

- Schema and immutable-digest validation for every new contract.
- Positive and negative tests for all reasoning modes, qualified external reasoners, cache drift, budgets, graph impact, full-recompute equivalence, federated permission and identity conflicts, unsupported projections, terminal closure, and separate publication authority.
- Architecture guards prohibit network and process execution in the semantic-interoperability module.
- CLI, stdio MCP, Digital Expert, npm package, inherited regression, independent Host, and designated-human WorkBuddy acceptance remain release-blocking.

## Replacement Conditions

This ADR requires replacement before adding unbounded reasoning, executable Packs, remote Catalog mutation, shared global ontology authority, automatic external-vocabulary activation, a cloud control plane, or Harness-owned EvoPilot Runtime execution.
