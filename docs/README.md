# EvoPilot Harness Documentation

Use this index to choose the shortest path for your task. Generic architecture and lifecycle pages describe the current v3 product; legacy behavior is routed through explicit v2 compatibility pages.

Current release: [`v4.1.2`](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v4.1.2), published on GitHub and as [`@evopilot/harness@4.1.2`](https://www.npmjs.com/package/@evopilot/harness/v/4.1.2). See [Release Notes](releases/4.1.2.md) for the documentation-system maintenance scope and publication contract.

## Learn The Product

1. [Product Roadmap](roadmap/ROADMAP.md) - accepted production-feedback, asset-quality, Agent-native operations, version, and deviation plan.
2. [How Harness Works](guides/how-harness-works.md) - management, evolution, reasoning, sources, publication, and control-plane consumption.
3. [Architecture Overview](architecture/overview.md) - current v3 modules, data flow, storage, and system boundary.
4. [v3 Asset Model](architecture/v3-asset-model.md) - Component, Profile, Bundle, and governance Packs.
5. [v3 Product Boundary](architecture/v3-product-boundary.md) - what this project owns and explicitly does not own.
6. [ADR 0002: Agent-Native Harness Operations](architecture/adr/0002-agent-native-harness-operations.md) - accepted and released v4 operating model.
7. [ADR 0003: Controlled Comparative Evidence](architecture/adr/0003-controlled-comparative-evidence.md) - immutable comparison, paired scoring, rescoring, calibration, and authority boundaries.

## Operate Through An Agent

- [Agent-Native Quickstart](agent/quickstart.md) - ordinary human path through a Digital Expert and local stdio MCP.
- [Digital Expert](agent/digital-expert.md) - portable Core, Adapter generation, imports, authority, and support claims.
- [MCP Reference](agent/mcp-reference.md) - process, protocol, tools, resources, errors, and safety gates.
- [Agent Operation Session](agent/session-protocol.md) - persisted state, digests, recovery, cross-Agent resume, and cleanup.
- [npm Distribution](operations/npm-distribution.md) - exact-version installation, package boundary, Agent bootstrap, WorkBuddy startup, Trusted Publishing, and Registry verification.
- [npm First-Publication Release Review](operations/npm-first-publication-review.md) - one-time package creation, external npm account configuration, stop rules, and mandatory OIDC handoff.
- [v4.1.2 Acceptance](operations/v4.1.2-acceptance.md) - documentation synchronization, drift guards, package, regression, artifact, and release-gate evidence.
- [v4.2.0 Candidate Acceptance](operations/v4.2.0-acceptance.md) - Target revision 2's 15 criteria, professional-learning contracts, installed-package and real WorkBuddy evidence, compatibility, security, and release boundary.
- [v4.2.3 Candidate Acceptance](operations/v4.2.3-acceptance.md) - Harness LLM initialization closure, 18 passing criteria, real WorkBuddy candidate-package evidence, and mandatory post-release public-package verification.
- [Agent Host Production Simulator Acceptance](operations/agent-host-production-simulator-acceptance.md) - Target revision 1's host-neutral Skill, WorkBuddy profile, public-Release Host run, authority boundaries, and 15 acceptance criteria.
- [v4.1.1 Acceptance](operations/v4.1.1-acceptance.md) - historical npm OIDC repair, package, regression, artifact, and release-gate evidence.
- [v4.1 Acceptance](operations/v4.1-acceptance.md) - controlled-comparison, calibration, package, protocol, lifecycle, integrity, and compatibility evidence.
- [v4.0 Acceptance](operations/v4-acceptance.md) - historical Agent-native baseline evidence.

## Produce And Publish

- [CLI Quickstart](cli/quickstart.md) - initialize a Workspace and reach a review-stage Proposal.
- [v3 Production Lifecycle](guides/v3-production-lifecycle.md) - single project, project root, GitHub, attachments, logs, review, approval, and publication.
- [CLI Commands](cli/commands.md) - complete atomic command reference.
- [Harness Hub](guides/harness-hub-integration.md) - standalone UI and optional iframe integration.
- [v3 Reasoning Contract](reference/v3-reasoning-contract.md) - eligibility, retrieval, scoring, decisions, Proposal Review Engine, and GLM authority.
- [Asset Delta And Evaluation](guides/asset-delta-and-evaluation.md) - typed before/after changes, portable v3 cases, impact closure, terminal decisions, and lifecycle gates.
- [Feedback Evidence](guides/feedback-evidence.md) - structured feedback contract, validation, ingestion, four-dimensional effectiveness, and authority limits.
- [Controlled Comparative Evidence](guides/controlled-comparative-evidence.md) - Baseline/Candidate contracts, exact-context comparison, immutable rescoring, policy calibration, Agent flow, and CLI.
- [Professional Asset Learning](guides/professional-asset-learning.md) - v4.2 candidate contracts for static research, curriculum, run manifests, completeness vectors, contributions, domain/role evidence, Agent flow, and authority boundaries.

## Integrate A Consumer

- [How Harness Works](guides/how-harness-works.md#6-how-a-control-plane-uses-a-published-harness) - current v3 immutable Bundle consumption boundary.
- [Catalog Contract](reference/catalog-contract.md) - Catalog structure and validation.
- [Registry Contract](reference/registry-contract.md) - multi-Catalog discovery.
- [Catalog Consumption Boundary](architecture/catalog-consumption-boundary.md) - legacy v2 producer/consumer contract.
- [Selected Harness Binding](reference/selected-harness-binding.md) - legacy v2 selection evidence.
- [EvoPilot Integration](guides/evopilot-integration.md) - legacy v2 Registry and Catalog environment contract.

## Operate And Develop

- [Workspace And Migration](operations/v3-workspace.md)
- [Testing](operations/testing.md)
- [v3 Acceptance Baseline](operations/v3-acceptance.md)
- [Deployment](operations/deployment.md)
- [Release Management](operations/release-management.md)
- [Troubleshooting](operations/troubleshooting.md)
- [Development](development.md)
- [`scripts/roadmap-gate.mjs`](../scripts/roadmap-gate.mjs) - deterministic Roadmap contract, intent, and release-version gate used by agents and CI.
- [Security](../SECURITY.md)
- [Contributing](../CONTRIBUTING.md)

## Atomic CLI And AI Automation

- [Agent Instructions](cli/AGENTS.md) - required stop rules and reporting fields.
- [Automation Contract](cli/automation.md) - JSON parsing and safe orchestration.
- [CLI Workflows](cli/workflows.md) - review-gated operating scenarios.
- [Scenario Coverage](guides/ai-agent-scenarios.md) - human and agent end-to-end paths.
- [`llms.txt`](../llms.txt) - compact machine-readable discovery map.

## Compatibility And History

- [v2 Compatibility Guide](guides/v2-compatibility.md) - operate or migrate legacy automation.
- [v2 Architecture Compatibility](architecture/v2-compatibility.md) - legacy model and v3 mapping.
- [Legacy Source-To-Harness](guides/source-to-harness.md) and [Harness Evolution](guides/harness-evolution.md) - detailed v2 behavior.
- [Release Notes](releases/README.md) - versioned shipped behavior and validation.

Normative Engine product and module ownership is defined by [ADR 0001](architecture/adr/0001-product-and-module-boundaries.md) and extended for controlled comparative evidence by [ADR 0003](architecture/adr/0003-controlled-comparative-evidence.md). Agent-native operating boundaries are defined by [ADR 0002](architecture/adr/0002-agent-native-harness-operations.md). The current Engine and public npm version is v4.1.2. GitHub Release, npm, and optional GHCR publication are independently verified distribution layers; do not infer one from another.
