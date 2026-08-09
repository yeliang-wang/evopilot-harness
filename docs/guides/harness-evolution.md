# Harness Evolution

Harness evolution is a local lifecycle managed by `evopilot-harness`. It is independent from EvoPilot releases.

## Lifecycle

```text
CREATED -> REVIEW_REQUIRED -> APPROVED -> PUBLISHED
              |
              v
           BLOCKED
```

## One-Command Flow

```bash
node src/index.mjs evolve \
  --source-project /path/to/project \
  --goal "Create or evolve a reusable domain Harness." \
  --json
```

The command performs:

1. source collection
2. source coverage generation
3. automatic Harness matching
4. draft generation
5. draft validation
6. review stop

If `--approve-and-publish` is supplied, the command also performs approval and publication. Use that only when real administrator approval has already happened.

## Atomic Flow

```bash
node src/index.mjs evolution create --source-project /path/to/project --goal "..." --json
node src/index.mjs evolution advance <evolution-id> --json
node src/index.mjs evolution review <evolution-id> --json
node src/index.mjs evolution impact <evolution-id> --json
node src/index.mjs evolution approve <evolution-id> --confirmed-by <admin> --confirmation <text> --json
node src/index.mjs evolution publish <evolution-id> --json
```

Use the atomic flow for normal administration because it leaves review points between draft generation, approval, and publication.

## Review Checklist

Before approval, verify:

- source coverage lists every intended source
- production log redaction is acceptable
- auto-match decision is reasonable
- target Harness id and version are correct
- `draft/template.yaml` has clear domain actions, evidence adapters, and release blockers
- `validation.status=VALIDATED`
- `validation.blockers` is empty
- `impactReport` is understood

## Publication Effects

Publication mutates:

```text
harnesses/<harness-id>/template.yaml
harnesses/<harness-id>/README.md
harnesses/<harness-id>/CHANGELOG.md
harnesses/<harness-id>/examples/selected-harness-binding.yaml
published/CATALOG.md
published/<harness-id>/<version>/
```

It does not change EvoPilot. EvoPilot sees the new Catalog only when its configured Catalog directory is read during a later planning request.
