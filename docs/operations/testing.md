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
hub snapshot
docs link check
node tests
```

## Targeted Checks

```bash
npm run catalog:publish
npm run catalog:validate
npm run hub:snapshot
npm run docs:links
npm test
git diff --check
```

## CLI Smoke

```bash
node src/index.mjs --help
node src/index.mjs harness list --json
node src/index.mjs harness validate --json
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
