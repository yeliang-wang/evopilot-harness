# EvoPilot Harness CLI

> Command-line access to the independent Harness asset factory, controlled comparative evidence, proposal lifecycle, signed Catalog, and Harness Hub.

The v3 CLI treats the Engine as read-only and writes user state under `EVOPILOT_HARNESS_HOME`. Its primary path is `workspace init` -> `produce` -> `proposal validate` -> `proposal review` -> `proposal approve` -> `proposal publish` -> Catalog validation/signing. `NO_CHANGE` and `NEED_MORE_EVIDENCE` stop before review/approval/publication. Legacy v2 commands remain available for migration compatibility.

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
| `comparison` | Inspect, validate, ingest, score, read, process, or append-only rescore Baseline/Candidate evidence. |
| `calibration` | Validate, ingest, replay, and read independently reviewed policy calibration cases. |
| `hub` | Build a Hub snapshot or serve the browser UI. |

## JSON First

Use `--json` for automation:

```bash
node src/index.mjs harness list --json
node src/index.mjs catalog validate --source published --json
```

Human-readable output is intentionally short and can change. JSON schemas are described in [commands.md](commands.md).

For governed v3.3 execution feedback, start with [Feedback Evidence](../guides/feedback-evidence.md) and use `feedback inspect|validate|process|aggregate|report --json`. This path measures immutable published assets and never creates a Proposal or publishes an asset.

For v4.1 controlled Baseline/Candidate evidence, start with [Controlled Comparative Evidence](../guides/controlled-comparative-evidence.md) and use `comparison ... --json` or `calibration ... --json`. These paths consume externally produced evidence and make bounded recommendations; they never execute either asset, mutate active policy, approve, publish, or roll back.

## Documentation

- [Agent Instructions](AGENTS.md)
- [Quickstart](quickstart.md)
- [Automation Rules](automation.md)
- [Workflows](workflows.md)
- [Commands](commands.md)
