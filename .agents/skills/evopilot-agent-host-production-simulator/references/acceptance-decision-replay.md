# Acceptance Decision Replay

Use this mode only to reduce repeated human prompts in a controlled acceptance set after one complete baseline lifecycle has been displayed, individually decided, and reviewed by the user. It is not available for ordinary production operation.

## Authorization manifest

Before opening the next counted Workspace, present one replay manifest and obtain explicit user authorization. Bind it to:

- the exact Harness candidate or public Release and package integrity;
- the host/profile, scenario id, Evidence Source digest, goal text, configuration class, and expected terminal state;
- the baseline run id and ordered Engine stage kinds;
- the normalized canonical business-view oracle for each replayable gate;
- the finite decision script, such as `APPROVE`, `CONTINUE_TO_PROPOSAL_DECISION`, `APPROVE`, `PUBLISH`, `CLOSE`;
- the exact repetition ids or maximum repetition count;
- expiry at the end of that acceptance set or on the first mismatch.

For an independent automated Host, validate the authorized manifest against the
fresh current gate with `scripts/acceptance_fast_path.mjs evaluate-replay`.
Record its passing output before submitting the current finite choice. A failed
validator result expires the replay path for that gate and returns no choice.

Do not include Engine decision handles, Session ids, Frame digests, Proposal digests, receipts, or authorization tokens as reusable credentials. Every replayed choice is a new decision submitted through the packaged Digital Expert against the current Session.

## Gate eligibility

At every new human gate, inspect the Engine-owned Frame before acting. Replay the recorded choice only when all of these match the baseline oracle:

1. stage kind and ordinal;
2. canonical template/schema version and locale;
3. normalized business semantics, risk level, affected asset identity, decision question, and finite choices;
4. expected prior stage outcome and Workspace/candidate/configuration bindings;
5. no new blocker, warning requiring a decision, scope increase, destructive effect, or Host-authored governed prose.

Typed volatile values declared non-semantic by the product contract may differ, including a new Session id, current Frame/digest bindings, timestamps, and idempotency receipts. The Digital Expert must bind the selected choice to those current values; the simulator must never copy a baseline token or fabricate an internal decision handle.

If any eligibility check fails, stop before mutation, preserve the new Frame as failure evidence, expire the manifest, and ask the user about that exact gate. Do not skip, repair, reinterpret, or choose the nearest option.

## Allowed and forbidden choices

Replay may cover Plan confirmation, Proposal Review continuation, Proposal approval/rejection, publication choice, and non-destructive Session close when all eligibility checks pass.

Never replay:

- Session cleanup or any destructive deletion;
- retry after an uncertain mutation, stale digest, timeout, disconnect, or changed Workspace;
- credential, model, permission, installation, upgrade, migration, rollback, or release authorization;
- a new or changed Frame, risk class, asset set, destination, decision option, or terminal state.

## Evidence

For each replayed gate, record the manifest digest, baseline stage binding, current Frame/session binding, eligibility result, selected finite choice, and resulting Engine state. Mark it `REPLAYED_CONDITIONAL_DECISION`, not a new interactive human response. The final report must distinguish baseline interactive decisions from conditional replay decisions and state that the manifest granted no cleanup, release, or unrelated mutation authority.
