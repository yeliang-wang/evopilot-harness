# EvoPilot Harness · v0.8.0 Preview

[Quickstart](#quickstart) · [Documentation](docs/README.md) · [Standards](specifications/v1/README.md) · [Downloads](https://github.com/yeliang-wang/evopilot-harness/releases) · [Contribute](CONTRIBUTING.md)

Harness defines and verifies QA/SRE delivery criteria for projects developed with a third-party AI assistant. It turns explicit project requirements into reusable native policies, validates evidence, and preserves reviewed immutable deliveries. It does not run business builds, deployments or autonomous repairs.

Earlier **v0.6.0 Preview** introduced published runbook applicability, evidence-bound problem assessments and reviewed dispositions with preserved incident history. It retains the bounded online SLO measurements, authenticated alerts, native evaluation and execution feedback introduced in earlier versions. Read [response guidance](docs/response.md) and the [v0.6.0 release page](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v0.6.0) for distribution and publication records. Source and synthetic tests alone do not establish real-project acceptance.

v0.8 adds independent asset consumption, explicit L1/L2/L3 usability assessment, mandatory purpose/scope/level admission before reverse modeling, and controlled reconstruction with an independent fixed oracle. Verified L3 is limited to the reviewed functional slice and requires two clean complete reconstructions; it does not mean byte-identical source, whole-project coverage, production readiness or automatic release. See [the owning API](docs/usability.md) and the [v0.8.0 release](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v0.8.0).

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

For Codex, use the [parent installation and first-use guide](https://github.com/yeliang-wang/evopilot/blob/main/README.md#install-a-published-bundle). It supplies the unified plugin, private Workspace and pinned native toolchain; no separate Harness plugin is required.

For standalone library integration, obtain `evopilot-next-harness-0.8.0.tgz`, `harness-dependency-lock.json` and `SHA256SUMS` from the [v0.8.0 assets](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v0.8.0). Verify the downloaded bytes against `SHA256SUMS` before installation. The package contains compiled JavaScript and declarations; source-development commands below are not commands for an installed tarball. Packages are distributed through GitHub Releases, not an npm registry publication.

To develop from a source checkout, use Node 24.14.0 and a verified native toolchain prepared by the parent:

```sh
git clone --branch v0.8.0 https://github.com/yeliang-wang/evopilot-harness.git
cd evopilot-harness
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

## Response guidance and implementation languages

In v0.6, an immutable native package can carry a runbook whose exact service, environment, source, parameters and prerequisites must match the proposed response. Problem assessments preserve observed, suspected and confirmed explanations separately. Verified closure requires retained recovery and Runtime's independent verification; deferral and risk acceptance preserve the original quality result. See [the response API](docs/response.md), including schema-5 upgrade and recovery requirements.

Maintained service and decision logic uses strict TypeScript. Installed entry points run generated JavaScript; handwritten JavaScript is limited to build, packaging, checks, examples and tests. Harness rules remain native Rego, with JSON/YAML configuration. The parent owns the [cross-product language policy](https://github.com/yeliang-wang/evopilot/blob/main/docs/language-policy.md); the RDF/SHACL Python adapter belongs to Ontology, not Harness orchestration.
