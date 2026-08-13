# Changelog

All notable changes to `evopilot-harness` are documented here.

## 3.3.0 - 2026-08-13

### Added

- Added the `HarnessExecutionFeedbackPackage v1` contract for approved, redacted, time-bounded, provenance-bearing execution evidence bound to a published immutable Bundle, Profile, and complete Component closure.
- Added Package and redacted-payload integrity checks, content-addressed idempotent ingestion, package-id conflict rejection, and persisted rejection/event records under the external Workspace.
- Added `HarnessEffectivenessReport v1` aggregation by Bundle, Profile, Component, and version across Outcome, Process, Safety, and Cost.
- Added sample count, independent source count, execution context, missing-field accounting, uncertainty levels, and Wilson 95% intervals to effect claims.
- Added `EvaluationPack v2` four-dimensional feedback criteria while preserving EvaluationPack v1 validation.
- Added JSON-first `feedback inspect|validate|ingest|aggregate|report|process` CLI commands and Harness Hub read-only feedback projections.
- Added a machine-enforced Roadmap Gate for intent and release-version alignment.

### Boundaries

- Feedback is Evidence Source state, not a Catalog asset. Processing never creates a Proposal, mutates or publishes Harness assets, executes Goal Loops, or runs source projects.
- v3.3.0 does not implement pairwise experiments, automatic delta reasoning, approval, publication, or model training; those remain outside this milestone.
- Contract fixtures validate the consumer side. Cross-project production closure requires a compatible control plane to export real approved packages.

### Validation

- `npm run roadmap:check`
- `npm run roadmap:release -- 3.3.0`
- `npm run verify:architecture`
- `npm run check`
- `npm run release:artifact`
- `npm run verify:release-artifact`
- `git diff --check`

## 3.2.1 - 2026-08-12

### Fixed

- Aligned Proposal Review prompts, Policy, Schema, and runtime validation so source-derived conclusions require Evidence Graph citations while Catalog-, Proposal-, definition-, and evaluation-derived conclusions may honestly use empty `evidenceIds`.
- Normalized string-form semantic definition-quality checks into structured report objects before Schema validation.
- Added an explicit 8192-token structured Review output budget and a production-shaped GLM response regression test.
- Preserved fail-closed behavior for missing source citations, unknown evidence ids, incomplete source membership, malformed JSON, and exhausted bounded repair.

### Validation

- `python3 .agents/skills/evopilot-harness-guided-operator/scripts/self_test.py`
- `node --test tests/v3.test.mjs`
- `npm run check`
- `npm run release:artifact`
- `npm run verify:release-artifact`
- Live GLM doctor, required Advisor, and Proposal Review from an isolated published-source Workspace
- `git diff --check`

## 3.2.0 - 2026-08-12

### Added

- Added a formal Proposal Review Engine with deterministic gates, independent evidence-bound GLM review, structured verdict synthesis, persisted reports, Schema validation, digests, model usage, and authority limits.
- Added `proposal inspect` and `proposal review-inspect` to separate raw draft inspection, review execution, and report inspection.
- Added Hub Review status, verdict, report digest, and review-driven next-action fields.

### Changed

- `proposal review` now executes product review instead of returning `proposal.yaml`.
- `proposal approve` now requires a current, valid `READY_FOR_HUMAN_APPROVAL` report and still requires separate human approval.
- Guided Operator automatically executes and presents every Proposal Review Report after production; it no longer asks whether the user wants to view reviews and cannot invent business conclusions.
- Advisor Policy `1.2.0` adds a separate Proposal Review Contract while preserving LLM authority limits.

### Validation

- `python3 .agents/skills/evopilot-harness-guided-operator/scripts/self_test.py`
- `node --test tests/v3.test.mjs`
- `npm test`
- `npm run v3:check`
- `npm run check`
- `npm run release:artifact`
- `npm run verify:release-artifact`
- `git diff --check`

## 3.1.0 - 2026-08-12

### Added

- Added `llm v3-doctor` to distinguish a configured GLM profile from verified live connectivity without exposing credentials; its minimal live request defaults to 60 seconds.
- Added a unified, redacted Advisor Run Contract for local projects, Source Roots, Git repositories, attachments, production logs, historical Harnesses, notes, and mixed evidence.
- Added persisted Advisor results for success, failure, rejection, unavailable, disabled, and policy-skipped outcomes, including request id, model, usage, validation, timing, retryability, failure type, and diagnostic reason.
- Added Source Root Advisor aggregation and regression coverage for successful and failed required Advisor runs.
- Added one Policy-bounded structure/citation repair for invalid JSON or rejected Advisor contracts, with per-attempt validation and aggregate token accounting.
- Added deterministic Advisor Evidence Projection for large Graphs, with Policy budgets, reasoning-first selection, source/kind coverage, immutable full-Graph retention, and projection audit metadata.
- Added an explicitly authorized `READ_ONLY_DIAGNOSTIC` state to the project-level guided Operator Skill.

### Changed

- `llm v3-models` now explicitly reports configuration-only readiness and points operators to `llm v3-doctor` for live verification.
- `produce --advisor required` now returns `BLOCKED` with a non-zero exit code when Advisor review fails, while retaining evidence and Proposal artifacts for diagnosis.
- Source Root production now returns `advisorSummary` and complete per-Proposal Advisor results instead of hiding group failure details behind `REVIEW_REQUIRED`.
- Separated timeout policies: full production Advisor reasoning defaults to 180 seconds, while the lightweight live doctor remains at 60 seconds; both retain explicit CLI overrides.
- Updated CLI, automation, lifecycle, architecture, release, and AI-agent documentation for the unified Advisor contract.

### Validation

- `python3 .agents/skills/evopilot-harness-guided-operator/scripts/self_test.py`
- `node --test tests/v3.test.mjs`
- `npm test`
- `npm run v3:check`
- `npm run check`
- `npm run release:artifact`
- `npm run verify:release-artifact`
- `git diff --check`

## 3.0.2 - 2026-08-11

### Documentation

- Reorganized the public documentation around the current v3 architecture and production lifecycle, with explicit v2 compatibility routes.
- Added governance, security, contributing, development, Release index, AI-agent discovery, and a real Harness Hub product screenshot.
- Clarified Engine versus user-asset release independence, local-first release boundaries, fixture limitations, and immutable Bundle consumption.
- Included root governance and AI-agent discovery files in verified source release archives.

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
