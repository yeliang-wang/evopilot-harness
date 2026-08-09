# EvoPilot Harness CLI

> Command-line access to the independent Harness Factory, Catalog publisher, evolution workflow, and Harness Hub.

The CLI manages local repository state. It reads source Harness packs from `harnesses/`, detects source roles and target Harnesses, writes evolution runs under `.evopilot-harness/`, publishes usable Catalog files under `published/`, maintains `harness-registry.yaml`, and serves the standalone Harness Hub.

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

## Documentation

- [Agent Instructions](AGENTS.md)
- [Quickstart](quickstart.md)
- [Automation Rules](automation.md)
- [Workflows](workflows.md)
- [Commands](commands.md)
