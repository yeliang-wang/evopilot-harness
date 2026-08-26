# ADR 0004: Deterministic Business-Centric Agent Interaction and Presentation Sandbox

- Status: Accepted for v4.4.0 implementation
- Date: 2026-08-23
- Refines: [ADR 0002](0002-agent-native-harness-operations.md)
- Preserves: [ADR 0001](0001-product-and-module-boundaries.md)

## Context

Agent Operations Protocol v2 made complete Engine objects visible and digest-bound, but a third-party Agent host could still make raw protocol fields the primary user experience. The Engine remained safe while the human had to interpret transport, state-machine, and audit details instead of the Harness business problem: what the source proves, what reusable capability should result, why, and which business decision is required.

Host-authored summaries cannot close this gap. Their wording and omissions vary with the host and its language model, so replacing WorkBuddy with another MCP host can change decision-relevant meaning even when the Engine result is unchanged.

## Decision

Agent Operations Protocol v3 makes the Engine the sole author of two immutable, mutually bound projections:

1. `BusinessDecisionView` is the exact primary human view. It explains the business goal, Source-to-Harness reasoning, proposed change, alternatives, uncertainty, risks, and one finite Engine-declared decision.
2. `ComplianceAuditEnvelope` preserves the complete authoritative render model, digests, authority, permitted and forbidden operations, Source reasoning map, and decision definition. A host may collapse it visually but must keep it available.

Revision 8 completes this boundary with an Engine-owned presentation sandbox. The sandbox is not an operating-system process sandbox and does not execute Source content. It is a deterministic structured-rendering boundary with these properties:

- `EvolutionContextBinding` fixes the Source snapshot, Catalog, Ontology, Match Policy, Advisor Policy and non-secret profile identity, operation intent, locale, and template version before professional analysis begins.
- `HarnessProfessionalAnalysis`, `HarnessArchitectureAssessment`, and `SourceOutcomeExplanation` are schema-validated Engine objects. They cover positive, no-change, unsuitable, insufficient-evidence, and rejected outcomes without relying on Host prose.
- the versioned template registry accepts only those structured objects, applies fixed section identifiers, order, labels, omission rules, and locale, then emits canonical Markdown and its digest;
- the same authoritative Evolution Context is replayed from immutable objects and does not repeat Engine or Advisor mutation;
- a changed Source, Catalog, Ontology, Policy, Advisor identity, intent, locale, or template version is a new context and cannot be presented as a replay of the old context.

The professional outcome set is finite: `REUSE_EXISTING`, `EVOLVE_EXISTING`, `COMPOSE_NEW_BUNDLE`, `PROPOSE_NEW_PROFILE`, `NOT_HARNESS_ELIGIBLE`, `NEED_MORE_EVIDENCE`, `NO_CHANGE`, and `REJECT`. Every accepted capability cites Source evidence and its extraction, normalization, Ontology mapping, and transformation rationale. Every non-adopted item records the failed or uncertain criterion, counter-evidence or missing evidence, and a safe next-evidence request or rejection reason.

`AgentHostBoundaryContract` and `HostConformanceProfile` make the host boundary executable. A governed Host must prove MCP connectivity, complete operation interception, exact Engine-owned Frame rendering, a digest-bound presentation receipt, fixed-locale rendering within the governed Frame, Workspace recovery, and the required timeout or `OperationJob` behavior before lifecycle entry. The Host may own surrounding chrome, loading, model-status, and transport-status surfaces, but they carry no Harness authority. Missing governed capability, Frame rewriting, translation, obstruction, replacement, omission, reordering, chat-memory recovery, inferred approval, unauthorized acknowledgement or confirmation, or a stale/incomplete receipt fails closed without governed state advance.

The Engine also emits `SourceToHarnessReasoningMap` and `DecisionDefinition`. A composite digest binds the Session, subject, frame, Business View, Audit Envelope, decision definition, Host delivery, and automatic receipt. Any drift invalidates the next governed operation. A deterministic opaque `decisionHandle` is embedded as non-visible machine transport in the canonical Markdown. The Host carries only that handle, one current finite choice, and the human identity through `submit_business_decision`; the Engine resolves every private digest and confirmation token. `advance_operation_session` can then run only the next already-authorized non-human operation and stops at the next canonical business view. This removes Host digest discovery and token construction without weakening stale-binding rejection or merging Proposal approval with publication authority.

The host may transport attachments, render exact Engine content, provide UI, invoke MCP tools, and carry an explicit human choice. It may not create or rewrite Harness reasoning, decision options, lifecycle state, approval, publication authority, or recovery evidence. In a governed presentation turn, `BusinessDecisionView.canonicalMarkdown` is the entire visible prose: a Host preface, translation, summary, status paragraph, conclusion, or next-step paraphrase is a contract violation even when the canonical view is also attached. To reduce Host-LLM composition drift, an MCP result containing a canonical view returns that Markdown as its sole primary text and declares an exact whole-turn replacement contract in result metadata; the complete structured result remains available for tool logic and audit. The Operation Server records delivery deterministically inside that canonical-response path before returning the view, so a Host model cannot omit the receipt or postpone it to another user turn. This receipt binds transport bytes and conformance metadata, not screen pixels or human intent, and carries no human authority; real Host acceptance separately proves exact visible rendering.

The Harness Advisor remains distinct from the Host LLM. It may use only the user's configured Harness model profile and provide advisory evidence. It cannot choose the deterministic outcome, author the canonical presentation, execute an operation, approve, publish, mutate policy, or override a gate.

Every Protocol v3 Session archives each immutable Frame when it becomes current. Archive inspection never re-executes the original governed mutation. Production conformance requires three distinct fresh Workspace, Session, and WorkBuddy task lifecycles with the same governed inputs. Each run must present in order Operation Plan; professional analysis and Proposal Review; Proposal human decision; and publication plus Session lifecycle decisions. Repeating one selected Frame or replaying one completed Session cannot stand in for these three production runs.

Protocol v2 Sessions remain readable and diagnosable. They can be explicitly cancelled or safely closed using their exact Session digest, or explicitly migrated. Migration preserves a digest of legacy interaction evidence, clears the v3 current frame and delivery receipts, and never fabricates historical Business Views or receipts.

## Alternatives considered

- Host-authored business summaries: rejected because business meaning would drift by host and model.
- Keep the complete raw Interaction Frame as the primary UI: rejected because audit completeness is not a usable business decision experience.
- Remove technical detail: rejected because governance, diagnosis, and independent verification require the full authoritative envelope.

## Consequences

- WorkBuddy and independent compatible hosts must produce identical authoritative Business View and audit digests; layout and transport metadata may differ.
- Three fresh complete production lifecycles with the same Source, candidate, Harness configuration, Catalog and policy baseline, locale, and explicit decisions must preserve governed Frame structure, professional business semantics, language, finite choices, and order. Run-specific Workspace, Session, Job, receipt, timestamp, and digest identities are compared as typed bindings rather than literal bytes.
- Rewriting, obstruction, replacement, omission, stale governed content, ambiguous continuation, unauthorized acknowledgement or confirmation, and stage reordering fail closed. Isolated Host-owned chrome, loading, reasoning-status, and transport-status content is excluded from the governed comparison.
- Ordinary Plan execution does not add pseudo-business confirmations. Approval, publication, retry, cancellation, close, and cleanup remain separate only where product authority or risk actually changes.
- The deterministic Engine owns more presentation contract code, but no ADR 0001 product boundary changes.
