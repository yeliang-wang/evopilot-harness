# EvoPilot Harness CLI Agent Instructions

This is the CLI entry point for WorkBuddy, Codex, Claude Code, CI jobs, and other AI agents that operate `evopilot-harness`.

Read this file first. Then read [quickstart.md](quickstart.md). Use [automation.md](automation.md) for JSON parsing rules, [workflows.md](workflows.md) for scenario flows, and [commands.md](commands.md) for full reference.

## Non-Negotiable Rules

- Use `--json` for every command where JSON is available.
- Do not parse human-readable CLI output for automation.
- Treat `evopilot-harness` as the system of record for Harness lifecycle.
- Do not use EvoPilot CLI or API to create, evolve, approve, publish, deprecate, or mutate Harness definitions.
- Do not approve an evolution run unless the generated draft, source coverage, validation, and impact have been shown to an administrator.
- Do not approve a corpus run unless the grouping, dedupe decisions, generated group drafts, validation, and publication impact have been shown to an administrator.
- Do not invent `--confirmed-by` or `--confirmation` values.
- Stop on `nextAction`, `BLOCKED`, `FAILED`, validation blockers, missing source files, missing Catalog files, approval gates, or non-zero exit codes.
- Do not pass raw production secrets in `--note`, `--file`, `--attachment`, or `--production-log`.
- Do not pass raw GitHub tokens in `--github-repo`; use public HTTPS, local Git credentials, or SSH.
- Do not print or rewrite `models.json`; it is a manually maintained CodeBuddy-style local LLM config file.
- Production logs are redacted for common patterns, but operators must still review inputs before sharing output.

## Required Local Context

Run from the repository root unless the project has been installed as a command-line package:

```bash
cd /path/to/evopilot-harness
npm install
node src/index.mjs --help
```

The package requires Node.js 22 or later.

If LLM Advisor review is expected, inspect model readiness without printing keys:

```bash
node src/index.mjs llm models --json
```

The Advisor is optional by default. Use `--llm-advisor required` only when a configured model call must succeed before review, and use `--no-llm-advisor` for deterministic-only automation.

## Safe Command Flow

```bash
node src/index.mjs catalog publish --source harnesses --out published --json
node src/index.mjs catalog validate --source published --json
node src/index.mjs harness list --source harnesses --json
node src/index.mjs harness validate --source harnesses --strict --json
node src/index.mjs asset validate --source harnesses --json
node src/index.mjs eval run --json
node src/index.mjs llm replay --json
node src/index.mjs hub snapshot --catalog published --source harnesses --json
```

For one-command evolution:

```bash
node src/index.mjs detect \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable domain Harness from this project." \
  --json
```

Show the detection fields to the administrator before draft generation when the decision is ambiguous or creates a new target:

```text
sourceProfile.primaryRole
sourceProfile.recommendedHarness
autoMatch.decision
autoMatch.targetHarnessId
autoMatch.parentCandidates
autoMatch.candidates
autoMatch.candidateRetrieval
autoMatch.reviewGate
autoMatch.decisionEvidence
nextAction
```

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
sourceProfile
autoMatch
validation
draft.harnessId
draft.version
draft.digest
draft.template.definitionQuality
draft.asset
llmAdvisor.status
llmAdvisor.llmProfileId
llmAdvisor.provider
llmAdvisor.model
llmAdvisor.usage
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

For root-directory corpus evolution:

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

Stop after `corpus plan` reaches `REVIEW_REQUIRED`. Show these fields to the administrator:

```text
corpusId
status
discovery
duplicateCount
groups[].targetHarnessId
groups[].selectedProjects
groups[].duplicateProjects
groups[].autoMatch
groups[].validation
groups[].draft.digest
validation
nextAction
```

Approve and publish only after explicit confirmation:

```bash
node src/index.mjs corpus approve <corpus-id> \
  --confirmed-by <administrator> \
  --confirmation "Reviewed corpus grouping, dedupe decisions, generated drafts, validation, and publication impact." \
  --json

node src/index.mjs corpus publish <corpus-id> --json
```

For GitHub repository source evolution:

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

Show `sourceCoverage.sources[].github.repository`, `ref`, `resolvedCommit`, `cachePath`, `sourceProfile.primaryRole`, `autoMatch.targetHarnessId`, and `draft.template.definitionQuality` before approval.

## EvoPilot Boundary

After publication, EvoPilot reads `harness-registry.yaml` dynamically:

```bash
EVOPILOT_HARNESS_REGISTRY_CONFIG=/path/to/evopilot-harness/harness-registry.yaml
```

EvoPilot records the selected published Harness during goal planning as `plan.selectedHarness`. It does not copy Harness files into its own lifecycle store and does not mutate this repository.
