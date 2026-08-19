# Harness Operation Server MCP Reference

## Start

```bash
evopilot-harness mcp serve \
  --transport stdio \
  --workspace "$HOME/.evopilot-harness"
```

From a checkout, replace `evopilot-harness` with `node /absolute/path/src/index.mjs`. v4 supports only local stdio. It opens no listening port and rejects a Workspace inside the Release.

## Protocol

The server accepts one JSON-RPC 2.0 message per line. Supported MCP protocol versions are `2025-06-18`, `2025-03-26`, and `2024-11-05`. Initialization must include `clientInfo.compatibility` with the exact Product version, Expert version, Core digest, Agent protocol, and Engine API declared by the imported Adapter and manifest lock. Any missing or mismatched field fails before Workspace mutation. Initialization must complete before tools or resources are read.

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
| `plan_operation_session` | Build evolve, feedback, or maintenance Plan | Review stage |
| `confirm_operation_plan` | Record exact human Plan confirmation | Digest-bound human gate |
| `execute_operation_plan` | Run only confirmed Engine operations | Planned Engine authority |
| `authorize_plan_publication_operation` | Authorize one Catalog/Ontology/Policy publication in a confirmed Plan | Separate digest-bound human gate |
| `resolve_interrupted_operation` | Accept a durable receipt or authorize retry only after an unchanged Workspace digest | Explicit recovery gate |
| `review_session_proposals` | Produce Engine Proposal Review reports | Engine verdict authority |
| `approve_session_proposal` | Bind Proposal, Review, Evaluation, and human approval | Separate human gate |
| `authorize_proposal_publication` | Record separate publication decision | Separate human gate |
| `publish_session_proposal` | Publish authorized Proposal and validate Catalog | Engine mutation |
| `inspect_operation_session` | Read and verify one Session | Read-only |
| `list_operation_sessions` | List resumable Sessions | Read-only |
| `resume_operation_session` | Transfer a Session to another Adapter | Digest-bound Session mutation |
| `cancel_operation_session` | Cancel without deleting assets | Explicit human gate |
| `close_operation_session` | Close while preserving audit state | Explicit human gate |
| `cleanup_operation_session` | Delete only owned closed-session metadata | Explicit destructive gate |
| `run_engine_diagnostic` | Run declared read-only Engine inspection/validation | Mutations rejected |

Every tool schema recursively rejects unknown fields where the contract is closed. Engine operation inputs pass a second field whitelist, secret-material check, and write-boundary check. Proposal approval and publication operations are not exposed through the generic diagnostic tool. `catalog.publish`, `ontology.publish`, and `policy.publish` stop after Plan confirmation and require their own operation authorization before the Engine may write.

## Resources

- `evopilot-harness://capabilities`
- `evopilot-harness://workspace/status`
- `evopilot-harness://digital-expert/manifest`
- `evopilot-harness://sessions`
- `evopilot-harness://sessions/<sessionId>`

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
