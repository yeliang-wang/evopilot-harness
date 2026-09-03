# Acceptance Fast Path

Use the fast path only for an exact authorized Candidate acceptance plan on an
independent automated Host. It reduces navigation and rerun friction without
changing Target coverage, Engine decisions, WorkBuddy policy, publication or
release authority.

## Resumable state

Create one external `evopilot-acceptance-fast-path-state/v1` file with
`scripts/acceptance_fast_path.mjs init`. Bind the exact Candidate Acceptance
Binding, Candidate-neutral Target manifest, acceptance plan and ordered stage
plan. Keep the state outside the product repository, Skill tree, package,
Source and WorkBuddy Workspace.

After the bounded plan is authorized, a `MACHINE` stage continues without a
new navigation prompt. A `HUMAN_GATE`, failed or stale binding, uncertain
mutation, scope change or exhausted authority stops. Every stage result must
append a concrete evidence digest; a completed stage is reused on resume.

## Failure isolation

Classify a failure before retrying:

- `RUNNER_PROJECTION` reruns only the affected stage;
- `TOOLING_DRIFT` reruns only the affected tooling check;
- `HOST_TRANSPORT` reruns only the affected Host leg after separate retry
  authority;
- `SOURCE_BINDING` reruns only the affected frozen Source wave after separate
  authority;
- `PRODUCT_BEHAVIOR` requires a new Candidate, impact closure and the complete
  Target-required matrix;
- `SEMANTIC_MISMATCH` stops for the exact human decision;
- `STALE_BINDING` returns to cross-layer preflight;
- `UNCERTAIN_MUTATION` resolves the current Session without replay.

Historical attempts remain in the state event list and evidence tree. Never
turn a runner or transport correction into Candidate evidence, and never use a
targeted rerun to waive the complete final Target matrix.

## Controlled decision replay

Read [Acceptance Decision Replay](acceptance-decision-replay.md). Validate each
current Engine Frame with `scripts/acceptance_fast_path.mjs evaluate-replay`.
The replay manifest must be explicitly authorized and bind the current
Candidate and Target digests, baseline semantic oracle, finite decision,
repetition ids and expiry. The validator compares the entire semantic oracle
and returns no decision on mismatch.

A passing replay record binds the fresh current Frame and Session. It never
reuses a baseline handle, digest, receipt or authorization token. Store the
record as evidence and pass it to `record --replay-record` for that exact human
gate. Release, cleanup, credentials, installation and uncertain retries remain
non-replayable.
