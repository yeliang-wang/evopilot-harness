# Deterministic Third-Party Agent Interaction Compliance

## Status

This document records the approved revision 3 design for the `evopilot-harness` v4.3.0 candidate. Revision 3 adds the bounded multi-source Proposal Review repair closure discovered during real WorkBuddy acceptance. Implementation approval does not authorize Release.

## Problem

The v4 Digital Expert Core already requires complete immutable-object presentation before every human decision. Generated Adapters carry the same Core digest, and the Engine enforces decision tokens and digest boundaries. A third-party Agent may nevertheless summarize, omit, collapse, or reorder visible conversation because current presentation rules are instructions rather than an executable host interaction contract.

The current `review_session_proposals` Session reference illustrates the gap: it preserves Review identity, verdict, and digests but not the complete Review fields required by the Digital Expert Renderer. A host must discover and call a separate inspection operation, and conformance currently validates Engine state markers rather than the complete visible transcript.

## Boundary

The deterministic Engine remains authoritative for Evidence, reasoning, Proposal Review, Evaluation, approval binding, publication, and Workspace state. The new capability belongs to the five v4 operating boundaries: Digital Expert Core, Agent Adapter, Harness Operation Server, AgentOperationSession, and External Agent Host.

It does not change Proposal Review Engine verdicts, Evaluation meaning, Catalog authority, model configuration, or source-execution policy. The Proposal Review membership contract adds an Engine-owned source digest so repaired semantic output can be bound to the exact Evidence Source identity.

## Interaction Frame

Every visible stage is represented by an immutable `evopilot-harness-interaction-frame/v1` object with:

- `frameId`, `stage`, `createdAt`, and `frameDigest`;
- Session id/digest and current Adapter/Core compatibility binding;
- subject type, identifier, immutable object digest, and supporting bindings;
- complete `requiredFields` and a schema-validated `renderModel`;
- exact human decision still required, or `null` when presentation must precede the question;
- permitted next interactions and forbidden governed operations;
- redaction classification and authority statement.

The Operation Server constructs the frame from authoritative Engine and Session state. An Agent cannot provide, delete, or redefine required fields.

## Deterministic Renderer

The packaged Core provides a canonical renderer for every frame stage. It emits structured content and canonical Markdown. Host LLM output may add a clearly separated explanation but may not replace or mutate the canonical rendering.

Required stages include capability and model readiness, Execution Brief, Plan, maintenance publication operation, comparison, calibration, professional completeness, Proposal Review, Proposal approval question, publication impact and question, interruption recovery, cancellation, close, cleanup, blocker, and final Catalog validation.

Collapsed UI, a link, an artifact, or a generic “view changes” affordance is supplemental and never substitutes for required canonical content in the visible conversation.

## Interaction Controller

An Agent-neutral controller owns only interaction sequencing. For each frame it:

1. validates the frame schema and digest;
2. selects the canonical renderer;
3. emits the complete render payload through the host Adapter;
4. verifies the host-specific observable delivery evidence required by its capability level;
5. exposes only the operations permitted for the resulting stage;
6. records a non-authoritative presentation receipt bound to the frame and host evidence;
7. advances to a separate decision frame only after successful presentation.

The presentation receipt is interaction evidence, not human approval. Approval and publication retain their existing Engine credentials and separate decisions.

## Host Capability Levels

- `TRANSPORT_ONLY`: structured MCP transport with no governed human gates.
- `CONVERSATIONAL_COMPATIBLE`: packaged Adapter conversation and tool use, but no claim that visible presentation is enforceable.
- `OBSERVABLE_INTERACTION_COMPATIBLE`: ordered visible transcript evidence can be inspected.
- `GOVERNED_HUMAN_GATE_COMPATIBLE`: deterministic rendering, operation interception, ordered transcript evidence, and fail-closed conformance are all proven for the exact host profile/version.

Only the final level may advance Plan confirmation, evidence acknowledgement, Proposal approval, publication authorization, retry authorization, cancellation, or destructive cleanup. Missing capabilities stop before the first affected gate with `HOST_INTERACTION_COMPLIANCE_UNAVAILABLE`.

## Protocol And Session Design

Revision 2 adopts Agent Operations Protocol v2 while preserving safe v1 inspection:

- new Sessions use a v2 interaction-state extension and immutable current-frame reference;
- v1 Sessions remain readable, diagnosable, cancellable, and closable;
- a v1 Session cannot resume a governed mutation until an explicit idempotent migration creates a valid v2 frame from current authoritative state;
- migration never fabricates prior presentation evidence;
- unsupported Adapters fail compatibility negotiation before mutation.

The user approved Agent Operations Protocol v2 with Target revision 2. Implementation must retain explicit version negotiation and may not silently treat a v1 Adapter as governed-gate compatible.

## Proposal Review Flow

The required flow is:

```text
PROPOSAL_REVIEW_REQUIRED
  -> run authoritative Review
PROPOSAL_REVIEW_PRESENTATION_REQUIRED
  -> construct and render the complete Review frame
PROPOSAL_REVIEW_PRESENTED
  -> construct a separate Proposal approval decision frame
PROPOSAL_APPROVAL_DECISION_REQUIRED
  -> accept only an explicit human approval bound to current Proposal and Review digests
PUBLICATION_PRESENTATION_REQUIRED
  -> render exact publication impact
PUBLICATION_DECISION_REQUIRED
```

No Review presentation acknowledgement is equivalent to Proposal approval. No Proposal approval is equivalent to publication authorization.

## Multi-Source Proposal Review Repair

Real WorkBuddy candidate acceptance exposed a bounded repair defect: an initial reviewer response omitted eleven of thirteen required memberships, while the repair request repeated only the missing source identifiers and not their immutable source context. The reviewer then returned empty references and the Engine correctly blocked the Session.

Revision 3 keeps semantic authority unchanged and separates immutable identity from model judgment:

- the repair request repeats every required source's `sourceId`, `sourceType`, `sourceRef`, `sourceDigest`, and allowed Evidence ids;
- the reviewer returns membership `sourceId`, `status`, `rationale`, and `evidenceIds` only;
- the Engine canonicalizes `sourceType`, `sourceRef`, and `sourceDigest` from the Evidence Projection;
- a model-supplied identity value must match exactly or the response is rejected;
- missing, duplicate, unknown, identity-mutated, empty-reference, or cross-source-cited memberships fail closed;
- only one policy-bounded repair is allowed, and failure never advances Proposal approval or publication.

## Conformance

Static Adapter digest equality is necessary but insufficient. Conformance must validate:

- every declared workflow and lifecycle branch produces the expected ordered frames;
- every required field appears in canonical visible output;
- no decision question precedes its presentation frame;
- no collapsed link or artifact substitutes for canonical content;
- forbidden operations fail in every earlier stage;
- stale frame, Session, Proposal, Review, Evaluation, comparison, or publication bindings fail closed;
- Generic and MCP fixtures validate full frames rather than status markers;
- WorkBuddy Desktop evidence records the actual visible expert, attachment, ordered conversation, structured tool exchange, and terminal Session state;
- unsupported hosts are reported as blocked rather than partially passed.

## Security And Privacy

Frames never contain credentials or raw secret-bearing model configuration. Evidence content follows existing redaction policy. Host evidence bundles redact unrelated conversations, account identifiers, notifications, and personal paths. Interaction receipts remain under the external Workspace and cannot mutate Release or Evidence Sources.

## Open Review Decisions

1. Confirm whether WorkBuddy exposes sufficient deterministic interception and observable transcript capabilities for `GOVERNED_HUMAN_GATE_COMPATIBLE`; if not, it must fail closed at governed gates.
2. Select the canonical Markdown size and pagination contract without allowing pagination to hide required content before a decision.
3. Define migration support duration for v1 Sessions.
