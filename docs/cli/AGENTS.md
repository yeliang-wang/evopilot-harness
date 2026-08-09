# EvoPilot Harness CLI Agent Instructions

This is the CLI entry point for WorkBuddy, Codex, Claude Code, CI jobs, and other AI agents that operate `evopilot-harness`.

Read this file first. Then read [quickstart.md](quickstart.md). Use [automation.md](automation.md) for JSON parsing rules, [workflows.md](workflows.md) for scenario flows, and [commands.md](commands.md) for full reference.

## Non-Negotiable Rules

- Use `--json` for every command where JSON is available.
- Do not parse human-readable CLI output for automation.
- Treat `evopilot-harness` as the system of record for Harness lifecycle.
- Do not use EvoPilot CLI or API to create, evolve, approve, publish, deprecate, or mutate Harness definitions.
- Do not approve an evolution run unless the generated draft, source coverage, validation, and impact have been shown to an administrator.
- Do not invent `--confirmed-by` or `--confirmation` values.
- Stop on `nextAction`, `BLOCKED`, `FAILED`, validation blockers, missing source files, missing Catalog files, approval gates, or non-zero exit codes.
- Do not pass raw production secrets in `--note`, `--file`, `--attachment`, or `--production-log`.
- Production logs are redacted for common patterns, but operators must still review inputs before sharing output.

## Required Local Context

Run from the repository root unless the project has been installed as a command-line package:

```bash
cd /path/to/evopilot-harness
npm install
node src/index.mjs --help
```

The package requires Node.js 22 or later.

## Safe Command Flow

```bash
node src/index.mjs catalog publish --source harnesses --out published --json
node src/index.mjs catalog validate --source published --json
node src/index.mjs harness list --source harnesses --json
node src/index.mjs hub snapshot --catalog published --source harnesses --json
```

For one-command evolution:

```bash
node src/index.mjs evolve \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable domain Harness from this project." \
  --json
```

Stop after the draft reaches `REVIEW_REQUIRED`. Show the response fields to the administrator:

```text
evolutionId
status
sourceCoverage
autoMatch
validation
draft.harnessId
draft.version
draft.digest
nextAction
```

Approve and publish only after explicit confirmation:

```bash
node src/index.mjs evolution approve <evolution-id> \
  --confirmed-by <administrator> \
  --confirmation "Reviewed source coverage, draft diff, validation, and impact." \
  --json

node src/index.mjs evolution publish <evolution-id> --json
```

## EvoPilot Boundary

After publication, EvoPilot reads the `published/` directory dynamically:

```bash
EVOPILOT_HARNESS_CATALOG_DIRS=/path/to/evopilot-harness/published
```

EvoPilot records the selected published Harness during goal planning as `plan.selectedHarness`. It does not copy Harness files into its own lifecycle store and does not mutate this repository.
