# ADR 0007: Governed Project Ontology And Declarative Professional Packs

Status: Accepted for implementation in evopilot-harness 4.7.0

## Context

v4.6.0 established a minimal Engine-owned `OntologyFoundation`, evidence-bound grounding, and optional Harness semantic requirements. It intentionally did not publish project ontology assets or provide a multi-Pack lifecycle. v4.7.0 must add user- and organization-authored professional knowledge without turning the Engine, an LLM, an imported vocabulary, or an Agent Host into universal business authority.

The design must preserve four independent axes: editable declaration, deterministic resolution, immutable publication, and project activation. It must also preserve the existing Harness Proposal and Catalog authority boundary and remain usable through the local package and stdio MCP distribution model.

## Decision

Add a declarative Semantic Asset Plane inside existing module 8 rather than a new service or authority plane.

- `DomainOntologyPack`, `ProductOntologyPack`, `OrganizationOntologyPack`, `ProjectOntologyOverlay`, and `DomainHarnessPack` use `semantics.evopilot.io/v1`. They are non-executable, independently versioned manifests with exact imports, namespaces, provenance, visibility, and content digests.
- The Engine resolves exact Pack versions with dependency, cycle, namespace, precedence, replacement, private-root, and optimistic-concurrency checks. Unresolved conditions fail closed; no partial merge or publication is permitted.
- `ProjectOntologyProposal/v1` has explicit Draft, apply, Review, and Approval transitions. Approval does not publish.
- An approved Proposal can create one immutable `ResolvedProjectOntologySnapshot/v1` bound to the project, Foundation, Pack set, dependency graph, predecessor, and digests.
- A separately authorized publication creates one atomic `ProjectOntologyArtifactSet/v1` containing the canonical snapshot, provenance, dependency lock, deterministic projections, and `ProjectOntologySkill/v1`.
- YAML, OWL, RDF Turtle, JSON-LD, bounded SWRL, and SHACL are projections of the canonical snapshot. A projection declares `NON_APPLICABLE` instead of fabricating content.
- `ProjectOntologySkill/v1` is a deterministic, read-only Agent guidance projection. The canonical snapshot remains the truth source.
- Installation, activation, successor, rollback, and deprecation use independent digest-bound lifecycle transitions after publication.
- `ExternalSemanticEvidenceAdapter/v1` imports read-only provenance-preserving Evidence. Imported content remains inactive and cannot override Packs or activate itself.
- Quality and optional-signing records are advisory evidence bound to exact Pack, benchmark, Gold Case, algorithm, policy, toolchain, and evidence versions. They do not create trust or lifecycle authority.

All state remains in the explicit external Workspace. Pack resolution and projection are deterministic and offline. EvoPilot remains a read-only consumer of published immutable artifacts and receives no authoring or mutation capability.

## Alternatives Considered

### Put deep vertical ontology truth in the Engine

Rejected. It would couple Engine releases to business domains, collapse Domain and Product dimensions, and grant maintainers authority over user-specific professional meaning.

### Treat Packs as executable plugins

Rejected. Executable installers and hooks introduce code-execution, isolation, credential, and supply-chain boundaries that are not part of this milestone. v4.7 Packs are data-only manifests.

### Add a hosted graph or marketplace service

Rejected. A new service would add network availability, tenancy, consistency, operations, and release coupling without being required for local deterministic authoring and publication. General-purpose graph storage and a cloud marketplace remain excluded.

### Store only an Agent Skill

Rejected. A Skill is optimized for guidance, not canonical identity, provenance, dependency, conflict, and round-trip closure. It is generated from and bound to the immutable snapshot.

## Consequences

- Pack and project ontology assets gain explicit provenance, dependency, conflict, publication, and rollback evidence.
- Users must make separate decisions for apply, approval, publication, installation, and activation; this is intentional authority separation.
- The package adds schemas, deterministic resolution/projection code, CLI and Engine-operation surfaces, and cumulative acceptance.
- v4.8 may add indexes, incremental reasoning, reasoning profiles, and federation without changing v4.7's canonical snapshot and authority model.

## Validation

- Schema and digest validation for every v4.7 resource.
- Negative tests for executable fields, missing dependencies, cycles, namespace collisions, stale bases, incompatible overrides, private-root leakage, and skipped transitions.
- Deterministic projection and non-applicability tests across all six declared formats.
- Engine-adapter, CLI, architecture-boundary, package, inherited regression, real-Host, and designated-human WorkBuddy acceptance required by the approved v4.7.0 Target.

## Replacement Conditions

This ADR requires replacement before allowing executable Packs, automatic trust or publication, a hosted marketplace, general-purpose graph storage, unbounded reasoning, imported-vocabulary activation, or live cross-organization authority.
