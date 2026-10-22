# Harness roadmap

Current edition: [HAR-F05 / v0.7 readable policy results](#har-f05--v07-readable-policy-results). Implemented for the v0.7 edition; exact publication and download records remain on the versioned Release page.

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

v0.2.0 introduced independent Workspace support. The parent owns first-use Workspace initialization, the private editable project root, Expert guidance and connection changes. Harness owns its protected service state and the [snapshot and relocation API](service.md#same-host-workspace-snapshots-and-relocation). The owner verifies identity, retained record and blob digests, and same-host location lineage; it does not copy an entire Workspace or switch the Host connection. Relocation preserves existing decisions, immutable deliveries, receipts and audit records. These interfaces and their stated limits are not a claim of candidate-specific cutover or release acceptance.

## v0.3.0 Preview: standards correction

Published in the v0.3.0 Preview under the approved parent `governance/standards-v03.json` Target. This section retains that standards-correction scope; actual project decisions and candidate-specific evidence remain private.

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

## Evolution goals beyond the v0.3.0 correction

Goals marked `CANDIDATE` remain **NOT SCHEDULED**; `CONDITIONAL_RESEARCH` first requires a concrete need and feasibility review. Those follow-ups have no committed software version or date and require separately reviewed Targets with scope, compatibility impact and measurable acceptance. HAR-F04 below has advanced to the implemented v0.6 scope. These goals are not automatically additional conditions for v1.0; the parent readiness contract remains authoritative. A trigger is a reason to review a goal, not permission to start work.

### HAR-F01 — Policy quality, diagnostics and scale

**Status:** `CANDIDATE`; broader policy quality/scale work is not scheduled. The bounded readable-diagnostics portion is included in HAR-F05's accepted v0.7 plan below; implementation is isolated.

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

**Status:** bounded OpenSLO/Prometheus/Alertmanager subset approved in v0.5 below; further adapters remain `CONDITIONAL_RESEARCH`.

**Trigger:** an onboarded project needs a delivery decision to consume observations from an existing SLI/SLO system, with an owner-defined observation window and freshness requirement.

**Scope:** explicit adapters for existing SLI/SLO definitions and results, using [OpenSLO](https://openslo.com/) and [Sloth](https://sloth.dev/introduction/features/) as candidates for a separately defined compatibility subset. Bind the source, service identity, indicator, objective, units, measurement window, collection time, freshness and actual observation to Harness evidence. Harness evaluates that evidence; Runtime owns authorized collection and execution. Importing a definition does not demonstrate that its objective was measured or met.

**Acceptance:** declare the supported upstream version/subset and field mappings; test met/violated objectives, missing or partial windows, stale data, mismatched service/source, wrong units, zero/undefined denominators and inaccessible providers. Retain the raw source result and exact mapping; repeat native/provider readback for the same bounded window and prove that stale or incomplete observations cannot pass. Snapshot evidence must not be presented as continuous monitoring. A quality warning cannot automatically create a patch release or lower an objective.

**Non-goals:** operating metrics collectors, Prometheus servers, dashboards, alert routing, on-call management or a replacement SRE platform. A future adapter does not claim full OpenSLO or Sloth support until its explicit compatibility and acceptance checks pass.

### HAR-F04 — Response guidance and verified problem disposition

**Status:** implemented for **v0.6.0 Preview** under the approved [response Target](https://github.com/yeliang-wang/evopilot/blob/main/governance/response-v06.json). This is Harness's part of [EVO-F04](https://github.com/yeliang-wang/evopilot/blob/main/docs/roadmap.md#evo-f04--incident-response-and-asset-learning). Publication is recorded by the [GitHub release](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v0.6.0); this roadmap describes scope, not private project acceptance or an additional v1.0 gate.

**Trigger:** a real project needs the quality evidence for an incident connected to applicable response guidance, explicit disposition and regression learning.

**Implemented scope:** versioned diagnostic and verification guidance with applicability, prerequisites, required inputs, stop conditions and immutable references to response steps. Bind the rule, service/environment/deployment and guidance revision; Runtime owns executable action plans and authority, while Ontology defines domain meaning. The [response API](response.md) specifies the manifested JSON runbook, exact published package pins, problem review and recovery contract. A runbook is not executable authorization, and Markdown prose alone does not certify conformance.

The service distinguishes an observed incident, a reviewed problem/root-cause assessment and a quality disposition. Firing/resolved remains observation history; root-cause removal and prevention require separate evidence. Deferral/risk-acceptance records retain actor, rationale, exact scope, expiry/review time and append-only history. They cannot erase failed measurements, suppress required rules, or convert FAIL, UNKNOWN or missing data into PASS. Expiry is visible and re-reviewable. Later healthy events preserve reviewed recovery; a newly received fault, including a distinct late fault, requires reassessment.

**Learning:** a postmortem may propose a new regression case, changed guidance or rule improvement through existing review/delivery mechanisms. Preserve the source incident, policy/configuration, actual evidence and prior asset version. Use HAR-F01 for broader calibration or mutation-quality work rather than expanding this bounded response scope. Private incident examples and SOPs stay private; public templates use synthetic examples.

**Fixed acceptance scope:** owner observation/guidance/disposition assertions for EVO-F04-E01–E03, E05 and E07–E08, with participation in E04, E06 and E09–E10. The existing `tests/e2e/response.test.mjs` and parent integration E2E cover failure/recovery, missing/stale evidence, mismatched guidance, false recovery, expired exceptions, late events and duplicate delivery. A command succeeding or an alert disappearing cannot prove the problem is fixed. New regression cases must fail against a demonstrated fault and pass against the repaired case under pinned rules and effective configuration; historical failures remain readable. Exact-candidate technical and Host evidence are recorded separately from this public criteria description.

**References and limits:** [Prometheus alert rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/) provide labels/annotations, not trusted execution instructions. [Google SRE postmortems](https://sre.google/sre-book/postmortem-culture/) inform impact, causes, mitigation and preventive actions; EvoPilot must define its own explicit supported fields and lifecycle. No replacement alert-routing/on-call platform, automatic rule weakening or automatic software release is included. Current `specifications/v1`, immutable records and the bounded online profile remain unchanged by this roadmap entry.

## Approved v0.4 execution feedback

Published in the v0.4 Preview under the parent [36-variant Target](https://github.com/yeliang-wang/evopilot/blob/main/governance/feedback-v04.json). This owner participates in registered execution feedback through its public APIs while preserving native v0.3 standards and historical records. Candidate-specific Host, recovery and release evidence remain private. v0.5 online Harness has the separate scope below; neither version authorizes v1.0.

## Approved v0.5: online Harness

The fixed [36-variant parent Target](https://github.com/yeliang-wang/evopilot/blob/main/governance/online-harness-v05.json) follows the published v0.4 Preview. This checkout implements that scope; exact candidate acceptance and release receipts remain external.

Harness owns immutable service/environment/deployment/SLO/policy bindings, actual Prometheus measurements, authenticated Alertmanager findings, native Rego evaluation, retained incidents and reviewable regression comparisons. Runtime receives trusted repair candidates; it does not infer a software version or dispatch an autonomous repair. Ontology standards and reviewed semantic evolution remain unchanged. The parent provides the explicitly enabled independent local worker and Expert journeys, with actual installed Codex acceptance.

The delivered scope is a bounded OpenSLO v1 RatioTimeslices profile and macOS arm64/launchd supervision. It does not establish full OpenSLO/Sloth compatibility, production business-SLO acceptance or v1.0 readiness. No second real project, WorkBuddy or original project mutation is included.

### Deferred online follow-ups

| Target candidate | Trigger | Required future evidence / boundary |
|---|---|---|
| Online retention and scale | Real projects reach bounded history/backlog limits | Reviewed retention/export semantics, immutable historical evidence, restart/load tests and explicit no-loss acceptance; no silent pruning |
| Additional supervisors/providers | A concrete project requires another platform or telemetry source | Pinned supported subset, real provider/Host E2E, credentials/network isolation and owned stop/recovery; no blanket compatibility claim |
| Additional SLO semantics | Several projects need calendar/composite/other budgeting methods | Versioned profile compatibility, upstream field/calculation comparisons, negative cases and preserved earlier approvals |

These candidates are not uncompleted v0.5 criteria and have no assigned release date. They require their own reviewed Target. Existing v1.0 readiness conditions remain unchanged.

## v0.6.0 Preview implementation

HAR-F04 is implemented under the approved parent [v0.6 response Target](https://github.com/yeliang-wang/evopilot/blob/main/governance/response-v06.json), which fixes the bounded implementation and 36 cross-product variants. Published runbooks, reviewed problem dispositions, immutable history checkpoints and exact recovery references are described in [response guidance](response.md). The [release record](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v0.6.0) identifies the distributed source and assets; actual project and Host acceptance remain private evidence. Maintained core source uses strict TypeScript, and native standards and historical records stay intact. The remaining follow-ups above do not become implicit v0.6 requirements.

## HAR-F05 — v0.7 readable policy results

**Status:** `IMPLEMENTED` for v0.7.0 Preview. The parent execution Target fixes 50 acceptance variants. Actual source, installed Host, recovery and release evidence remain private and candidate-bound; this roadmap does not itself grant authority.

**Scope:** own the Harness part of V07-T1–T3: preflight the complete required rule/test/observation inventory before candidate freeze; expose readable, scoped policy catalogs and verified diagnostic projections; support the parent's Codex reports through public owner APIs. Show rule identity/name, applicability, input/parameter references, expected/actual outcomes, test verdict, evidence origin and source/report/receipt references. Preserve native messages and exact rule/query identity; display absent explanatory metadata honestly.

Native Rego/OPA/Conftest, frozen `specifications/v1`, supported online semantics and immutable historical assets remain authoritative. Prefer native [OPA metadata](https://www.openpolicyagent.org/docs/policy-language#metadata) and existing declared fields; version additive presentation contracts separately. Changed policy bytes require a new candidate and review. An expected negative case that is rejected passes its test, not the underlying business policy. Keep source declarations, synthetic cases, actual execution and online findings distinct. Grouping review items does not merge their decisions, permit automatic REUSE or weaken a warning gate.

**Acceptance mapping:** V07-E01 specific owner prerequisites and safe error context; E02 missing required observations/cases rejected before freeze; E03 native messages plus expected/actual/test-verdict agreement; E04 no asset PASS presented as overall product acceptance; E05 bounded rule/parameter changes with affected references; E06 complete paginated/filterable results and cross-format agreement; E07 preserved owner history/receipts through parent maintenance; E08 isolated read-only queries, installed guides and accessible reports. Bind positive, negative, missing/stale and recovery variants in `tests/e2e` and parent integration E2E before implementation. No results are claimed here.

Reference [Policy Reporter UI](https://kyverno.github.io/policy-reporter-docs/policy-reporter-ui/introduction.html) for grouping and navigation without importing its Kubernetes lifecycle as EvoPilot's contract. HAR-F01's broader coverage, mutation calibration and performance work remains separate. The parent composes Codex reports; Dashboard implementation and a second Harness database are excluded. Real project cases remain private; v1.0 criteria are unchanged; installing a newer version is a separate operation.

### v0.7 project planning addition

The approved parent V07-T0 adds project-scoped conversation provenance, immutable planning revisions and Runtime-owned Roadmap decisions/execution bindings. Ontology and Harness assets retain independent native validation and review. User planning stays private; native specifications/v1 remain unchanged. Installation changes follow the separately authorized stopped-state backup, recovery and Host verification procedure. See the parent [planning decision](https://github.com/yeliang-wang/evopilot/blob/main/docs/adr-planning.md).
