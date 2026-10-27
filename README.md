# EvoPilot Harness · v0.8.3 Preview

English | [简体中文](README_CN.md)

Harness turns explicit project requirements into reusable quality policies, evaluates evidence and preserves reviewed immutable deliveries. It owns QA/SRE criteria within [EvoPilot](https://github.com/yeliang-wang/evopilot/blob/main/README.md). [Ontology](https://github.com/yeliang-wang/evopilot-ontology/blob/main/README.md) owns semantic assets; [Runtime](https://github.com/yeliang-wang/evopilot-runtime/blob/main/README.md) owns collection, execution and project completion.

[Quickstart](#quickstart) · [Documentation](docs/README.md) · [Standards](specifications/v1/README.md) · [Release](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v0.8.3)

## Capabilities and standards

| Capability | Basis and responsibility |
|---|---|
| Native quality policies | Rego v1 rules, stable identities, source mappings and fixed coverage |
| Evaluation | Conftest 0.71.1 with embedded OPA 1.21.1, pure capabilities and fail-on-warn |
| Rule tests | OPA CLI 1.21.2, positive/negative cases and cross-engine comparison |
| Content readiness | Explicit v2 L1/L2/L3 review, qualification, gaps and freshness |
| Online assessment | Bounded OpenSLO v1 profile, Prometheus measurements and Alertmanager events |
| Feedback and response | Reviewed impact, exact-version reuse, runbook applicability and retained recovery evidence |

Rego and Conftest are upstream tools, not an industry-wide Harness lifecycle standard. EvoPilot defines its own package, coverage, review and delivery conventions. See the [adoption table](specifications/v1/adoption.md), [support matrix](specifications/v1/support-matrix.json) and [online profile](specifications/online/v1/README.md).

Harness does not run business builds, deployments or autonomous repairs. A successful policy evaluation alone does not prove actual collection or complete project coverage. Runtime checks the corresponding evidence independently.

## Quickstart

For Codex, use the [parent installation](https://github.com/yeliang-wang/evopilot/blob/main/docs/installation.md), unified Expert and pinned toolchain. No separate Harness plugin is required.

For standalone integration, obtain `evopilot-next-harness-0.8.3.tgz`, `harness-dependency-lock.json`, `source-revision.txt` and `SHA256SUMS` from [v0.8.3 Preview](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v0.8.3). Verify every downloaded file against `SHA256SUMS` and inspect the source revision. Packages contain compiled JavaScript and declarations; GitHub Releases is the distribution channel, not an npm registry. See [native integration](docs/native-harness.md).

For source development, use **Node 24.14.0** and a verified native toolchain prepared through the parent:

```sh
git clone --branch v0.8.3 https://github.com/yeliang-wang/evopilot-harness.git
cd evopilot-harness
npm ci --ignore-scripts
npm run build
npm run check
EVOPILOT_TEST_NATIVE_TOOLCHAIN=/absolute/path/to/verified/native-toolchain.json npm test
```

These are source-maintainer commands, not commands for an installed tarball. Build emits strict TypeScript declarations and JavaScript. Tests use isolated state and synthetic fixtures; missing native tools fail explicitly.

```js
import { createHarnessService } from '@evopilot-next/harness/service';
import { inspectHarnessStandard, validateNativeHarness } from '@evopilot-next/harness/native';
```

Follow the [native lifecycle](docs/native-harness.md) and [synthetic tutorial](examples/native/tutorial.mjs): **put → validate → review → decide → publish/readback**. Rules remain native `policy/*.rego` and `*_test.rego`, with bounded parameters and source mappings. Actual human decisions remain separate from validation. Historical JSON writes are retired; converting an old format is not re-extraction.

## Content levels and operational boundaries

Current grading selects `standardVersion: "v2"`: L1 domain understanding, L2 implementation specifications, L3 reconstruction specification completeness. `assetAssessment` and `reconstructionVerification` remain independent. L3 does not require reconstruction or the original running environment; `L3 / NOT_REQUESTED` is valid. It does not prove generated functional equivalence, identical code, production readiness or release authority. Historical usability v1 records retain their original semantics. See [readiness v2](docs/readiness-v2.md).

Online configuration is not a measurement. Required missing or stale data remains incomplete. The parent supervises an explicitly enabled worker; Harness owns durable evaluation records. Findings, received feedback and passing checks do not authorize repairs, policy changes, asset publication or patch releases. [Response guidance](docs/response.md) distinguishes observations, suspected causes, confirmed causes and independently verified recovery.

<a id="response-guidance-and-implementation-languages"></a>

## Documentation and contribution

- [Documentation index](docs/README.md), [native decisions](docs/native-decisions.md), [readable API](docs/readable-api.md) and [feedback](docs/feedback.md).
- [Online API and provider limits](docs/online-harness.md), [archived public references](docs/public-assets.md) and [re-extraction](specifications/v1/re-extraction.md).
- [Changelog](CHANGELOG.md), [Roadmap](docs/roadmap.md), [contributing](CONTRIBUTING.md) and [bilingual maintenance](docs/documentation-languages.md).
- [Security](SECURITY.md), [Apache-2.0 license](LICENSE) and [notices](NOTICE).

Service and decision logic uses strict TypeScript; installed processes use compiled JavaScript. Rego remains the policy language. The [parent language policy](https://github.com/yeliang-wang/evopilot/blob/main/docs/language-policy.md) defines the boundaries. Preview and synthetic tests do not establish production readiness or GA.

Documentation navigation draws inspiration from [OpenHands](https://github.com/OpenHands/OpenHands); wording is independently written and no affiliation is implied.

These source pages include documentation improvements after v0.8.3. Existing tagged archives retain their original documentation; future releases package the updated pages.
