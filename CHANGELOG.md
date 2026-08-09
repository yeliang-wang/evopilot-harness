# Changelog

All notable changes to `evopilot-harness` are documented here.

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
