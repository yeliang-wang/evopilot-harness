# Changelog

All notable changes to `evopilot-harness` are documented here.

## 3.0.1 - 2026-08-10

### Fixed

- Made v2-to-v3 migration journal ids and rollback lookup consistent on case-sensitive Linux filesystems.
- Preserved exact legacy journal ids during rollback while rejecting path traversal input.

### Validation

- `npm test`
- `npm run v3:check`
- `npm run check`
- `npm run release:artifact`
- `npm run verify:release-artifact`
- `git diff --check`

## 3.0.0 - 2026-08-10

### Added

- Added product-neutral `HarnessComponent`, `HarnessProfile`, and immutable `HarnessBundle` assets with formal JSON Schemas.
- Added versioned `OntologyPack`, `MatchPolicyPack`, `AdvisorPolicyPack`, and `EvaluationPack` governance assets.
- Added a read-only Engine plus configurable `EVOPILOT_HARNESS_HOME` Workspace model.
- Added `produce` for local projects, project roots, GitHub repositories, attachments, logs, historical Harnesses, notes, and controlled research.
- Added redacted Evidence Graphs, Harness Eligibility Gate, BM25 retrieval, seven-factor scoring, negative conflicts, novelty, and deterministic v3 decisions.
- Added evidence-bound GLM Advisor review with citation validation, token usage, policy/ontology versions, prompt/response digests, replay records, and enforced authority limits.
- Added Profile/Bundle Proposal review, approval, evaluation review, immutable publication, Catalog/Registry validation, Ed25519 signatures, and Hub v3 views.
- Added v2-to-v3 dry-run/apply/rollback and generated v3 Profiles/Bundles for all nine legacy templates.
- Added v3 contract, adversarial, lifecycle, migration, source, signature, and Hub tests while preserving all v2 compatibility tests.

### Changed

- Narrowed the product from broad software classification to Harness eligibility, candidate relationships, and evolution decisions for repeatable engineering tasks.
- Moved v3 domain concepts, roles, weights, thresholds, risk rules, and Advisor prompt out of matcher code into versioned assets.
- Changed unknown domains to reviewed Profile Proposals instead of automatically published Harnesses.
- Decoupled Engine, Harness asset, Ontology, Policy, Evaluation, and Catalog versions.
- Made EvoPilot format an optional Bundle export rather than the canonical v3 asset.

### Validation

- `npm test`
- `npm run v3:check`
- `npm run check`
- `npm run release:artifact`
- `npm run verify:release-artifact`
- `git diff --check`

## 2.1.0 - 2026-08-10

### Added

- Added `--github-repo`, `--github-ref`, `--github-cache-root`, and `--github-depth` source inputs for `detect`, `evolve`, and `evolution create`.
- Added GitHub repository source coverage with repository, ref, resolved commit, and local cache path metadata.
- Added credential rejection for GitHub HTTPS URLs and documented SSH/local credential usage.
- Added generated `definitionQuality` guidance to Harness drafts so the next evolution target remains more accurate, professional, and fine-grained Harness definitions.
- Added LLM Advisor definition-quality advice in the prompt and response contract.
- Added `docs/guides/how-harness-works.md`, an OpenHands-style technical overview that explains Harness management, evolution, matching, source inputs, publication attributes, and EvoPilot control-plane consumption in one reader path.

### Changed

- Updated README and documentation indexes so new users, administrators, and AI agents can start from the Harness operating model before jumping into CLI and reference contracts.
- Updated CLI, workflow, testing, and source-to-harness docs for GitHub repository sources and definition-quality goals.
- Preserved the Harness Asset v2, Source Profile v2, Auto-Match v2, Catalog v2, and Registry contracts.

### Validation

- `node --check src/index.mjs`
- `npm run check`
- `npm run release:artifact`
- `npm run verify:release-artifact`
- `git diff --check`

## 2.0.0 - 2026-08-10

### Added

- Added Harness Asset v2 with `apiVersion: evopilot.dev/v2`, `kind: HarnessAsset`, metadata, embedded template, match/execution/evidence/lifecycle sections, quality conditions, relations, and provenance.
- Added `asset inspect` and `asset validate` for source packs and published Catalog directories.
- Added Catalog v2 fields for asset paths, asset digests, asset API metadata, quality reports, and publication provenance.
- Added Source Profile v2 scanner evidence, scanner summary, runtime-log signals, sensitive-material signals, and uncertainty reasons.
- Added Auto-Match v2 candidate retrieval, conflicts, uncertainty, review gates, and decision evidence.
- Added unknown-source matching eval fixtures and the `eval run` release gate.
- Added LLM Advisor replay fixtures and the `llm replay` release gate.
- Added read-only CodeBuddy-style `models.json` support for LLM Advisor model selection.
- Added `llm models` inspection output with selected profile metadata, provider/model visibility, and API-key redaction.
- Added `models.example.json` while ignoring real local `models.json` secrets.

### Changed

- Changed `npm run check` to validate Harness Assets, run unknown-source evals, and replay Advisor cases before docs and node tests.
- Changed published Catalog output to write `asset.yaml` beside each published `template.yaml`.
- Changed `asset validate --source published` to support the published `<harness-id>/<version>` directory shape.
- Changed detect/evolve/corpus responses to expose v2 matching metadata while preserving review and approval gates.
- Changed LLM Advisor control to optional by default: deterministic matching still runs when no configured model is available, while `--llm-advisor required` blocks on missing or failed model calls.
- Default model selection now prefers a manually configured GLM profile and falls back to built-in EvoPilot GLM metadata.

### Validation

- `node --check src/index.mjs`
- `npm test`
- `npm run check`
- `npm run release:artifact`
- `npm run verify:release-artifact`
- `git diff --check`

## 1.4.0 - 2026-08-10

### Added

- Added the source-root Corpus Lifecycle: `corpus scan`, `corpus plan`, `corpus list`, `corpus review`, `corpus approve`, and `corpus publish`.
- Added one-command root-directory evolution through `evolve corpus --source-root <path>`.
- Added grouped Harness draft generation with target Harness grouping, nested module dedupe, representative project selection, strict draft validation, approval, and batch publication.
- Added Corpus state storage under `.evopilot-harness/corpora/<corpus-id>/` and draft output under `.evopilot-harness/corpora/<corpus-id>/drafts/<target-harness-id>/`.
- Added Harness Hub snapshot visibility for recent corpus runs and corpus lifecycle commands.

### Changed

- Kept single-project `detect`, `detect batch`, `evolve`, and atomic `evolution` commands compatible while reusing the same detection, Source Profile, LLM Advisor, draft generation, validation, and publication primitives for corpus runs.
- Updated CLI, automation, quickstart, workflows, source-to-harness, testing, and release documentation for both human operators and AI Agents.

### Validation

- `node --check src/index.mjs`
- `npm test`
- `npm run check`
- `git diff --check`

## 1.3.0 - 2026-08-09

### Added

- Added Harness Detect Algorithm v1 with `detect` and `detect batch` CLI commands.
- Added deterministic Source Profile generation for languages, build tools, frameworks, dependencies, imports, symbols, architecture signals, source roles, negative signals, and sensitive material findings.
- Added Template Quality Standard v1 with strict validation for `productBoundary`, `matchPolicy`, `executionModel`, `evidenceContract`, `qualityGate`, and domain execution.
- Added an external sample validation script for local historical project corpora without copying those projects into Harness templates.

### Changed

- Updated `evolve` to reuse the detect profile and auto-match result before draft generation.
- Updated source Harness templates with richer product boundaries, match policies, execution models, evidence contracts, and quality gates.
- Raised the default deterministic match threshold from `0.08` to `0.45`.
- Documented the `CREATE_NEW_WITH_PARENT_REFERENCE` and `REVIEW_REQUIRED` decisions for narrow-domain Harness evolution.

### Validation

- `node --check src/index.mjs`
- `npm test`
- `npm run check`
- `node scripts/validate-howbuy-samples.mjs --source-root /Users/wangyejing/project/howbuy_project --source harnesses`
- `git diff --check`

## 1.2.0 - 2026-08-09

### Added

- Added multi-Catalog Registry support through `registry publish` and `registry validate`.
- Added Registry-aware Harness Hub snapshots.

### Changed

- Clarified that `harness-registry.yaml` is a Catalog discovery layer and must not duplicate per-Catalog Harness entries.

### Validation

- `npm run check`
- `npm run release:artifact`
- `npm run verify:release-artifact`
- `git diff --check`

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
