# EvoPilot Harness Agent Instructions

This repository is the independent Harness producer for the EvoPilot series. Ordinary human operation starts with the generated [Digital Expert Skill](.agents/skills/evopilot-harness-digital-expert/SKILL.md) and [Agent Quickstart](docs/agent/quickstart.md). Atomic CLI automation should also read [docs/cli/AGENTS.md](docs/cli/AGENTS.md).

Use [llms.txt](llms.txt) for the shortest machine-readable documentation map and [docs/README.md](docs/README.md) for the human documentation index.

## Roadmap Gate

- For any EvoPilot-series evolution triggered by a user goal, issue, benchmark, article, paper, report, or proposed Roadmap change, start with `$evopilot-evolution-orchestrator`. It is the conversational entry; repository Roadmaps and deterministic gates remain authoritative.
- Benchmark, LLM, and Subagent output is evidence only. It cannot revise this Roadmap, approve an Evolution Target, authorize implementation, or authorize release.
- Treat [EvoPilot Harness Roadmap](docs/roadmap/ROADMAP.md) and `governance/roadmap.yaml` as the accepted product-evolution plan.
- Before changing product behavior, architecture, contracts, CLI, schemas, versions, or release scope, run `npm run roadmap:gate -- --intent "<requested change>" --json` and report the result.
- Continue implementation only for `ALIGNED`. Stop on `UNPLANNED`, `DEVIATION`, `BOUNDARY_CHANGE`, or `UNKNOWN` and obtain explicit user review before editing.
- `BOUNDARY_CHANGE` always requires a replacement ADR, migration and compatibility impact, formal Roadmap revision, executable guard updates, and explicit user approval. A one-task exception is not sufficient.
- User approval of an unplanned one-task exception does not revise the Roadmap and cannot authorize a Release containing an undeclared Engine capability. User Organization Catalog assets continue to evolve through their independent lifecycle.
- Before product implementation, require an explicitly approved `evopilot-evolution-target/v1` bound to the current `roadmapDigest`, matched milestone or standing work, target version, scope, exclusions, and acceptance evidence. Roadmap digest drift returns the task to review.
- Implementation approval and successful acceptance do not authorize an Engine release. Release requires a separate user decision and passing Evolution Target release gate. Harness Asset publication retains its independent lifecycle and authority.
- Before commit or Release, run `npm run roadmap:check`; before a versioned Release, also run `npm run roadmap:release -- <version>`.

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
- The v4 release line makes a portable, question-driven Digital Expert the ordinary human entry and uses a local stdio MCP Harness Operation Server for Agent access. Atomic JSON CLI remains a compatibility, CI, and emergency-diagnostic surface.
- The v4 Digital Expert, Agent adapters, and MCP surface may operate the Engine but must not own Harness reasoning, Review verdicts, approval, publication authority, credentials, or runtime state.
- Engine, Asset, Ontology, Policy, Evaluation, Catalog, EvoPilot, and Dashboard versions are independent.
- Harness publication does not require an EvoPilot or Dashboard release.

## Confirmed Decisions

- Matching may expose `HarnessProfile` metadata, but downstream v3 execution must bind a published, immutable `HarnessBundle` with pinned dependencies and digests.
- Source ingestion is static. Do not execute source-project build, test, deploy, or business commands. Any future execution requires a separately reviewed isolated Evidence Runner and explicit operator authorization.
- Signing is optional under the current cross-project contract. Do not make signature verification mandatory without a replacement ADR and user approval.

## Module Ownership

The 24 core Engine module boundaries are defined in [ADR 0001](docs/architecture/adr/0001-product-and-module-boundaries.md):

1. Engine; 2. Workspace; 3. CLI; 4. Harness Hub; 5. Source Ingestion; 6. Snapshot/Redaction; 7. Evidence Graph.
8. OntologyPack; 9. MatchPolicyPack; 10. Eligibility Gate; 11. Candidate Retrieval/Scoring; 12. Decision Aggregator; 13. AdvisorPolicyPack; 14. GLM Advisor.
15. Proposal Review Engine; 16. HarnessComponent; 17. HarnessProfile; 18. HarnessBundle/Export; 19. EvaluationPack; 20. Proposal Lifecycle; 21. Schema Validator.
22. Catalog Publisher/Optional Signing; 23. Registry; 24. Migration/Rollback.

The four controlled comparative-evidence module boundaries are defined in [ADR 0003](docs/architecture/adr/0003-controlled-comparative-evidence.md): 25. Comparison Evidence Intake/Immutable Store; 26. Comparability/Paired Scoring; 27. Versioned Rescoring; 28. Matching/Proposal Calibration. Together they form 28 enforced Engine module boundaries.

No Engine module may bypass Proposal approval, write Built-in assets from evidence, give LLM authority, execute source-project commands, mutate active policy from calibration, overwrite comparison history, or make Engine source files the runtime state store.

The five v4 operating-module boundaries are defined in [ADR 0002](docs/architecture/adr/0002-agent-native-harness-operations.md): Digital Expert Core, Agent Adapter, Harness Operation Server, AgentOperationSession, and External Agent Host. Together with the 28 Engine modules, the v4.1 release line has 33 enforced component/module boundaries.

- One Agent-neutral Core must generate every Adapter workflow and stop rule. Do not edit generated Adapter semantics directly.
- MCP tools may coordinate the Engine but cannot bypass Engine validation or Session human gates.
- Every Session mutation must bind the current `sessionDigest`; Plan, Review, approval, and publication each retain their own digest boundary.
- Publication remains a separate human decision after approval.
- Maintenance Catalog, Ontology, and Policy publication requires a separate operation authorization after Plan confirmation.
- Comparison and calibration reports are deterministic evidence. A Session must present the exact report and record a digest-bound acknowledgement before completion; acknowledgement is not approval, policy activation, rollback, or publication authorization.
- Baseline/Candidate evidence is comparable only under the exact governed task, source snapshot, environment, model, toolchain, Evaluation, scorer, metric, and asset bindings. Non-comparable contexts must remain stratified and must not produce a mixed aggregate.
- Rescoring is append-only. It may add a replacement report and rescore record but may not mutate accepted observations or prior reports.
- Calibration may recommend a matching or Proposal policy revision but may not mutate or activate the current policy.
- Planned Engine operations use stable idempotency receipts. After interruption, accept a matching receipt or explicitly retry only when the external Workspace digest is unchanged; never repeat an uncertain mutation.
- Session state belongs under the explicit external Workspace. Release, source, attachments, logs, and human-maintained model configuration remain read-only.

## Required Validation

Run after architecture, lifecycle, CLI, or documentation changes:

```bash
npm run roadmap:check
npm run digital-expert:check
npm run verify:architecture
npm run check
git diff --check
```

Treat [ADR 0001](docs/architecture/adr/0001-product-and-module-boundaries.md) as accepted. Crossing it requires an explicit replacement ADR, migration impact, executable guard updates, and user approval.

## Documentation Rules

- Keep `README.md` as a concise product entry; route operating detail to `docs/`.
- Keep generic architecture and lifecycle pages current for v3. Route legacy commands and models through explicit v2 compatibility pages.
- Verify commands, paths, versions, defaults, and response fields against source and tests before documenting them.
- Do not describe fixture results as general matching accuracy or production-readiness evidence.
- Do not expose `models.json`, credentials, signing private keys, source-project secrets, or unredacted logs.
- Do not add comparison or equivalence claims about an external reference project to public documentation.
