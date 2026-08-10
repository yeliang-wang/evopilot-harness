# EvoPilot Harness v3 CLI Quickstart

> Shortest safe path for a person or AI agent to produce, review, approve, and publish Harness assets.

## 1. Initialize

```bash
cd /path/to/evopilot-harness
npm install

export EVOPILOT_HARNESS_HOME="$HOME/.evopilot-harness"
node src/index.mjs workspace init \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --json
```

Continue only when `status=READY`, `engine.mode=read-only`, `engine.mutationAllowed=false`, and `workspace.writable=true`. `engine.filesystemWritable` reports the host/container filesystem fact; it does not grant the Harness lifecycle permission to mutate installed Engine files.

## 2. Validate The Bootstrap

```bash
node src/index.mjs asset v3-test --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs catalog v3-validate \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source "$EVOPILOT_HARNESS_HOME/catalogs/builtin" \
  --json
node src/index.mjs registry v3-validate --workspace "$EVOPILOT_HARNESS_HOME" --json
```

All three must pass. `asset v3-test` also returns the honest `accuracyClaim` from the evaluation gate.

## 3. Inspect GLM Readiness

```bash
node src/index.mjs llm v3-models \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --models-file /path/to/models.json \
  --json
```

Do not print or rewrite `models.json`. A new Profile or ambiguous decision requires a usable Zhipu GLM profile. Missing GLM does not erase the deterministic result, but it blocks approval.

## 4. Produce A Proposal

Local project:

```bash
node src/index.mjs produce \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source-project /path/to/project \
  --goal "Produce or evolve a reusable Harness asset." \
  --json
```

Project root:

```bash
node src/index.mjs produce \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source-root /path/to/project-root \
  --goal "Produce grouped Harness asset proposals." \
  --json
```

GitHub:

```bash
node src/index.mjs produce \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --github-repo owner/repository \
  --github-ref main \
  --goal "Produce or evolve a reusable Harness asset." \
  --json
```

The command stops at `REVIEW_REQUIRED`, `INSUFFICIENT_EVIDENCE`, or `NOT_HARNESS_ELIGIBLE`. It never approves or publishes automatically.

## 5. Review The Contract

Read these JSON fields:

```text
runId
evidenceGraph.path
evidenceGraph.digest
reasoning.algorithmVersion
reasoning.ontology
reasoning.policy
reasoning.eligibility
reasoning.decision
reasoning.targetProfile
reasoning.composeProfiles
reasoning.proposedProfile
reasoning.candidates[].factors
reasoning.candidates[].rejectionReasons
reasoning.evidenceIds
advisor.status
advisor.model
advisor.usage
advisor.validation
proposal.proposedAssets
proposal.validations
proposal.blockers
proposal.evaluationStatus
nextAction
```

Then inspect the full proposal:

```bash
node src/index.mjs proposal review <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --json
```

Stop if any blocker remains.

## 6. Approve And Publish

Use real reviewer values. An AI agent must not invent them.

```bash
node src/index.mjs proposal approve <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --confirmed-by <reviewer> \
  --confirmation "Reviewed evidence, reasoning, Advisor citations, asset boundary, and evaluation case." \
  --evaluation-reviewed \
  --json

node src/index.mjs proposal publish <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --json
```

Publication fails if the proposal is not approved, a schema fails, a dependency cannot be resolved, or an immutable asset version already exists.

## 7. Sign And Verify

```bash
node src/index.mjs keys generate --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs catalog v3-sign \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --private-key "$EVOPILOT_HARNESS_HOME/keys/catalog-signing-private.pem" \
  --json
node src/index.mjs catalog v3-verify \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --public-key "$EVOPILOT_HARNESS_HOME/keys/catalog-signing-public.pem" \
  --json
```

## 8. Run Harness Hub

```bash
node src/index.mjs hub v3-serve --workspace "$EVOPILOT_HARNESS_HOME"
```

Open `http://127.0.0.1:4176`.

## Legacy v2

Existing `detect`, `evolve`, `corpus`, `evolution`, `harness`, `asset validate`, and Catalog v2 commands remain available for compatibility. New automation should use the v3 commands above. See [commands.md](commands.md) for both surfaces and [v3 Workspace And Migration](../operations/v3-workspace.md) for migration.
