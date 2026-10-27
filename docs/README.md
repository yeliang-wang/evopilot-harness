# Harness documentation

Harness v0.8.3 Preview adds readable policy reports and exact-version comparisons to corrected native Rego/Conftest standards, registered execution feedback, bounded online assessment and reviewed response guidance/problem dispositions. Historical Preview records remain readable. Start with the [quickstart](../README.md#quickstart).

English | [简体中文](zh-CN/README.md)

## Guides and reference

- [Current native guide and typed API](native-harness.md): standards, toolchain, package lifecycle, execution reports and recovery.

- [Registered execution feedback](feedback.md): owner review, exact reuse and new delivery proposals.
- [Response guidance and problem disposition](response.md): published runbooks, problem review, independent recovery and retained history.
- [Native decision evidence](native-decisions.md): review-bound human decisions and historical readback.
- [CLI guide](cli.md): discovery, explicit workspace requests and retained receipts.
- [Service API](service.md): typed operations, lifecycle, dependencies and persistence limits.
- [Native v1 specification](../specifications/v1/README.md): asset formats and validation rules.
- [Semantic compatibility](semantic-consumer.md): grounding inputs and evaluation boundaries.
- [Preserved public sources](public-assets.md): archive access and provenance.
- [Roadmap](roadmap.md): Preview capabilities and future direction.
- [Changelog](../CHANGELOG.md): edition changes and historical releases.

## Contribution and integration

- [Contributing](../CONTRIBUTING.md), [security](../SECURITY.md), [license](../LICENSE) and [notices](../NOTICE).
- [Parent EvoPilot](https://github.com/yeliang-wang/evopilot): product composition, MCP, Expert and Codex connection.
- [Parent flow guides](https://github.com/yeliang-wang/evopilot/blob/main/docs/first-journey.md) and [release procedure](https://github.com/yeliang-wang/evopilot/blob/main/docs/github-release.md).

Preview documentation describes software capabilities; technical checks do not establish business acceptance or production readiness.

## Online integration, introduced in v0.5

[Online API](online-harness.md) and [OpenSLO implementation profile](../specifications/online/v1/README.md) define inputs, actual evidence, limits and state recovery.

## v0.6 response guidance

Read [published runbook applicability, evidence-bound problem assessments and reviewed dispositions with preserved incident history](response.md). The additive response API preserves native v1 specifications and uses schema reader floor 5. Exact installation evidence stays private; the [v0.6.0 release record](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v0.6.0) identifies public distribution. See also the [implementation language boundaries](../README.md#response-guidance-and-implementation-languages).

## v0.7.0 Preview

Read [owner-readable API](readable-api.md) for exact snapshots, table-first reports and bounded comparisons. Native v1 formats and validators remain unchanged. The [v0.7.0 Preview release](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v0.7.0) records publication. Installing it and accepting a business project remain separate operations.

## Documentation maintenance

This default branch includes post-release documentation corrections for v0.7.0. Original tagged archives are immutable. See the [documentation correction policy](https://github.com/yeliang-wang/evopilot/blob/main/docs/github-release.md#documentation-corrections-after-publication).

## Historical usability v1 authoring admission

The additive [usability preflight SDK](usability.md) checks scoped L1/L2 specification coverage and exposes gaps. It does not award a verified level. This historical v1 addition does not define the current v2 content grade.


## v0.8.3 Preview

Current content grading explicitly selects `standardVersion: "v2"`: L1 covers domain understanding, L2 implementation specifications, and L3 reconstruction specification completeness. L3 does not require software reconstruction or access to the original runtime environment. `assetAssessment` and `reconstructionVerification` remain independent; `L3 / NOT_REQUESTED` is valid and makes no generated-equivalence claim. Read the [current v2 API](readiness-v2.md). Publication and project acceptance retain separate evidence.

### Historical usability v1

Historical v0.8.0 usability v1 added independent asset consumption, explicit L1/L2/L3 usability assessment, mandatory purpose/scope/level admission before reverse modeling, and controlled reconstruction with an independent fixed oracle. Verified L3 is limited to the reviewed functional slice and requires two clean complete reconstructions; it does not mean byte-identical source, whole-project coverage, production readiness or automatic release. Read [the retained v1 workflow/API](usability.md). Publication and project acceptance retain separate evidence.

- [Asset readiness v2 API](readiness-v2.md)
