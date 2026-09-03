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

## Cumulative Capability And Compatibility Policy

- Every released `evopilot-harness` version establishes the product-capability baseline for the next version. A later version may add capabilities, adjust user journeys, replace schemas or protocols, and refactor implementation, but it must continue to provide equivalent fresh-start user outcomes for every released capability unless this Roadmap explicitly deprecates or removes that capability with reviewed user impact and approval.
- `RESET_PRE_PRODUCTION` may remove compatibility or migration obligations for pre-baseline Workspace, Session, Harness definition, configuration, Ontology, Catalog, Harness Asset schema, MCP protocol, installed runtime state, and direct upgrade paths when concrete evidence proves that no production consumer depends on them. It does not authorize removal of released product capabilities, business results, Harness lifecycle stages, safety guarantees, authority boundaries, or explicit human decisions.
- A fresh installation of a new baseline may reimplement retained capabilities using new schemas, protocols, state models, and architecture. It does not need to read or migrate superseded artifacts, but it must allow an ordinary user to complete the retained tasks from a fresh Workspace.
- Every v4.5.0 and later Evolution Target must map the preceding released version's acceptance lineage. Compatibility-specific criteria may be excluded with concrete reset evidence; functional, capability, safety, authority, and end-to-end obligations must be inherited or restated and retested on the new design with `NO_REGRESSION`.
- Removing, deferring, or replacing a released capability requires an explicit Roadmap capability-change decision. A milestone exclusion, refactor, compatibility reset, zero inherited-acceptance set, or historical-criteria count cannot implicitly authorize capability deletion.

## Real-Host Acceptance Execution Policy (Revision 10)

- From v4.5.0 onward, release-blocking WorkBuddy end-to-end acceptance remains mandatory and follows `human-operated-workbuddy/v1`: a designated human performs every visible WorkBuddy action and current human decision. This does not remove WorkBuddy coverage, weaken a Harness capability, or replace the Digital Expert as the supported ordinary-human product entry.
- WorkBuddy completion follows `designated-human-range-completion/v1`. Codex and EvoPilot-series Skills freeze and provide the complete applicable RC runbook set before execution, then remain outside the WorkBuddy control, observation, and supervision path. They do not request, collect, retain, or review WorkBuddy sessions, transcripts, screenshots, screen recordings, logs, receipts, canonical digests, or other WorkBuddy execution artifacts, and they do not require per-case progress reports or intermediate acknowledgements.
- The designated human independently creates the required fresh WorkBuddy tasks, selects the installed Digital Expert, attaches every exact authorized Source, sends each approved goal, makes every current digest-bound decision after viewing the complete Engine-owned result, performs all required restart, resume, retry, cancellation, publication, validation, and close actions, and sends one final range-completion declaration only after the complete frozen runbook range has been performed.
- For v4.5.0 the real-Host portfolio contains exactly five coherent top-level journeys, RC01–RC05. Source classes, classification outcomes, Advisor states, hostile inputs, deterministic replay, Harness outcomes, GitHub diversity and cumulative regression combinations that share the same human-visible start, authority sequence and terminal lifecycle belong to an explicit machine-readable variant matrix. Every variant retains an independent assertion, result and evidence reference; old RCs may not be hidden, renamed or nested as extra human journeys inside the five-RC portfolio.
- WorkBuddy exercises the five representative top-level journeys, while the independent conformant Host and deterministic acceptance runner execute the complete required variant matrix. A failing variant remains visible and release-blocking; compact RC numbering cannot sample, average away or waive any current, historical, security, architecture, Source, Host or no-regression obligation.
- An exact business classification label is an acceptance oracle only when it was fixed independently before Candidate execution from an explicit controlled Taxonomy and a responsibility-focused Source. For broad or mixed Sources, acceptance validates the classification state, cited evidence, alternatives, explanation, authority and user-revision lifecycle without treating an invented business label as product truth.
- For v4.5.0 the canonical declaration is `RC01～RC05 已完成`; `~` and `～` are accepted range separators. Before that declaration is received, all five WorkBuddy human-operation legs remain `PENDING`. After receipt, the WorkBuddy legs of RC01–RC05 become `PASSED`. No additional narrative or WorkBuddy artifact is required.
- The final human declaration is necessary and sufficient only for the WorkBuddy human-operation legs. Overall RC and Target closure still requires every non-WorkBuddy Functional, Capability, package, Source, independent-Host, security, architecture, deterministic, and no-regression criterion to pass with its existing machine-verifiable evidence. Even when those checks already pass, the declared RC range remains open until the final human declaration is received.
- Independent conformant, deterministic, weak, or hostile Host coverage may remain automated where its Target permits. Engine-owned reasoning, human gates, Source non-execution, approval and publication separation, and independent-Host evidence requirements remain unchanged; the WorkBuddy side of cross-Host acceptance is deliberately trust-based and represented solely by the designated-human completion declaration.
- This policy optimizes acceptance speed and human privacy over independently reviewable WorkBuddy execution proof. A WorkBuddy-specific failure cannot be reconstructed from retained acceptance artifacts unless the human voluntarily reports it outside the formal requirement. The declaration never authorizes publication or release, which always requires a separate exact user decision.
- This policy is acceptance governance, not a replacement of the supported primary human operation model and not an Engine, protocol, schema, Candidate-package, or product-boundary change. A Roadmap digest change returns an existing Target to review so its acceptance bindings can adopt this policy; it does not by itself require rebuilding or reinstalling an unchanged Candidate.

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

### v4.4.0: Deterministic Business-Centric Harness Interaction (Complete)

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

### v4.5.0: Source-First Classification And Cumulative Harness Evolution

- Establish v4.5.0 as an evidence-bound clean production baseline under `RESET_PRE_PRODUCTION`. Pre-v4.5 Workspace, Session, Harness definition, configuration, Ontology, Catalog, Harness Asset schema, MCP protocol, installed runtime state, and direct-upgrade compatibility or migration are excluded. The reset applies only to superseded artifacts and protocols: a fresh v4.5.0 installation must retain every released v4.4.0 product capability and user outcome. The Target must bind concrete no-production-consumer evidence, partition historical acceptance into compatibility-specific exclusions and inherited or restated capability obligations, and retest the cumulative baseline with `NO_REGRESSION`.
- Replace the pre-v4.5 Engine module 8 `OntologyPack` contract with an accepted Semantic Foundation and Taxonomy Resolution boundary. The Foundation owns only semantic axes and relation primitives; it contains no business Domain or Product value such as finance, metallurgy, application system, middleware, CRM, ERP, API gateway, or distributed cache. A replacement ADR, module documentation, and executable architecture-guard updates are required before implementation may proceed.
- Let users declare arbitrary Domain and Product roots, stable namespaces, ids, labels, aliases, definitions, hierarchy depths, parent-child relations, assignability, axis cardinality, positive evidence hints, and exclusion hints in a compact, non-executable `Taxonomy` resource using a stable `apiVersion`, `kind`, `metadata`, and `spec` envelope. Domain and Product remain orthogonal, declarations own the selected business vocabulary rather than classifier behavior, and user declarations are never Built-in Engine authority.
- Canonically validate and resolve exactly one selected Taxonomy document with the Foundation into an immutable Engine-owned `ResolvedTaxonomySnapshot`. Bind schema version, namespace, document version, supported Engine range, required capabilities, canonicalization algorithm, relation closure, resource limits, and content digest. Invalid ids, normalized alias collisions, missing parents, cycles, unsupported versions or capabilities, resource-limit violations, and digest drift fail closed before Source reasoning.
- Before comparing against the selected Taxonomy, derive an immutable evidence-bound `SourceConceptHypothesis` from the static Source snapshot and Evidence Graph without exposing the selected business labels to that concept-extraction step. The hypothesis records supported concepts, structure and dependency signals, citations, contradictions, uncertainty, Advisor provenance, and missing evidence so a closed candidate list cannot silently anchor Source understanding.
- Replace exact-only mapping with a versioned `OpenWorldTaxonomyClassifier`. Candidate retrieval may use exact id, label, and alias evidence, boundary-aware lexical and BM25 evidence, embeddings, and bounded structured Source signals; an evidence-bound LLM Advisor may interpret Source concepts, compare only a bounded candidate set, identify contradictions, and propose an absent category. Every signal is recorded separately, and no retriever, similarity score, LLM response, imported material, or Agent Host can directly select a governed result.
- Make the Engine-owned Decision Aggregator apply a versioned hierarchy-aware policy over the immutable signals, including assignability, axis cardinality, specificity, calibrated thresholds, top-candidate margin, exclusions, minimum evidence, and bounded candidate counts. Exact matches remain a high-confidence signal rather than the only semantic path; a parent is never selected merely because a more specific child is missing, and an unchanged bound context deterministically reuses the recorded signals and decision without repeating an LLM call.
- Keep Taxonomy Sufficiency separate from Harness Eligibility. Taxonomy Sufficiency returns exactly `TAXONOMY_MATCHED`, `TAXONOMY_EXTENSION_SUGGESTED`, `TAXONOMY_EVIDENCE_INSUFFICIENT`, or `TAXONOMY_AMBIGUOUS`: a coherent evidence-backed Source concept with no suitable declared node produces an extension suggestion; weak Source understanding produces evidence insufficient; multiple materially supported candidates without a policy-safe margin produce ambiguous. The existing Eligibility Gate remains the sole owner of `NOT_HARNESS_ELIGIBLE` and insufficient Harness-eligibility evidence. Taxonomy Sufficiency itself does not emit Profile, Bundle, or Asset-lifecycle decisions; after every required axis is matched, only an explicit user choice may carry the same immutable Source and classification context into the retained Harness Eligibility and evolution lifecycle.
- Bind the exact Foundation, resolved Taxonomy snapshot, Source snapshot, Source concept hypothesis, retrieval configuration, mapping and aggregation policies, algorithms, thresholds, candidate scores, Advisor model and prompt identity, recorded Advisor output, operation intent, locale, and presentation template into a new Evolution Context. Replacing a declaration, policy, algorithm, model, prompt, or live Advisor result never changes an active Session or context; re-analysis always creates a new immutable context.
- Make every extension suggestion identify the unresolved Domain or Product axis, proposed label, definition and parent, alternatives, rejection reasons, uncertainty, immutable Source citations, taxonomy-blind concept evidence, and missing taxonomy evidence without editing, applying, approving, publishing, activating, or silently selecting the user's Taxonomy.
- Require the user to supply a revised valid declaration and explicitly request re-analysis. Source content, LLM advice, imported material, and third-party Agent Hosts remain evidence or transport and never become Taxonomy, Eligibility, approval, publication, or activation authority.
- Use ordinary-human product language in every Engine-owned presentation: `业务分类方案`, `业务领域`, `产品或系统类型`, `项目分类分析`, and `分类覆盖情况`. Keep `Taxonomy`, `Domain`, `Product`, algorithm identifiers, scores, thresholds, digests, and other professional terms in schemas and audit surfaces, not as unexplained primary user language.
- Reimplement and retain the complete v4.4.0 fresh-start Harness producer journey on the v4.5.0 baseline: Engine-owned BusinessDecisionView and ComplianceAuditEnvelope, professional Source-to-Harness reasoning, Harness Eligibility, Catalog comparison, `REUSE_EXISTING`, `EVOLVE_EXISTING`, `COMPOSE_NEW_BUNDLE`, `PROPOSE_NEW_PROFILE`, `NOT_HARNESS_ELIGIBLE`, `NEED_MORE_EVIDENCE`, `NO_CHANGE`, and `REJECT`, HarnessProfile and immutable HarnessBundle production, Proposal Review, explicit Proposal approval, separately authorized publication, Catalog validation, interruption recovery, and safe Session close.
- Treat `ANALYZE_TAXONOMY` as a new Engine-owned stage before Harness evolution, not a replacement for the Harness lifecycle. `TAXONOMY_EXTENSION_SUGGESTED`, `TAXONOMY_EVIDENCE_INSUFFICIENT`, `TAXONOMY_AMBIGUOUS`, and `ANALYSIS_BLOCKED_ADVISOR` block the handoff. `TAXONOMY_MATCHED` only enables the user to choose whether to stop after classification or explicitly continue; it never proves Harness Eligibility, creates a Proposal, approves, or publishes.
- Bind the retained Harness Eligibility and evolution operation to the exact completed classification result, Source snapshot, ResolvedTaxonomySnapshot, Evolution Context, and explicit continue decision. Source, Taxonomy, algorithm, policy, model, prompt, or result drift requires explicit re-analysis and cannot silently alter an active Harness evolution context.
- Preserve the v4.4.0 authority sequence on the replacement implementation: Produce and Proposal generation never publish; Proposal Review remains Engine-owned; approval and publication remain separate digest-bound human decisions; Agent Hosts and LLMs never acquire reasoning, approval, publication, or lifecycle authority.
- Require every v4.5.0 and later Evolution Target to include real end-to-end acceptance. The v4.5 Target must cover semantic matching when Source does not contain the declared label or alias, missing-category suggestion and explicit re-analysis, genuinely insufficient evidence, materially ambiguous candidates, misleading Source keywords, Advisor unavailability and model or prompt change, deterministic replay, and equivalent Engine-owned semantics in WorkBuddy and an independent conformant Host.
- Organize v4.5.0 real-Host acceptance as exactly five top-level ordinary-human journeys with an independently evidenced machine variant matrix covering all required Source types, classification branches, Advisor states, Harness outcomes, Host negatives and cumulative regression obligations. For later Targets, five is the default maximum; exceeding it requires an explicitly reviewed reason that the additional journey has an independent authority boundary, incompatible starting or terminal state, or materially different real-Host interaction that cannot safely be a machine variant.
- Require the v4.5.0 Target to include cumulative real end-to-end acceptance from a fresh candidate and Workspace: classification through explicit continue, Harness Eligibility, professional Source-to-Harness reasoning, Catalog comparison, Harness evolution decision, Proposal Review, Proposal human decision, separate publication, Catalog validation, and safe close in real WorkBuddy, with equivalent Engine-owned semantics in an independent conformant Host. Classification-only journeys cannot substitute for this retained zero-to-one lifecycle.
- Require every Target-bound WorkBuddy journey to follow the Revision 10 real-Host policy: a designated human independently performs the complete frozen WorkBuddy RC runbook set while Codex neither operates nor observes WorkBuddy and requests no WorkBuddy execution artifact. The WorkBuddy legs remain `PENDING` until the designated human sends the final range-completion declaration, after which those human-operation legs are accepted as `PASSED`; every non-WorkBuddy criterion retains its machine-evidence requirement and release remains separately unauthorized.
- Establish the single-document namespace, resource envelope, canonical snapshot, and context bindings as the forward-compatible base that v4.7 later extends with multi-Pack imports, precedence, publication, and Organization ownership rather than replacing the v4.5 Taxonomy contract.

The objective is cumulative Source-first Harness evolution: an ordinary user supplies material without knowing its classification; the Engine explains the best supported business domain and product-or-system type, distinguishes a missing category from weak evidence and ambiguity, and then, only after a complete classification and explicit user choice, continues into the full retained Harness producer lifecycle. LLM interpretation is a bound signal inside Engine-owned deterministic decisions, never the final authority or a route to automatic Taxonomy, Proposal, approval, or publication mutation. This milestone does not add a complete Ontology platform, multi-Pack merge, Organization Pack governance, a `DomainHarnessPack` ecosystem, semantic-web mapping, incremental graph runtime, model training, automatic threshold activation, or compatibility migration for superseded pre-v4.5 artifacts.

### v4.6.0: Professional Reasoning Depth And Bundle Quality

- Deepen the professional Source-to-Harness reasoning already retained in v4.5.0 by extracting more precise evidence-bound business objects, capabilities, task classes, roles, constraints, workflows, failure modes, recovery rules, validators, and positive and negative cases.
- Improve the existing Harness Eligibility and finite Harness decisions by explaining reusable boundaries, alternatives, rejection reasons, risks, expected effects, missing evidence, and professional sufficiency without changing their human-authority semantics.
- Improve the professional completeness, dependency closure, composition quality, boundary specificity, and Evaluation coverage of the HarnessProfiles and immutable HarnessBundles already produced by v4.5.0.
- Use the v4.5 classification context to improve professional reasoning while proving that taxonomy labels, retriever scores, and LLM similarity remain context only and never become Harness Eligibility, composition, approval, or publication authority.
- Compare the enhanced professional reasoning and Bundle composition against a frozen v4.5.0 baseline using governed, context-equivalent evidence, uncertainty, conflict, and no-regression gates; calibration remains advisory and cannot activate policy automatically.
- Preserve every v4.5.0 classification, Harness evolution, review, approval, publication, Host-conformance, recovery, and safe-close capability and require complete cumulative end-to-end replay before accepting any v4.6.0 quality improvement.

The objective is to improve the depth and quality of capabilities already present in v4.5.0, not to restore professional Source-to-Harness reasoning, HarnessProfile, HarnessBundle, Proposal, approval, or publication functionality that a prior release removed. v4.6.0 remains additive and cumulative.

### v4.7.0: Governed Multi-Pack and Organization Lifecycle

- Extend the stable v4.5 Taxonomy envelope, namespaces, canonical snapshots, and context bindings with versioned Domain, Product, Organization, and `DomainHarnessPack` resources, imports, precedence, equivalence, replacement, deprecation, and fail-closed merge semantics.
- Separate editable drafts from immutable resolved publication snapshots; approval, publication, and Evolution Context activation remain independent actions.
- Add base-digest, optimistic-concurrency, conflict-set, atomic-publication-set, semantic-version and dependency-propagation, migration, and rollback contracts.
- Provide Pack scaffolding, linting, validation, dependency inspection, installation, update, rollback, documentation, benchmark, Gold Case, quality-level, optional-signing, and certification tooling.
- Separate community, domain-team, and private Organization roots with explicit provenance, trust, author, reviewer, approver, and publisher roles.

### v4.8.0: Scalable Semantic Interoperability and Incremental Reasoning

- Add versioned JSON-LD and PROV-O compatible projections, RDF and OWL mappings, SHACL-compatible validation, multilingual terms, and governed external-vocabulary identity mapping without becoming a general-purpose knowledge-graph platform.
- Treat imported vocabularies as inactive evidence that cannot activate or override user Packs.
- Add content-addressed semantic and graph indexes, affected-subgraph calculation, selective Source re-analysis, incremental dependency propagation, and full-recompute equivalence proofs.
- Add bounded concurrency, cache-digest binding, performance budgets, decision telemetry, large-Catalog impact analysis, and federated read-only Pack discovery.
- Preserve source Catalog, version, digest, provenance, trust, and authority context across interoperability, indexing, caching, and federation.

## Deferred Discussion Register

The following item records a reviewed discussion outcome only. It is not a
versioned milestone, accepted product scope, Evolution Target, implementation
authorization, acceptance obligation, release requirement, or version
commitment. Discussion must not resume until v4.5.0 has been formally
published and independently verified from the public distribution boundary.
At that point, EvoPilot and `evopilot-harness` must rerun their Roadmap Gates,
review the cross-project boundary, and explicitly decide whether the proposal
enters a later version and, if so, which version.

### EvoPilot-owned execution Lifecycle Harness

- Preserve two independent meanings of lifecycle. `evopilot-harness` continues
  to own the Harness Asset lifecycle: evidence ingestion, reasoning, authoring,
  evolution, review, approval, evaluation, publication, Catalog, and Registry.
  EvoPilot continues to own project Goal/Target execution and project release
  decisions.
- After v4.5.0 publication, discuss a versioned EvoPilot execution-lifecycle
  model that can select and immutably bind one resolved lifecycle for a Goal or
  Target while referencing one or more published, digest-pinned
  `HarnessBundle` assets. The proposed execution lifecycle may define stages,
  transitions, gates, evidence closure, retries, human decisions, completion,
  and release-decision inputs without giving EvoPilot Harness authoring or
  publication authority.
- The future design should support multiple lifecycle definitions selected by
  software type, task class, risk, environment, or release mode. A concrete run
  remains bound to one exact resolved definition and must not silently switch
  lifecycle during execution.
- Treat Alpha, Beta, RC, and GA as a possible built-in compatibility profile,
  not as the universal lifecycle model. Other possible profiles, including
  library, database, documentation, security-hotfix, and non-release
  exploration lifecycles, remain examples for future review rather than
  accepted product requirements.
- Do not redefine `HarnessBundle` as an execution lifecycle or move EvoPilot
  Goal Loop execution into `evopilot-harness`. Any future cross-project
  contract change requires explicit Roadmap and ADR review in the affected
  repositories.

This deferred item has no effect on the v4.5.0 milestone, approved v4.5.0
Evolution Target, completed implementation, frozen Candidate bytes, acceptance
portfolio, release readiness, or release authority. It does not reserve v4.6,
v4.7, v4.8, or any other version.

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
11. A compatibility reset, refactor, milestone exclusion, or historical-acceptance partition cannot delete a released product capability. Any intended capability removal or deprecation requires an explicit Roadmap capability-change proposal and user approval.

Release tags must be declared by the machine Roadmap and pass `npm run roadmap:release -- <version>`.
