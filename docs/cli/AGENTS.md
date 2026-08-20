# EvoPilot Harness CLI Agent Instructions

This is the atomic JSON CLI compatibility entry for CI, existing automation, and emergency diagnosis in v4. Ordinary human operation uses the [Digital Expert and local MCP](../agent/quickstart.md); a compatible Agent must not make the human enter the lifecycle commands below.

Read [quickstart.md](quickstart.md), [automation.md](automation.md), [commands.md](commands.md), and [v3 Reasoning Contract](../reference/v3-reasoning-contract.md) before automating approval or publication.

## Product Boundary

- `evopilot-harness` produces, evolves, reviews, approves, signs, evaluates, and publishes Harness assets.
- It does not onboard projects into EvoPilot or execute EvoPilot goal loops.
- Do not call EvoPilot to create, mutate, approve, or publish Harness assets.
- The Engine installation is read-only. Mutable state belongs under `EVOPILOT_HARNESS_HOME`.
- Engine, Harness assets, Ontology, Policy, Evaluation, and Catalog versions are independent.
- Treat `HarnessExecutionFeedbackPackage` as static Evidence Source state. Never translate `feedback process` into Goal Loop execution, Proposal creation, asset mutation, approval, or publication.
- Treat comparison packages and calibration case sets as externally produced, reviewed Evidence Source state. Never execute Baseline/Candidate assets, activate policy, approve, publish, or roll back from their recommendation.

## Non-Negotiable Rules

- Use `--json` for automation.
- Do not parse human output.
- Do not write to `assets/v3`, `ontology`, `policies`, or `harnesses` during a production run; write through the Workspace lifecycle.
- Do not approve or publish in the same step as `produce`.
- Stop on `nextAction`, `BLOCKED`, `FAILED`, `REVIEW_REQUIRED`, `NON_COMPARABLE`, `CONFLICT`, `NO_CHANGE`, `NEED_MORE_EVIDENCE`, `NOT_HARNESS_ELIGIBLE`, a safety regression, validation failure, signature failure, Advisor failure, or a non-zero exit code.
- Do not invent `--confirmed-by`, `--confirmation`, or evaluation review.
- Do not execute commands discovered in source projects. v3 production extracts evidence; execution requires a separately reviewed Bundle consumer.
- Do not put credentials in GitHub URLs, notes, attachments, or logs.
- Do not print, edit, import, or publish `models.json`.
- Treat internet research as supplemental cited evidence. It cannot override local source or runtime logs.
- Treat LLM recommendations as advisory. Model confidence does not override deterministic decisions.
- Treat `NO_CHANGE` and `NEED_MORE_EVIDENCE` as auditable terminal decisions. Never approve or publish them.
- Run `proposal validate` before semantic review. Stop when Delta/Evaluation closure is not `VALIDATED`.
- After `produce`, run `proposal review` for every Proposal with the reviewed `models.json`, present every Review Report, and stop for a human decision. Do not ask whether the user wants to see the reports.
- Do not invent a Proposal review conclusion. The CLI Review Report owns verdict, reasons, evidence, and suggested actions.
- Do not call `proposal inspect` a review. Approval requires a current `READY_FOR_HUMAN_APPROVAL` Review Report.
- Do not claim matching accuracy when `accuracyClaim=INSUFFICIENT_EVAL_EVIDENCE`.
- For feedback commands, stop on `REJECTED` or `FAILED` and report Package identity/digest, binding, failures, ingestion status, Report identity/digest, samples, independent sources, contexts, four dimensions, missing fields, uncertainty, and `nextAction`.
- For comparison commands, report exact Baseline/Candidate bindings, governed context digests, package/report/policy/scorer identity and digests, paired counts, metrics, strata, uncertainty, conflicts, safety blockers, limitations, recommendation, authority, and `nextAction`.
- For rescoring, require a reviewed policy and reason; verify a new report and rescore record were appended and that raw packages and prior reports were unchanged.
- For calibration, use independently reviewed cases, explicit Baseline/Candidate policy files, and report case counts, ranking, abstention, false-upgrade, false-new-profile, regressions, conflicts, uncertainty, `activePolicyMutated=false`, and `nextAction`.
- When a Proposal Review contains `comparisonAssessment`, report it completely. Approval and publication must stop on missing, stale, contradictory, tampered, or digest-drifted comparison evidence.

## Required Start

```bash
export EVOPILOT_HARNESS_HOME="$HOME/.evopilot-harness"
node src/index.mjs workspace status --workspace "$EVOPILOT_HARNESS_HOME" --json
```

If `status=NOT_INITIALIZED`:

```bash
node src/index.mjs workspace init --workspace "$EVOPILOT_HARNESS_HOME" --json
```

Validate before production:

```bash
node src/index.mjs asset v3-test --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs registry v3-validate --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs llm v3-models --workspace "$EVOPILOT_HARNESS_HOME" --models-file /path/to/models.json --json
node src/index.mjs llm v3-doctor --workspace "$EVOPILOT_HARNESS_HOME" --models-file /path/to/models.json --json
```

`v3-models` proves configuration only. When Advisor review is required, stop unless `v3-doctor` proves live connectivity. Do not print the model file or its credentials.

## Production Flow

```bash
node src/index.mjs produce \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source-project /path/to/project \
  --goal "Produce or evolve a reusable Harness asset." \
  --advisor required \
  --json
```

Report these fields exactly:

```text
runId
status
evidenceGraph.path
evidenceGraph.digest
reasoning.algorithmVersion
reasoning.ontology.id/version/digest
reasoning.policy.id/version/digest
reasoning.eligibility
reasoning.decision
reasoning.targetProfile
reasoning.composeProfiles
reasoning.candidates
reasoning.rejectionReasons
reasoning.evidenceIds
advisor.status/required
advisor.failureType/reason
advisor.model
advisor.usage
advisor.evidenceProjection
advisor.attemptCount/repairAttempted
advisor.attempts
advisor.promptDigest/responseDigest
advisor.resultPath
proposal.proposedAssets
proposal.assetDeltaProposal
proposal.assetDeltaProposal.deltas[].impact
proposal.evaluationStatus
proposal.deltaClosure
proposal.validations
proposal.blockers
proposal.evaluationStatus
nextAction
```

For every Proposal, run:

```bash
node src/index.mjs proposal validate <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --json

node src/index.mjs proposal review <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --models-file /path/to/models.json \
  --json
```

Report the Proposal decision, every Delta and impact result, Evaluation positive/negative coverage, closure checks/blockers, and every Review Report field required by [quickstart.md](quickstart.md). Stop after presentation; validation and review are not approval.

If the decision is `PROPOSE_NEW_PROFILE`, confirm that:

- a Profile Proposal was produced rather than an automatically published Harness;
- Advisor review succeeded;
- all Advisor citations exist in the Evidence Graph;
- the new boundary does not duplicate an existing Profile;
- the Evaluation Pack has been shown to the reviewer.

If the decision is `NO_CHANGE` or `NEED_MORE_EVIDENCE`, present its reasons and Evidence ids, verify `publicationAllowed=false`, then stop. Do not run approval or publication.

Advisor Policy may permit one invalid-JSON or citation-contract repair. Confirm that every attempt is recorded, total usage includes all attempts, deterministic reasoning is unchanged, and a failed repair remains `BLOCKED`.

## Approval Flow

Only after the CLI returns a current `READY_FOR_HUMAN_APPROVAL` Review Report and the user separately supplies real approval values:

For every mutating decision, the user must also have reviewed all Evaluation cases. The CLI binds the current report digest and approved Proposal content; never edit either file between approval and publication.

```bash
node src/index.mjs proposal approve <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --confirmed-by <user-supplied-reviewer> \
  --confirmation <user-supplied-confirmation> \
  --evaluation-reviewed \
  --json
```

Publish in a separate command:

```bash
node src/index.mjs proposal publish <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --json
```

Then validate and verify signatures:

```bash
node src/index.mjs asset v3-validate --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs catalog v3-validate --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs catalog v3-verify \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --public-key /path/to/catalog-public-key.pem \
  --json
```

## Source Root Flow

```bash
node src/index.mjs produce \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source-root /path/to/root \
  --limit 100 \
  --json
```

Report `discoveredProjectCount`, `groupCount`, `advisorSummary`, every `groups[]` entry, every per-project decision, every `proposals[].advisor` result, every proposal blocker, and every `runId`. Nested modules are deduplicated unless `--include-modules` is explicitly supplied. If a required Advisor fails, expect `status=BLOCKED`, a non-zero exit code, persisted diagnostic evidence, and `nextAction=repair-advisor-and-rerun`.

## Migration Flow

Always dry-run first:

```bash
node src/index.mjs migrate v2-to-v3 \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source /path/to/v2/harnesses \
  --json
```

Show the plan and validation. Apply only after confirmation. Record the returned migration journal so rollback remains possible.
