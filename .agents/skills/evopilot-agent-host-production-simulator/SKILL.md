---
name: evopilot-agent-host-production-simulator
description: Simulate an ordinary human operating a released evopilot-harness Digital Expert inside a real third-party Agent host, beginning with WorkBuddy, and produce redacted acceptance evidence. Do not use for Harness product evolution or direct Engine operation.
---

# EvoPilot Agent Host Production Simulator

Validate the real human-facing path from a public Harness Release through an installed third-party Agent host. The host carries conversation and UI interaction; the packaged Digital Expert and deterministic Engine retain operation authority.

## Route

1. Read [references/simulation-contract.md](references/simulation-contract.md) for every run.
2. Select exactly one host profile. For WorkBuddy, read [profiles/workbuddy.md](profiles/workbuddy.md). For a new host, first satisfy [profiles/profile-contract.md](profiles/profile-contract.md); never add host-private behavior to this file.
3. Read [references/evidence-contract.md](references/evidence-contract.md) before capturing artifacts.
4. Read [references/failure-recovery.md](references/failure-recovery.md) when a host, MCP call, or Session is interrupted or blocked.
5. Read [references/security-and-redaction.md](references/security-and-redaction.md) before handling screenshots, logs, configuration, or model readiness.

## Authority

- Test only an installed public `@evopilot/harness` Release unless the user explicitly requests pre-release package testing. Record the exact version and prove that the simulated operation does not resolve into a source checkout.
- Use the installed Release's generated Digital Expert and exact bootstrap result. Do not copy, reinterpret, or replace its Core instructions.
- Treat host interaction as transport. Never rewrite Engine results, infer evidence, approve a Plan or Proposal, authorize publication, or construct a human decision that the human did not explicitly make after seeing the exact immutable object.
- Generic words such as “continue”, “start”, “proceed”, “继续”, or “开始” are navigation only. They are never Plan confirmation, Proposal approval, evidence acknowledgement, retry authorization, cleanup authorization, or publication authorization.
- Never read, transcribe, paste, store, screenshot, or return API keys, tokens, cookies, credentials, private keys, or authorization headers. Ask the human to configure secrets directly in the host or reviewed model configuration surface.
- Never execute source-project commands or mutate the Release, Evidence Sources, model configuration, or unrelated host configuration.
- Stop before every real human gate and ask one decision about the exact displayed digest-bound object. Resume only after the user answers that question.
- Do not perform GHCR publication, deployment, GitHub Release, npm publication, or other release actions under this Skill.

## Run shape

Maintain a visible simulation brief containing the host/version, public package/version, expert identity, read-only Evidence Sources, external Workspace, intended scenario, permitted UI actions, expected gates, evidence destination, and current status.

Perform the smallest observable sequence that proves the requested production path:

1. Inspect the host and public package without mutation.
2. Preview any installation or update and show its exact scope. Obtain explicit authorization immediately before applying it.
3. Open the real host, select the installed Harness Digital Expert, and attach the user's chosen Evidence Source through the host UI when the request requires attachment behavior.
4. Send an ordinary-language Harness goal. Verify that the host uses the packaged adapter and local stdio MCP.
5. Require `inspect_capabilities` before Workspace mutation and bind product version, Expert version, Core digest, Agent protocol, Engine API, and supported MCP protocol.
6. Follow the Digital Expert until the next human gate or terminal result. Never optimize away visible questions or stop points.
7. On interruption, inspect durable Session state and receipts before any retry.
8. Produce a redacted evidence bundle and classify each requested criterion as `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN`. Never report 100% pass when a real UI or human-gate observation was not performed.

The simulator may operate a desktop UI only when an available control surface can inspect each resulting state. If reliable desktop control is unavailable, stop with `BLOCKED`; do not substitute a CLI run for a UI criterion. A separately identified CLI conformance check may still be reported as supporting evidence.
