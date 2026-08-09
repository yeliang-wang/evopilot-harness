# Testing

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

## External Sample Validation

When the local historical project corpus exists, use it only as validation input:

```bash
node scripts/validate-howbuy-samples.mjs \
  --source-root /Users/wangyejing/project/howbuy_project \
  --source harnesses
```

The script must not copy those projects into `harnesses/` or publish them as fixed templates.
