# Agent Host Profile Contract

Each profile describes the execution mode and transport boundary for one third-party Agent host without changing Harness semantics.

Declare:

- host id, supported version evidence, application/binary discovery, and visible identity;
- how an installed Digital Expert is previewed, installed, inspected, updated, and removed;
- how the exact packaged instructions and local stdio MCP configuration are loaded;
- whether visible Host actions are `DESIGNATED_HUMAN` or `REVIEWED_AUTOMATION`;
- for a human-operated Host, the complete runbook-set fields, final range-declaration contract, no-artifact rule, and Codex non-operation/non-observation boundary;
- for an automated Host, the reviewed adapter and observable postconditions;
- least-privilege permissions and the point requiring human authorization;
- completion basis and fail-closed diagnostics appropriate to the declared execution mode;
- unrelated configuration that must remain byte-for-byte or semantically unchanged.

A profile must not define Engine operations, internal decision tokens, Review semantics, model credentials, or publication authority. A human-operated profile must prohibit Codex UI control and automated transport qualification. Unsupported host versions and missing managers must stop with a manual route. A synthetic profile used for isolation testing may contain fixtures but must never claim real-host acceptance.
