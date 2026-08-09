# Changelog

All notable changes to `evopilot-harness` are documented here.

## 1.1.1 - 2026-08-09

### Added

- Added a complete `docs/` technical documentation tree for humans, AI agents, CLI automation, architecture review, EvoPilot integration, Harness Hub embedding, operations, and reference contracts.
- Added `docs/cli/AGENTS.md` as the shortest safe entry point for WorkBuddy, Codex, Claude Code, CI jobs, and other command-line agents.
- Added a local Markdown link checker and wired it into `npm run check`.

### Changed

- Reworked the root README into a compact public product entry with quick start, capability routing, architecture overview, and documentation links.
- Clarified that `evopilot-harness` remains the Harness lifecycle system of record while EvoPilot reads published Catalog directories dynamically.

### Validation

- `npm run check`
- `git diff --check`
- Harness Hub `/api/hub/snapshot` smoke on a local port

## 1.1.0 - 2026-08-09

### Added

- Added the independent Harness Hub / 专家市场 UI owned by `evopilot-harness`.
- Added `hub serve` and `hub snapshot` commands for browser operation and AI Agent-readable state.
- Added Docker, Compose, GitHub Actions CI, release artifacts, SBOM, provenance, checksum, and GHCR image metadata support.

### Changed

- Kept Harness lifecycle, evolution, approval, versioning, publication, CLI, and UI fully independent from EvoPilot and Dashboard.
- Preserved the published `CATALOG.md` directory contract consumed by EvoPilot `>=3.0.0`.

### Validation

- `npm run check`
- `npm run release:artifact`
- `npm run verify:release-artifact`
- `git diff --check`

## 1.0.0 - 2026-08-09

### Changed

- Promoted `evopilot-harness` to the owner of Harness lifecycle, evolution, approval, versioning, and publication.
- Changed the EvoPilot integration boundary to read-only Catalog directory consumption through `EVOPILOT_HARNESS_CATALOG_DIRS`.
- Removed user-facing guidance that depended on EvoPilot-side Harness import, mount, template, profile, policy, or evolution CLI commands.
- Published Catalogs are now compatible with EvoPilot `>=3.0.0`.

### Added

- Added `harness list`, `harness inspect`, `harness validate`, `harness publish`, and `harness deprecate` lifecycle commands.
- Added `evolution create`, `sources`, `advance`, `review`, `approve`, `publish`, and `impact` atomic commands.
- Added one-command `evolve` flow for source-project or material driven Harness evolution.
- Added source coverage, auto-match, draft generation, approval, publication, and impact result schemas for AI Agent automation.

### Validation

- `npm test`
- `npm run catalog:publish`
- `npm run catalog:validate`

## 0.1.0 - 2026-08-09

### Added

- Created the independent EvoPilot-compatible Harness project.
- Added Catalog publisher and validator CLI commands.
- Added the published `CATALOG.md` offline directory contract for EvoPilot `>=2.5.0`.
- Added domain Harness packs for database products, API gateways, and distributed cache products, plus runtime baseline packs for Python, Java, Node, Go, observability, and generic management software.

### Validation

- `npm test`
- `npm run catalog:publish`
- `npm run catalog:validate`
