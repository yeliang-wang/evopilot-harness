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

Preflight with deterministic detection:

```bash
node src/index.mjs detect \
  --source-project /path/to/project \
  --goal "Create or evolve a reusable domain Harness." \
  --json
```

Review:

```text
sourceProfile.primaryRole
sourceProfile.recommendedHarness
autoMatch.decision
autoMatch.targetHarnessId
autoMatch.parentCandidates
autoMatch.candidates[]
nextAction
```

Then generate the draft:

```bash
node src/index.mjs evolve \
  --source-project /path/to/project \
  --goal "Create or evolve a reusable domain Harness." \
  --json
```

The command performs:

1. source collection
2. source coverage generation
3. Source Profile generation
4. Harness Detect Algorithm v1 matching
5. optional LLM Advisor semantic review
6. draft generation
7. Template Quality Standard v1 validation
8. review stop

If `--approve-and-publish` is supplied, the command also performs approval and publication. Use that only when real administrator approval has already happened.

## LLM Advisor Review

The LLM Advisor is disabled by default. It can be enabled for production semantic review with GLM or another OpenAI-compatible endpoint:

```bash
export EVOPILOT_HARNESS_LLM_ADVISOR=optional
export EVOPILOT_HARNESS_LLM_PROVIDER_PRESET=glm
export EVOPILOT_HARNESS_LLM_API_KEY="<secret>"

node src/index.mjs evolve \
  --source-project /path/to/project \
  --goal "Create or evolve a reusable domain Harness." \
  --json
```

Use `--llm-advisor required` or `--require-llm-advisor` when the run must block if model review cannot complete. Use `--apply-llm-advisor` only when a high-confidence Advisor recommendation may change the generated draft target. Explicit `--target-id` still overrides the Advisor.

The Advisor returns:

```text
llmAdvisor.status
llmAdvisor.sourceClassification
llmAdvisor.recommendation
llmAdvisor.alternatives
llmAdvisor.reviewWarnings
llmAdvisor.sensitiveMaterialFindings
llmAdvisor.provider
llmAdvisor.model
llmAdvisor.usage
```

Advisor output is not approval. Administrators must still review the draft, source coverage, validation, and impact before approving publication.

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
- `sourceProfile.primaryRole`, recommended Harness, architecture signals, and negative signals are reasonable
- `autoMatch.decision`, confidence, target Harness id, parent candidates, and reasons are reasonable
- LLM Advisor classification, recommendation, alternatives, warnings, and token usage are understood when enabled
- target Harness id and version are correct
- `draft/template.yaml` has clear `productBoundary`, `matchPolicy`, `executionModel`, `evidenceContract`, `qualityGate`, domain actions, evidence adapters, and release blockers
- `validation.status=VALIDATED`
- `validation.blockers` is empty
- strict validation passes before a source pack or Catalog is published as a release baseline
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
