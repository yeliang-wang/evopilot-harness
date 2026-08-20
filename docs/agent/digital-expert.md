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
| Digital Expert Core | Questions, plan/review rendering, stop points, recovery guidance | Matching, Review verdict, state, identity, approval, publication |
| Agent Adapter | Host import format and MCP binding | Host-specific business policy |
| External Agent | Conversation and tool invocation | Engine state or silent human decisions |
| Operation Server | MCP, capabilities, Session coordination, Engine adapter | General Agent loop, shell, business verdict |
| Engine | Evidence, reasoning, Review, validation, approval binding, publication, Catalog | Human conversation |

## Question-Driven Behavior

The Expert asks exactly one shortest missing question and does not repeat information already supplied. A complete request moves directly to an Execution Brief and Plan. It renders Engine output without inventing missing evidence or changing verdict language. Humans approve the immutable object currently displayed in natural language; the Expert constructs digest-bound Engine tokens internally and never asks a human to copy protocol credentials.

## Import

- Codex: load `digital-expert/adapters/codex/SKILL.md`; the repository also contains the generated project-level Skill at `.agents/skills/evopilot-harness-digital-expert/SKILL.md`.
- Claude Code: load the packaged `digital-expert/adapters/claude-code/CLAUDE.md` using the host's supported project-instruction mechanism.
- WorkBuddy: load `digital-expert/adapters/workbuddy/WORKBUDDY.md` using a supported local instruction or extension mechanism.
- Generic or custom Agent: load `digital-expert/adapters/generic/AGENT.md` and implement stdio MCP with structured tool results.
- MCP-only client: use `digital-expert/adapters/mcp/MCP.md`; it provides transport guidance but not a conversational UI.

Adapter packaging does not prove the host supports local instructions, subprocesses, or stdio MCP. Unsupported hosts must return a capability blocker. v4.0.2 validates the Codex protocol path, the included independent Generic Agent Host, cross-Adapter Plan/Engine-call/stop-point semantics, the real MCP process, and the WorkBuddy CLI currently installed on the acceptance Mac from an isolated local tarball. The acceptance report records its exact path and version. Claude Code remains package-only until its actual host passes conformance. WorkBuddy acceptance does not prove public npm availability or every later host version.

## Legacy Skill

`evopilot-harness-guided-operator` remains only as a compatibility alias. Its previous human-CLI workflow, guard scripts, and policy copies were removed so there is one ordinary-user authority.
