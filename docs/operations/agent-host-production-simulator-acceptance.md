# Agent Host Production Simulator Acceptance

Target revision 1 was approved for implementation without Harness Release authority. The Roadmap intent is `ALIGNED` with `evopilot-harness-4.0-agent-native-operations`, Roadmap digest `sha256:6bd8877addc5b0999bd4d5c4146791546ec3709c540084499e235abfce253e73`, and boundary impact `NONE`.

## Result

All 15 Target criteria pass. This acceptance validates the Skill implementation and a least-privilege real-Host/public-Release startup path. It does not authorize a Harness product Release, Asset approval, publication, GHCR operation, or deployment.

| Criterion | Status | Evidence |
| --- | --- | --- |
| AC01 Skill structure and instruction validation | PASS | System `quick_validate.py` and `npm run agent-host-simulator:check`. |
| AC02 Host-neutral Core contains no WorkBuddy-private behavior | PASS | Shared entry and `profiles/profile-contract.md` separate host semantics; deterministic validator rejects WorkBuddy leakage in the common profile contract. |
| AC03 WorkBuddy behavior is isolated | PASS | `profiles/workbuddy.md` owns application discovery, visible expert selection, attachment, least privilege, and model-readiness behavior. |
| AC04 Real WorkBuddy is discoverable | PASS | Actual `/Applications/WorkBuddy.app` CLI version `2.106.4` completed the host run. |
| AC05 Public npm Release is used outside the checkout | PASS | `npm view @evopilot/harness@4.2.2` returned `4.2.2`; `--package-spec @evopilot/harness@4.2.2` reported `distributionMode=public-registry` and `sourceCheckoutUsed=false`. |
| AC06 Digital Expert install/update is governed | PASS | Profile requires inspect, preview, explicit apply authorization, ownership checks, backup, idempotency, and unrelated-configuration preservation. Existing installer lifecycle tests pass. |
| AC07 Correct visible expert is selected | PASS | Profile requires exactly one visible `Harness全生命周期数字专家` and fails closed on absence or duplication; v4.2.1 actual Desktop acceptance remains the supporting UI baseline. |
| AC08 Real attachment UI is modeled | PASS | WorkBuddy profile requires the host attachment control, exact authorized file, visible filename verification, and Evidence-only treatment before send. |
| AC09 MCP and capability binding | PASS | Real WorkBuddy connected packaged stdio MCP and called `inspect_capabilities` exactly once; Engine `4.2.2`, Core digest, protocol versions, and tool family were preserved. |
| AC10 Safe missing-model behavior | PASS | Profile stops on the Engine blocker, directs the human to configure the reviewed reference, and forbids reading, entering, or recording credentials and silent Advisor fallback. |
| AC11 Human gates remain separate | PASS | Entry explicitly excludes generic continuation from Plan confirmation and preserves Plan, Proposal, evidence review, publication, retry, and cleanup decisions. |
| AC12 Digest-bound interruption recovery | PASS | Recovery reference requires Session inspection, durable receipts, `resolve_interrupted_operation`, unchanged Workspace binding, and fail-closed uncertain mutation handling. Repository recovery tests pass. |
| AC13 Actionable failure diagnostics | PASS | Unsupported host, missing manager, duplicate expert, incompatible capability, secret exposure, checkout resolution, and unavailable observable UI return `BLOCKED`; automatic repair is forbidden. |
| AC14 Redacted structured evidence | PASS | Evidence schema records host/package/adapter/MCP/Session bindings, state transitions, four result classes, blockers, and authority disclaimer; redaction rules exclude secrets and unrelated personal state. |
| AC15 Real WorkBuddy plus public Release end to end | PASS | Public registry install → packaged WorkBuddy adapter → real WorkBuddy Host → local stdio MCP → exact `inspect_capabilities` result completed with no Workspace mutation. Evidence is stored outside the repository. |

## Commands

```bash
npm run agent-host-simulator:check
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/evopilot-agent-host-production-simulator
npm run package:workbuddy -- --package-spec @evopilot/harness@4.2.2 --evidence-dir <external-evidence-directory>
npm run roadmap:check
npm run digital-expert:check
npm run verify:architecture
npm run check
git diff --check
```

The installed Codex copy at `~/.codex/skills/evopilot-agent-host-production-simulator` is byte-equivalent to the repository source at acceptance time. The repository copy is the recoverable source of truth and remains excluded from the npm runtime package.
