# Agent Host Profile Contract

Each profile describes transport mechanics for one third-party Agent host without changing Harness semantics.

Declare:

- host id, supported version evidence, application/binary discovery, and visible identity;
- how an installed Digital Expert is previewed, installed, inspected, updated, and removed;
- how the exact packaged instructions and local stdio MCP configuration are loaded;
- how the host visibly selects the expert, starts a conversation, attaches a local file, and exposes tool results;
- least-privilege permissions and the point requiring human authorization;
- observable success evidence and fail-closed diagnostics;
- unrelated configuration that must remain byte-for-byte or semantically unchanged.

A profile must not define Engine operations, internal decision tokens, Review semantics, model credentials, or publication authority. Unsupported host versions and missing managers must stop with a manual-import route. A synthetic profile used for isolation testing may contain fixtures but must never claim real-host acceptance.
