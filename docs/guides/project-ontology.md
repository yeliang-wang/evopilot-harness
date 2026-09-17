# Governed Project Ontology And Professional Packs

evopilot-harness 4.7 adds declarative Professional Packs and an immutable project ontology publication flow. It does not add executable plugins or give an Agent, LLM, imported vocabulary, or downstream consumer authority over business meaning.

## Resource model

Professional knowledge is split across independently versioned resources:

- `DomainOntologyPack` describes a business domain.
- `ProductOntologyPack` describes a product or product family independently of Domain.
- `OrganizationOntologyPack` contains private organization-owned meaning and policy context.
- `ProjectOntologyOverlay` records project-specific additions and resolutions.
- `DomainHarnessPack` supplies non-executable Harness authoring guidance.

Every Pack uses `semantics.evopilot.io/v1`, declares its root and visibility, binds provenance and an exact digest, and remains data-only. Imports bind exact ids, versions, and digests. Missing dependencies, cycles, namespace collisions, incompatible replacement, stale bases, and private-root leakage fail closed.

## Lifecycle

The lifecycle deliberately keeps these actions separate:

```text
Draft -> apply -> Review -> Approval -> Publication -> installation -> activation
                                                           |             |
                                                     deprecation   successor/rollback
```

Approval never implies publication. Publication never implies installation or activation. Every transition binds the current immutable record digest and an explicit actor.

## Project artifacts

An approved `ProjectOntologyProposal/v1` resolves into one immutable `ResolvedProjectOntologySnapshot/v1`. A separately authorized publication produces `ProjectOntologyArtifactSet/v1`, which closes over:

- the exact project and Source snapshot;
- Foundation, Proposal, Pack-set, Pack, dependency, predecessor, and snapshot digests;
- provenance and a dependency lock;
- deterministic YAML, OWL, RDF Turtle, JSON-LD, bounded SWRL, and SHACL projections;
- `ProjectOntologySkill/v1` for read-only Agent guidance, bound to the Artifact Set manifest.

If a projection is not semantically applicable, its status is `NON_APPLICABLE` with a reason. The Engine never fabricates content merely to fill the manifest. The Skill is not the truth store; the published Skill binds the canonical snapshot, projection-set, and Artifact Set manifest digests without a circular artifact digest.

## CLI diagnostics

All commands support `--json` and operate against the explicit external Workspace.

```bash
evopilot-harness pack scaffold --file domain-pack-draft.yaml --workspace "$EVOPILOT_HARNESS_HOME" --json
evopilot-harness pack inspect --file product-pack.yaml --available-pack domain-pack.yaml --workspace "$EVOPILOT_HARNESS_HOME" --json
evopilot-harness pack resolve --pack domain-pack.yaml --pack product-pack.yaml --target-root DOMAIN_TEAM --workspace "$EVOPILOT_HARNESS_HOME" --json
evopilot-harness pack lifecycle-init --file lifecycle-binding.yaml --pack product-pack.yaml --workspace "$EVOPILOT_HARNESS_HOME" --json
evopilot-harness pack benchmark --file benchmark.yaml --workspace "$EVOPILOT_HARNESS_HOME" --json
evopilot-harness pack gold-case --file gold-case.yaml --workspace "$EVOPILOT_HARNESS_HOME" --json
evopilot-harness pack evidence-adapter --file evidence-adapter.yaml --workspace "$EVOPILOT_HARNESS_HOME" --json
evopilot-harness project-ontology propose --file project-ontology-input.yaml --workspace "$EVOPILOT_HARNESS_HOME" --json
evopilot-harness project-ontology resolve --proposal approved-proposal.yaml --expected-proposal-digest sha256:... --foundation-digest sha256:... --workspace "$EVOPILOT_HARNESS_HOME" --json
evopilot-harness project-ontology project --snapshot resolved-snapshot.yaml --workspace "$EVOPILOT_HARNESS_HOME" --json
evopilot-harness project-ontology skill --snapshot resolved-snapshot.yaml --workspace "$EVOPILOT_HARNESS_HOME" --json
```

The low-level transition and publication commands are compatibility and automation surfaces. Ordinary Agent operation must use the Digital Expert and local stdio MCP Session gates so exact human decisions remain bound to the current digest.

## External evidence and certification

`ExternalSemanticEvidenceAdapter/v1` is a versioned, non-executable, locally supplied read-only adapter contract. It imports external catalog, vocabulary, RDF/OWL, or graph observations as inactive Evidence with exact adapter, source, and content digests. Import cannot override a Pack, activate knowledge, or approve or publish an artifact.

Pack certification binds the exact Pack, benchmark, Gold Cases, algorithm, policy, toolchain, optional signer, and evidence. Certification is advisory and never establishes automatic trust or lifecycle authority.

## Downstream boundary

EvoPilot may consume a separately published `ProjectOntologyArtifactSet` and `ProjectOntologySkill` read-only. evopilot-harness does not call EvoPilot APIs, execute a Goal Loop, or grant the consumer Pack authoring, mutation, Review, Approval, Publication, installation, or activation authority.
