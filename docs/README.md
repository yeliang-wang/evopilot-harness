# EvoPilot Harness Documentation

`evopilot-harness` documentation is organized by reader task. Start from the section that matches what you need to do.

## New Users

- [v3 Product Boundary](architecture/v3-product-boundary.md) - precise scope, ownership, and version independence.
- [v3 Asset Model](architecture/v3-asset-model.md) - Component, Profile, Bundle, and supporting Packs.
- [v3 Production Lifecycle](guides/v3-production-lifecycle.md) - source-to-proposal-to-signed-Catalog flow.
- [v3 Reasoning Contract](reference/v3-reasoning-contract.md) - eligibility, BM25, scoring, LLM boundary, and decisions.
- [How Harness Works](guides/how-harness-works.md) - OpenHands-style overview of management, evolution, matching, source inputs, publication, and control-plane consumption.
- [CLI Quickstart](cli/quickstart.md) - shortest local path to publish a Catalog, validate it, and run the Harness Hub.
- [Harness Hub Integration](guides/harness-hub-integration.md) - run the standalone browser UI and embed it from another dashboard.
- [Source Harness Packs](../harnesses/README.md) - current source pack model and publish commands.
- [Published Catalog](../published/CATALOG.md) - generated Catalog directory that EvoPilot can read.

## AI Agents And CLI Automation

- [CLI Agent Instructions](cli/AGENTS.md) - shortest safe entry point for WorkBuddy, Codex, Claude Code, CI, and other command-line agents.
- [CLI Automation](cli/automation.md) - JSON parsing, stop rules, and reporting fields.
- [CLI Commands](cli/commands.md) - atomic command reference.
- [CLI Workflows](cli/workflows.md) - one-command and review-gated Harness evolution scenarios.
- [AI Agent Scenario Coverage](guides/ai-agent-scenarios.md) - end-to-end simulation paths for agents and humans.

## Harness Administrators

- [How Harness Works](guides/how-harness-works.md) - plain-language technical model for humans and AI agents.
- [Source To Harness](guides/source-to-harness.md) - convert source projects, attachments, logs, and notes into a Harness draft.
- [Harness Evolution](guides/harness-evolution.md) - lifecycle from source collection through approval and publication.
- [Template Schema](reference/template-schema.md) - template v2, Harness Asset v2 envelope, Template Quality Standard v1 fields, and strict validation.
- [Registry Contract](reference/registry-contract.md) - `harness-registry.yaml` discovery file and multi-Catalog rules.
- [Catalog Contract](reference/catalog-contract.md) - `CATALOG.md` block, directory shape, and validation rules.

## EvoPilot And Dashboard Integrators

- [Architecture](architecture/README.md) - architecture entry point.
- [Overview](architecture/overview.md) - system model and repository boundary.
- [Catalog Consumption Boundary](architecture/catalog-consumption-boundary.md) - how EvoPilot reads the Registry and published Catalog directories.
- [EvoPilot Integration](guides/evopilot-integration.md) - configure EvoPilot and verify selected Harness evidence.
- [Selected Harness Binding](reference/selected-harness-binding.md) - fields recorded by EvoPilot during goal planning.

## Production Operators

- [v3 Workspace And Migration](operations/v3-workspace.md) - read-only Engine, writable Workspace, Packs, and rollback.
- [v3 Acceptance Baseline](operations/v3-acceptance.md) - exact meaning of 100 percent acceptance.
- [Deployment](operations/deployment.md) - Docker, Compose, and process mode.
- [Release Management](operations/release-management.md) - release artifacts, tags, checksums, SBOM, and provenance.
- [Testing](operations/testing.md) - validation commands and expected boundaries.
- [Troubleshooting](operations/troubleshooting.md) - common failures and repair steps.

## Releases

- [3.0.0](releases/3.0.0.md)
- [2.1.0](releases/2.1.0.md)
- [2.0.0](releases/2.0.0.md)
- [1.4.0](releases/1.4.0.md)
- [1.3.0](releases/1.3.0.md)
- [1.2.0](releases/1.2.0.md)
- [1.1.1](releases/1.1.1.md)
- [1.1.0](releases/1.1.0.md)
- [1.0.0](releases/1.0.0.md)
- [0.1.0](releases/0.1.0.md)
