# Testing

## v3 Acceptance

```bash
npm test
npm run v3:check
npm run check
```

The v3 gates validate formal schemas, immutable references, Evidence Graph decisions, GLM citations/failure behavior, source types, source-root grouping, migration/rollback, signatures, Catalog/Registry closure, Hub state, and all v2 compatibility tests. See [v3 Acceptance Baseline](v3-acceptance.md).

`eval v3-run` reports `INSUFFICIENT_EVAL_EVIDENCE` until enough reviewed cases exist; do not convert passing contract fixtures into a general accuracy claim.

Use these commands before publishing a Catalog, changing CLI behavior, or preparing a release.

## Full Local Check

```bash
npm run check
```

This runs:

```text
catalog publish
catalog validate
registry publish
registry validate
asset validate
unknown-source eval
LLM Advisor replay
hub snapshot
docs link check
node tests
```

## Targeted Checks

```bash
npm run catalog:publish
npm run catalog:validate
npm run registry:publish
npm run registry:validate
npm run asset:validate
npm run eval:run
npm run llm:replay
npm run hub:snapshot
npm run docs:links
npm test
git diff --check
```

## CLI Smoke

```bash
node src/index.mjs --help
node src/index.mjs harness list --json
node src/index.mjs harness validate --strict --json
node src/index.mjs catalog validate --source published --json
node src/index.mjs asset validate --source published --json
node src/index.mjs eval run --json
node src/index.mjs llm replay --json
node src/index.mjs hub snapshot --catalog published --source harnesses --json
```

## Evolution Smoke

Use a temporary source project when validating evolution behavior:

```bash
tmp="$(mktemp -d)"
mkdir -p "$tmp/project/docs"
cat > "$tmp/project/README.md" <<'EOF'
# Distributed Cache

Self-developed distributed cache with Redis-compatible protocol, TTL, eviction,
replica failover, slot migration, and hot key diagnostics.
EOF

node src/index.mjs detect \
  --source-project "$tmp/project" \
  --goal "Evolve a distributed cache Harness from this source project." \
  --json
```

Expected result:

```text
status=READY
sourceProfile.primaryRole=distributed-cache-product
autoMatch.targetHarnessId=distributed-cache-harness
```

Then run:

```bash
node src/index.mjs evolve \
  --source-project "$tmp/project" \
  --goal "Evolve a distributed cache Harness from this source project." \
  --json
```

Expected result:

```text
status=REVIEW_REQUIRED
autoMatch.targetHarnessId=distributed-cache-harness
validation.status=VALIDATED
```

## Corpus Smoke

Use a temporary source root with more than one project when validating corpus behavior:

```bash
node src/index.mjs corpus scan \
  --source-root /path/to/project-root \
  --include-modules \
  --json

node src/index.mjs corpus plan \
  --source-root /path/to/project-root \
  --include-modules \
  --max-projects-per-group 5 \
  --json
```

Expected result:

```text
status=REVIEW_REQUIRED
nextAction=review-approve-corpus-plan
groups[].targetHarnessId present
groups[].validation.status=VALIDATED
validation.status=VALIDATED
```

Do not publish a corpus smoke into the repository's real `harnesses/` directory unless the generated group drafts have been reviewed and are intended release content.

## GitHub Repository Source Smoke

Use this smoke when validating that a repository source can be cloned or fetched, scanned, matched, and turned into a reviewable draft:

```bash
node src/index.mjs detect \
  --github-repo owner/repo \
  --github-ref main \
  --goal "Create or evolve a reusable domain Harness from this GitHub repository." \
  --json

node src/index.mjs evolve \
  --github-repo https://github.com/owner/repo \
  --github-ref main \
  --goal "Create or evolve a reusable domain Harness from this GitHub repository." \
  --json
```

Expected result:

```text
sourceCoverage.sources[].type=github-repository
sourceCoverage.sources[].github.resolvedCommit present
sourceProfile.sourceTypes includes github-repository
draft.template.definitionQuality.objective=more accurate, professional, and fine-grained Harness definition
validation.status=VALIDATED
```

Do not pass GitHub tokens in `--github-repo`. For offline CI, use a local Git fixture exposed as `file://...`; the product behavior is the same after clone/fetch.

## External Sample Validation

When the local historical project corpus exists, use it only as validation input:

```bash
node scripts/validate-howbuy-samples.mjs \
  --source-root /Users/wangyejing/project/howbuy_project \
  --source harnesses
```

The script must not copy those projects into `harnesses/` or publish them as fixed templates.
