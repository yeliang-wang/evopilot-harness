# Scalable Semantic Interoperability

evopilot-harness 4.8.0 extends the immutable v4.7 Project Ontology model with bounded reasoning, content-addressed indexes, incremental impact analysis, interoperable projections, and read-only federated discovery. The canonical `ResolvedProjectOntologySnapshot/v1` remains the truth source.

## Reasoning profiles

`OntologyReasoningProfile/v1` selects `NONE`, `RDFS`, `OWL_RL`, `SWRL_SAFE`, or `EXTERNAL_REASONER`. Every profile declares exact supported rules and positive limits for nodes, edges, iterations, wall time, concurrency, and cache entries.

An external reasoner is never started by Harness. Supply only a qualified immutable result containing the exact reasoner identity, version, binary or distribution digest, qualification digest, input digest, output digest, and proof digest. A mismatch fails before the result can influence any governed state.

## Index and incremental computation

`SemanticIndex/v1` binds the snapshot, policy, algorithm, toolchain, optional cache policy, nodes, edges, and indexed Ontology, Source, HarnessProfile, HarnessComponent, Evaluation, and HarnessBundle assets. `AffectedSubgraph/v1` starts from exact changed concept ids and computes a bounded deterministic dependency closure with proof paths.

An incremental result is not independently authoritative. Run a full computation with identical index and reasoning-profile bindings and compare the outcome digests. Any mismatch returns `FAILED` and cannot advance a lifecycle.

## Federated discovery

Federated discovery accepts immutable Catalog-root descriptions. It never opens a network connection or mutates a root. Available and permitted roots contribute matching Packs; unavailable or denied roots remain visible as explicit results. Every Pack retains its source Catalog digest and trust context. Two roots that claim the same Pack id and version with different digests cause a fail-closed identity conflict.

## Interoperability projections

The Engine generates JSON-LD, PROV-O-compatible JSON, RDF Turtle, OWL, and SHACL projections. External identity mappings are inactive evidence and multilingual terms retain provenance. If a requested semantic construct cannot be represented safely, the relevant projection is `NON_APPLICABLE` with a reason and no fabricated content.

## Terminal closure

`TerminalSemanticClosure/v1` binds:

- the immutable Project Ontology snapshot;
- one exact reasoning profile;
- one content-addressed index;
- the interoperability projection set;
- a passing round-trip and incremental/full-equivalence report;
- exact HarnessProfile, HarnessComponent, and HarnessBundle bindings.

The closure also requires exact dependency locks, evaluation bindings, rollback links, and generation provenance. The Candidate closure is not published. Publication requires the separate `semantic.closure.publish` operation and an exact `AUTHORIZED` publication record. The published closure remains consumer-read-only and grants no mutation, approval, publication, or Engine Release authority.

`semantic closure-slice` validates the exact published closure digest and returns only an offline read-only binding slice. It has no live Harness dependency and cannot mutate or advance any lifecycle.

## Atomic CLI examples

The Digital Expert and stdio MCP are the normal human interface. These CLI operations are intended for CI and diagnosis:

```bash
evopilot-harness semantic reasoning-profile --file reasoning-profile.yaml --workspace "$EVOPILOT_HARNESS_HOME" --json
evopilot-harness semantic index --snapshot snapshot.yaml --asset profile.yaml --asset component.yaml --workspace "$EVOPILOT_HARNESS_HOME" --json
evopilot-harness semantic affected-subgraph --index index.yaml --profile profile.yaml --changed-concept finance:account --cache-digest sha256:... --workspace "$EVOPILOT_HARNESS_HOME" --json
evopilot-harness semantic compute --index index.yaml --profile profile.yaml --mode FULL --workspace "$EVOPILOT_HARNESS_HOME" --json
evopilot-harness semantic federate --file federation-request.yaml --workspace "$EVOPILOT_HARNESS_HOME" --json
```

Always stop on digest drift, budget exhaustion, unavailable proof, identity conflict, permission denial, mixed context, or incremental/full mismatch.
