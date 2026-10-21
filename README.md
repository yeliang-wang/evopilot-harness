# EvoPilot Harness

[Quickstart](#quickstart) · [Documentation](docs/README.md) · [Standards](specifications/v1/README.md) · [Downloads](https://github.com/yeliang-wang/evopilot-harness/releases) · [Contribute](CONTRIBUTING.md)

Harness defines and verifies QA/SRE delivery criteria for projects developed with a third-party AI assistant. It turns explicit project requirements into reusable native policies, validates evidence, and preserves reviewed immutable deliveries. It does not run business builds, deployments or autonomous repairs.

**v0.5.0 Preview** adds bounded online SLO measurements, authenticated alerts, native evaluation and reviewable repair/regression feedback while preserving the corrected native v1 standards. Use the Downloads page for published artifacts. Source and synthetic tests alone do not establish real-project acceptance.

This **v0.6.0 candidate** adds published runbook applicability, evidence-bound problem assessments and reviewed dispositions with preserved incident history. Read [the implementation guide](docs/response.md). Acceptance and installation require exact-candidate evidence; the v0.5 downloads below remain the previously published release. Core implementation uses strict TypeScript; generated JavaScript is the installed runtime format.

## Adopted standards

| Part | Basis | What EvoPilot adds |
|---|---|---|
| Rule language | [OPA Rego v1](https://www.openpolicyagent.org/docs/policy-language) | Stable rule IDs, source mappings and mandatory coverage |
| Quality evaluation | [Conftest 0.71.1](https://www.conftest.dev/options/) with embedded OPA 1.21.1 | Fixed configuration, pure capabilities, fail-on-warn and exact evidence identity |
| Rule tests | [OPA CLI 1.21.2](https://www.openpolicyagent.org/docs/policy-testing) and Conftest verify | Exact test IDs, positive/negative cases and cross-engine comparison |
| Online SLO configuration | [OpenSLO v1 implementation profile](specifications/online/v1/README.md), Prometheus and Alertmanager | Exact service/deployment binding, actual window/freshness evidence and explicit selection |
| Package and lifecycle | EvoPilot conventions | Source/requirement closure, review, explicit decision, immutable publication and receipts |

Rego and Conftest are upstream formats/tools, **not a universal industry Harness standard**. Read the [adoption table](specifications/v1/adoption.md), [machine-readable support matrix](specifications/v1/support-matrix.json), [directory rules](specifications/v1/directory-layout.json) and [conformance cases](specifications/v1/conformance-cases.json). `specifications/v1` is corrected directly; its actual digest distinguishes it from historical v1 semantics.

## Product boundaries

| Product | Responsibility |
|---|---|
| [Harness](https://github.com/yeliang-wang/evopilot-harness) | Quality policies, native validation and reviewed asset lifecycle |
| [Ontology](https://github.com/yeliang-wang/evopilot-ontology) | Native semantic definitions, relationships and constraints |
| [Runtime](https://github.com/yeliang-wang/evopilot-runtime) | Approved collection, protected evidence receipts, execution and project completion |
| [EvoPilot](https://github.com/yeliang-wang/evopilot) | Expert, Workspace, installer, composition and Codex plugin |

The parent supplies the Codex plugin; Harness does not require a separate plugin. The same standard supports forward design and reverse extraction, public and private projects. A successful policy run does not prove that the input was actually collected, or that the project scope was complete: Runtime checks those independently.

## Quickstart

Use Node 24.14.0 and the parent-installed pinned native toolchain:

```sh
npm ci --ignore-scripts
npm run build
npm run check
EVOPILOT_TEST_NATIVE_TOOLCHAIN=/absolute/path/to/verified/native-toolchain.json npm test
```

Build emits strict TypeScript declarations and JavaScript. Tests use temporary private states and synthetic fixtures. Missing native executables are a test failure, never a skipped acceptance result.

```js
import { createHarnessService } from '@evopilot-next/harness/service';
import { inspectHarnessStandard, validateNativeHarness } from '@evopilot-next/harness/native';
```

Follow the [native API and lifecycle guide](docs/native-harness.md), starting with the [synthetic native package builder](examples/native/package.mjs) and [runnable tutorial](examples/native/tutorial.mjs). Use original `policy/*.rego`, native `*_test.rego`, bounded JSON parameter data, source mappings and fixed cases. The owner lifecycle is **put → validate → review → decide → publish/readback**. Explicit decisions retain their own authority; warnings do not automatically trigger a release or repair.

Historical JSON operations and deliveries are retained read-only. Current writes use the corrected native package contract; converting the old JSON format alone does not count as re-extraction. See [re-extraction and history](specifications/v1/re-extraction.md).

## Documentation and contribution

- [Current native guide](docs/native-harness.md), [documentation index](docs/README.md), [Roadmap](docs/roadmap.md).
- [Preserved public sources](docs/public-assets.md): 101 archived documents remain inert reference material, not automatically approved native packages.
- [Contributing](CONTRIBUTING.md), [security](SECURITY.md), [license](LICENSE) and [notices](NOTICE).
- [Parent release procedure](https://github.com/yeliang-wang/evopilot/blob/main/docs/github-release.md).

Navigation takes inspiration from [OpenHands](https://github.com/OpenHands/OpenHands); wording is original and no affiliation is implied. Preview software and technical validation do not constitute a stable v1.0 or production-readiness guarantee.

Native approvals bind readable, digest-pinned evidence to the exact review, Workspace and operation. See [decision evidence](docs/native-decisions.md) for the format, historical readback and trusted-operator boundary.

## Execution feedback (v0.4)

v0.4 adds private, source-bound feedback through the public service API. This owner receives protected Runtime evidence and records reviewed impact, exact-version reuse or a new native delivery. Receiving evidence does not approve or publish assets. See [feedback](docs/feedback.md). Native v0.3 standard and contract bytes remain unchanged. Publication and exact installed acceptance are recorded separately.

## Online service assessment

See [online API and supported provider limits](docs/online-harness.md), the [profile/schema/provenance](specifications/online/v1/README.md) and [synthetic policy example](examples/native/online-package.mjs). Configuration is not a measurement. Missing or stale data is incomplete, and a finding cannot authorize a patch release or policy change. The parent supervises the explicitly started worker; Harness owns its durable evaluation records.
