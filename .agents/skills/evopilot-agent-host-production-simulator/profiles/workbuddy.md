# WorkBuddy Profile

Use this profile for the visible macOS WorkBuddy application. Under `human-operated-workbuddy/v1` plus `designated-human-range-completion/v1`, only the designated human operates WorkBuddy. Codex provides the complete runbook set and waits for the final RC-range declaration; it never observes, supervises or controls the application.

## Visible path

Codex gives the human all frozen per-case runbooks before execution. Each runbook contains:

1. the exact Candidate and existing-install binding, external Workspace, Source id and snapshot, model route, classification scheme, goal, initial state and expected terminal state;
2. the visible steps to create a fresh task, open **专家·技能·连接器**, select **Harness全生命周期数字专家**, attach the exact Source once, verify its visible identity and send the exact goal once;
3. every expected lifecycle stage and finite human gate, including the rule that the human decides only after the complete current Engine-owned view is visible;
4. required restart, disconnect, resume, retry, cancellation, publication and close actions, each retaining its separate authority;
5. the instruction to continue independently through the complete declared runbook set and send only the final range-completion declaration after every required action is complete.

The human performs and verifies every visible action without Codex supervision. Localized labels may vary, but the exact installed Expert, Source, goal and Engine-owned semantics may not. The human resolves or stops on ambiguity, wrong attachment, stale state, missing Frame or uncertain mutation according to the runbook and does not send the final declaration until the complete range has been performed.

Codex and its Skills must not use Computer Use, Accessibility, coordinates, mouse, keyboard, clipboard, Apple events, attachment drivers, startup-readiness probes, SO06, or transport receipts for WorkBuddy. These mechanisms are neither prerequisites nor fallbacks. Candidate reinstall is also not a recovery action.

Codex also must not request, collect, retain or review WorkBuddy sessions, transcripts, screenshots, screen recordings, logs, receipts, canonical digests, per-case reports or intermediate acknowledgements. For v4.5.0 Target revision 15, `RC01～RC05 已完成` or the same range using `~` is the only accepted final declaration. Before receipt, all five WorkBuddy human-operation legs remain `PENDING`; after receipt, RC01–RC05 WorkBuddy legs become `PASSED`. The five non-WorkBuddy machine variants retain independent assertion-level evidence and are unaffected by the declaration. The declaration grants no release authority.
