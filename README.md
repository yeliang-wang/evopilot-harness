# EvoPilot Harness 0.1.0

Harness owns declarative checks and evaluation of supplied evidence. Public root APIs are `inspectOntologyReference`, `validateHarness`, `evaluateHarness`, `buildDelivery` and `verifyDelivery`. Evaluation distinguishes PASS, FAIL, ERROR, INDETERMINATE and explicit N/A; severity and blocking remain independent. Delivery construction leaves evaluation NOT_RUN and unresolved dependency material NOT_RESOLVED.

See the [normative v1 specification and API guide](specifications/v1/README.md), [template](specifications/v1/templates/harness.json) and [synthetic examples](examples/synthetic-harnesses.json). The `@evopilot-next/harness/sources` subpath exposes `listPublicSources` and `readPublicSource` for 101 preserved public documents. The [source guide](docs/public-assets.md) and [provenance](provenance/public-assets.json) explain their ownership and integrity. Archived recipes are data, never executable instructions.

All root APIs also expose `PRODUCT`, `VERSION` and `capabilities()`. Readiness remains false and reports convey no acceptance, execution or publication authority. Persistent lifecycle/services, workspace integration, CLI/MCP and unified Expert/plugin delivery remain under construction. This source is not stable 1.0 or production-ready, and does not establish M1 or full acceptance.

Use Node 24.14.0. In this independent source checkout, install from its own committed lock with `npm ci --ignore-scripts --no-audit --no-fund`, then:

```sh
npm run check
npm run build
npm test
```

Build verifies owned ESM sources and pinned vendor bytes; it needs no parent generator or sibling source. Only the parent canonical build regenerates vendor bytes. The same commands work in an unrelated standalone source copy. Installed tarballs omit development scripts/tests; these commands apply to source checkouts. Earlier specification guides describing a parent-first build refer to vendor regeneration, not a prerequisite for validating an existing pinned copy.

Read the [current roadmap](docs/roadmap.md). Final remote URL metadata and GitHub execution remain pending authorization. Local artifact rehearsal is technical evidence only. Licenses and provenance retain their existing ownership.
