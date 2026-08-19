# EvoPilot Harness Documentation

Use this index to choose the shortest path for your task. Generic architecture and lifecycle pages describe the current v3 product; legacy behavior is routed through explicit v2 compatibility pages.

## Learn The Product

1. [Product Roadmap](roadmap/ROADMAP.md) - accepted production-feedback, asset-quality, Agent-native operations, version, and deviation plan.
2. [How Harness Works](guides/how-harness-works.md) - management, evolution, reasoning, sources, publication, and control-plane consumption.
3. [Architecture Overview](architecture/overview.md) - current v3 modules, data flow, storage, and system boundary.
4. [v3 Asset Model](architecture/v3-asset-model.md) - Component, Profile, Bundle, and governance Packs.
5. [v3 Product Boundary](architecture/v3-product-boundary.md) - what this project owns and explicitly does not own.
6. [ADR 0002: Agent-Native Harness Operations](architecture/adr/0002-agent-native-harness-operations.md) - accepted and implemented v4 candidate operating model.

## Operate Through An Agent

- [Agent-Native Quickstart](agent/quickstart.md) - ordinary human path through a Digital Expert and local stdio MCP.
- [Digital Expert](agent/digital-expert.md) - portable Core, Adapter generation, imports, authority, and support claims.
- [MCP Reference](agent/mcp-reference.md) - process, protocol, tools, resources, errors, and safety gates.
- [Agent Operation Session](agent/session-protocol.md) - persisted state, digests, recovery, cross-Agent resume, and cleanup.
- [v4 Acceptance](operations/v4-acceptance.md) - deterministic, process, protocol, lifecycle, integrity, and compatibility evidence.

## Produce And Publish

- [CLI Quickstart](cli/quickstart.md) - initialize a Workspace and reach a review-stage Proposal.
- [v3 Production Lifecycle](guides/v3-production-lifecycle.md) - single project, project root, GitHub, attachments, logs, review, approval, and publication.
- [CLI Commands](cli/commands.md) - complete atomic command reference.
- [Harness Hub](guides/harness-hub-integration.md) - standalone UI and optional iframe integration.
- [v3 Reasoning Contract](reference/v3-reasoning-contract.md) - eligibility, retrieval, scoring, decisions, Proposal Review Engine, and GLM authority.
- [Asset Delta And Evaluation](guides/asset-delta-and-evaluation.md) - typed before/after changes, portable v3 cases, impact closure, terminal decisions, and lifecycle gates.
- [Feedback Evidence](guides/feedback-evidence.md) - structured feedback contract, validation, ingestion, four-dimensional effectiveness, and authority limits.

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

Normative Engine product and module ownership is defined by [ADR 0001](architecture/adr/0001-product-and-module-boundaries.md). Agent-native operating boundaries are defined by [ADR 0002](architecture/adr/0002-agent-native-harness-operations.md). The current published Engine baseline is v4.0.1.
