# Source To Harness

This guide explains how source material becomes a Harness draft.

## Supported Inputs

| Input | CLI Option | Behavior |
|---|---|---|
| Source project | `--source-project <path>` | Scans code, docs, manifests, and selected text files. |
| Supporting file | `--file <path>` | Adds text material or records binary attachment digest. |
| Attachment | `--attachment <path>` | Alias for supporting file. |
| Production log | `--production-log <path>` | Adds text after common-pattern redaction. |
| Administrator note | `--note <text>` | Adds human context. |

## Source Project Scan

The scan skips generated or heavy directories such as `.git`, `node_modules`, `dist`, `build`, `target`, `.next`, `coverage`, and `.evopilot-harness`.

It reads common source and documentation files, including:

```text
README
architecture/design/overview files
docs/
.github/
package manifests
Dockerfile and Compose files
*.md, *.txt, *.yaml, *.json, *.toml, *.xml
*.go, *.java, *.rs, *.py, *.ts, *.js
```

The scan is bounded. It records file counts, selected files, top extensions, and extracted text excerpts.

## Auto Match

The CLI builds a local corpus from the supplied sources and compares it against existing Harness pack signals:

- template id
- name
- description
- domain
- runtime profiles
- match signals
- Catalog tags

Possible decisions:

| Decision | Meaning |
|---|---|
| `EVOLVE_EXISTING` | The best match meets the threshold and becomes the target Harness. |
| `FORK_FROM_MATCH` | A match exists, but a different explicit target id was requested. |
| `CREATE_NEW` | No confident match exists; the CLI creates a new domain Harness draft. |

The default threshold is `0.08`. Use `--match-threshold` to tune it and `--target-id` to force a target id.

## Draft Output

Draft files are written under:

```text
.evopilot-harness/evolutions/<evolution-id>/draft/
  template.yaml
  README.md
  CHANGELOG.md
  examples/selected-harness-binding.yaml
```

Review these files before approval.

## Publication

Publication copies the draft into `harnesses/<harness-id>/`, republishes `published/`, and updates `CATALOG.md`.

```bash
node src/index.mjs evolution publish <evolution-id> --json
node src/index.mjs catalog validate --source published --json
```
