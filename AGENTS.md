# EvoPilot Harness Agent Instructions

This repository is the independent Harness producer for the EvoPilot series. CLI operators should also read [docs/cli/AGENTS.md](docs/cli/AGENTS.md).

## Accepted Product Boundary

- `evopilot-harness` owns Harness evidence ingestion, reasoning, authoring, evolution, review, approval, evaluation, publication, Catalog/Registry, CLI, and Harness Hub.
- EvoPilot owns third-party-project onboarding, project-to-Harness matching, goal-loop execution, project evidence, and project release decisions.
- evopilot-dashboard may embed Harness Hub but must not own Harness lifecycle state.
- EvoPilot is a dynamic, read-only consumer. Do not add EvoPilot API calls or project-loop execution to this repository.
- Registry lists Catalog roots; each Catalog lists its own published assets. Do not duplicate asset entries in Registry.
- Source projects, corpora, GitHub repositories, attachments, logs, historical Harnesses, notes, research, and tests are Evidence Sources only.
- Produce and Proposal generation never publish. Only explicit review, approval, validation, and publication may write Organization Catalog assets.
- Evidence Sources and tests must never generate, overwrite, or publish Built-in Catalog assets.
- LLM Advisor is advisory only and cannot execute, approve, publish, mutate models, invent evidence, or override gates.
- Engine, Asset, Ontology, Policy, Evaluation, Catalog, EvoPilot, and Dashboard versions are independent.
- Harness publication does not require an EvoPilot or Dashboard release.

## Confirmed Decisions

- Matching may expose `HarnessProfile` metadata, but downstream v3 execution must bind a published, immutable `HarnessBundle` with pinned dependencies and digests.
- Source ingestion is static. Do not execute source-project build, test, deploy, or business commands. Any future execution requires a separately reviewed isolated Evidence Runner and explicit operator authorization.
- Signing is optional under the current cross-project contract. Do not make signature verification mandatory without a replacement ADR and user approval.

## Module Ownership

The 23 accepted module boundaries are defined in [ADR 0001](docs/architecture/adr/0001-product-and-module-boundaries.md):

1. Engine; 2. Workspace; 3. CLI; 4. Harness Hub; 5. Source Ingestion; 6. Snapshot/Redaction; 7. Evidence Graph.
8. OntologyPack; 9. MatchPolicyPack; 10. Eligibility Gate; 11. Candidate Retrieval/Scoring; 12. Decision Aggregator; 13. AdvisorPolicyPack; 14. GLM Advisor.
15. HarnessComponent; 16. HarnessProfile; 17. HarnessBundle/Export; 18. EvaluationPack; 19. Proposal Lifecycle; 20. Schema Validator.
21. Catalog Publisher/Optional Signing; 22. Registry; 23. Migration/Rollback.

No module may bypass Proposal approval, write Built-in assets from evidence, give LLM authority, execute source-project commands, or make Engine source files the runtime state store.

## Required Validation

Run after architecture, lifecycle, CLI, or documentation changes:

```bash
npm run verify:architecture
npm run check
git diff --check
```

Treat [ADR 0001](docs/architecture/adr/0001-product-and-module-boundaries.md) as accepted. Crossing it requires an explicit replacement ADR, migration impact, executable guard updates, and user approval.
