# Evidence Contract

This contract applies differently by Host execution mode. Never write artifacts into the Source project or attachment directory.

## WorkBuddy designated-human completion

For `human-operated-workbuddy/v1` plus `designated-human-range-completion/v1`, do not create a WorkBuddy execution-evidence directory and do not request, collect, retain or review sessions, transcripts, screenshots, screen recordings, logs, receipts, canonical digests, per-case reports or intermediate acknowledgements.

The complete frozen runbook-set manifest is preparation evidence, not WorkBuddy execution evidence. For v4.5.0 Target revision 15, every WorkBuddy human-operation leg remains `PENDING` until the designated human sends `RC01～RC05 已完成` or the same range using `~`. Receipt changes RC01–RC05 WorkBuddy legs to `PASSED`; all five non-WorkBuddy machine variants and their independent assertion-level evidence are unaffected. The declaration does not satisfy any independent-Host, Engine, package, Source, security, architecture, deterministic or no-regression criterion and grants no publication or release authority.

## Independent Host evidence

For `REVIEWED_AUTOMATION`, create the Target-declared evidence directory and final report. It must contain:

The final report must contain:

- schema `evopilot-agent-host-production-simulation/v1`;
- run id and timestamps;
- host id/version and observable application identity;
- Host execution mode, exact adapter and proof that its declared automation and evidence boundaries were followed;
- package name/version, public-registry verification, installed root, and `sourceCheckoutUsed`;
- expert id/version/Core digest and MCP/Engine compatibility fields;
- Evidence Source identifiers using basename and digest where useful, not secret contents;
- Source Portfolio, discovery plan, selection manifest and candidate-blind oracle digests when a Target binds them;
- for a multi-Source wave, the complete frozen inventory, per-Source Host journey, expected-versus-observed result, failure visibility, no-replacement evidence and closed terminal state;
- ordered state transitions and user-authorized mutations;
- when acceptance decision replay is used: the redacted replay-manifest digest and scope, baseline interactive decision bindings, per-gate eligibility results, fresh current-Session bindings, replayed finite choices, and the reason for any expiration;
- Session, Plan, Proposal, Review, approval, publication, receipt, and Workspace digests when produced;
- screenshots/logs with redaction status and available Engine-owned structured receipts and canonical digests;
- criteria classified `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN`, with evidence references;
- requested and observed start/terminal states, stages, repetitions, restarts,
  Hosts, model routes, and evidence kinds when a local scenario checklist is in
  use;
- canonical or structured digest bindings when the product exposes them,
  together with any observed semantic drift or Host-authored governed prose;
- exact blocker and next action;
- when the Acceptance Fast Path is used: the external state digest, completed
  stage ids, append-only attempt events, failure class and permitted rerun scope;
- explicit statement that simulation evidence grants no approval or publication authority.

Screenshots prove only visible UI state and cannot alone establish semantic or
digest equality. Structured transcripts prove only recorded host/tool exchange.
Independent-Host evidence cannot replace the final WorkBuddy range declaration,
and the WorkBuddy declaration cannot replace independent-Host evidence. Do not
claim overall acceptance from process exit or either Host leg alone.
