# Harness Operation Server MCP Reference

## Start

```bash
evopilot-harness mcp serve \
  --transport stdio \
  --workspace "$HOME/.evopilot-harness"
```

Use `evopilot-harness agent bootstrap --host <id> --workspace <path> --json` to obtain the exact installed-package command. From a checkout, replace `evopilot-harness` with `node /absolute/path/src/index.mjs`. v4 supports only local stdio. It opens no listening port and rejects a Workspace inside the Release.

Protocol v3 exposes `reevaluate_operation_session` for an explicit reevaluation against the current Source and governed environment. It never overwrites the prior Session or imports a prior approval: it creates a new append-only Session, binds a new `EvolutionContextBinding`, returns the deterministic old/new context difference, renders a new Engine-owned Plan, and stops at the new Plan decision.

## Protocol

The server accepts one JSON-RPC 2.0 message per line. Supported MCP protocol versions are `2025-11-25`, `2025-06-18`, `2025-03-26`, and `2024-11-05`. Standard initialization requires `protocolVersion`, `capabilities`, and `clientInfo`; it does not require a non-standard client extension. A host may additionally send `clientInfo.compatibility` with the exact Product version, Expert version, Core digest, Agent protocol, and Engine API. If supplied, any mismatch fails before Workspace mutation.

After standard initialization, the Digital Expert must call `inspect_capabilities` and compare the returned Product, Expert, Core, Agent protocol, and Engine API values with its packaged Adapter and manifest lock before mutation. This post-initialize check is mandatory even when the optional extension was supplied. Initialization must complete before tools or resources are read.

Session and Plan inputs accept references, not credentials. Raw API keys, tokens, passwords, authorization headers, cookies, credentials, and private-key material are rejected. Before Session or receipt persistence and before mutating Engine operations, the Workspace tree is checked for internal symlinks that escape the Workspace. Individual output paths are also resolved through existing ancestors and must remain inside the external Workspace.

Supported MCP methods:

- `initialize`
- `notifications/initialized`
- `ping`
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`
- `resources/templates/list`
- `logging/setLevel`

## Tools

| Tool | Purpose | Authority |
|---|---|---|
| `inspect_capabilities` | Versions, operations, safety, Workspace state | Read-only |
| `prepare_workspace` | Initialize external Workspace | External Workspace only |
| `start_operation_session` | Bind human intent and Adapter | Session mutation |
| `plan_operation_session` | Build evolve, feedback, comparison, calibration, professional-learning, or maintenance Plan | Review stage |
| `confirm_operation_plan` | Record exact human Plan confirmation | Digest-bound human gate |
| `execute_operation_plan` | Run only confirmed Engine operations | Planned Engine authority |
| `authorize_plan_publication_operation` | Authorize one Catalog/Ontology/Policy publication in a confirmed Plan | Separate digest-bound human gate |
| `resolve_interrupted_operation` | Accept a durable receipt or authorize retry only after an unchanged Workspace digest | Explicit recovery gate |
| `authorize_blocked_operation_retry` | Return a repairable blocked Proposal Review to review-ready state after complete blocker/retry presentation and unchanged Workspace verification | Separate digest-bound retry gate; no approval or publication authority |
| `acknowledge_evidence_report_review` | Bind human review of one exact Comparison or Calibration Report | Review acknowledgement only; no lifecycle authority |
| `record_business_view_delivery` | Idempotent compatibility/recovery fallback for the automatic canonical-presentation delivery receipt | Delivery evidence only; no human authority |
| `submit_business_decision` | Carry the current hidden decision handle, one finite human choice, and human identity; Engine resolves every digest/token | Explicit current human gate only |
| `advance_operation_session` | Continue only the next already-authorized non-human operation until the next canonical view | No new human authority |
| `review_session_proposals` | Produce Engine Proposal Review reports | Engine verdict authority |
| `start_operation_job` | Start or recover one digest-bound long-running Engine operation | Idempotent operation transport only; no human-gate authority |
| `inspect_operation_job` | Read one durable Job and its authoritative terminal result | Read-only |
| `list_operation_jobs` | List durable Jobs in the external Workspace | Read-only |
| `approve_session_proposal` | Bind Proposal, Review, Evaluation, and human approval | Separate human gate |
| `authorize_proposal_publication` | Record separate publication decision | Separate human gate |
| `publish_session_proposal` | Publish authorized Proposal and validate Catalog | Engine mutation |
| `inspect_operation_session` | Read and verify one Session | Read-only |
| `list_operation_sessions` | List resumable Sessions | Read-only |
| `resume_operation_session` | Transfer a Session to another Adapter | Digest-bound Session mutation |
| `migrate_operation_session_to_v3` | Explicitly migrate a v2 Session without fabricated historical views or receipts | Compatibility mutation |
| `cancel_operation_session` | Cancel without deleting assets | Explicit human gate |
| `close_operation_session` | Close while preserving audit state | Explicit human gate |
| `cleanup_operation_session` | Delete only owned closed-session metadata | Explicit destructive gate |
| `run_engine_diagnostic` | Run declared read-only Engine inspection/validation | Mutations rejected |

Every tool schema recursively rejects unknown fields where the contract is closed. Engine operation inputs pass a second field whitelist, secret-material check, and write-boundary check. Proposal approval, publication, and planned comparison/calibration/learning mutations are not exposed through the generic diagnostic tool. `run_engine_diagnostic` may inspect or validate evidence inputs and read reports. `comparison.process`, `comparison.ingest|score|rescore`, `calibration.ingest|run`, and `learning.ingest|snapshot|run-manifest|score|rescore` require a confirmed Plan. `catalog.publish`, `ontology.publish`, and `policy.publish` stop after Plan confirmation and require their own operation authorization before the Engine may write.

Every presentation-producing tool records a `CanonicalPresentationDeliveryReceipt` inside the Operation Server canonical-response path before returning the governed view. This is deterministic transport evidence: it binds the exact current Frame, Business View, canonical Markdown, Host conformance profile, and Session digest without another user prompt or assistant turn. It is not a human acknowledgement, does not prove screen pixels by itself, and grants no Plan, Proposal, publication, close, cleanup, or retry authority. Real Host conformance and screenshot acceptance still verify that the returned canonical Markdown became the complete visible assistant turn.

Every decision-bearing canonical Markdown view ends with an invisible deterministic `decisionHandle` binding. The Host may copy that opaque handle and one option from the current `DecisionDefinition` into `submit_business_decision`; it may not obtain, construct, search for, display, or reason over internal Session, Frame, Plan, Proposal, Review, publication, or close digests and confirmation tokens. The Engine verifies the current presentation receipt and immutable binding, resolves its private credentials internally, and rejects stale handles or undeclared options. `advance_operation_session` then performs only work already authorized by the accepted decision; it cannot create authority and stops at the next Engine-owned business view.

`record_business_view_delivery` remains an idempotent compatibility and recovery fallback. Its `renderedBusinessViewDigest` means the digest of the complete visible prose in that governed assistant turn, not merely an embedded attachment or matching substring. It must equal the digest of `businessView.canonicalMarkdown`. A Host that adds prose before or after it, rewrites or translates it, or cannot replace the whole visible turn must stop with `HOST_INTERACTION_COMPLIANCE_UNAVAILABLE`; it must not use the fallback to claim compliant rendering.

Proposal Review has semantically identical bounded-synchronous and durable asynchronous transport paths. A Host with a verified request window may use `review_session_proposals`. WorkBuddy and any Host whose declared window cannot cover the Review timeout must use `start_operation_job(operation=proposal.review)` and poll `inspect_operation_job`. Job identity binds the Session digest, operation, and input digest. Repeating that exact start returns the same Job; reconnecting never grants permission to retry, approve, publish, close, or clean anything. The detached Engine worker can finish after the MCP client disconnects, and a new compatible Host retrieves the same persisted result. If the worker actually disappears before recording a result, recovery is `INTERRUPTED_UNCERTAIN` and automatic re-execution is forbidden.

`acknowledge_evidence_report_review` requires `reportType`, `reportId`, `expectedReportDigest`, `confirmedBy`, the current `sessionDigest`, and the exact internally constructed acknowledgement. It re-reads the persisted report and rejects stale or tampered content. Success proves review only; it does not approve a Proposal, activate a policy, authorize rollback, publish, or execute.

## Resources

- `evopilot-harness://capabilities`
- `evopilot-harness://workspace/status`
- `evopilot-harness://digital-expert/manifest`
- `evopilot-harness://sessions`
- `evopilot-harness://sessions/<sessionId>`
- `evopilot-harness://operation-jobs`

## Tool Result

Successful calls return both MCP text content and `structuredContent`. Product failures use `isError=true` with:

```json
{
  "schema": "evopilot-harness-agent-operation-error/v1",
  "status": "FAILED",
  "code": "SESSION_DIGEST_MISMATCH",
  "message": "Agent Operation Session changed since the caller last read it.",
  "nextAction": "reload-session"
}
```

JSON-RPC framing, method, or schema errors use JSON-RPC error codes. Agents must preserve `code` and `nextAction`; they must not silently retry.
