# Harness roadmap

Harness owns project QA and delivery rules, evidence evaluation, and immutable Harness deliveries. Runtime owns execution, project decisions and business completion; Ontology owns domain models. The [parent roadmap](https://github.com/yeliang-wang/evopilot/blob/main/docs/roadmap.md) coordinates cross-product goals and v1.0 readiness. Recording a future goal here is not implementation, acceptance or release authority.

The [published v0.1.0 Preview](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v0.1.0) is the historical baseline. Its published specifications, fixtures, archived sources and provenance remain retained unchanged. The approved correction of the current `specifications/v1` below does not rewrite those historical records.

## v0.1.1 Preview edition

v0.1.1 Preview includes strict TypeScript source and compiled package delivery, operation-specific service response types, compiled-output tests, build/check ordering and indexed public documentation. The common release workflow and gate separate distribution preparation from explicitly authorized publication. See the [changelog](../CHANGELOG.md) and [documentation index](README.md).

Source verification runs build, check and full filesystem tests in order. Technical verification, Host acceptance and publication are separate decisions.

## Existing source capabilities

These describe the source interfaces, not evidence that a particular candidate has passed project, Host or release acceptance.

- Native v1 validation, supplied-evidence evaluation, deterministic delivery construction and verification for Components, Profiles, Bundles and EvaluationPacks.
- [Owned service](service.md) with scoped lifecycle, published dependency closure, composed evaluation, durable receipts, CAS, restart recovery and inert historical source retention.
- [Independent CLI](cli.md) with read-only discovery and one explicit service request per invocation. External Ontology resolution comes from trusted embedding code or parent composition.
- [Semantic compatibility](semantic-consumer.md), with unevaluated relations explicitly NOT_EVALUATED and no fabricated grounding evidence.
- A hash-verified archive of 101 public sources, retained as data rather than approved native assets.

## v0.2.0 Workspace scope

The package currently identifies as v0.2.0. The parent owns first-use Workspace initialization, the private editable project root, Expert guidance and connection changes. Harness owns its protected service state and the [snapshot and relocation API](service.md#same-host-workspace-snapshots-and-relocation). The owner verifies identity, retained record and blob digests, and same-host location lineage; it does not copy an entire Workspace or switch the Host connection. Relocation preserves existing decisions, immutable deliveries, receipts and audit records. These interfaces and their stated limits are not a claim of candidate-specific cutover or release acceptance.

## v0.3.0 Preview: standards correction

Status: **IMPLEMENTING** under the user-approved parent `governance/standards-v03.json` Target. Exact-candidate acceptance and conditional Preview release remain pending; this Roadmap is not a certificate.

Directly correct `specifications/v1`; do not create `specifications/v2` to avoid repairing the existing definition. Adopt native Rego v1 with OPA and Conftest, with explicit supported semantics, exact tool/configuration identities, and upstream positive/negative conformance examples. Clearly distinguish upstream policy semantics from EvoPilot's package, source, directory, evidence and decision conventions.

The approved scope includes:

- Typed configuration and normalized evidence input, stable rule/query/test IDs, native Rego policies and tests, and a fixed required acceptance inventory independent of produced results.
- Required positive, targeted negative, missing-input and boundary cases; empty rules/tests, wrong namespaces, skipped required cases, warning gates, invalid input, evaluator errors and timeouts must not become successful completion.
- Recorded effective configuration and restricted evaluator capabilities. Environment overrides or changed parameters must invalidate evidence that was approved for a different configuration.
- Runtime-controlled collection of actual source/execution evidence, followed by Harness evaluation. Imported or synthetic results remain explicitly identified; evaluation does not prove that a claimed command ran.
- Owner-controlled review, immutable delivery and readback, source/rule/configuration/report binding, and independent native-tool replay without a running EvoPilot service.
- Fresh extraction for projects affected by the corrected standard, with old bytes and historical decisions retained. Old approval or PASS is not approval under the corrected standard. The same `v1` directory name is insufficient identity; compare the actual specification digest.
- README and technical documentation identifying standards, upstream implementations, supported subsets, limitations and tests. Generic synthetic examples are public; real private project assets and progress remain private.

The first implementation gate must prove installation, native evaluation, positive/negative behavior, the minimum Runtime evidence flow and recovery in isolation. The approved Target then requires exact-candidate product, integration, user-journey and installation acceptance; this roadmap does not assert any such result. Mandatory IDs, positive/negative tests, source binding and independent replay belong to this proposal and must not be deferred into the future goals below.

## Integration and future work

[Parent EvoPilot](https://github.com/yeliang-wang/evopilot) owns Runtime/Harness/Ontology composition, MCP, Expert and Codex connection support. Its [first journey](https://github.com/yeliang-wang/evopilot/blob/main/docs/first-journey.md) contains the four flow guides. Installed MCP is passive; Expert requires explicit selection and activation. Package capability flags are not candidate acceptance status.

The historical 0.1.x repair scope limited that line to approved real-project feedback; it does not restrict the separately approved v0.2.0 Workspace scope or itself approve v0.3.0; that authority is recorded by the separate approved Target. Advanced historical feedback, calibration and matching algorithms are not all claimed as ported. Stable 1.0 and production readiness are not claimed.

Machine validation, human decisions, asset publication, Runtime business completion, Host acceptance and software release remain separate. Candidate-specific acceptance and existing release authorization must be evaluated independently; this roadmap supplies neither. Preserve retained audit records and daily workspace data.

## Future goals beyond the v0.3.0 correction

The goals below are **NOT SCHEDULED**. `CANDIDATE` records a follow-up direction; `CONDITIONAL_RESEARCH` first requires a concrete need and feasibility review. They have no committed software version or date. Each requires a separately reviewed Target with scope, compatibility impact and measurable acceptance before implementation. They are not automatically additional conditions for v1.0; the parent readiness contract remains authoritative. A trigger is a reason to review a goal, not permission to start work.

### HAR-F01 — Policy quality, diagnostics and scale

**Status:** `CANDIDATE`; not scheduled.

**Trigger:** real project adoption reveals gaps that required rule IDs and positive/negative cases cannot adequately diagnose, or a measured policy/evidence workload exceeds the current bounded operating profile.

**Scope:** add native policy coverage analysis, systematic mutation-quality evaluation, clearer source-linked failure diagnostics and reproducible scale/performance measurements. Historical feedback may support reviewed rule improvements when representative, labeled evidence exists. Keep original observations, false-positive/false-negative findings and evaluation context; never automatically lower thresholds or convert prior failures to passes.

**Acceptance:** pin a representative corpus, tool versions, resource limits and agreed performance budgets before implementation; execute identical workloads through upstream tools and the adapter; account for required tests independently of statement coverage; demonstrate that agreed rule mutations are detected; measure time/memory and prove that limit errors remain errors rather than truncated PASS results. Reproduce diagnostics against exact rule/query/source IDs. Any calibration must compare a held-out labeled set, retain the previous policy and require a new exact policy decision. Coverage numbers alone cannot establish business completeness or permit removal of required rules.

**References:** [OPA policy testing and coverage](https://www.openpolicyagent.org/docs/policy-testing), [OPA policy performance](https://www.openpolicyagent.org/docs/policy-performance). Basic required-case completeness and negative testing remain in the v0.3.0 correction.

### HAR-F02 — Cross-project policy reuse and optional distribution

**Status:** `CONDITIONAL_RESEARCH`; not scheduled.

**Trigger:** independently scoped projects demonstrate repeated reusable policies, or an operator requires explicit distribution through an existing repository/OCI registry.

**Scope:** reviewed reusable policy packages and dependency/version compatibility, with optional upstream OPA Bundle/Conftest OCI import/export. Keep native local and offline execution available. Resolve immutable bytes and exact digests rather than evaluating an implicitly updated remote tag. OPA Bundle is the upstream policy packaging format; it is not automatically equivalent to EvoPilot's existing Harness Bundle identity or approval.

**Acceptance:** use at least two synthetic project namespaces to prove reuse without parameter, source or scope leakage; compare local execution before and after export/import; reject changed bytes, unresolved dependencies and incompatible package/tool versions. Demonstrate explicit remote selection, disabled-by-default remote access, missing registry access, offline operation and repeatable digest-pinned recovery. Test that private project inputs, evidence and credentials cannot be silently included in a public package. Distribution success must not create approval or activation.

**References:** [Conftest policy sharing and OCI support](https://www.conftest.dev/sharing/), [OPA bundles](https://www.openpolicyagent.org/docs/management-bundles). Reuse existing distribution systems; do not create a new EvoPilot registry service or make signing mandatory through this goal.

### HAR-F03 — Existing SRE evidence adapters

**Status:** `CONDITIONAL_RESEARCH`; not scheduled.

**Trigger:** an onboarded project needs a delivery decision to consume observations from an existing SLI/SLO system, with an owner-defined observation window and freshness requirement.

**Scope:** explicit adapters for existing SLI/SLO definitions and results, using [OpenSLO](https://openslo.com/) and [Sloth](https://sloth.dev/introduction/features/) as candidates for a separately defined compatibility subset. Bind the source, service identity, indicator, objective, units, measurement window, collection time, freshness and actual observation to Harness evidence. Harness evaluates that evidence; Runtime owns authorized collection and execution. Importing a definition does not demonstrate that its objective was measured or met.

**Acceptance:** declare the supported upstream version/subset and field mappings; test met/violated objectives, missing or partial windows, stale data, mismatched service/source, wrong units, zero/undefined denominators and inaccessible providers. Retain the raw source result and exact mapping; repeat native/provider readback for the same bounded window and prove that stale or incomplete observations cannot pass. Snapshot evidence must not be presented as continuous monitoring. A quality warning cannot automatically create a patch release or lower an objective.

**Non-goals:** operating metrics collectors, Prometheus servers, dashboards, alert routing, on-call management or a replacement SRE platform. A future adapter does not claim full OpenSLO or Sloth support until its explicit compatibility and acceptance checks pass.

## Approved v0.4 execution feedback

Status: implementing the parent [36-variant Target](https://github.com/yeliang-wang/evopilot/blob/main/governance/feedback-v04.json). Add this owner's capture/delivery or impact-review responsibilities through public APIs, preserve native v0.3 standards and historical records, and verify real Host, restart, upgrade, source CI and release readback. v0.5 online Harness work remains a separate target; neither authorizes v1.0.
