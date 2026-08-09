# Source Harness Packs

This directory contains human-readable source Harness packs maintained by `evopilot-harness`.

EvoPilot automatically matches one published template when a project is onboarded and a goal loop target is submitted, but EvoPilot does not read this source directory directly. Run `evopilot-harness catalog publish` to produce the offline `published/` directory, then let EvoPilot mount that published Catalog.

## v2 Template Model

EvoPilot v2.2 keeps domain-first templates alongside the existing runtime/language templates. A domain template defines the product harness first, then records compatibility, architecture, implementation runtime profiles, project required actions, evidence adapters, and release blockers.

Current domain templates:

- `database-product-harness@2.2.0` for self-developed database products. PostgreSQL, MySQL, and similar systems are compatibility references or differential oracles, not the default evolution target.
- `api-gateway-harness@2.2.0` for gateway, ingress, traffic proxy, and service-mesh gateway products.

The existing Python, Java, Node, Go, observability, and generic management templates remain useful runtime or broad software-type baselines. Automatic matching gives strong database/gateway domain signals priority and uses language/runtime signals as a secondary layer.

## Pack Shape

Each template pack uses the same minimal directory shape:

```text
<template-id>/
  README.md
  template.yaml
  CHANGELOG.md
  examples/
    default-project-profile.yaml
```

`README.md` is for humans and AI agents. `template.yaml` is the structured server-authoritative source used for validation, versioning, digesting, and publishing. `CHANGELOG.md` explains version movement in normal text. `examples/` gives LLMs and administrators a concrete ProjectHarnessProfile shape.

## Publish Commands

```bash
evopilot-harness catalog publish --source harnesses --out published --json
evopilot-harness catalog validate --source published --json
evopilot-harness harness publish --name distributed-cache-harness --source harnesses --out published --json
```

Pack commands are intentionally small. Diff and review happen through Git and the readable files in this directory. The published Catalog is the artifact EvoPilot consumes through a server-side mount.

## Source-Driven Evolution

When a template should be upgraded from reviewable source material rather than direct file editing, run that evolution through EvoPilot's server-governed lifecycle, then bring the approved Harness definition back into this project if it should become a reusable Catalog asset:

```bash
evopilot harness template evolution create \
  --base-template python-enterprise-harness \
  --target-version 1.1.1 \
  --intent "Add stronger exception tracking, observability, and AI troubleshooting metadata." \
  --source github=fastapi/fastapi#master \
  --source url=https://opentelemetry.io/docs/languages/python/ \
  --source runtime-evidence=release-evidence-2026-08-python \
  --file ./workspace-observability-notes.md \
  --note "Require requestId/traceId/errorCode/nextAction in error logs." \
  --json
evopilot harness template evolution advance <evolution-id> --json
evopilot harness template evolution advance <evolution-id> --json
evopilot harness template evolution advance <evolution-id> --llm-profile platform-harness-llm --json
```

Stop at `REVIEW_REQUIRED`, inspect the generated draft pack, validation, diff, and source coverage, then publish only after explicit administrator approval:

```bash
evopilot harness template evolution approve <evolution-id> --confirmed-by <admin> --confirmation <text> --json
evopilot harness template evolution publish <evolution-id> --json
evopilot harness template evolution impact <evolution-id> --refresh --json
```

The EvoPilot lifecycle stores evidence under `<dataRoot>/harness-template-evolutions/<evolutionId>/`. This project stores the reusable source pack and publishes the Catalog. Existing active project profiles are not silently rewritten.
