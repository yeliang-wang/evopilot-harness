# Reviewed response guidance and problem disposition

The v0.6 response service links published Harness guidance, retained online
findings and reviewed problem assessments to Runtime's isolated execution and
validation. It does not execute a runbook, deploy a production change, choose a
software version or publish a release. An alert becoming resolved is evidence of
signal recovery; it does not establish that the cause was fixed.

The native [Harness standard](native-harness.md) and its `specifications/v1`
bytes remain unchanged. Runbooks are optional manifested JSON files inside an
already published native Harness package. The parent generates the additive
`vendor/compatibility/response/v1` contract used by all owners. Online evidence
continues to follow the [online Harness contract](online-harness.md), including
the existing bounded OpenSLO profile and actual native evaluation receipts.
Response history uses additive owner-local records with schema reader floor 5.

## Published runbook contract

`evopilot-response-runbook/v1` declares an ID and version, exact service,
environment and source revision, fixed JSON parameters, pinned prerequisites,
one described `isolated-collection` step, bounded evidence age and expiration.
All timestamps use Unix seconds. The stop conditions include `SOURCE_DRIFT`,
`PREREQUISITE_FAILED`, `GUIDANCE_WITHDRAWN`, `EXPIRED`, `TIMEOUT` and `UNKNOWN`.
At least one prerequisite must reference an owning product's evidence.

A runbook contains guidance rather than executable command text. Runtime binds
the separately reviewed collection recipe and exact asset/source references.
Admission resolves the actual published package through a trusted provider,
validates the package and file manifest, parses the manifested file and compares
its digest with the requested pin. Requests cannot substitute arbitrary JSON for
published guidance. Public packages can be reused from the project's public
scope or `shared`; private packages remain within the exact private project.

Withdrawal requires an actor declaration, rationale and pinned human evidence
for the exact withdrawal review. It preserves the package and prior admission
receipt and prevents the withdrawn guidance from being treated as active.

## Problem assessment and closure

An assessment declares impact and distinguishes **observed**, **suspected** and
**confirmed** explanations. Every cause cites evidence included in the assessed
evidence set. The owner resolves the actual incident and findings from its own
state and reads other owners' evidence through trusted callbacks. Inputs cannot
submit a replacement finding or convert an `UNKNOWN` result to `PASS`.

`response.problem.prepare` returns a review digest that binds the full
assessment, a complete incident-history checkpoint, selected owned finding digests
and resolved evidence. `response.problem.put`
requires pinned human approval of that digest. Each accepted assessment and
disposition becomes a new immutable digest-addressed version. Reassessment must
name the current `previousDigest`; historical versions remain readable.

Preventive work is an explicit bounded `followups` array (up to 32 entries),
separate from cause assertions. Each entry contains `{id,description,actor,status,
evidence}`, with status `PROPOSED`, `TRACKED` or `DONE`. IDs must be unique within
the assessment. Evidence references must appear in its full evidence set and
resolve through the actual owning service. `DONE` requires nonempty product
evidence with every referenced result `PASS`; missing, FAIL, UNKNOWN and private
campaign prose cannot certify completion. Changing status requires a new exact
assessment review and preserves the previous version. A followup never executes
an action, authenticates its declared actor or grants release permission.

The four disposition kinds are:

| Kind | Required review content | Effect |
| --- | --- | --- |
| `OPEN` | Actor and rationale | Retains an open problem without claiming resolution. |
| `DEFERRED` | Actor, rationale and future expiry | Records a bounded deferral; original quality evidence remains unchanged. |
| `RISK_ACCEPTED` | Actor, rationale and future expiry | Records the declared risk decision without granting validation or release authority. |
| `VERIFIED_CLOSED` | Actor, rationale, exact owned recovery and Runtime verification | Records a reviewed closure after recovery and execution evidence match the problem. |

Expiry is a timestamp in the historical decision, not a timer that rewrites the
record. `response.problem.status` derives the effective status, newly unassessed
findings and review reasons from current evidence. Consumers use this projection
before presenting a current closure, deferral or risk acceptance; an expired
decision requires a new review. Every disposition approval uses the
existing native human-evidence decision `APPROVE`; its review digest separately
pins the requested disposition kind, actor, rationale, expiry and evidence.

Verified closure requires an actual retained `online.regression.verify` result,
its original FAIL observation and later PASS observation, matching binding and
native report identities, and Runtime's verified response projection for this
exact problem digest. Exit code zero, a resolved alert or a caller-authored
summary cannot substitute. A recovery finding that arrives after the initial
assessment can be included in the closure review only when it references that
exact verified recovery. An additional unassessed fault forces reassessment; subsequent healthy windows
remain observations and do not reopen a reviewed closure. Late events do not overwrite prior assessments or original
FAIL/UNKNOWN evidence.

## Public service operations

Construct and explicitly initialize `createHarnessService`, then call
`service.response({operation, scope, input, ...mutationIdentity})`. Mutations
require a unique `requestId` and the revision from `response.inspect`. The
revision is shared with feedback and online owner records. Repeating the exact
retained request returns its receipt; changing its intent is rejected.

| Operation | Input |
| --- | --- |
| `response.inspect`, `response.list` | `{}` |
| `response.receipt.inspect` | `{requestId}` |
| `response.runbook.admit`, `response.runbook.inspect` | `{pin}` where pin is `{reference,path,digest}` |
| `response.runbook.withdraw.review` | `{pin,actor,rationale}` |
| `response.runbook.withdraw` | Previous input plus `{reviewDigest,humanEvidenceRef}` |
| `response.problem.context` | `{incidentId}` |
| `response.problem.prepare` | `{assessment}` |
| `response.problem.put` | `{assessment,reviewDigest,humanEvidenceRef}` |
| `response.problem.inspect`, `response.problem.status` | `{id}` |
| `response.problem.version` | `{id,digest}` |
| `response.problem.review` | `{id,expectedDigest,kind,actor,rationale,expiresAt,recovery,execution}` |
| `response.problem.decide` | Previous input plus `{reviewDigest,humanEvidenceRef}` |
| `response.evidence.inspect` | `{reference}` |
| `response.recovery.link` | `{regressionId,incidentId,firingId,resolvedId}` |
| `response.recovery.inspect` | `{id}` for a retained online regression or recovery-link digest |

`assessment` has `{id,previousDigest,incidentId,findingIds,impact,causes,followups,evidence}`.
For a new problem `previousDigest` is `null`. `findingIds` contains at most 128
selected real members of the incident and must include the last appended FIRING
finding. It is not the complete incident history. `response.problem.context`
returns `{incidentId,incidentState,findingIds,historySnapshot,authority}` with a
recommended selection of the last appended FIRING and latest finding, deduplicated.
The snapshot is `{count,digest,firingCount,firingDigest}` and covers every retained
finding through that checkpoint, including failures omitted from the bounded
selection. Its digest binds the ordered original finding digests. All original
history remains intact regardless of its length.

Preparation fixes the checkpoint at the last selected member. Subsequent healthy
windows do not move that checkpoint or invalidate the same approval. A newly
appended FIRING, including one with an old event timestamp, requires selection
and a fresh review. Closure similarly fixes the checkpoint through its exact
recovery finding. No raw historical observation is rewritten or deleted. For non-closing dispositions,
`recovery` and `execution` are `null`; for `OPEN` or `VERIFIED_CLOSED`,
`expiresAt` is `null`.

`response.problem.inspect` returns the immutable current assessment used for
Runtime binding. `response.problem.status` separately returns `{problem,
incidentState,historySnapshot,reviewedHistorySnapshot,unreviewedObservationCount,
unassessedFindingIds,decisionEffective,requiresReview,reasonCodes,observedAt,authority}`. New FIRING events and expiry can invalidate the effective
decision without changing the assessment, retained review or original evidence.
Recovery predating any assessed fault cannot close that problem.

Harness evidence references use owner `harness`, ID `finding:<finding.id>` or
`observation:<observation.id>`, and the exact retained record digest. Resolved
findings project to `UNKNOWN`, while native observations preserve their actual
PASS/FAIL/INCOMPLETE outcome. Recovery references use owner `harness` with both
ID and digest equal to the retained regression or recovery-link digest. The
read-only inspect operation revalidates its observations, binding and native
reports without changing the original records.

An Alertmanager incident has its own fingerprint/start-time identity. Its
recovery therefore uses `response.recovery.link`: `regressionId` is the original
`online.regression.verify` digest, `incidentId` is the target Alertmanager
incident, and `firingId`/`resolvedId` select actual retained findings from that
same incident. Both findings must match the regression's workspace, project,
binding, service, environment and deployment. Their time ordering must be
`alert FIRING <= native FAIL < alert RESOLVED <= native PASS`, and the quality
recovery cannot be in the future. A resolved alert alone supplies no quality
result; a quality PASS alone cannot resolve the Alertmanager event.

The mutation retains a content-addressed correlation and returns the existing
`ResponseRecovery` shape. The target incident and reference identify that
correlation, while `faultDigest`, `recoveryDigest`, `faultAt` and `recoveryAt`
remain the actual native regression's values. The link retains both original
finding digests and the fault-history summaries of both incident streams.
Readback rejects a newly observed quality failure or a new FIRING in either
stream, including a distinct late FIRING with an older timestamp. Additional
healthy RESOLVED observations preserve the original link. The original
regression remains readable as historical evidence after a link becomes stale.
Linking facts does not approve a cause, execute an action or close the problem;
Runtime verification and the exact closure review remain required.

Trusted provider callbacks are `resolveFeedbackMaterial`,
`readResponseEvidence`, `readResponseRecovery` and `readResponseExecution`.
Harness evidence and recovery are always derived from its own records; a
provided recovery projection must match those records. Runtime verification
arrives through its public owner service. Providers are configured by the host,
never by request input. Active asynchronous response operations prevent service
closure until their outcome is known.

## Verification boundary

`tests/e2e/response.test.mjs` exercises owner boundaries, exact scope and digests,
human evidence, immutable history, expiry, withdrawal, late findings, recovery
and idempotency using explicitly synthetic seeded records. These tests do not
claim a real incident or human decision. Parent integration acceptance separately
requires actual collection, native engines, installed Codex journeys and
upgrade/recovery evidence before an installation is declared accepted.
