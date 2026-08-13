# EvoPilot Harness CLI

> Command-line access to the independent v3 Harness asset factory, proposal lifecycle, signed Catalog, and Harness Hub.

The v3 CLI treats the Engine as read-only and writes user state under `EVOPILOT_HARNESS_HOME`. Its primary path is `workspace init` -> `produce` -> `proposal review` -> `proposal approve` -> `proposal publish` -> Catalog validation/signing. Legacy v2 commands remain available for migration compatibility.

## Install

From the repository:

```bash
npm install
node src/index.mjs --help
```

If the command is installed on the shell path, replace `node src/index.mjs` with `evopilot-harness` in the examples.

## Command Groups

| Group | Purpose |
|---|---|
| `catalog` | Publish or validate a usable Catalog directory. |
| `registry` | Publish or validate the multi-Catalog discovery file. |
| `harness` | List, inspect, validate, publish, or deprecate source packs. |
| `detect` | Build Source Profiles and choose candidate Harness targets before evolution. |
| `corpus` | Scan, group, dedupe, review, approve, and publish source-root Harness evolution. |
| `evolution` | Run the review-gated lifecycle for generated Harness changes. |
| `evolve` | One-command source scan, detect, draft, optional approval, and publication. |
| `hub` | Build a Hub snapshot or serve the browser UI. |

## JSON First

Use `--json` for automation:

```bash
node src/index.mjs harness list --json
node src/index.mjs catalog validate --source published --json
```

Human-readable output is intentionally short and can change. JSON schemas are described in [commands.md](commands.md).

For governed v3.3 execution feedback, start with [Feedback Evidence](../guides/feedback-evidence.md) and use `feedback inspect|validate|process|aggregate|report --json`. This path measures immutable published assets and never creates a Proposal or publishes an asset.

## Documentation

- [Agent Instructions](AGENTS.md)
- [Quickstart](quickstart.md)
- [Automation Rules](automation.md)
- [Workflows](workflows.md)
- [Commands](commands.md)
