# ADR: Agent-Native Harness Operations

## Status

Accepted and released in v4.0.1. The v4.0.0 source tag was superseded after its Release workflow failed before publication.

## Context

The v3 Engine exposes an automation-safe JSON CLI and a project-level Guided Operator that simulates a careful human CLI operator. A human still needs to discover that Skill or understand which operating surface to invoke. The approved v4 direction makes a portable, question-driven Digital Expert the supported ordinary human entry while preserving the deterministic Harness asset boundary in ADR 0001.

This decision is about how the Harness producer is operated. It does not turn `evopilot-harness` into a HarnessBundle execution sandbox, a general Agent runtime, an EvoPilot project control plane, or a model-training system.

## Decision

1. A human expresses goals and decisions through a Digital Expert loaded by a compatible external Agent host such as Codex, WorkBuddy, or Claude Code.
2. The Digital Expert is an independently packaged, Agent-neutral definition with generated host adapters. It owns conversation guidance, one-question-at-a-time intent collection, Operation Plan presentation, Engine-result rendering, human stop points, and resume guidance.
3. A local Harness Operation Server exposes structured tools and resources. `stdio` MCP is the default v4.0.0 transport; a remote multi-tenant service is excluded.
4. The Operation Server loads or invokes the deterministic Engine, validates protocol and version compatibility, manages process health, and persists `AgentOperationSession` state only in an explicit external Workspace.
5. The Engine remains authoritative for Evidence Source ingestion, reasoning, LLM Advisor policy, Proposal construction, Review verdicts, validation, digest-bound approval, publication, Catalog, Registry, and mutable lifecycle state.
6. Atomic JSON CLI contracts remain available for Engine automation, CI, compatibility, and emergency diagnosis. They are not the supported ordinary human journey in v4.
7. A human must not need to enter a Harness CLI command for a supported v4 end-to-end scenario. The Agent may execute only declared machine operations and cannot turn natural-language continuation into approval or publication.
8. Every planned Engine operation uses a stable idempotency key and durable result receipt. An interrupted operation may continue only by accepting a matching receipt or by explicitly retrying after an unchanged Workspace digest; an uncertain changed Workspace fails closed.
9. Catalog, Ontology, and Policy publication inside a maintenance Plan requires a separate operation-level publication authorization after Plan confirmation.

## Component Boundaries

| Component | Owns | Must not own |
|---|---|---|
| Digital Expert Core | role, conversation state machine, intent questions, plan and result presentation, human gates, resume guidance | Harness matching, business verdicts, approval identity, publication authority, credentials, mutable asset state |
| Agent Adapter | host-specific packaging and transport binding generated from the Core | host-specific business rules or divergent workflow semantics |
| Harness Operation Server | MCP handshake, capabilities, structured tools/resources, process health, compatibility, Session coordination | general Agent loop, conversational LLM, unrestricted shell, bypass of Engine policy |
| AgentOperationSession | intent, plan digest, operation references, current stage, next action, Proposal/Review references, interruption and close state | raw secrets, canonical Harness assets, approval authority, reliance on Agent conversation memory |
| External Agent Host | user conversation, Digital Expert loading, MCP invocation, rendering, explicit user decision collection | Engine state ownership, Harness verdicts, silent approval or publication |

Existing ADR 0001 modules remain authoritative. v4 implementation may extend executable architecture guards for these operating modules, but it may not weaken the existing 24 boundaries.

## Interaction And Process Model

```text
Human
  -> External Agent Host
  -> Portable Digital Expert
  -> local stdio MCP
  -> Harness Operation Server
  -> deterministic Harness Engine
  -> external EVOPILOT_HARNESS_HOME
```

The default lifecycle is:

```text
DISCOVER -> DOCTOR -> READY -> COLLECT_INTENT -> PLAN_REVIEW
  -> WAIT_EXECUTION_CONFIRMATION -> EXECUTING -> [WAIT_OPERATION_PUBLICATION_AUTHORIZATION]
  -> PRESENT_REVIEW
  -> WAIT_HUMAN_DECISION -> APPROVE -> WAIT_PUBLICATION_CONFIRMATION
  -> PUBLISH -> VERIFY -> COMPLETE
```

`BLOCKED`, `FAILED`, and `CANCELLED` are explicit terminal or resumable states. Session recovery revalidates Engine version, protocol, Workspace, operation receipt, plan, Proposal, Review, and digest state rather than trusting prior Agent conversation text or blindly repeating an uncertain mutation.

## Security And Authority

- MCP is a machine protocol, not an authentication, authorization, or isolation boundary.
- The Engine revalidates every mutating request and remains fail-closed on missing, stale, or incompatible state.
- Release files, source projects, attachments, logs, and human-maintained model configuration retain their existing read/write boundaries.
- The Digital Expert and Agent host cannot execute source-project build, test, deploy, or business commands.
- Proposal Review is always an Engine result. An Adapter may explain fields but cannot create or rewrite the verdict.
- Approval binds the current Proposal, Review Report, Evaluation state, user-supplied confirmation, and digests. Publication requires a separate user decision.
- Plan confirmation does not authorize Catalog, Ontology, or Policy publication. Each such operation binds a separate authorization to its Plan digest, operation index, and operation digest.
- v4.0.0 makes no strong human-identity claim beyond the evidence available from the local Agent session.

## Portability And Compatibility

The Digital Expert is released independently from source layout as a versioned artifact containing an Agent-neutral Core, schemas, policies, renderers, adapters, and conformance tests. Its manifest declares the Expert version, Engine protocol range, compatible Engine versions, required host capabilities, and adapter identity.

An Agent is supported only when it can use at least one declared integration surface such as MCP, structured tool calling, local process execution, or a compatible Agent Skill. Unsupported hosts receive a capability failure rather than an equivalence claim.

The v4.0.0 release must prove Codex plus at least one independent Agent adapter against the same real local Engine and stdio MCP scenarios. WorkBuddy-specific support may be claimed only after its actual extension and process capabilities are verified.

## Compatibility And Migration

- v3 Harness assets, Workspace state, Proposal history, Catalogs, Registry files, and feedback packages remain data-compatible unless a separately reviewed schema migration says otherwise.
- The current Guided Operator is migration input for the Digital Expert Core. v4 must not maintain two divergent ordinary user workflows.
- Existing JSON CLI automation remains supported for the v4 compatibility window. Human-oriented CLI tutorials move to compatibility/diagnostic documentation after Agent-native acceptance.
- EvoPilot and evopilot-dashboard require no release because published Harness consumption and feedback contracts do not change.
- MCP initialization binds the exact Product version, Expert version, Core digest, Agent protocol, and Engine API. Any mismatch blocks before Workspace mutation.
- Session inputs persist only normalized references and reject raw secret material.
- Mutating output paths are resolved through existing ancestors and cannot leave the external Workspace through absolute paths or symlinks.

## Consequences

- Humans can complete supported Harness production lifecycles through natural-language interaction without learning CLI commands.
- Operation state becomes portable across compatible Agent hosts because it lives in the Workspace rather than one conversation memory.
- Cross-Adapter conformance and process lifecycle become release-blocking product responsibilities.
- v4 remains a Harness producer. Agent-native operation does not transfer Goal Loop, project release, or source-project execution ownership.

## Implementation And Release Gate

Implementation is bound to the approved `evopilot-evolution-target/v1` and current Roadmap digest. Acceptance evidence is collected in [v4 Acceptance](../../operations/v4-acceptance.md). Implementation completion never authorizes commit, tag, GitHub Release, npm, or container publication; those actions require a separate release review and passing release gate.
