# Failure and Recovery

On host crash, timeout, MCP disconnect, unknown mutation result, or stale digest:

1. Stop issuing mutations.
2. Preserve the visible error, timestamp, last confirmed state, Session id/digest, attempt digest, Workspace digest, and known receipt without exposing secrets.
3. Reopen the host only when doing so cannot repeat a mutation.
4. Use `inspect_operation_session` and durable journal/receipt evidence; never use chat memory as state.
5. If `inFlightOperation` exists, use `resolve_interrupted_operation`. Accept a matching durable receipt or ask for the exact retry decision only when the Engine confirms an unchanged Workspace digest.
6. If state changed without a receipt, preserve or cancel for inspection. Do not retry.

Missing host, unsupported version, missing manager, failed public-registry verification, duplicate expert, incompatible adapter, absent capability field, secret exposure, source-checkout resolution, or unavailable observable Desktop control is `BLOCKED`, not a reason for automatic repair.
