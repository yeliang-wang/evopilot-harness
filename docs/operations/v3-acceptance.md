# v3 Acceptance Baseline

## Meaning Of 100 Percent

For v3.0.0, 100 percent acceptance means every defined deterministic schema, safety, lifecycle, migration, Catalog, signature, UI, and compatibility check passes. It does not mean unknown future domains can be classified with 100 percent accuracy.

When reviewed matching evidence is too small, the product must report `INSUFFICIENT_EVAL_EVIDENCE`.

## Automated Gates

```bash
node --check src/index.mjs
find src/v3 -name '*.mjs' -print0 | xargs -0 -n1 node --check
npm test
npm run v3:check
npm run check
git diff --check
```

The v3 suite covers:

- read-only Engine behavior and writable Workspace isolation;
- Component, Profile, Bundle, Ontology, Matcher, Advisor, and Evaluation schemas;
- immutable reference and Component digest closure;
- nine v2 templates migrated into eighteen v3 assets;
- non-mutating migration and journal rollback;
- Redis-client versus distributed-cache-product negative-boundary handling;
- exact Ontology role preservation and substantive evidence-backed existing-Profile evolution;
- protection against assigning an arbitrary domain from shared execution-only concepts;
- unknown-domain Profile Proposal behavior;
- GLM evidence citations, token accounting, transport failure, and authority limits;
- attachment, runtime-log, note, local project, source-root, and GitHub evidence sources;
- source-root nested-module deduplication and grouping;
- Catalog/Registry validation and Ed25519 tamper rejection;
- contract/safety evals with honest accuracy-evidence status;
- Harness Hub v3 snapshot fields;
- all v2 compatibility tests.

## Manual Browser Gate

```bash
node src/index.mjs hub v3-serve \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --host 127.0.0.1 \
  --port 4176
```

Verify `/api/health`, `/api/v3/snapshot`, desktop layout, mobile layout, Catalog table, asset counts, proposals, governance packs, evaluation status, GLM usage, source types, and generated `produce` command.
