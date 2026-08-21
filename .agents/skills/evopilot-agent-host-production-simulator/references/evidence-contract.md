# Evidence Contract

Create a run directory chosen by the user or a temporary location. Do not write evidence into the source project or attachment directory.

The final report must contain:

- schema `evopilot-agent-host-production-simulation/v1`;
- run id and timestamps;
- host id/version and observable application identity;
- package name/version, public-registry verification, installed root, and `sourceCheckoutUsed`;
- expert id/version/Core digest and MCP/Engine compatibility fields;
- Evidence Source identifiers using basename and digest where useful, not secret contents;
- ordered state transitions and user-authorized mutations;
- Session, Plan, Proposal, Review, approval, publication, receipt, and Workspace digests when produced;
- screenshots/logs with redaction status;
- criteria classified `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN`, with evidence references;
- exact blocker and next action;
- explicit statement that simulation evidence grants no approval or publication authority.

Screenshots prove only visible UI state. Structured transcripts prove only recorded host/tool exchange. CLI conformance cannot substitute for a required real Desktop observation. Do not claim success from process exit alone.
