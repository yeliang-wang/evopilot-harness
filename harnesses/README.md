# Source Harness Packs

This directory contains human-readable source Harness packs maintained by `evopilot-harness`.

EvoPilot does not read this source directory. Run `evopilot-harness catalog publish` to produce the usable `published/` Catalog directory, then configure EvoPilot with `harness-registry.yaml` through `EVOPILOT_HARNESS_REGISTRY_CONFIG`.

## Template Model

Domain templates define product evolution controls first, then record compatible runtime profiles, project actions, evidence adapters, and release blockers. Runtime and language templates remain useful fallback baselines, but domain signals should win when a source project clearly belongs to a business or technical domain.

Current domain templates include:

- `database-product-harness@2.3.0` for self-developed database products. PostgreSQL, MySQL, and similar systems are compatibility references or differential oracles, not the default evolution target.
- `api-gateway-harness@2.3.0` for gateway, ingress, traffic proxy, and service-mesh gateway products.
- `distributed-cache-harness@0.2.0` for self-developed distributed cache and key-value storage products.

## Pack Shape

Each template pack uses the same minimal directory shape:

```text
<template-id>/
  README.md
  template.yaml
  CHANGELOG.md
  examples/
    selected-harness-binding.yaml
```

`README.md` is for humans and AI agents. `template.yaml` is the structured source used for validation, versioning, digesting, and publishing. `CHANGELOG.md` explains version movement in normal text. `examples/` provides optional consumer binding examples; EvoPilot writes the real `selectedHarness` binding at goal plan time.

## Publish Commands

```bash
evopilot-harness harness list --json
evopilot-harness harness validate database-product-harness --strict --json
evopilot-harness harness publish database-product-harness --source harnesses --out published --json
evopilot-harness catalog publish --source harnesses --out published --strict --json
evopilot-harness catalog validate --source published --json
```

Pack commands are intentionally small. Review happens through Git, draft files, validation output, and the readable files in this directory. The published Catalog directory is the artifact EvoPilot consumes dynamically.

## Source-Driven Evolution

Use atomic lifecycle commands when an administrator wants full control:

```bash
evopilot-harness detect \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable Harness from this project." \
  --json
```

```bash
evopilot-harness evolution create \
  --source-project /path/to/source-project \
  --file ./architecture-notes.md \
  --production-log ./production-error.log \
  --goal "Create or evolve a distributed cache Harness." \
  --json

evopilot-harness evolution advance <evolution-id> --json
evopilot-harness evolution review <evolution-id> --json
evopilot-harness evolution approve <evolution-id> --confirmed-by <admin> --confirmation <text> --json
evopilot-harness evolution publish <evolution-id> --json
evopilot-harness evolution impact <evolution-id> --json
```

Use the one-command flow when a normal user should not need to understand the atomic lifecycle:

```bash
evopilot-harness evolve \
  --source-project /path/to/source-project \
  --goal "Create or evolve a reusable Harness from this project." \
  --approve-and-publish \
  --confirmed-by <admin> \
  --confirmation <text> \
  --json
```

Evolution evidence is stored under `.evopilot-harness/evolutions/<evolution-id>/`. Existing EvoPilot goal plans are not silently rewritten; new or regenerated plans can bind the newly published Harness version.
