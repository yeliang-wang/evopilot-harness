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

The current v3 suite covers:

- read-only Engine behavior and writable Workspace isolation;
- Component, Profile, Bundle, Ontology, Matcher, Advisor, and Evaluation schemas;
- immutable Profile and Component digest closure;
- v2-to-v3 migration, non-mutating dry-run, applied journals, and rollback;
- exact migration id preservation on case-sensitive Linux filesystems, added in `3.0.1`;
- Harness eligibility, Ontology role preservation, candidate factors, negative boundaries, ambiguity, novelty, and unknown-domain proposals;
- protection against assigning a domain from shared execution-only concepts;
- evidence-backed existing-Profile evolution and cross-Profile Bundle composition;
- GLM citations, token accounting, replay, transport failure, and authority limits;
- independent Proposal Review verdicts, schema, evidence/source citation closure, product-boundary and corpus-membership output, report persistence, stale-report rejection, and approval blocking;
- attachment, runtime-log, note, local project, project-root, and GitHub evidence;
- nested-module deduplication, per-project reasoning, grouping, and merged Evidence Graphs;
- Catalog and Registry validation, immutable publication, optional signing, and tamper rejection;
- contract and safety evaluations with honest evidence-sufficiency status;
- Harness Hub v3 snapshot fields;
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
- EvoPilot or Dashboard behavior was not added to this repository;
- external validation corpora were not copied into the Harness asset library;
- no ECS deployment was inferred or required by the local-first release contract.

## Release Evidence

For a release, source acceptance is only one layer. Verify the tag, GitHub Release, uploaded source archive, SBOM, provenance, checksums, and immutable GHCR image separately before claiming the release chain is complete.
