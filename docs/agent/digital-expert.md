# Digital Expert

The v4 Digital Expert is a portable, question-driven operating definition for external Agent hosts. It is not a built-in LLM, Agent runtime, Harness reasoner, or approval authority.

## Package

```text
digital-expert/
  expert-manifest.yaml
  manifest.lock.json
  core/
    instructions.md
    conversation.yaml
    workflows.yaml
    policies.yaml
    renderers.yaml
  adapters/
    codex/SKILL.md
    workbuddy/WORKBUDDY.md
    claude-code/CLAUDE.md
    mcp/MCP.md
    generic/AGENT.md
  schemas/
  conformance/
```

`expert-manifest.yaml` declares version and compatibility. `manifest.lock.json` binds every packaged artifact and the Agent-neutral Core by SHA-256. `npm run digital-expert:check` fails when an Adapter diverges. `npm run digital-expert:generate` is the only supported way to regenerate host entries after a reviewed Core change.

## Responsibility

| Component | Owns | Cannot own |
|---|---|---|
| Digital Expert Core | Questions, plan/review rendering, comparison/calibration presentation, stop points, recovery guidance | Matching, comparison verdict, Review verdict, state, identity, approval, policy activation, rollback, publication |
| Agent Adapter | Host import format and MCP binding | Host-specific business policy |
| External Agent | Conversation and tool invocation | Engine state or silent human decisions |
| Operation Server | MCP, capabilities, Session coordination, Engine adapter | General Agent loop, shell, business verdict |
| Engine | Evidence, reasoning, Review, validation, approval binding, publication, Catalog | Human conversation |

Protocol v3 fixes the boundary: the Engine authors professional Source-to-Harness analysis, architecture assessment, finite outcome, business-facing decision content, fixed-locale canonical presentation, and its complete audit envelope. WorkBuddy or another Host may transport attachments, render those exact objects, provide pixel layout, invoke MCP, and carry an explicit choice. It may not summarize, translate, supplement, omit, reorder, or reinterpret Source-to-Harness reasoning, invent decision options, or recover authority from chat memory. Host layout can differ; authoritative business bytes and digests cannot.

The presentation sandbox is enforced by schemas, a versioned Engine renderer, Evolution Context binding, Host capability negotiation, and a digest-bound presentation receipt. It is not a prompt-only convention. The Operation Server records that non-authoritative receipt in the same canonical-presentation response path before returning the view, so normal operation needs no follow-up user prompt or extra assistant turn. The explicit receipt tool is an idempotent compatibility/recovery fallback and can never grant authority. Real-Host conformance compares Engine-owned Harness Frames, not the complete third-party application page: Host chrome, loading, model-status, and transport-status surfaces are excluded, while any Host rewrite, obstruction, replacement, confirmation, or advancement of governed content fails closed.

## Question-Driven Behavior

The Expert asks exactly one shortest missing question and does not repeat information already supplied. A complete request moves directly to an Execution Brief and Plan. Its primary output is the exact Engine-owned Business Decision View: what the Source proves, how each item maps to a Harness capability, why the outcome is reuse/evolve/compose/create/reject/need-more-evidence, what changes, risks, alternatives, and the one decision now required. Complete technical fields remain available in the bound Audit Envelope. Humans decide on the immutable object currently displayed in natural language; the Expert constructs digest-bound Engine tokens internally and never asks a human to copy protocol credentials.

## Import

- Codex: load `digital-expert/adapters/codex/SKILL.md`; the repository also contains the generated project-level Skill at `.agents/skills/evopilot-harness-digital-expert/SKILL.md`.
- Claude Code: load the packaged `digital-expert/adapters/claude-code/CLAUDE.md` using the host's supported project-instruction mechanism.
- WorkBuddy: load `digital-expert/adapters/workbuddy/WORKBUDDY.md` using a supported local instruction or extension mechanism.
- Generic or custom Agent: load `digital-expert/adapters/generic/AGENT.md` and implement stdio MCP with structured tool results.
- MCP-only client: use `digital-expert/adapters/mcp/MCP.md`; it provides transport guidance but not a conversational UI.

Adapter packaging does not prove the host supports local instructions, subprocesses, stdio MCP, exact canonical rendering, fixed locale, complete-turn receipts, operation interception, recovery, or required timeout/OperationJob behavior. Unsupported hosts must return a capability blocker before lifecycle entry. v4.4 acceptance requires candidate-package conformance, an independent Host, and the real WorkBuddy Host; packaging or an Adapter file alone does not prove a Host version.

## Legacy Skill

`evopilot-harness-guided-operator` remains only as a compatibility alias. Its previous human-CLI workflow, guard scripts, and policy copies were removed so there is one ordinary-user authority.
