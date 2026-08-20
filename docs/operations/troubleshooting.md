# Troubleshooting

## Public npm Version Is Missing

Check the exact Registry version:

```bash
npm view @evopilot/harness@4.0.2 version
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

If WorkBuddy reports `Unsupported MCP protocol version`, inspect both sides. v4.0.2 supports `2025-11-25`, `2025-06-18`, `2025-03-26`, and `2024-11-05`; do not claim host compatibility outside that list.

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
