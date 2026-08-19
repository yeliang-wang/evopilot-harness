# Testing

Tests prove contracts, lifecycle gates, safety behavior, and compatibility. They do not prove 100 percent accuracy for unknown future domains.

## Complete Local Gate

```bash
npm run check
git diff --check
```

`npm run check` runs, in order:

```text
legacy Catalog publish and validate
legacy Registry publish and validate
legacy Harness Asset validation
unknown-source evaluation fixtures
LLM Advisor replay fixtures
legacy Hub snapshot generation
documentation link validation
architecture-boundary verification
Node test suite
v3 schema, asset, reasoning, lifecycle, feedback, and migration validation
v3 Hub snapshot generation
```

The command regenerates tracked legacy Catalog, Registry, and Hub snapshots. Inspect `git status` afterward and include only intentional changes.

## Targeted Commands

| Area | Command |
|---|---|
| Documentation links | `npm run docs:links` |
| Architecture boundaries | `npm run verify:architecture` |
| Node tests | `npm test` |
| v3 contracts | `node --test tests/v3.4.test.mjs tests/v3.test.mjs && npm run v3:check` |
| Asset Delta and EvaluationPack v3 | `node --test tests/v3.4.test.mjs` |
| Feedback contracts | `node --test --test-name-pattern='feedback|EvaluationPack' tests/v3.test.mjs` |
| Digital Expert generation | `npm run digital-expert:check` |
| Agent-native protocol and lifecycle | `node --test tests/v4.test.mjs` |
| Legacy Catalog | `npm run catalog:publish && npm run catalog:validate` |
| Legacy Registry | `npm run registry:publish && npm run registry:validate` |
| Legacy assets | `npm run asset:validate` |
| Unknown-source fixtures | `npm run eval:run` |
| Advisor replay | `npm run llm:replay` |
| Hub snapshots | `npm run hub:snapshot && npm run hub:v3-snapshot` |
| Release artifacts | `npm run release:artifact && npm run verify:release-artifact` |

## v3 Workspace Smoke

Use a disposable Workspace:

```bash
export EVOPILOT_HARNESS_HOME="$(mktemp -d)"
node src/index.mjs workspace init --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs workspace status --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs asset v3-test --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs catalog v3-validate --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs registry v3-validate --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs eval v3-run --workspace "$EVOPILOT_HARNESS_HOME" --json
```

Expected stop states and `nextAction` values are part of the contract. Do not treat `REVIEW_REQUIRED` or `INSUFFICIENT_EVAL_EVIDENCE` as test infrastructure failures when the scenario intentionally reaches those gates.

`eval v3-run` includes valid and adversarial v3.4 fixtures for all seven Delta asset kinds, positive/negative Evaluation coverage, and blocked impact closure. Fixture counts prove contract branches, not domain completeness.

Feedback contract tests create Package fixtures only in disposable Workspaces. They cover approval, redaction, expiry, integrity, immutable Bundle closure, idempotency/conflicts, four-dimensional aggregation, Report uncertainty, Catalog non-mutation, and Hub read-only methods. Fixture success proves the consumer contract, not that an external production exporter already exists.

## Source-To-Proposal Smoke

Use a fixture or disposable project, never a production source tree that the test may mutate:

```bash
node src/index.mjs produce \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source-project /path/to/fixture-project \
  --goal "Produce or evolve a reusable Harness asset." \
  --advisor off \
  --json
```

Verify:

- the source is represented by redacted Evidence Graph nodes and digests;
- eligibility and candidate decisions cite evidence ids;
- deterministic factor scores and rejection reasons are present;
- policy-required Advisor absence remains a Proposal blocker;
- the run stops before approval and publication;
- no Built-in or Engine asset is modified.
- all five Proposal decisions preserve their publication boundary;
- exact before/after digests, Evaluation references, and impact closure validate;
- `NO_CHANGE` and `NEED_MORE_EVIDENCE` cannot approve or publish.

Then use a test model service or authorized GLM profile to run `proposal review`. Verify report Schema, verdict, citations, every source membership, model/usage, report digest, and the approval gate. A missing or non-ready report must block `proposal approve`.

Use `--source-root` to verify multi-project discovery, nested-module deduplication, independent per-project reasoning, grouping, merged Evidence Graphs, and one Proposal per group. Test projects are evidence fixtures only and must not become published assets.

## GitHub Source Smoke

For deterministic offline tests, point `--github-repo` to a local Git fixture exposed as `file://...`. For a live public repository smoke, verify the resolved commit and do not include credentials in the URL.

Expected evidence includes:

```text
source kind = github-repository
resolved repository revision
redacted source snapshot digest
reasoning evidence ids
review-stage Proposal or explicit stop decision
```

## GLM Advisor Tests

Replay fixtures verify output shape, citation closure, token accounting, invalid evidence rejection, failure behavior, and authority limits. A live GLM call is a separate integration layer and requires a manually maintained `models.json` or approved environment-based configuration.

Never print the real model configuration or raw API key. LLM success cannot replace deterministic, schema, evaluation, or human-review gates. The original Advisor and the independent Proposal semantic reviewer are separate calls with separate persisted results and token usage.

## Harness Hub Browser Gate

```bash
node src/index.mjs hub v3-serve \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --host 127.0.0.1 \
  --port 4176
```

Verify `/api/health`, `/api/hub/snapshot`, `/api/v3/snapshot`, desktop and mobile layout, assets, proposals, Packs, five-way decisions, typed Delta summaries, compatibility/blast-radius/rollback findings, positive/negative Evaluation coverage, feedback counts/effectiveness/uncertainty, source types, GLM usage, and the generated `produce` command. Confirm that no secret or unredacted source content is rendered and every non-GET request returns 405.

See [v3 Acceptance Baseline](v3-acceptance.md) for the release-quality interpretation of these checks.
