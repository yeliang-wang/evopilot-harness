# EvoPilot Harness

[Quickstart](#quickstart) · [Documentation](docs/README.md) · [Downloads](https://github.com/yeliang-wang/evopilot-harness/releases) · [Contribute](CONTRIBUTING.md)

Harness defines reusable QA and delivery-evidence standards for EvoPilot projects. It validates declarative checks, evaluates supplied evidence, and packages deterministic deliveries with traceable source mappings. It does not execute repairs or infer business acceptance.

**v0.2.0 Preview** provides strict TypeScript source, compiled package exports and typed service responses. The published **[v0.1.0 Preview](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v0.1.0)** remains the historical baseline. See the [changelog](CHANGELOG.md) and [roadmap](docs/roadmap.md).

## Product boundaries

| Product | Responsibility |
| --- | --- |
| [Harness](https://github.com/yeliang-wang/evopilot-harness) | QA definitions, evidence evaluation, asset review and delivery lifecycle |
| [Runtime](https://github.com/yeliang-wang/evopilot-runtime) | Projects, goals, execution, credentials, decisions and audit; consumption of published Harness deliveries |
| [Ontology](https://github.com/yeliang-wang/evopilot-ontology) | Semantic definitions, grounding and instance validation |
| [Parent EvoPilot](https://github.com/yeliang-wang/evopilot) | Product composition, MCP and Expert connection |

For Codex, use the [parent plugin connection instructions](https://github.com/yeliang-wang/evopilot#readme); an independent Harness Codex plugin is not required. The four end-to-end flow guides live in the parent's [first journey](https://github.com/yeliang-wang/evopilot/blob/main/docs/first-journey.md). Standalone Harness supplies its CLI and compiled package API.

## Quickstart

Use Node 24.14.0 or later within the supported Node 24 baseline. From this repository's source checkout:

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
node dist/cli.js help
node dist/cli.js version
```

TypeScript compiles from `src/*.ts` to `dist/*.js` with declarations. Build cleans only generated `dist`; check verifies strict types, package consumer contracts, owned imports and pinned vendor integrity. Full tests create isolated temporary workspaces. These commands describe local verification, not a claim of passing CI or Host acceptance.

Download a published Preview tarball from [releases](https://github.com/yeliang-wang/evopilot-harness/releases) and install that local file with `npm install /absolute/path/to/downloaded-package.tgz`. Installed tarballs contain compiled JavaScript and type declarations; they omit development scripts/tests. ESM consumers use the package exports:

```js
import { validateHarness, evaluateHarness, buildDelivery } from '@evopilot-next/harness';
import { createHarnessService } from '@evopilot-next/harness/service';
```

The installed command is `evopilot-next-harness`. Discovery needs no workspace. Persistent operations require an explicit isolated workspace and initialization; see the [CLI guide](docs/cli.md) and [service API](docs/service.md). The standalone CLI supplies no external Ontology resolver. Embedders configure a trusted resolver; parent composition supplies one.

## Assets and provenance

The [native v1 specification](specifications/v1/README.md) defines HarnessComponent checks, HarnessProfile component groups, HarnessBundle profile groups, and EvaluationPack checks with pinned dependencies. Start with the [template](specifications/v1/templates/harness.json) and [synthetic examples](examples/synthetic-harnesses.json).

Definitions declare objectives, deliverables, inputs, parameters, preconditions and rules. Forward provenance connects designed requirements to their sources; reverse provenance records observed source material and its inferred definitions. Every semantic row carries source mappings tied to source locator, revision and status. Hashes preserve reproducibility; they do not authenticate outside observations.

Public and private project scopes remain explicit. Public assets cannot depend on private material; private references stay within their project. Runtime consumes exact published deliveries, not unreviewed drafts. Publication requires a current review, explicit decision and resolved dependencies; published versions are immutable.

Extensions are additive, versioned namespace records. They cannot override base fields. Unsupported required extensions fail validation; optional unknown extensions remain inert and `NOT_EVALUATED`. Evolve extensions through explicit versions instead of rewriting the frozen v1 format.

## Evidence and decisions

Evaluation reports distinguish `PASS`, `FAIL`, `ERROR`, `INDETERMINATE` and explicit `N/A`. Missing evidence or zero checks never imply success. Severity and blocking are independent: a failed nonblocking warning remains `FAIL`. A warning does not automatically publish, bump a version or launch repair.

Pure delivery construction leaves evaluation `NOT_RUN` and unresolved dependencies `NOT_RESOLVED`. Deterministic reports, capability flags, schema validity and successful tests provide technical evidence. Human decisions, asset publication, Runtime business completion, Host acceptance and software release each retain their own authority boundary.

The introductory layout and navigation acknowledge [OpenHands](https://github.com/OpenHands/OpenHands) as inspiration. The wording is original; no affiliation or endorsement is implied.

## Documentation and contribution

- [Documentation index](docs/README.md).
- [Service lifecycle and typed responses](docs/service.md), [CLI requests and receipts](docs/cli.md), and [semantic compatibility](docs/semantic-consumer.md).
- [Preserved public sources](docs/public-assets.md) and [archive provenance](provenance/public-assets.json): 101 documents retained as inert data, not automatically approved native assets.
- [Contributing](CONTRIBUTING.md), [security boundary](SECURITY.md), [Apache-2.0 license](LICENSE) and [notices](NOTICE).

Repository: [yeliang-wang/evopilot-harness](https://github.com/yeliang-wang/evopilot-harness). Common release mechanics belong to the [parent release guide](https://github.com/yeliang-wang/evopilot/blob/main/docs/github-release.md). No stable 1.0 or production-readiness claim is made.
