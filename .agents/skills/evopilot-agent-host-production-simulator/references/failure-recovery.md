# Failure and Recovery

On host crash, timeout, MCP disconnect, unknown mutation result, or stale digest:

1. Stop issuing mutations.
2. Preserve the visible error, timestamp, last confirmed state, Session id/digest, attempt digest, Workspace digest, and known receipt without exposing secrets.
3. Reopen the host only when doing so cannot repeat a mutation.
4. Use `inspect_operation_session` and durable journal/receipt evidence; never use chat memory as state.
5. If `inFlightOperation` exists, use `resolve_interrupted_operation`. Accept a matching durable receipt or ask for the exact retry decision only when the Engine confirms an unchanged Workspace digest.
6. If state changed without a receipt, preserve or cancel for inspection. Do not retry.

Missing host, unsupported version, missing manager, failed public-registry verification, duplicate expert, incompatible adapter, absent capability field, secret exposure, source-checkout resolution, or missing independent-Host evidence is `BLOCKED`, not a reason for automatic repair.

For an authorized independent-Host batch, classify the failure through the
[Acceptance Fast Path](acceptance-fast-path.md) before proposing a rerun. Only
`RUNNER_PROJECTION` and `TOOLING_DRIFT` may continue automatically after their
bounded correction. Host transport, Source binding, semantic mismatch, stale
binding and uncertain mutation stop at their declared authority boundary.
`PRODUCT_BEHAVIOR` always returns to a new Candidate and the complete required
impact and regression path.

WorkBuddy has no Codex desktop-control or evidence-export dependency. A Computer Use, Accessibility, SO06, startup-probe, transport-receipt, screenshot, transcript, receipt or digest issue is outside the WorkBuddy acceptance path. Codex does not recover, supervise or classify individual WorkBuddy cases. The designated human withholds the final declaration until the complete range has been performed; Candidate reinstall, Source mutation and Host substitution remain forbidden recovery actions.

For a counted repeated-run scenario, retry only outside the counted run. The first deterministic fixture failure or lifecycle mismatch is a circuit breaker: stop the run, preserve the failure evidence, classify the set as invalid, and return its count to zero. Never continue from a contaminated composer, restored task, old Session, partially attached source, uncertain send, or mutated Workspace merely to finish the requested repetition count.

For a frozen multi-Source wave, interruption never authorizes refetch, sample replacement, oracle revision, or failed-record deletion. Resume the same frozen Source, commit, snapshot, Host and Session when durable state proves that binding. Otherwise mark that Source and the wave `BLOCKED`; a later retry or new discovery wave is append-only.
