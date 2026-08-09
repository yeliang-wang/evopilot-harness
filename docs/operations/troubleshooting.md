# Troubleshooting

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

Verify the published Catalog first:

```bash
node src/index.mjs catalog validate --source published --json
```

Then verify EvoPilot is configured with the correct directory:

```bash
EVOPILOT_HARNESS_CATALOG_DIRS=/path/to/evopilot-harness/published
```

If the Catalog is valid but no Harness matches, evolve or create a better Harness in `evopilot-harness`, publish it, and regenerate the EvoPilot goal plan.
