# Agent-Native Quickstart

This is the ordinary v4 human journey. A human talks to a compatible external Agent. The Agent loads the Digital Expert and uses local stdio MCP; the human does not enter Harness lifecycle CLI commands.

## Prerequisites

- Node.js 22.14 or newer.
- An exact installed `@evopilot/harness` Release, a verified local release tarball, or a development checkout.
- A compatible Agent host that can load local instructions and call a local stdio MCP server.
- An external writable Workspace, normally `$HOME/.evopilot-harness`.
- A manually maintained read-only model configuration when Advisor or Proposal Review requires GLM.

## Install And Verify

For a publicly available version:

```bash
npm view @evopilot/harness@4.2.1 version
mkdir -p "$HOME/.evopilot-harness-runtime"
cd "$HOME/.evopilot-harness-runtime"
npm init -y
npm install --save-exact @evopilot/harness@4.2.1
./node_modules/.bin/evopilot-harness --version --json
```

The Registry command must return `4.2.1`; otherwise use a locally verified tarball. A development checkout uses `npm ci`, `npm run digital-expert:check`, and `node src/index.mjs --version --json`, but it is not installed-package evidence. Do not put the Workspace inside the installed package or checkout. See [npm Distribution](../operations/npm-distribution.md).

## Load The Expert

Choose one Adapter under `digital-expert/adapters/`:

| Adapter | Entry | Validation state |
|---|---|---|
| Codex | `codex/SKILL.md` | v4 acceptance path; project copy is generated at `.agents/skills/evopilot-harness-digital-expert/SKILL.md`. |
| Generic Agent | `generic/AGENT.md` | Independent executable conformance host included. |
| MCP client | `mcp/MCP.md` | Real stdio protocol conformance included. |
| Claude Code | `claude-code/CLAUDE.md` | Packaged; claim full support only after the actual host proves required capabilities. |
| WorkBuddy | `workbuddy/WORKBUDDY.md` | Installed-package acceptance uses the WorkBuddy CLI currently installed on the acceptance Mac and records its exact path/version (`2.106.4` for the latest local run); public npm remains a separate Registry check. |

All Adapters contain the same Core digest from `digital-expert/manifest.lock.json`. Host-specific instructions cannot change workflow or stop rules.

## Configure MCP

First obtain the package-bound Adapter and MCP command:

```bash
./node_modules/.bin/evopilot-harness agent bootstrap \
  --host workbuddy \
  --workspace /absolute/external/workspace \
  --json
```

Configure the Agent host to launch the exact command returned under `mcp.exactNpxCommand`. An installed local binary may equivalently launch:

```text
./node_modules/.bin/evopilot-harness mcp serve --transport stdio --workspace /absolute/external/workspace
```

Source development may replace the installed binary with `node /absolute/path/to/evopilot-harness/src/index.mjs`. The process writes only JSON-RPC messages to stdout, uses stderr for process diagnostics, and opens no network listener. v4 rejects non-stdio transports.

## Start A Conversation

Example:

```text
使用 /Users/me/project/cache-server 作为只读 source project，
引导我生成或升级 Harness。先展示计划，自动运行并展示 Proposal Review，
分别询问我是否批准、是否发布。
```

The Expert calls `inspect_capabilities`, prepares the Workspace, starts a persistent Session, and asks only the shortest missing question. Before execution it presents the Plan, source boundaries, Advisor mode, operations, stop points, and exact `planDigest`.

To review externally produced Baseline/Candidate evidence instead of producing a Proposal:

```text
使用 /absolute/path/to/comparison.yaml 作为已经批准、脱敏的比较证据包。
先展示 Operation Plan，再处理比较；完整展示 Comparison Report，
并停在报告审阅确认，不要批准、发布、回滚或执行任何 Harness。
```

For calibration, provide the reviewed case set plus explicit Baseline and Candidate policy files. The Expert presents ranking, abstention, false-upgrade, false-new-profile, regressions, conflicts, uncertainty, and recommendation. See [Controlled Comparative Evidence](../guides/controlled-comparative-evidence.md).

For the v4.2 candidate professional-learning flow, provide only reviewed local Research, Contribution, Curriculum, or Domain/Role documents. The Engine does not fetch a URL or execute adapter code. The Expert creates a `learning` Plan, presents immutable Curriculum and Completeness bindings, and stops for review of the exact report digest. See [Professional Asset Learning](../guides/professional-asset-learning.md).

## Mandatory Decisions

The human answers one plain-language question about the Plan, Proposal, publication, or recovery action currently on screen. The Expert then builds and submits the Engine's exact digest-bound token internally. A human never copies or types these protocol values:

```text
CONFIRM_OPERATION_PLAN:<planDigest>
ACKNOWLEDGE_COMPARISON_REVIEW:<reportId>:<reportDigest>
ACKNOWLEDGE_CALIBRATION_REVIEW:<reportId>:<reportDigest>
ACKNOWLEDGE_COMPLETENESS_REVIEW:<reportId>:<reportDigest>
AUTHORIZE_PLAN_PUBLICATION:<sessionId>:<planDigest>:<operationIndex>:<operationDigest>
APPROVE_PROPOSAL:<proposalId>:<proposalDigest>:<reviewDigest>
AUTHORIZE_PUBLICATION:<proposalId>:<approvedProposalDigest>
```

The two `ACKNOWLEDGE_*_REVIEW` values record only that the exact deterministic report was reviewed; they cannot approve, publish, activate policy, roll back, or execute. `AUTHORIZE_PLAN_PUBLICATION` applies to maintenance Plans containing `catalog.publish`, `ontology.publish`, or `policy.publish`. It is separate from Plan confirmation. `AUTHORIZE_PUBLICATION` applies to an approved Harness Proposal and remains a separate decision from Proposal approval.

“继续”, “开始”, plan acceptance, Review presentation, and Proposal approval do not authorize a later gate. A valid answer must explicitly approve the immutable object just presented; an earlier answer cannot approve a newly created or changed digest.

## Recover An Interrupted Operation

Inspect and resume the persisted Session first. Do not rerun an operation from chat memory.

- When `inFlightOperation` exists, call `resolve_interrupted_operation`. Accept a matching durable receipt with `ACCEPT_OPERATION_RECEIPT:<sessionId>:<attemptDigest>:<receiptDigest>`, or authorize retry only when the MCP result proves the Workspace digest is unchanged with `CONFIRM_RETRY_UNCHANGED_OPERATION:<sessionId>:<attemptDigest>:<workspaceDigest>`.
- When the Session has no unknown in-flight operation, resume the remaining confirmed Plan only with `RETRY_INTERRUPTED_PLAN:<sessionId>:<planDigest>`.
- When the Workspace changed and no matching receipt exists, retry is forbidden. Preserve or cancel the Session and inspect retained Engine artifacts.

## Resume In Another Agent

Give the new Agent the same Workspace and Session id. It must read `evopilot-harness://sessions/<sessionId>` or call `inspect_operation_session`, then call `resume_operation_session` with the current `sessionDigest` and its Adapter id. It must not infer state from an earlier conversation.

See [Digital Expert](digital-expert.md), [MCP Reference](mcp-reference.md), [Session Protocol](session-protocol.md), and [Troubleshooting](../operations/troubleshooting.md).
