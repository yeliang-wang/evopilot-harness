# Agent-Native Quickstart

This is the ordinary v4 human journey. A human talks to a compatible external Agent. The Agent loads the Digital Expert and uses local stdio MCP; the human does not enter Harness lifecycle CLI commands.

## Prerequisites

- Node.js 22 or newer.
- An installed `evopilot-harness` v4 Release or checkout.
- A compatible Agent host that can load local instructions and call a local stdio MCP server.
- An external writable Workspace, normally `$HOME/.evopilot-harness`.
- A manually maintained read-only model configuration when Advisor or Proposal Review requires GLM.

## Install And Verify

From the Release root:

```bash
npm install
npm run digital-expert:check
node src/index.mjs version --json
```

Expected product version for this candidate is `4.0.0`. Do not put the Workspace inside the Release directory.

## Load The Expert

Choose one Adapter under `digital-expert/adapters/`:

| Adapter | Entry | Validation state |
|---|---|---|
| Codex | `codex/SKILL.md` | v4 acceptance path; project copy is generated at `.agents/skills/evopilot-harness-digital-expert/SKILL.md`. |
| Generic Agent | `generic/AGENT.md` | Independent executable conformance host included. |
| MCP client | `mcp/MCP.md` | Real stdio protocol conformance included. |
| Claude Code | `claude-code/CLAUDE.md` | Packaged; claim full support only after the actual host proves required capabilities. |
| WorkBuddy | `workbuddy/WORKBUDDY.md` | Packaged; claim full support only after the actual host proves required capabilities. |

All Adapters contain the same Core digest from `digital-expert/manifest.lock.json`. Host-specific instructions cannot change workflow or stop rules.

## Configure MCP

Configure the Agent host to launch:

```text
node /absolute/path/to/evopilot-harness/src/index.mjs mcp serve --transport stdio --workspace /absolute/external/workspace
```

The process writes only JSON-RPC messages to stdout, uses stderr for process diagnostics, and opens no network listener. v4.0.0 rejects non-stdio transports.

## Start A Conversation

Example:

```text
使用 /Users/me/project/cache-server 作为只读 source project，
引导我生成或升级 Harness。先展示计划，自动运行并展示 Proposal Review，
分别询问我是否批准、是否发布。
```

The Expert calls `inspect_capabilities`, prepares the Workspace, starts a persistent Session, and asks only the shortest missing question. Before execution it presents the Plan, source boundaries, Advisor mode, operations, stop points, and exact `planDigest`.

## Mandatory Decisions

The human answers one plain-language question about the Plan, Proposal, publication, or recovery action currently on screen. The Expert then builds and submits the Engine's exact digest-bound token internally. A human never copies or types these protocol values:

```text
CONFIRM_OPERATION_PLAN:<planDigest>
AUTHORIZE_PLAN_PUBLICATION:<sessionId>:<planDigest>:<operationIndex>:<operationDigest>
APPROVE_PROPOSAL:<proposalId>:<proposalDigest>:<reviewDigest>
AUTHORIZE_PUBLICATION:<proposalId>:<approvedProposalDigest>
```

`AUTHORIZE_PLAN_PUBLICATION` applies to maintenance Plans containing `catalog.publish`, `ontology.publish`, or `policy.publish`. It is separate from Plan confirmation. `AUTHORIZE_PUBLICATION` applies to an approved Harness Proposal and remains a separate decision from Proposal approval.

“继续”, “开始”, plan acceptance, Review presentation, and Proposal approval do not authorize a later gate. A valid answer must explicitly approve the immutable object just presented; an earlier answer cannot approve a newly created or changed digest.

## Recover An Interrupted Operation

Inspect and resume the persisted Session first. Do not rerun an operation from chat memory.

- When `inFlightOperation` exists, call `resolve_interrupted_operation`. Accept a matching durable receipt with `ACCEPT_OPERATION_RECEIPT:<sessionId>:<attemptDigest>:<receiptDigest>`, or authorize retry only when the MCP result proves the Workspace digest is unchanged with `CONFIRM_RETRY_UNCHANGED_OPERATION:<sessionId>:<attemptDigest>:<workspaceDigest>`.
- When the Session has no unknown in-flight operation, resume the remaining confirmed Plan only with `RETRY_INTERRUPTED_PLAN:<sessionId>:<planDigest>`.
- When the Workspace changed and no matching receipt exists, retry is forbidden. Preserve or cancel the Session and inspect retained Engine artifacts.

## Resume In Another Agent

Give the new Agent the same Workspace and Session id. It must read `evopilot-harness://sessions/<sessionId>` or call `inspect_operation_session`, then call `resume_operation_session` with the current `sessionDigest` and its Adapter id. It must not infer state from an earlier conversation.

See [Digital Expert](digital-expert.md), [MCP Reference](mcp-reference.md), [Session Protocol](session-protocol.md), and [Troubleshooting](../operations/troubleshooting.md).
