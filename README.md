# EvoPilot Harness 0.1.0

Harness owns the native v1 quality lifecycle for Components, Profiles, Bundles and EvaluationPacks, plus read-only external Ontology semantic compatibility. Public root APIs are `inspectOntologyReference`, `validateHarness`, `evaluateHarness`, `buildDelivery`, `verifyDelivery`, `createHarnessSemanticRequirements` and `evaluateSemanticCompatibility`. Evaluation distinguishes PASS, FAIL, ERROR, INDETERMINATE and explicit N/A; severity and blocking remain independent. Missing evidence or rules never imply PASS; warnings do not trigger version changes or publication. Delivery construction leaves evaluation NOT_RUN and unresolved dependency material NOT_RESOLVED.

See the [normative v1 specification and API guide](specifications/v1/README.md), [template](specifications/v1/templates/harness.json) and [synthetic examples](examples/synthetic-harnesses.json). The `@evopilot-next/harness/sources` subpath exposes `listPublicSources` and `readPublicSource` for 101 preserved public documents. The [source guide](docs/public-assets.md) and [provenance](provenance/public-assets.json) explain their ownership and integrity. Archived recipes are data, never executable instructions.

The root module also exports `PRODUCT`, `VERSION` and `capabilities()`. The [durable service](docs/service.md) implements scoped lifecycle, exact publication dependencies, composed evaluation and source retention. Construction and discovery are read-only; persistence requires explicit initialization. The [semantic consumer](docs/semantic-consumer.md) compares supplied grounding evidence without producing or mutating Ontology assets.

The parent EvoPilot Preview composes Runtime, Harness and Ontology, including a native published Ontology resolver for Harness dependencies. Parent MCP, Expert and connection support are implemented. Installed MCP is passive; Expert is off by default and requires explicit Preview selection and task activation of the current stdio connection. Preview uses a namespace separate from the old product. These integration facts come from supplied operator verification; this standalone package does not deliver those parent surfaces.

Machine validation, explicit human decisions, quality evaluation, Runtime business execution and software Release remain separate. Root Host/plugin/production/release readiness flags remain false as package-local metadata; they do not supply candidate acceptance status. Service/CLI pending labels are package-local metadata, not the current parent integration status. Desktop/Host acceptance status is supplied separately in a local report bound to the exact candidate; without that report, no acceptance claim is made. M0 and technical tests do not establish Host acceptance. This is a 0.1.0 product, with no stable 1.0 or production-readiness claim.

The independent package bin is `evopilot-next-harness`; in a source checkout use `node src/cli.mjs`. Discovery needs no workspace. To explicitly initialize/inspect an operator-owned workspace, substitute a canonical absolute path with an existing parent outside any Git/source tree:

```sh
evopilot-next-harness capabilities
printf '%s\n' '{"operation":"workspace.inspect","scope":{"visibility":"public","projectId":"demo"},"input":{}}' | evopilot-next-harness request --workspace /absolute/operator/harness-workspace --workspace-id demo
```

See the [CLI guide](docs/cli.md) for complete write requests, revisions, idempotency, input limits and exit codes. The standalone CLI deliberately supplies no external Ontology resolver, so required external dependencies fail with `UNAVAILABLE_DEPENDENCY`. Embedding applications can configure the service resolver; the parent composition supplies it. There is no legacy fallback.

Use Node 24.14.0. In this independent source checkout, install from its own committed lock with `npm ci --ignore-scripts --no-audit --no-fund`, then:

```sh
npm run check
npm run build
npm test
```

The check/build script verifies the exact service export, owned imports and pinned vendor, and tests service construction/discovery with read-only filesystem permission. Vendor bytes need no regeneration. Only the parent canonical build regenerates vendor bytes. Installed tarballs omit development scripts/tests; these commands apply to source checkouts. Operator E2E tests require filesystem access for isolated temporary workspaces.

The current operator-verified baseline is 60 Harness technical tests passing with check/build, and 394 parent full-source tests passing with zero skips. Verified integration covers the three owned products, passive installed MCP, two adapters sharing one verified daemon, session isolation, CAS, restart receipts and workspace preservation on program uninstall. These results do not establish Desktop/Host acceptance or release authority.

The 101-document public archive exists and its hashes are verified. The 146 historical sources (101 public and 45 private) were imported only into an isolated acceptance workspace; they are not automatically approved or published native assets. Existing licenses and provenance retain their ownership. Advanced legacy feedback, calibration and matching algorithms are not all claimed as ported.

Read the [current roadmap](docs/roadmap.md) for remaining acceptance boundaries and approved 0.1.x real-project feedback scope. GitHub execution and software Release are not claimed complete.

## Source and Preview release distribution

The M5 source/CI/release-preparation scope covers [this Harness repository](https://github.com/yeliang-wang/evopilot-harness). The [v0.1.0 Preview release](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v0.1.0) is pending until published. See the parent [common release mechanics](https://github.com/yeliang-wang/evopilot/blob/main/docs/github-release.md) and [Codex plugin composition](https://github.com/yeliang-wang/evopilot).

CI and release preparation use Node 24.14.0. For Harness, `expected_digest` is the tarball SHA256 from the parent verified CI. The default `publish=false` permits preparation with publication disabled; publication requires validation against the external M5 target and an explicit user decision. Code, scripts and CI tests do not establish Host acceptance or release authority. Existing feature metadata and the M0–M4 baseline remain unchanged; this preparation adds no production-readiness claim.
