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

Nested modules are deduplicated by default. Add `--include-modules` only when modules are independent project evidence units. Every discovered project first receives its own Evidence Graph and reasoning result. Runs are then grouped by selected existing Profile, proposed new Profile, or composed Bundle target. Each group receives a merged, re-indexed Evidence Graph and exactly one review-stage Proposal. Shared execution-only evidence is never used to guess a domain; such projects remain `unclassified-engineering` until Advisor and human review add justified domain evidence.

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

Stop when `status` is `REVIEW_REQUIRED`. Show these fields to the owner:

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
advisor.model
advisor.usage
proposal.proposedAssets
proposal.validations
proposal.blockers
proposal.evaluationStatus
nextAction
```

```bash
node src/index.mjs proposal review <proposal-id> \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --json
```

## 6. Approve And Publish

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

Policy-required Advisor failures block approval. Existing immutable asset versions are never overwritten.

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
