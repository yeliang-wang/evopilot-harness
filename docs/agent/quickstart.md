# Agent-Native Quickstart

This is the ordinary v4 human journey. A human talks to a compatible external Agent. The Agent loads the Digital Expert and uses local stdio MCP; the human does not enter Harness lifecycle CLI commands.

This guide installs Harness 4.8.1, checks the Host connection, and reaches a first classification result without publishing an asset. For all three products together, use the [series installation guide](https://github.com/yeliang-wang/evopilot/blob/main/docs/guides/agent-host-installation.md) and [Runtime first task](https://github.com/yeliang-wang/evopilot/blob/main/docs/guides/first-task.md).

## Prerequisites

- Node.js 22.14 or newer.
- An exact installed `@evopilot/harness` Release, a verified local release tarball, or a development checkout.
- A compatible Agent host that can load local instructions and call a local stdio MCP server.
- An external writable Workspace, normally `$HOME/.evopilot-harness`.
- A manually maintained external model configuration when Advisor or Proposal Review requires an LLM. The Release supplies no default provider, model, endpoint, or credential.

## Install And Verify

For a publicly available version:

```bash
npm view @evopilot/harness@4.8.1 version
mkdir -p "$HOME/.evopilot-harness-runtime"
cd "$HOME/.evopilot-harness-runtime"
npm init -y
npm install --save-exact @evopilot/harness@4.8.1
./node_modules/.bin/evopilot-harness --version --json
```

The Registry command must return `4.8.1`; otherwise use a locally verified tarball. A development checkout uses `npm ci`, `npm run digital-expert:check`, and `node src/index.mjs --version --json`, but it is not installed-package evidence. Do not put the Workspace inside the installed package or checkout. See [npm Distribution](../operations/npm-distribution.md).

## Load The Expert

Choose one Adapter under `digital-expert/adapters/`:

| Adapter | Activation path | Evidence and limits |
|---|---|---|
| Codex | Bootstrap `--host codex`; load `codex/SKILL.md` and configure the returned stdio command. | Current 4.8.1 real Host acceptance is Codex-only and bounded to its recorded environment. No `agent install --host codex` installer exists. |
| WorkBuddy | Bootstrap `--host workbuddy`; manual import of `workbuddy/WORKBUDDY.md`, or the separate `agent install --host workbuddy` flow. | Installer exists; prior WorkBuddy runs are historical evidence, not fresh 4.8.1 live acceptance. |
| Claude Code | Bootstrap `--host claude-code`; load `claude-code/CLAUDE.md` through project instructions and configure stdio. | Adapter packaged; the actual Host must prove the required interaction capabilities. |
| Generic Agent | Bootstrap `--host generic`; load `generic/AGENT.md` and configure stdio. | Independent executable conformance fixtures do not qualify every custom Host. |
| MCP client | Bootstrap `--host mcp`; load `mcp/MCP.md` as transport guidance. | Protocol support only; no conversational UI or human-gate rendering is supplied. |

All Adapters contain the same Core digest from `digital-expert/manifest.lock.json`. Host-specific instructions cannot change workflow or stop rules.

The WorkBuddy installer detects the **desktop app version** from its macOS bundle and checks known versions against the `5.x` range. Historical acceptance also records a **CLI version**, such as `2.106.4`. They identify different components. A matching desktop range or a packaged Adapter alone does not establish full Host conformance; see [current acceptance limits](../releases/current-release.md).

## Configure MCP

First obtain the package-bound Adapter and MCP command:

```bash
./node_modules/.bin/evopilot-harness agent bootstrap \
  --host codex \
  --workspace /absolute/external/workspace \
  --json
```

Use the returned absolute `adapter.path` for the Host's supported local-instruction mechanism. For Codex, place the packaged `codex/SKILL.md` in a named skill directory such as `.agents/skills/evopilot-harness-digital-expert/SKILL.md` in the project, preserving its contents. Restart or reload the Host so the Adapter and MCP entry are both active. Bootstrap does not perform this activation.

Configure the Agent host to launch the exact command and argument array returned under `mcp.exactNpxCommand`. To use the installation above without relying on the Host's working directory or `PATH`, resolve the binary to an absolute path, for example:

```text
/Users/me/.evopilot-harness-runtime/node_modules/.bin/evopilot-harness mcp serve --transport stdio --workspace /absolute/external/workspace
```

Source development may replace the installed binary with `node /absolute/path/to/evopilot-harness/src/index.mjs`. The process writes only JSON-RPC messages to stdout, uses stderr for process diagnostics, and opens no network listener. v4 rejects non-stdio transports.

For WorkBuddy's managed installer, run the local binary from the installation directory:

```bash
./node_modules/.bin/evopilot-harness agent install \
  --host workbuddy --workspace "$HOME/.evopilot-harness" --json
```

Review the returned paths and repeat with `--confirm` followed by the exact `planDigest` only when those changes are approved. `agent install` is currently WorkBuddy-only; bootstrap is available for all Adapters listed above. See [WorkBuddy installation](../operations/npm-distribution.md#workbuddy).

## Verify The Connection Before A Business Task

After MCP initialization, the Adapter calls read-only `inspect_capabilities`. In the Host's tool result, check schema `evopilot-harness-operation-server-capabilities/v1`, Engine/Expert/Core/protocol bindings against the packaged manifest, `mcp.transport=stdio`, and the expected external Workspace. A successful capability result establishes connection and contract compatibility only; it does not initialize a Workspace, verify the model or certify Host rendering. A fresh Workspace can still require preparation. See [layered troubleshooting](../operations/troubleshooting.md#start-with-the-failing-layer) if no tool result appears.

## Prepare Or Reuse The Workspace And Model

For a new Workspace, `prepare_workspace` initializes generic Components and policies plus a provider-neutral empty `models.example.json`, and points `config.yaml` at external `models.json`. It installs no professional Profiles, Bundles or business vocabulary. It never creates or overwrites `models.json`, imports a credential, or borrows the Host's conversation model.

Reuse an existing `CONFIGURED_AND_VERIFIED` model binding. For a new or changed configuration, the operator supplies the profile locally, using an explicitly named environment variable or a `0600` file. `initialize_model_configuration` performs inspection and a minimal live model call, storing only a secret-free receipt. Failed reinitialization returns `CONFIGURED_UNVERIFIED`; it does not retry, select a fallback, or edit the file. Repair the reported fault before explicitly initializing again.

An administrator can inspect readiness from the same installation directory without making a model call:

```bash
./node_modules/.bin/evopilot-harness llm v3-readiness \
  --workspace "$HOME/.evopilot-harness" --json
```

Only when initialization is needed, `llm v3-initialize` with that Workspace performs the equivalent live check. Neither command requires putting credentials in a conversation or command arguments.

## First Task: Classify One Existing Source

Example:

```text
使用 /Users/me/project/cache-server 作为只读 source project，
使用 /Users/me/taxonomies/software.yaml 作为我的业务分类方案，
复用当前已验证的模型配置，完成分类分析并展示结果，
停在是否继续 Harness 演进的选择处。
```

Replace both paths with an existing readable Source and your own valid classification scheme. See [business classification](../guides/business-classification.md) for the scheme format. This task creates a persisted analysis Session and uses the configured model; it does not modify the Source or publish an asset.

The Expert starts the generic Operation Session with `ANALYZE_TAXONOMY`. The first useful result is an Engine-owned classification view showing 业务领域、产品或系统类型、分类覆盖情况, cited evidence, alternatives, and a finite next action. `TAXONOMY_MATCHED`, `TAXONOMY_EXTENSION_SUGGESTED`, `TAXONOMY_EVIDENCE_INSUFFICIENT`, and `TAXONOMY_AMBIGUOUS` are distinct completed analysis outcomes. A model failure instead returns `ANALYSIS_BLOCKED_ADVISOR`; retain its evidence and repair the reported cause.

Missing categories require a user-owned scheme revision and explicit re-analysis. Only a complete match plus an explicit “continue to Harness evolution” choice attaches the handoff to that same Session. Harness Eligibility then runs independently, followed by the Plan, Proposal Review, approval, separate publication authorization, Catalog validation, and close gates. Missing applicable professional knowledge can correctly stop production at `NEED_MORE_EVIDENCE`; neither installing the Engine nor completing classification proves a publishable Harness.

## Continue Into Other Workflows

To review externally produced Baseline/Candidate evidence instead of producing a Proposal:

```text
使用 /absolute/path/to/comparison.yaml 作为已经批准、脱敏的比较证据包。
先展示 Operation Plan，再处理比较；完整展示 Comparison Report，
并停在报告审阅确认，不要批准、发布、回滚或执行任何 Harness。
```

For calibration, provide the reviewed case set plus explicit Baseline and Candidate policy files. The Expert presents ranking, abstention, false-upgrade, false-new-profile, regressions, conflicts, uncertainty, and recommendation. See [Controlled Comparative Evidence](../guides/controlled-comparative-evidence.md).

For the retained professional-learning flow, provide only reviewed local Research, Contribution, Curriculum, or Domain/Role documents. The Engine does not fetch a URL or execute adapter code. The Expert creates a `learning` Plan, presents immutable Curriculum and Completeness bindings, and stops for review of the exact report digest. See [Professional Asset Learning](../guides/professional-asset-learning.md).

## Decisions And Interrupted Work

The Expert presents the current Engine-owned Plan, Review, Proposal, publication or recovery decision in plain language. Confirm only the object currently displayed. Plan confirmation, Proposal approval and asset publication are separate decisions; a previous answer does not authorize changed content or a later stage. Report acknowledgement records review, not publication or policy activation. The Expert transports the exact bound decision internally; users do not copy protocol digests or tokens.

If a request disconnects or times out, keep its Workspace and Session id. Ask the Expert to inspect that Session before continuing. An unknown in-flight operation must be resolved against its retained receipt; the Expert may not rerun it from conversation memory. If the Workspace changed and no matching receipt exists, retry remains blocked. The [Session protocol](session-protocol.md) and [MCP reference](mcp-reference.md) define the exact recovery operations and decision bindings.

## Resume In Another Agent

Give the new Agent the same Workspace and Session id. It must read `evopilot-harness://sessions/<sessionId>` or call `inspect_operation_session`, then call `resume_operation_session` with the current `sessionDigest` and its Adapter id. It must not infer state from an earlier conversation.

See [Digital Expert](digital-expert.md), [MCP Reference](mcp-reference.md), [Session Protocol](session-protocol.md), and [Troubleshooting](../operations/troubleshooting.md).
