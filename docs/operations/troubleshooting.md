# Troubleshooting

## Public npm Version Is Missing

Check the exact Registry version:

```bash
npm view @evopilot/harness@4.1.1 version
```

If it is missing, stop. Use a locally verified release tarball or a source checkout. Do not silently install `latest`, another version, or an unreviewed package name.

## Agent Bootstrap Fails

Run the installed binary with JSON output:

```bash
evopilot-harness agent bootstrap \
  --host workbuddy \
  --workspace "$HOME/.evopilot-harness" \
  --json
```

- `MISSING_HOST`: choose a packaged host id.
- `UNSUPPORTED_HOST`: use one of the Adapters listed in `digital-expert/expert-manifest.yaml`.
- `ADAPTER_NOT_PACKAGED`: reject the package and reinstall the exact version.
- Workspace boundary failure: choose a writable path outside the installed package or source checkout.

Bootstrap does not edit Agent configuration or initialize the Workspace.

## WorkBuddy Shows No Harness MCP Tools

Verify the project `.mcp.json` uses the exact command from bootstrap. WorkBuddy project MCP servers require explicit approval. In headless mode set `enableAllProjectMcpServers=true` or list `evopilot-harness` in `enabledMcpjsonServers` according to WorkBuddy's documented settings.

If WorkBuddy reports `Unsupported MCP protocol version`, inspect both sides. The v4.1 release line supports `2025-11-25`, `2025-06-18`, `2025-03-26`, and `2024-11-05`; do not claim host compatibility outside that list.

If `inspect_capabilities` is denied because `DeferExecuteTool` requires approval, permit only `DeferExecuteTool` and `mcp__evopilot-harness__inspect_capabilities` for the read-only startup check. Do not use global `bypassPermissions` as acceptance evidence. Confirm the tool result has schema `evopilot-harness-operation-server-capabilities/v1` and compare every compatibility field before mutation.

## Installed Package Resolves Into A Checkout

Reject the result. `agent bootstrap` must report `distributionMode=installed-package` for installed operation, and package/Adapter paths must resolve below the installation's `node_modules/@evopilot/harness`, not the repository checkout. Run `npm run package:smoke` from the source candidate to reproduce the isolated installation contract.

## Feedback Package Is `REJECTED`

Run validation with JSON and inspect `failures[]`:

```bash
node src/index.mjs feedback validate /path/to/feedback.yaml \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --json
```

- `schema`: repair the v1 envelope.
- `approval`: export only after explicit approval.
- `redaction` or `redacted-payload-digest`: redact first, then recalculate both digests.
- `not-expired`: generate a fresh approved Package.
- `package-digest`: reject tampering and regenerate through the producer.
- `bundle-reference`, `profile-reference`, or `component:*`: reference exact published ids, versions, and digests.
- `bundle-component-closure`: include exactly the Components resolved by the Bundle.
- `package-id-conflict`: issue a new Package id; one id cannot identify different content.

Do not edit accepted Packages under `feedback/packages`. High Report uncertainty is not a runtime error: inspect sample count, independent sources, contexts, missing fields, and `uncertainty.reasons`.

## Comparison Package Is `REJECTED`

```bash
evopilot-harness comparison validate /path/to/comparison.yaml \
  --workspace "$EVOPILOT_HARNESS_HOME" --json
```

- `schema`, `package-digest`, or `payload-digest`: reject edited content and regenerate through the evidence producer.
- `approval`, `redaction`, `not-from-future`, or `not-expired`: obtain a fresh approved and redacted package; do not repair authority metadata automatically.
- `baseline-*` or `candidate-*`: bind exact published Catalog assets or the exact current Proposal and asset digests.
- `candidate-evaluation-pack`: bind the Proposal's current EvaluationPack id, version, and digest.
- `package-id-conflict`: issue a new package id; accepted content is immutable.

## Comparison Is `NON_COMPARABLE` Or Inconclusive

Read `comparability.checks[]`, `comparability.strata[]`, `uncertainty.reasons`, `conflicts`, and `limitations` from the report. A task, source snapshot, environment, model, toolchain, EvaluationPack, scorer set, metric definition, or asset-binding mismatch must remain in separate strata; never merge them manually. `NEED_MORE_EVIDENCE` requires more approved repetitions or sources. `CONFLICT` requires independent evidence review. `REVISE_CANDIDATE` and `ROLLBACK_RECOMMENDED` are non-executing recommendations.

## Rescore Or Proposal Approval Reports Drift

- `proposal-comparison-assessment-drift`: accepted comparison evidence changed after Proposal Review. Score again and rerun `proposal review`.
- stale report or replacement-chain failure: inspect the source report, current package digests, selected policy/scorer version, and rescore record; do not overwrite prior reports.
- report integrity failure: preserve the Workspace for audit and regenerate from immutable accepted packages.

## Calibration Is Blocked

Run `calibration validate` and inspect the exact case and report references. Every case set must be independently `APPROVED`; matching cases require a current Evidence Graph reference and both Match Policy files, while Proposal cases require a current Comparison Report and both Comparison Policy files. `NEED_MORE_REVIEWED_CASES` means the selected Comparison Policy minimum is not met. `REVISE_CANDIDATE_POLICY` is a recommendation; edit and review a new policy version outside calibration, then replay. Calibration never changes active policy.

## Session Stops At `EVIDENCE_REVIEW_REQUIRED`

This is expected. Present the entire bound Comparison or Calibration Report. Call `acknowledge_evidence_report_review` only after the human confirms review of the exact report id and digest. Acknowledgement cannot approve, publish, activate policy, roll back, or execute. If the digest changed, reload the report and present it again.

## v3 `proposal approve` Is Blocked

Inspect the draft and run the independent Review Engine:

```bash
node src/index.mjs proposal inspect <proposal-id> --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs proposal review <proposal-id> --workspace "$EVOPILOT_HARNESS_HOME" --models-file /path/to/models.json --json
```

- `proposal-review-required`: no formal report exists.
- `proposal-review-invalid`: the persisted report failed Schema validation.
- `proposal-review-stale`: the Proposal changed after review; rerun review.
- `proposal-review-verdict:*`: follow the report's `suggestedActions` and `nextAction`; do not approve.
- `semantic-proposal-review-required`: repair model configuration/connectivity or response-contract failure and rerun review.

Only `status=REVIEWED` and `verdict=READY_FOR_HUMAN_APPROVAL` permit a separate human approval. The verdict itself is not approval.

## `catalog validate` Fails With Missing `CATALOG.md`

Cause: the Catalog was not published or the wrong directory was passed.

Repair:

```bash
node src/index.mjs catalog publish --source harnesses --out published --json
node src/index.mjs catalog validate --source published --json
```

## `catalog validate` Fails With Missing Fenced Block

Cause: `CATALOG.md` does not contain the `yaml evopilot-harness-catalog` block.

Repair by republishing from source packs:

```bash
node src/index.mjs catalog publish --source harnesses --out published --json
```

## Evolution Is `BLOCKED`

Check:

```bash
node src/index.mjs evolution review <evolution-id> --json
```

Repair the validation blockers shown in `validation.blockers`, then rerun:

```bash
node src/index.mjs evolution advance <evolution-id> --json
```

## Approval Fails

Only `REVIEW_REQUIRED` runs can be approved. Review the run:

```bash
node src/index.mjs evolution review <evolution-id> --json
```

If the status is `CREATED`, advance it. If it is `BLOCKED`, repair validation blockers. If it is already `APPROVED` or `PUBLISHED`, do not approve it again.

## Hub Shows Missing Or Stale Catalog

Regenerate the Catalog and snapshot:

```bash
npm run catalog:publish
npm run catalog:validate
npm run hub:snapshot
```

Restart the Hub process:

```bash
node src/index.mjs hub serve --catalog published --source harnesses
```

## Production Log Contains Sensitive Text

The CLI redacts common token, password, secret, API key, authorization, and email patterns. It does not replace human review. Remove or mask sensitive material before adding logs.

## EvoPilot Does Not Select A Harness

Verify the Registry first:

```bash
node src/index.mjs registry validate --registry harness-registry.yaml --json
```

Then verify the published Catalog:

```bash
node src/index.mjs catalog validate --source published --json
```

Then verify EvoPilot is configured with the correct Registry file:

```bash
EVOPILOT_HARNESS_REGISTRY_CONFIG=/path/to/evopilot-harness/harness-registry.yaml
```

If the Catalog is valid but no Harness matches, evolve or create a better Harness in `evopilot-harness`, publish it, and regenerate the EvoPilot goal plan.
