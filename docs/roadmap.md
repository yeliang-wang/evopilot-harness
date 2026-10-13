# Harness 0.1.x roadmap

The [published v0.1.0 Preview](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v0.1.0) is the historical baseline. Its native v1 specification, fixtures, archived sources and provenance remain unchanged.

## v0.1.1 Preview edition

v0.1.1 Preview includes strict TypeScript source and compiled package delivery, operation-specific service response types, compiled-output tests, build/check ordering and indexed public documentation. The common release workflow and gate separate distribution preparation from explicitly authorized publication. See the [changelog](../CHANGELOG.md) and [documentation index](README.md).

Source verification runs build, check and full filesystem tests in order. Technical verification, Host acceptance and publication are separate decisions.

## Implemented capabilities

- Native v1 validation, supplied-evidence evaluation, deterministic delivery construction and verification for Components, Profiles, Bundles and EvaluationPacks.
- [Owned service](service.md) with scoped lifecycle, published dependency closure, composed evaluation, durable receipts, CAS, restart recovery and inert historical source retention.
- [Independent CLI](cli.md) with read-only discovery and one explicit service request per invocation. External Ontology resolution comes from trusted embedding code or parent composition.
- [Semantic compatibility](semantic-consumer.md), with unevaluated relations explicitly NOT_EVALUATED and no fabricated grounding evidence.
- A hash-verified archive of 101 public sources, retained as data rather than approved native assets.

## Integration and future work

[Parent EvoPilot](https://github.com/yeliang-wang/evopilot) owns Runtime/Harness/Ontology composition, MCP, Expert and Codex connection support. Its [first journey](https://github.com/yeliang-wang/evopilot/blob/main/docs/first-journey.md) contains the four flow guides. Installed MCP is passive; Expert requires explicit selection and activation. Package capability flags are not candidate acceptance status.

Further 0.1.x development is limited to approved real-project feedback. Advanced historical feedback, calibration and matching algorithms are not all claimed as ported. Stable 1.0 and production readiness are not claimed.

Machine validation, human decisions, asset publication, Runtime business completion, Host acceptance and software release remain separate. Candidate-specific acceptance and existing release authorization must be evaluated independently; this roadmap supplies neither. Preserve retained audit records and daily workspace data.
