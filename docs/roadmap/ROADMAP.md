# EvoPilot Harness Roadmap

## Status And Authority

This Roadmap is the human-readable evolution plan for `evopilot-harness`. The machine-readable authority is [`governance/roadmap.yaml`](../../governance/roadmap.yaml). The accepted [product and module boundary ADR](../architecture/adr/0001-product-and-module-boundaries.md) and [Agent-native operations ADR](../architecture/adr/0002-agent-native-harness-operations.md) are harder constraints than any milestone.

Every feature, architecture, contract, version, and release task must pass the Roadmap Gate before implementation. Only `ALIGNED` work may proceed automatically. `UNPLANNED`, `DEVIATION`, `BOUNDARY_CHANGE`, and `UNKNOWN` require user review before files are changed.

In Codex, `$evopilot-evolution-orchestrator` is the conversational entry for user goals and external triggers such as issues, benchmarks, articles, papers, and reports. It may coordinate evidence research, but this Roadmap, accepted ADRs, the deterministic Gate, and explicit user decisions remain authoritative. External evidence, LLMs, and Subagents never approve a Roadmap change, Engine implementation, Asset publication, or Engine release.

The Roadmap governs the Engine, not the contents of a user's Organization Catalog. A reviewed Harness Asset, Ontology, Policy, Evaluation, or Catalog version can evolve independently without an Engine release.

## Product Direction

`evopilot-harness` is the user's Harness asset library and independent Harness producer. It converts evidence into model-external execution environments that are reusable, constrained, reviewable, and verifiable.

Its next evolution is to use governed production feedback to improve Harness precision and professional completeness:

```text
Source evidence + approved execution feedback
  -> Evidence Graph and effectiveness evidence
  -> deterministic matching and LLM advice
  -> Profile/Component/Bundle/Evaluation delta Proposal
  -> independent review and human approval
  -> immutable published Harness version
```

It does not onboard EvoPilot projects, execute Goal Loops, run source projects, or train model weights.

After v3.4 closes the professional Asset Delta and Evaluation contracts, v4 changes the supported operating model without moving those business boundaries. A human expresses goals and decisions through a portable, question-driven Digital Expert loaded by Codex, WorkBuddy, Claude Code, or another compatible Agent host. The Agent operates the deterministic Engine through a local machine protocol; it does not become the source of Harness reasoning, approval, publication authority, or runtime state.

## Versioned Milestones

### v3.3.0: Feedback Evidence Foundation

- Define and statically read `HarnessExecutionFeedbackPackage`.
- Reject unapproved, unredacted, stale, tampered, or unresolved feedback.
- Aggregate effectiveness by Profile, Component, Bundle, and version with uncertainty and provenance.
- Extend `EvaluationPack` for Outcome, Process, Safety, and Cost evidence.

Feedback remains evidence only. It cannot directly change or publish an asset.

### v3.4.0: Evidence-Driven Asset Delta And Evaluation Closure (Complete)

- Define typed, evidence-linked deltas for Profile, Component, Bundle, Ontology, Policy, and Evaluation assets.
- Add portable `EvaluationPack v3` cases with positive and negative expectations, context, assertions, validator/scorer versions, baseline references, and regression boundaries.
- Improve new-versus-existing-versus-composed decisions while adding explicit `NO_CHANGE` and `NEED_MORE_EVIDENCE` outcomes.
- Add deterministic compatibility, blast-radius, expected-effect, regression, and rollback analysis to Proposal Review.

v3.4.0 uses approved production feedback as one Evidence Source, but it does not introduce Pairwise experiments or claim causal improvement. Every Delta Proposal remains review-stage until deterministic validation, independent review, and explicit human approval complete.

### v4.0.0: Agent-Native Harness Operations (Complete)

- Publish a portable, question-driven Digital Expert Core with versioned Codex, WorkBuddy, Claude Code, MCP, and generic adapters generated from one authority.
- Add a local-first Harness Operation Server with `stdio` MCP as the default transport, structured tools/resources, process health, and version negotiation.
- Define persistent `AgentOperationSession` state for planning, confirmation, execution, Proposal presentation, human gates, interruption recovery, cross-Agent resume, and safe close.
- Make the Digital Expert the only supported ordinary human entry while retaining atomic JSON CLI contracts for Engine automation, CI, compatibility, and emergency diagnosis.
- Cover every released Engine lifecycle branch through real Agent-to-MCP-to-Engine end-to-end validation without requiring a human to enter Harness CLI commands.

The Digital Expert understands and explains intent, but the Engine remains authoritative for evidence, reasoning, review, validation, approval binding, publication, and state. MCP is an operation protocol, not a security boundary. v4.0.0 does not execute source-project commands, own Goal Loops, embed a general Agent runtime, create model credentials, or permit automatic approval or publication.

The published Engine baseline is `v4.0.1`. The `v4.0.2` maintenance release closes npm distribution, isolated Agent-host installation, package provenance, and WorkBuddy conformance for the existing v4.0 operating model; it does not add a new Harness lifecycle capability or change the accepted boundary. Because npm Trusted Publishing can be configured only after the package exists, this release line may include one explicitly selected, token-backed first-publication Bootstrap that refuses to run once the package exists. Every later publication must use the OIDC Trusted Publisher path. npm account creation, organization or scope ownership, token and 2FA configuration, and actual Registry publication remain external Release Review decisions and are never inferred from implementation acceptance.

### v4.1.0: Controlled Comparative Evidence And Calibration (Complete)

- Define governed Baseline/Candidate comparison evidence bound to the same task, environment, scorer, and Evaluation cases.
- Preserve immutable raw results and append independently versioned rescoring rather than overwriting history.
- Require repeated observations, context-comparability checks, uncertainty, and conflict handling before a comparative conclusion.
- Calibrate matching and Proposal quality with independently reviewed cases and cross-version regression evidence.

Pairwise evidence may recommend keeping, revising, or rolling back an asset candidate. It cannot approve or publish an asset, override deterministic gates, or turn confounded observations into causal claims.

The published Engine baseline for this milestone is `v4.1.2`.

### v4.2.0: Professional Asset Learning And Research

- Build an evidence-backed curriculum from unresolved boundaries, conflicts, production failures, and Evaluation gaps.
- Accept external research evidence through provenance-preserving adapters with explicit authority limits.
- Measure long-horizon professional completeness without confusing contract coverage with independently reviewed accuracy.
- Infer new domains and roles from evidence rather than expanding a hard-coded project-category list.

The objective is more accurate, professional, and fine-grained Harness definitions. It is not large-scale training throughput or an ever-growing hard-coded domain list.

The `v4.2.4` maintenance line also closes explicit user-owned LLM configuration for installed Agent-host operation. Release packages remain provider-neutral: they do not contain or generate a default provider, model, endpoint, profile, or credential, and they never borrow the host conversation model. An operator binds model configuration in an explicit external Workspace and completes a live doctor before LLM-required operations proceed. Deterministic non-LLM operations remain available while configuration is incomplete. Existing human-maintained configuration is preserved across install, upgrade, repair, and Agent-host restart.

### v4.3.0: Deterministic Third-Party Agent Interaction Compliance

- Replace advisory-only human-gate presentation with a versioned, host-neutral Interaction Frame contract and deterministic Renderer.
- Keep Harness business verdicts in the Engine while an Agent-neutral Interaction Controller constrains presentation order, required fields, and the next permitted operation.
- Classify third-party Agent hosts by observable interaction capabilities and fail closed before governed human gates when complete visible presentation cannot be enforced and verified.
- Validate Plan, comparative evidence, professional-completeness, Proposal Review, approval, publication, recovery, cancellation, close, and cleanup interaction order through field-level conformance and real-host evidence.

The objective is deterministic compliance with the existing Digital Expert interaction specification, not a new Harness reasoning authority or a general-purpose Agent runtime. A host may transport, explain, and visibly render an immutable Interaction Frame, but it may not omit required fields, reorder gates, invent a human decision, or advance a governed operation when its interaction capabilities are insufficient. Proposal Review Engine verdicts, Evaluation semantics, Asset lifecycle authority, and Catalog publication rules remain unchanged.

The published Engine baseline for this milestone is `v4.3.0`.

### v4.4.0: Deterministic Business-Centric Harness Interaction

- Generate an Engine-owned `BusinessDecisionView` for every governed human decision so Source understanding, Source-to-Harness reasoning, Proposal substance, Evaluation, risk, and impact remain the primary user experience across Agent hosts.
- Preserve the complete authoritative Engine object, digests, authority, permitted operations, receipts, and recovery metadata in a separate Engine-owned `ComplianceAuditEnvelope` without allowing decision-relevant facts to be hidden from the business view.
- Add a versioned `SourceToHarnessReasoningMap` that binds each proposed, reused, composed, evolved, rejected, or evidence-blocked Harness capability to immutable Source Evidence, deterministic normalization, uncertainty, alternatives, and Catalog relationships.
- Advance the Agent Operations Protocol with composite decision binding, Engine-declared finite decision options, automatic non-authoritative presentation receipts, cross-host resume, and fail-closed transport conformance.
- Prove that WorkBuddy and at least one independently implemented compatible Host present the same authoritative business content for the same Harness state while allowing only Host-specific layout and transport metadata to differ.
- Define the conformance boundary explicitly: the Engine owns the governed Harness Frames; the third-party Host owns its surrounding application chrome, loading indicators, model-reasoning status, and transport progress. Host-owned surface content is not part of the zero-drift comparison, but it may never rewrite, obscure, replace, acknowledge, confirm, infer, or advance a governed Harness Frame or decision.
- Validate the real production experience with the same Source, release candidate, configuration, and explicit decision inputs in at least one fresh Workspace, Session, and WorkBuddy task. The run must complete the full zero-to-one lifecycle and present, in order, four Engine-owned Harness business phases: Operation Plan; professional Source-to-Harness analysis and Proposal Review; Proposal human decision; and publication plus Session lifecycle decisions.
- Preserve repeatability through deterministic multi-run and cross-Host conformance tests that compare canonical Frame structure, business semantics, bound locale, finite decision options, and lifecycle order. Real-run-specific Workspace, Session, receipt, timestamp, Job, and digest identities remain valid typed bindings and are not required to be literal byte matches.
- Require each compatible Host to declare its long-running MCP capabilities and use either a verified synchronous request window or an Engine-owned asynchronous `OperationJob` protocol for operations such as Proposal Review.
- Recover MCP timeout, disconnect, restart, reconnect, and repeated-start cases by immutable Session, input, Job, and result digests without repeating an uncertain Engine or LLM mutation; synchronous and asynchronous paths must produce identical authoritative Review and Business Decision View digests.

The objective is to keep the complete Harness lifecycle and user-facing business semantics closed inside `evopilot-harness`. WorkBuddy, Codex, Claude Code, and future MCP Agent hosts remain conversational and presentation shells: they may collect input, transport attachments, render Harness payloads, and submit explicit choices, but they may not generate Source-to-Harness reasoning, rewrite Engine verdicts, choose governed next operations, infer approval from generic conversation, or restore state from chat memory.

This milestone does not embed a general-purpose Agent runtime or conversational model, execute Source projects, alter Proposal Review or Evaluation meaning, merge approval with publication, automate Catalog publication, run EvoPilot Goal Loops, or add container, GHCR, cloud, or remote-service distribution.

### v4.5.0: Governed Professional Ontology Evolution

- Split professional knowledge into a stable Built-in Foundation Ontology plus independently versioned Domain and Organization Ontology Packs, while keeping Proposal-local candidate knowledge inactive until approved and published.
- Add an Ontology Sufficiency Gate before Catalog matching. It measures evidence coverage, specificity loss, boundary conflict, ambiguity, and unknown-concept density so a professional Source cannot be collapsed into an unjustifiably broad Harness merely because a generic concept matched.
- Introduce `ONTOLOGY_EXTENSION_REQUIRED` for Sources that demonstrate repeatable Harness value and professional distinctions that the active Ontology cannot explain. Insufficient evidence remains `NEED_MORE_EVIDENCE`; non-Harness material remains `NOT_HARNESS_ELIGIBLE`.
- Produce evidence-bound candidate Concepts, Roles, domains, task classes, parent and conflict relationships, positive and negative boundaries, alternatives, and uncertainty. LLM Advisor output remains advisory and cannot mutate or activate knowledge.
- Carry OntologyPack, HarnessProfile, HarnessComponent, and EvaluationPack changes through one exact `AssetDeltaProposal` with immutable before/after documents, dependency impact, regression coverage, rollback, independent Review, human approval, and separate publication.
- Complete Organization and Domain OntologyPack operations for draft, review, approval, rejection, immutable publication, deprecation, compatibility inspection, migration, and rollback binding independently from Engine releases.
- Bind the exact Source snapshot, Catalog, Ontology Packs, Policies, Advisor identity, operation intent, locale, and presentation template into the Evolution Context. A newly published Ontology never changes an active Session; re-reasoning requires an explicit new context.
- Validate professional open-world behavior with financial CRM versus general CRM, manufacturing ERP, insufficient-domain evidence, non-Harness material, multi-domain composition, and complete historical classification regression across WorkBuddy and an independent conformant Host.

The objective is governed knowledge evolution rather than an ever-growing built-in keyword list. Source material may reveal a candidate professional domain, but it cannot directly change active Ontology, matching Policy, Harness assets, or later Sessions. Built-in Foundation changes remain part of an Engine release; approved Organization and Domain Ontology Packs have an independent immutable lifecycle.

This milestone does not add automatic online learning, automatic Ontology activation, LLM-owned classification, Source-authored policy mutation, Agent-host reasoning, model training, Source-project execution, EvoPilot Goal Loops, containers, GHCR, cloud deployment, or remote-service distribution.

## Evidence Basis

This milestone order reflects a reviewed comparison with adjacent mature open-source systems rather than copying another project's product boundary:

- Nuclei Templates and Semgrep prioritize strict asset schemas, positive and negative evidence, engine validation, snapshots, and release QA before promotion.
- Inspect AI preserves evaluation logs and separates generation from versioned scoring and rescoring.
- Promptfoo compares asset versions against identical fixtures and measures both recall and precision.
- DeepSeek Harness separates provider discovery, precedence, scope, and fail-closed execution policy.
- OpenHands separates the control surface, agent server, execution backend, and sandbox.
- Codex separates Agent interaction from machine execution through sandbox, permission, and MCP contracts.
- Claude Agent SDK separates Agent reasoning from deterministic tool permissions and pre-tool hooks.
- Kubernetes Agent Sandbox documents that an MCP surface is not itself an authentication or isolation boundary.

The resulting order is deliberate: v3.4 closes professional Delta and Evaluation contracts, v4.0 makes the complete asset lifecycle Agent-native, v4.1 adds controlled comparative evidence, and v4.2 adds long-horizon learning and external research. External repositories and reports remain evidence only and never become approval authority.

## Cross-Project Feedback

The v3.3.0 consumer contract is active and offline. A compatible external exporter is still pending, so the complete cross-project production loop is not yet claimed:

```text
EvoPilot exports approved HarnessExecutionFeedbackPackage
  -> evopilot-harness validates and reads it as Evidence Source
  -> Proposal / Evaluation / Review / human approval
  -> evopilot-harness publishes a new immutable asset version
  -> a future consumer may discover that version from Catalog/Registry
```

`evopilot-harness` does not call back into a project loop or rewrite the historical Bundle binding used by EvoPilot.

## Standing Work

Bug fixes, security repairs, documentation synchronization, dependency maintenance, compatibility work, and regressions are continuously allowed when they do not add an unplanned capability or change an accepted boundary.

Open-source productization hardening is standing work when it is limited to contribution templates, accurate repository metadata, dependency and security automation, product-native public wording, and deterministic checks that keep Roadmap and Release state synchronized. It must not add Harness behavior, expand a distribution channel, copy another project's product boundary, or use workflow count as an acceptance target.

Codex workflow governance is also standing work when it only binds Engine evolution to reviewed evidence, this Roadmap, an approved `evopilot-evolution-target/v1`, deterministic acceptance, and separately authorized Engine release. It must not change Harness product behavior, asset authority, milestones, versions, or boundaries under the label of governance. User Organization Catalog assets retain their independent review, approval, and publication lifecycle.

## Change Control

1. Start EvoPilot-series evolution through `$evopilot-evolution-orchestrator` and produce a reviewed evidence brief when external material is involved.
2. Run `npm run roadmap:gate -- --intent "<requested change>" --json` before implementation.
3. Continue to Target Review only for `ALIGNED`.
4. Present `UNPLANNED` and `DEVIATION` with reason, milestone and version impact, alternatives, and a versioned Roadmap Revision Proposal; wait for explicit approval.
5. Bind implementation to an approved `evopilot-evolution-target/v1` containing the current Roadmap digest, matched milestone or standing work, scope, exclusions, target version, acceptance, and evidence requirements.
6. Rerun the binding gate after Roadmap or scope changes and before implementation, acceptance closure, and Engine release.
7. A one-task exception does not rewrite the Roadmap and cannot authorize a Release containing an undeclared product capability.
8. Permanent changes update this document, `governance/roadmap.yaml`, relevant ADRs, executable gates, compatibility notes, and EvoPilot-series memory.
9. `BOUNDARY_CHANGE` always requires a replacement ADR and formal Roadmap revision before implementation.
10. Implementation approval and acceptance never imply Engine release authorization; exact publication actions require a separate user decision. Harness Asset publication remains governed by the independent Asset lifecycle.

Release tags must be declared by the machine Roadmap and pass `npm run roadmap:release -- <version>`.
