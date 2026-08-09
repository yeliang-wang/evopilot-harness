# Catalog Contract

The published Catalog is the offline directory EvoPilot reads.

## Directory Shape

```text
published/
  CATALOG.md
  <harness-id>/<version>/template.yaml
  <harness-id>/<version>/README.md
  <harness-id>/<version>/CHANGELOG.md
  <harness-id>/<version>/examples/selected-harness-binding.yaml
```

`CATALOG.md` is the index. Each `entries[].path` points to a published `template.yaml` or `harness.yaml` file under the same directory.

## Markdown Index

`CATALOG.md` must contain a fenced YAML block named `evopilot-harness-catalog`:

```yaml
catalogVersion: 1
catalogId: evopilot-public-harness-catalog
generatedAt: 2026-08-09T05:24:19.115Z
compatibleEvopilot: ">=3.0.0"
entries:
  - name: database-product-harness
    version: 2.2.0
    layer: domain
    domain: database-product
    status: published
    path: ./database-product-harness/2.2.0/template.yaml
    digest: sha256:...
    tags:
      - database
      - product
    matchSummary: Domain baseline for self-developed database products.
```

## Entry Fields

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Harness id. |
| `version` | yes | Published Harness version. |
| `layer` | yes | `domain` or `runtime`. |
| `domain` | for domain | Domain id used for matching and evidence. |
| `status` | yes | `published` or `deprecated`. |
| `path` | yes | Relative path to template file under the Catalog root. |
| `digest` | yes | SHA-256 digest of the source template text. |
| `tags` | recommended | Matching and browsing signals. |
| `matchSummary` | recommended | Human-readable match description. |

## Validation

```bash
node src/index.mjs catalog validate --source published --json
```

Validation checks:

- `CATALOG.md` exists
- fenced `evopilot-harness-catalog` block exists
- every entry path stays under the Catalog root
- every entry path exists
- each referenced domain template has required actions, evidence adapters, and release blockers

## EvoPilot Read Rule

EvoPilot reads the Catalog directory dynamically and records the selected entry digest in `plan.selectedHarness`. It must not mutate the Catalog.
