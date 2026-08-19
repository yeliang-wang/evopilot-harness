# v3 Acceptance Baseline

## Meaning Of 100 Percent

For the v3 line, 100 percent acceptance means every defined schema, safety, lifecycle, migration, Catalog, signature, UI, documentation, and compatibility gate in the current release passes. It does not mean unknown future domains can be classified with 100 percent accuracy or that fixture counts prove production coverage.

When independently reviewed matching evidence is insufficient, the correct result is `INSUFFICIENT_EVAL_EVIDENCE`.

## Automated Gates

```bash
node --check src/index.mjs
find src/v3 -name '*.mjs' -print0 | xargs -0 -n1 node --check
npm test
npm run v3:check
npm run check
git diff --check
```

`npm run v3:check` includes disposable-Workspace `feedback validate` and `feedback process` acceptance. The fixture is deleted with the Workspace and never enters a Catalog.

The current v3 suite covers:

- read-only Engine behavior and writable Workspace isolation;
- Component, Profile, Bundle, Ontology, Matcher, Advisor, and Evaluation schemas;
- AssetDeltaProposal for Component, Profile, Bundle, Ontology, Matcher Policy, Advisor Policy, and Evaluation changes;
- Feedback Package, Effectiveness Report, and EvaluationPack v1/v2/v3 schemas;
- portable positive/negative Evaluation cases with context, assertions, pinned validators/scorers, baselines, expected outcomes, and regression boundaries;
- feedback approval, redaction, time, integrity, immutable Bundle closure, idempotency, conflict, and rejection gates;
- Bundle/Profile/Component/version effectiveness aggregation across Outcome, Process, Safety, and Cost, including samples, sources, contexts, missing fields, and uncertainty;
- immutable Profile and Component digest closure;
- v2-to-v3 migration, non-mutating dry-run, applied journals, and rollback;
- exact migration id preservation on case-sensitive Linux filesystems, added in `3.0.1`;
- Harness eligibility, Ontology role preservation, candidate factors, negative boundaries, ambiguity, novelty, and unknown-domain evidence stops;
- five-way Delta decisions with deterministic `NO_CHANGE` and `NEED_MORE_EVIDENCE` publication blocking;
- exact before/after state, change evidence, compatibility, dependencies, blast radius, expected effect, regression, and rollback closure;
- protection against assigning a domain from shared execution-only concepts;
- evidence-backed existing-Profile evolution and cross-Profile Bundle composition;
- GLM citations, token accounting, replay, transport failure, and authority limits;
- independent Proposal Review verdicts, schema, evidence/source citation closure, product-boundary and corpus-membership output, report persistence, stale-report rejection, and approval blocking;
- attachment, runtime-log, note, local project, project-root, and GitHub evidence;
- nested-module deduplication, per-project reasoning, grouping, and merged Evidence Graphs;
- Catalog and Registry validation, immutable publication, optional signing, and tamper rejection;
- contract and safety evaluations with honest evidence-sufficiency status;
- Harness Hub v3 snapshot fields, feedback projection, and non-GET 405 enforcement;
- retained v2 compatibility behavior.

Exact fixture and asset counts are release implementation evidence, not a claim that those counts represent all domains or user projects.

## Manual Browser Gate

```bash
node src/index.mjs hub v3-serve \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --host 127.0.0.1 \
  --port 4176
```

Verify:

- `/api/health`, `/api/hub/snapshot`, and `/api/v3/snapshot`;
- desktop and mobile layouts without overlap or clipped text;
- Component, Profile, Bundle, Proposal, Pack, Catalog, and Evaluation views;
- GLM Advisor run count and aggregate token usage without raw keys;
- source-type visibility without unredacted source content;
- generated `produce` command and review-oriented `nextAction`;
- no browser-local approval or publication authority.

## Boundary Gate

Acceptance also requires a clean ownership audit:

- evidence and tests did not generate or overwrite Built-in assets;
- source ingestion did not execute project commands;
- GLM did not approve, publish, mutate configuration, or override deterministic decisions;
- Proposal Review Engine did not approve, publish, execute source code, invent evidence, or override failed deterministic gates;
- immutable published versions were not overwritten;
- publication preflight prevented partial asset, Evaluation, or Delta writes on immutable-path conflicts;
- Feedback processing did not create a Proposal, mutate a Catalog asset, publish an asset, execute a Goal Loop, or run source projects;
- EvoPilot or Dashboard behavior was not added to this repository;
- external validation corpora were not copied into the Harness asset library;
- no ECS deployment was inferred or required by the local-first release contract.
- no v4.1 Pairwise/Champion-Challenger or v4.2 long-horizon learning capability was introduced; the planned v4.0 Agent-native operating model is also not part of v3 acceptance.

## Release Evidence

For a release, source acceptance is only one layer. Verify the tag, GitHub Release, uploaded source archive, SBOM, provenance, checksums, and immutable GHCR image separately before claiming the release chain is complete.
