# EvoPilot Harness 0.1.0

Harness owns declarative checks and evaluation of supplied evidence. Public root APIs are `inspectOntologyReference`, `validateHarness`, `evaluateHarness`, `buildDelivery` and `verifyDelivery`. Evaluation distinguishes PASS, FAIL, ERROR, INDETERMINATE and explicit N/A; severity and blocking remain independent. Delivery construction leaves evaluation NOT_RUN and unresolved dependency material NOT_RESOLVED.

See the [normative v1 specification and API guide](specifications/v1/README.md), [template](specifications/v1/templates/harness.json) and [synthetic examples](examples/synthetic-harnesses.json). The `@evopilot-next/harness/sources` subpath exposes `listPublicSources` and `readPublicSource` for 101 preserved public documents. The [source guide](docs/public-assets.md) and [provenance](provenance/public-assets.json) explain their ownership and integrity. Archived recipes are data, never executable instructions.

All root APIs also expose `PRODUCT`, `VERSION` and `capabilities()`. Pure-core readiness remains false and reports convey no acceptance, execution or publication authority. The `@evopilot-next/harness/service` subpath provides the [local M2 durable service](docs/service.md): scoped lifecycle, exact publication dependencies, Component and composed evaluation, and lossless historical source retention. The standalone CLI exposes one explicit owned request per invocation. Operator filesystem verification, configured imports, M3 parent provider wiring, full plugin/MCP and unified Expert/Host delivery remain pending. This source is not stable 1.0 or production-ready, and does not establish M1 or full acceptance.

The independent package bin is `evopilot-next-harness`; in a source checkout use `node src/cli.mjs`. Discovery needs no workspace. To explicitly initialize/inspect an operator-owned workspace, substitute a canonical absolute path with an existing parent outside any Git/source tree:

```sh
evopilot-next-harness capabilities
printf '%s\n' '{"operation":"workspace.inspect","scope":{"visibility":"public","projectId":"demo"},"input":{}}' | evopilot-next-harness request --workspace /absolute/operator/harness-workspace --workspace-id demo
```

See the [CLI guide](docs/cli.md) for complete write requests, revisions, idempotency, input limits and exit codes. Standalone Ontology dependencies require an unavailable external provider; there is no legacy fallback.

Use Node 24.14.0. In this independent source checkout, install from its own committed lock with `npm ci --ignore-scripts --no-audit --no-fund`, then:

```sh
npm run check
npm run build
npm test
```

The check/build script verifies the exact service export, owned imports and pinned vendor, and tests service construction/discovery with read-only filesystem permission. Vendor bytes need no regeneration. Only the parent canonical build regenerates vendor bytes. Installed tarballs omit development scripts/tests; these commands apply to source checkouts. Operator E2E tests require filesystem access for isolated temporary workspaces.

Read the [current roadmap](docs/roadmap.md). Final remote URL metadata and GitHub execution remain pending authorization. Local artifact rehearsal is technical evidence only. Licenses and provenance retain their existing ownership.
