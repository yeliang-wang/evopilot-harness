# EvoPilot Harness Architecture

Start here when reviewing the current v3 system, repository boundaries, Catalog contracts, or compatibility.

- [Architecture Overview](overview.md) - current v3 modules, data flow, storage boundaries, and version axes.
- [v3 Product Boundary](v3-product-boundary.md) - narrowed product scope, ownership, and independent versions.
- [v3 Asset Model](v3-asset-model.md) - Component, Profile, Bundle, and supporting Packs.
- [ADR 0001: Product And Module Boundaries](adr/0001-product-and-module-boundaries.md) - accepted cross-project and 24 core Engine ownership rules.
- [ADR 0002: Agent-Native Harness Operations](adr/0002-agent-native-harness-operations.md) - five operating boundaries for Digital Expert, Adapters, MCP, Sessions, and external Agent hosts.
- [ADR 0003: Controlled Comparative Evidence](adr/0003-controlled-comparative-evidence.md) - four Engine boundaries for immutable comparison intake, paired scoring, rescoring, and calibration.
- [ADR 0004: Deterministic Business-Centric Agent Interaction](adr/0004-deterministic-business-centric-interaction.md) - Engine-owned Business Views, complete audit envelopes, Protocol v3, and replaceable Agent Host boundaries.
- [ADR 0005: Source-first Business Classification And Cumulative Harness Handoff](adr/0005-source-first-business-classification.md) - user-authored classification schemes, deterministic classification, Advisor non-authority, and explicit handoff to the retained producer lifecycle.
- [v3 Reasoning Contract](../reference/v3-reasoning-contract.md) - Evidence Graph, eligibility, matcher, and LLM authority.
- [Catalog Consumption Boundary](catalog-consumption-boundary.md) - legacy v2 boundary between publication and EvoPilot consumption.
- [Catalog Contract](../reference/catalog-contract.md) - published Catalog format and digest rules.
- [Registry Contract](../reference/registry-contract.md) - multi-Catalog discovery.
- [Selected Harness Binding](../reference/selected-harness-binding.md) - legacy v2 evidence EvoPilot records after matching.
- [v2 Architecture Compatibility](v2-compatibility.md) - legacy source pack, Catalog, and migration mapping.
- [Harness Template Contract](harness-template-contract.md) - legacy v2 template fields and validation rules.
