# Ontology Grounding And Bundle Semantic Requirements

v4.6 adds a business-neutral semantic grounding layer between static Source evidence and optional HarnessBundle semantic requirements. It does not add a universal enterprise ontology and does not change Harness Eligibility, Proposal approval, publication, or runtime authority.

## Contracts

- `OntologyFoundation/v1`: the fixed Entity, Attribute, Relationship, Rule, Event, Action, Actor, Role, Permission, State, Workflow, Capability, System, and DataAsset meta-types, relation primitives, and resource bounds; no business values. Business objects, tasks, failures, recovery, validators, cases, alternatives, risks, and expected effects remain professional analysis facets rather than Foundation meta-types.
- `SemanticCandidateSet/v1`: evidence-bound candidates extracted from Source. LLM advice is recorded separately and cannot select authoritative identifiers.
- `OntologyGroundingResult/v1`: immutable six-outcome decision with evidence, uncertainty, explanation, and finite user actions.
- `HarnessSemanticRequirements/v1`: optional, versioned, digest-closed requirements embedded in an immutable HarnessBundle.
- `SemanticCompatibilityReport/v1`: `COMPATIBLE`, `INCOMPATIBLE`, or `INDETERMINATE`; never an Eligibility or publication verdict.

## Example flow

```text
static Source snapshot
  -> professional semantic candidates
  -> user/organization concept context
  -> deterministic grounding
  -> optional Bundle semantic requirements
  -> independent semantic compatibility report
  -> unchanged Eligibility, Proposal, review, approval, publication lifecycle
```

The resolver stops safely when evidence is weak, concepts conflict, or more than one authoritative concept remains possible. Adding or correcting evidence or concepts creates a new result bound to prior result digests; it does not overwrite history.

## Diagnostic commands

After `workspace init`, Agents and operators can inspect the same read-only Engine semantics:

```bash
evopilot-harness semantic foundation --workspace /absolute/workspace --json
evopilot-harness semantic candidates --workspace /absolute/workspace --hypothesis hypothesis.json --json
evopilot-harness semantic ground --workspace /absolute/workspace --candidate-set candidates.json --concepts concepts.yaml --json
evopilot-harness semantic compatibility --workspace /absolute/workspace --requirements requirements.yaml --grounding-result grounding.json --json
```

The corresponding MCP diagnostic operations are `semantic.foundation.inspect`, `semantic.candidates.inspect`, `semantic.grounding.inspect`, and `semantic.compatibility.inspect` through `run_engine_diagnostic`.

Project ontology artifacts, ontology Skills, multi-Pack governance, OWL/RDF/SWRL/SHACL exports, and external reasoners are not v4.6 capabilities.
