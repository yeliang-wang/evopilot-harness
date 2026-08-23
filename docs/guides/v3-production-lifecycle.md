# v3 Production Lifecycle

## 1. Initialize The Workspace

```bash
export EVOPILOT_HARNESS_HOME="$HOME/.evopilot-harness"

node src/index.mjs workspace init \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --json
```

The Engine checkout is read-only from the lifecycle's perspective. All mutable state goes under the Workspace.

## 2. Produce From One Source Project

```bash
node src/index.mjs produce \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source-project /path/to/project \
  --goal "Produce or evolve a reusable Harness asset." \
  --json
```

For GitHub:

```bash
node src/index.mjs produce \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --github-repo owner/repository \
  --github-ref main \
  --goal "Produce or evolve a reusable Harness asset." \
  --json
```

Do not put credentials in the URL. Use local Git credentials or SSH.

## 3. Produce From A Project Root

```bash
node src/index.mjs produce \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source-root /path/to/root \
  --limit 100 \
  --goal "Produce grouped Harness asset proposals." \
  --json
```

Nested modules are deduplicated by default. Add `--include-modules` only when modules are independent project evidence units. Every discovered project first receives its own Evidence Graph and reasoning result. Runs are then grouped by selected existing Profile, proposed new Profile, composed Bundle target, `NO_CHANGE`, or `NEED_MORE_EVIDENCE`. Each group receives a merged, re-indexed Evidence Graph and exactly one auditable Proposal. Shared execution-only evidence is never used to guess a domain; without discriminating domain evidence the result remains `NEED_MORE_EVIDENCE` and no generic Profile is created.

## 4. Add Materials And Logs

The same command accepts repeated inputs:

```bash
node src/index.mjs produce \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source-project /path/to/project \
  --attachment architecture.pdf \
  --attachment design.pptx \
  --production-log production.log \
  --historical-harness prior-profile.yaml \
  --note "Observed failure boundary and desired reusable task." \
  --json
```

PDF uses `pdftotext` when available. DOCX and PPTX text is extracted from their XML packages. All stored excerpts are redacted and written to `evidence/<run-id>/`.

Controlled research is explicit:

```bash
node src/index.mjs produce \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --source-project /path/to/project \
  --research-url https://example.org/cited-specification \
  --allow-internet-research \
  --json
```

Only HTTPS is allowed; local and private-network destinations are rejected. Research is supplemental.

## 5. Review

Stop when `status` is `REVIEW_REQUIRED`, `NO_CHANGE`, `NEED_MORE_EVIDENCE`, or `BLOCKED`. Before required Advisor production, distinguish configuration from connectivity:

```bash
node src/index.mjs llm v3-models --workspace "$EVOPILOT_HARNESS_HOME" --models-file /path/to/models.json --json
node src/index.mjs llm v3-doctor --workspace "$EVOPILOT_HARNESS_HOME" --models-file /path/to/models.json --json
```

Show these fields to the owner:

```text
runId
evidenceGraph.path
evidenceGraph.digest
reasoning.eligibility
reasoning.decision
reasoning.candidates[].factors
reasoning.rejectionReasons
reasoning.evidenceIds
advisor.status
advisor.failureType
advisor.reason
advisor.model
advisor.usage
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

```bash
node src/index.mjs proposal validate <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --json

node src/index.mjs proposal review <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --models-file /path/to/models.json \
  --json
```

First present every Proposal decision, Delta before/after state, change evidence, impact analysis, Evaluation case coverage, and closure result. Do not review, approve, or publish a terminal `NO_CHANGE` or `NEED_MORE_EVIDENCE` Proposal. For Source Roots, run semantic review once for every validated mutating Proposal. Present every report and stop. Required review fields include `verdict`, `summary`, `findings`, `reasons`, `evidenceIds`, deterministic gates, group coherence, every project membership, boundary assessment, existing-asset overlap, definition quality, evaluation sufficiency, suggested actions, remaining blockers, Reviewer model/usage, report digest, and `nextAction`.

## 6. Approve And Publish

Only a mutating decision with `deltaClosure.status=VALIDATED` and a current `status=REVIEWED`, `verdict=READY_FOR_HUMAN_APPROVAL` report may proceed to this separate human gate:

```bash
node src/index.mjs proposal approve <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --confirmed-by <real-reviewer> \
  --confirmation "Reviewed evidence, reasoning, Advisor citations, asset boundary, and evaluation case." \
  --evaluation-reviewed \
  --json

node src/index.mjs proposal publish <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --json
```

Policy-required Advisor failures return `BLOCKED`, persist a redacted Advisor Run, and block approval. Large group Graphs are reduced only for LLM input through the deterministic Advisor Policy projection; the complete Graph remains the source of record and projection coverage is reported. Policy may permit one structure/citation-only repair for invalid JSON or a rejected response contract; every attempt and its usage remain visible, and a failed repair stays blocked. For Source Roots, report the aggregate `advisorSummary` and each `proposals[].advisor` result. Repair the Advisor and start a fresh production run; do not attach approval to a failed Advisor run. Existing immutable asset versions are never overwritten.

The semantic Proposal reviewer is a second, independent LLM contract. Its verdict and suggestions belong to the Engine report, not the Guided Operator Skill. It cannot alter the deterministic decision, repair missing impact closure, approve, or publish. For multi-source repair, the Engine repeats the complete immutable source projection, accepts model-authored membership status, rationale, and citations, and canonicalizes source identity from that projection. Missing, duplicate, unknown, identity-mutated, empty-reference, cross-source-cited, failed, rejected, stale, digest-mismatched, or non-ready Review Reports block approval. Every mutating decision requires `--evaluation-reviewed`; all Evaluation cases must be approved, all required polarities must be represented, and the pack must be `READY`. Approval binds the current Review Report and stores an approved-content digest. Publication rereads those bindings and rejects any Proposal change made after approval.

Publication rebuilds the Delta from the exact `published` asset and Evaluation documents, then validates their schemas, digests, derived changes, impact fields, and references. It preflights every asset, Evaluation, and Delta destination before the first write. Existing immutable paths block the entire publication rather than leaving partial state.

## 7. Validate And Sign

```bash
node src/index.mjs asset v3-test --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs catalog v3-validate --workspace "$EVOPILOT_HARNESS_HOME" --json

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

The private key is created with owner-only permissions. Do not commit it.
