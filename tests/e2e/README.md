# Repository E2E corpus

This directory is the discoverable, repository-local index for governed
`evopilot-harness` end-to-end cases. It does not replace or revise an Evolution
Target.

## Authority model

- `governance/targets/*.json` owns acceptance meaning, case status, evidence,
  approval, validation, and release authority.
- `tests/e2e/versions/*/manifest.json` is a read-only projection bound to the
  exact SHA-256 of one authoritative Target file.
- Large or private Host evidence stays outside this repository. A manifest
  points to the Target fields that contain the immutable evidence references;
  it never copies the evidence itself.
- Historical validation proves that the repository projection still matches
  the accepted record. It does not replay external effects or re-authorize a
  prior release.

## Run

Validate the complete version index:

```bash
node scripts/validate-repository-e2e.mjs
```

Validate one checked-in manifest:

```bash
node scripts/validate-repository-e2e.mjs \
  --manifest tests/e2e/versions/4.8.0/manifest.json
```

The command reads repository files only and emits a machine-readable report.
Any Target digest drift, unsupported version, unsafe path, missing or reordered
case, coverage mismatch, evidence-pointer mismatch, or embedded authority field
fails closed.

## Layout

- [`index.json`](index.json) lists supported version projections.
- [`schema/manifest.schema.json`](schema/manifest.schema.json) defines the
  machine-readable manifest shape.
- [`scenarios/target-case-projection.json`](scenarios/target-case-projection.json)
  defines the shared read-only validation journey.
- `versions/<version>/manifest.json` binds one version to its exact Target and
  RC01-RC05 projections.
- [`versions/4.8.1/case-plan.json`](versions/4.8.1/case-plan.json) is a separate
  development-only projection of the approved semantic supply Target. It is not
  a historical acceptance manifest and is not inserted into the historical index.

Git history and release tags retain prior corpus revisions. New product
versions add a new version manifest; shared validation behavior remains in the
scenario profile and validator.

## 4.8.1 development case plan

For maintainers with the exact approved external 4.8.1 Target file, one command
checks its byte digest, the five RC definitions, ten machine-variant definitions,
eleven current criterion mappings, historical projections and local source tests:

```bash
node scripts/validate-semantic-supply-corpus.mjs \
  --target /absolute/path/to/approved/harness-target.json --run-local
```

Replace the example Target path with the existing approved file; no Target or
private evidence is copied into this repository. Omit `--run-local` to validate
definitions only. The command reads the Target and historical records without
modifying them. Local suites create disposable synthetic fixtures in the OS temp
directory; the runner accepts no manifest-supplied commands. It rejects Target
digest drift, missing/reordered cases, coverage drift, unsafe suite references,
symlink substitutions, embedded authority fields and package allowlists that
include tests. The source tests are excluded from the product package allowlist;
this check is not a built-package isolation test.

`CASE_PLAN_VALIDATED` means definitions match. `localSyntheticTests: PASSED`
means supporting source-checkout tests passed, **not that RC01-RC05 passed**.
Installed-package E2E, independent real Hosts, cumulative historical replay and
formal acceptance remain `NOT_RUN`; `targetCriteriaClosed` remains zero.
The Target's `/inheritedAcceptance` still owns cumulative obligations. This plan
does not expand those obligations into a completed replay matrix, copy evidence
or transfer prior human declarations. Full installed-version case runners and
their acceptance bindings remain subsequent work.

### Partial 4.8.1 installed discovery probe

The [installed entry point](versions/run-installed-probe.mjs) runs the fixed
[4.8.1 read-only discovery probe](versions/4.8.1/discovery-probe.mjs). It inspects
an already published, independently prepared Catalog twice and checks its exact
pointer, generation, policy stability and non-publication authority. It never
prepares a Workspace, creates an asset, publishes, rolls back or operates a Host.
This is only the read portion of RC01-M1, not the complete case.

After separately authorized artifact materialization and campaign preflight:

```bash
node tests/e2e/versions/run-installed-probe.mjs --context /absolute/context.json --context-digest sha256:<exact-context-bytes> --input /absolute/input.json
```

This is a template, not build/install or acceptance authorization. The context
schema `evopilot-installed-readonly-probe-context/v1` requires product `harness`,
version `4.8.1`, absolute `installationRoot` and external `workspace`, the complete
installation `files` array of `{path,digest}`, `artifactSetDigest`,
`acceptanceBindingDigest` and `probeInputDigest`. Context SHA-256 binds the exact
JSON bytes; `probeInputDigest` uses the exported `probeDigest` over parsed input.
Input is `{expected:{catalogId,pointerDigest,generationDigest}}`. Do not put
credentials or raw Source content in either file.

Optionally add `generation`, the independently frozen expected generation JSON,
to that same input. The [supply projection oracle](versions/4.8.1/supply-assertions.mjs)
checks its canonical digest, exact returned entries/sets/revocations, scoped
ArtifactSet/Skill/Closure references and embedded Skill parent. The context input
digest binds the expected generation as well; it must not be generated from the
response being judged. Input files are limited to 8 MiB. Explicit `null` is
rejected instead of silently skipping the assertion. The report distinguishes
`INDEPENDENT_EXPECTED_PROJECTION_CHECKED` from `NOT_REQUESTED`.

The projection oracle alone does not load material files or publication receipts.
For independent byte evidence, additionally provide
`supply:{catalogRoot,publication:{requestId,expectedHead,authorization}}` in the
input, along with the frozen `generation`. `catalogRoot` must be an absolute,
external Catalog path. The publication fields must be independently reviewed
before reading the result, not derived from it. This path handles `PUBLISH`
receipts, not rollback/revocation transitions, and never executes publication.

The [material verifier](versions/4.8.1/supply-materials.mjs) reads the pointer,
generation, immutable head, receipt, request record and every distinct material
file. It verifies exact hashes/byte sizes, embedded Skill parentage, the pinned
publication decision, COMMITTED CLI readback and a stable final pointer. It
rejects symlinked descendants, non-files, hard links, changed bytes and missing
records. Limits are 64 KiB pointer/receipt, 4 MiB generation, 16 MiB per material,
256 MiB total reads, 4096 entries and a 30-second read deadline. Cancellation is
checked between bounded read chunks. It produces only hash/size observations,
not material content. A matching receipt does not prove policy authority or
independently qualify a real publication campaign.

The installed wrapper exposes the result as `supplyEvidence`, or `null` if not
requested. Source tests freeze expectations before synthetic publication, then
verify actual files and reject changed/missing receipts, altered decisions,
UNKNOWN readback, byte tampering and symlink substitution. A toy installed CLI
tests wrapper connection only. Full installed-artifact RC01 and its authorized
publication Session remain unexecuted.

The [transport](versions/installed-transport.mjs) only allows `semantic
catalog-inspect --catalog-id <id> --json` and `semantic catalog-readback
--catalog-id <id> --request-id <id> --json`, and adds the bound Workspace. It checks
the complete installed tree before and after each invocation, rejects source
checkouts, changed/extra files and all symlinks, and uses a clean process
environment. The independently materialized installation must have no bin links.
Limits are 32768 entries, depth 32, 32 MiB per file, 512 MiB total, 10 seconds per
process and 1 MiB process output; the probe has a 30-second default deadline.
Context hashes alone do not verify artifact provenance or grant authority:
the external campaign must verify the accepted archives and all dependencies.

`PROBE_ASSERTIONS_PASSED` closes zero Target criteria. Independent artifact
qualification, full RC assertions, real Hosts and formal acceptance stay open.

### RC01 publication Session execution

The programmatic [publication journey](versions/4.8.1/publication-journey.mjs)
adds `prepare`, `confirm-plan`, `publish` and `readback` phases. It requires a raw
MCP invocation callback, an independently verified per-call authorizer, frozen
`publicationInput` and expected `generation`, and an external `catalogRoot`.
The publication input fields are `catalogId,file,inputDigest,
expectedGenerationDigest,expectedHead,requestId,publication`; `EMPTY` denotes no
previous head. Prepare also requires explicit `adapterId` and independently
qualified `hostInteraction`, and returns a Session reference and plan frame.

Confirm-plan and publish use that exact `sessionRef:{sessionId,sessionDigest,
planDigest}`, plus `decision:{confirmedBy,confirmation,frameDigest}`. Their exact
confirmation strings remain separate Engine-owned decisions. Generic continue,
a prior plan confirmation, changed Session/frame or an invented displayed view
is rejected. There is no default decision or automatic publication permission.
`deliverBusinessView` must provide independently observed delivery evidence as
`{frameDigest,renderedBusinessViewDigest}` before the runner records a receipt;
computing a hash in a fixture is not real Host delivery evidence. Do not wrap this
runner with a test client that silently records presentation or approves gates.

Publication verifies COMMITTED readback, discovery and actual material bytes
against a pointer independently reconstructed from the preselected publication
inputs. No rollback/revoke/repair or source execution is performed. Uncertain
publication returns `UNKNOWN_PUBLICATION_OUTCOME` with readback-only guidance;
earlier uncertain Session mutation requires Session inspection before retry.
Readback never executes the plan or republishes. Deadline is 30 seconds by
default (maximum 120), shared with callback/transport waits and the remaining
file-read budget; MCP responses are limited to 4 MiB.

`PUBLICATION_SUBJOURNEY_ASSERTIONS_PASSED` closes zero formal criteria. Source
tests exercise raw stdio MCP, separately supplied synthetic decisions/display
receipts, public readback and actual synthetic Catalog files. They do not prove
installed MCP identity, artifact provenance, production policy or real Host
qualification. Those prerequisites must be supplied by the external campaign.

### RC02 finite public refusal checks

The programmatic [refusal probe](versions/4.8.1/refusal-probe.mjs) performs one
raw MCP `semantic.catalog.inspect` diagnostic. Supply
`expected:{catalogId,workspace,code}`, `invoke` and `authorizeInvocation`, with
optional `signal` and `timeoutMs`. The external Workspace and expected refusal
must be independently pinned before execution. The runner never creates the
negative fixture, changes policy, retries, repairs or performs publication.

Supported expected codes are `UNAVAILABLE`, `PERMISSION_DENIED`,
`TRUST_REQUIRED`, `PATH_DENIED`, `INVALID_JSON`, `DIGEST_MISMATCH`, `FILE_LIMIT`,
`UNSUPPORTED`, `WIRE_SCHEMA_INVALID`, `IDENTITY_CONFLICT`, `SCOPE_INVALID`,
`MATERIAL_MISSING`, `DEPENDENCY_CYCLE`, `PARENT_INVALID`, `REVOKED`,
`MATERIAL_LIMIT`, `ENTRY_LIMIT`, `EDGE_LIMIT`, `DEPTH_LIMIT`,
`TOTAL_MATERIAL_LIMIT`, `ROOT_LIMIT` and `MATERIAL_INVALID`.
The independent oracle checks the exact Engine envelope, operation, Workspace,
failure status, exit code, finite redacted message and `nextAction`, including
the MCP text projection. Extra authority, private content, a mismatched text
projection or a generic transport/tool error cannot count as the expected
product refusal. `UNKNOWN` is not accepted as a successful negative test.

Source tests cover unpublished/disabled supply, current permission loss, revoked
asset approval, stale root binding, unknown policy fields, policy symlinks,
invalid pointer JSON/digest and missing or corrupted materials. Size growth and
same-size digest corruption are separate fixtures: a size rejection must not
be mislabeled a digest-validation result. Workspace snapshots before and after
each diagnostic check that no repair or mutation occurred. Denied invocation,
cancelled/hung transport, disconnection and oversized responses stop without
retry. The timeout defaults to 30 seconds (maximum 120); responses are limited
to 1 MiB.

The [public structural/resource negative matrix](../v4.8.1-semantic-catalog-public-negative.test.mjs)
adds thirty actual raw-MCP refusal scenarios. Each first verifies a valid
published synthetic generation, then injects one named fault into the disposable
external Workspace and requires the exact public error, not merely failure.
Coverage includes unsupported/extra wire fields, Catalog and asset identity,
missing/cross-project/cyclic dependencies, Skill parent links, revocation,
path escapes and URL paths, hard links, current scope/visibility/grant expiry,
and graph/file/root budgets. Rehashed corrupt generations and synthetic receipt
grants let the reader reach the intended check; they are test preparation,
never Engine-authorized publication or acceptance evidence.

The matrix tests one-over maxima of 4096 entries, 16384 edges, depth 64,
16 MiB per material, 256 MiB aggregate, 64 KiB pointer and 4 MiB generation.
Graph material totals are metadata accounting checks, not public reads of
256 MiB of valid semantic materials. Existing contract/storage suites retain
the exact-boundary positives. One actual MCP positive accepts sixteen enabled
Registry roots without scanning unselected roots; seventeen is refused.
Snapshot hashes and a synthetic sentinel remain unchanged after every refusal.
Malformed instruction fields remain inert data. These controls do not prove
general Source execution prevention or every secret-leakage path.

The versioned development corpus includes this fixed local suite. It cannot
substitute a manifest-supplied command or omit the suite without failing exact
projection validation.

`REFUSAL_SUBJOURNEY_ASSERTIONS_PASSED` closes zero Target criteria. This is a
broader subset of RC02 source conformance, not the complete current/inherited
negative matrix, an installed-product run or qualified Host evidence.
The installed discovery transport is unchanged.

### RC05 read-only interruption reconciliation

The programmatic [recovery probe](versions/4.8.1/recovery-probe.mjs) has two
read-only phases: `inspect` before independently authorized recovery, and
`readback` after it. Both require raw MCP `invoke` and a per-call
`authorizeInvocation` callback. Its frozen `expected` frame contains
`catalogId,requestId,generationDigest,previousHead,publication,lock,recoveryId,
recoveryAuthorization,publicationOutcome`. Decisions are exact
`{decision,actor,authorizationDigest}` records. `lock` is the independently pinned
complete owner record, not a field copied from the diagnostic being assessed.
The expected outcome must be independently established, never inferred from an
`UNKNOWN` publication readback. These pins are evidence, not campaign authority.

Inspect verifies the exact dead-owner lock, publication request, current head
and `grantsRecoveryAuthority:false`. It never unlocks or authorizes recovery.
Readback checks the full recovery record against an independently reconstructed
digest, including the publication and recovery request hashes, lock, head,
outcome and separate recovery decision. `mutationReplayed` must be false.
`PREFLIGHT`, `UNKNOWN`, extra authority fields and even rehashed but mismatched
records fail. The runner has no mutation operations, implicit decisions or retry.

Readback also requires an absolute external `catalogRoot`. A bounded independent
file oracle checks the durable recovery record, the exact archived lock owner,
absence of an active publication lock and an unchanged current pointer. It reads
only fixed paths, rejects links/non-files/hard links and inode or content drift,
and limits each JSON file to 64 KiB with a five-second file-check deadline.
For `COMMITTED`, also supply frozen `publicationInput` and `generation` as for
the publication journey: the probe verifies publication readback, discovery and
all actual supply bytes. For `NOT_COMMITTED`, it requires the exact recovery
record, archived owner and unchanged previous head; it does not interpret a
missing receipt or `UNKNOWN` as proof. The pointer must stay at the pinned head;
later growth, rollback, historical ancestry and concurrent writes are outside
this subjourney and must not be silently accepted.

The default overall timeout is 30 seconds, maximum 120, including authorization
and transport waits. Recovery MCP responses are limited to 1 MiB; the committed
publication verifier retains its 4 MiB limit and uses the remaining time.
Errors, cancellation, timeout and current-policy refusal stop without mutation.

Source tests crash a synthetic child before generation persistence, after it,
before pointer switch and after switch; they then use fresh raw stdio MCP for
inspection and readback. Only the fixture performs separately granted recovery.
Catalog snapshots before/after diagnostics confirm no publication replay or
file mutation. Forged records, revoked authority, missing/changed archived
owners, symlinks, denied invocation and hung/cancelled transports fail closed.
`RECOVERY_SUBJOURNEY_ASSERTIONS_PASSED` still closes zero Target criteria. The
installed discovery transport is unchanged and cannot run this probe. Full
RC05, installed recovery, independent real Hosts and formal acceptance remain
unexecuted; this is source-conformance evidence only.

### RC05 history and concurrent-publication source coverage

The programmatic [history probe](versions/4.8.1/history-probe.mjs) reads an
independently frozen complete chain from an initially empty Catalog. Its input
is `{expected:{catalogId,steps},catalogRoot,invoke,authorizeInvocation}` with
optional `signal` and `timeoutMs`. Every step contains
`{requestId,action,generation,authorization,transition}`. `PUBLISH` uses a null
transition; `ROLLBACK` uses `{targetPointerDigest}` naming an earlier pinned
head; `REVOKE` uses `{revokedDigests}`. Publication decisions and expected
generations must be fixed before the operation being assessed, never copied
from the returned discovery or readback. This is not a mutation plan or policy
authorization.

The independent oracle reconstructs request, transition, receipt and pointer
digests, preserves previous-head links and rejects lost revocations. Fixed raw
MCP diagnostics inspect the current Catalog before and after reading every
historical request. A historical `COMMITTED` response must name its own receipt
and pointer, not the latest head. The final discovery must exactly match the
last expected generation, including an empty Catalog after revocation. Current
Engine policy is rechecked on each request; revoked read authority fails closed.
Historical evidence is not permission to restore revoked assets.

An independent disk reader verifies immutable heads, receipts, request records,
generation JSON and material file hashes/sizes, with a stable current pointer.
It rejects links, hard links, changed inodes, unsafe content paths and oversized
files. Limits: 32 revisions, 4096 entries per generation, 64 KiB head/receipt,
4 MiB generation, 16 MiB material, 256 MiB total bytes and 1 MiB MCP responses.
The overall timeout defaults to 30 seconds, maximum 120. Every invocation
requires external read authorization; cancellation, timeout, `UNKNOWN`, drift
or refusal stops without retry, recovery, Session mutation or publication.

Source tests coordinate two independently granted writer processes through a
fixture-only IPC start barrier. Exactly one same-head write succeeds; the loser
returns `CONFLICT`, leaves no request record and reads back as `UNAVAILABLE`.
This is a known rejected write, not an inference from an uncertain timeout.
Fresh source MCP verifies the winner without retrying either publication.
Other source tests verify growth, rollback, revocation, immutable historical
bytes, restart readback and refusal to resurrect revoked assets. Tampered
receipts/materials, rehashed wrong transitions/decisions, substituted heads,
revoked grants and bounded transport failures are negative controls.

The recovery probe is also exercised after five recovery-stage interruptions:
after guard creation, after receipt persistence, before lock archival, after
archival and during cleanup. A receipt without the matching archived lock
cannot pass. After archival, exact recovery readback may pass even while the
separate recovery guard remains; this is evidence reconciliation, **not** proof
that cleanup completed or permission to remove the guard or retry writes.
Catalog snapshots confirm diagnostics leave all such state untouched.

`HISTORY_SUBJOURNEY_ASSERTIONS_PASSED` closes zero formal Target criteria.
These tests run synthetic source processes, not installed products or qualified
real Hosts. The installed discovery wrapper remains unchanged. Complete RC05
impact mapping, installed journeys and formal acceptance are still separate.

### RC03 legacy compatibility and RC04 independent consumer evidence

The pure [compatibility oracle](versions/4.8.1/compatibility-assertions.mjs)
compares externally captured pre-publication file digests, root-only Registry,
old v3 consumer projections and the exact expected semantic generation.
Every pre-existing file must retain its bytes. Asset versions come from the
independently frozen generation, not the Engine version. The synthetic source
fixture retains a `4.8.0` Closure while testing the `4.8.1` Engine line; this
does not prove preservation of every historical public package.

The pure [consumer handoff oracle](versions/4.8.1/handoff-assertions.mjs)
compares an independently supplied Runtime report with expectations frozen
before publication: Registry/policy hashes, pointer, generation, publication
receipt, every material document digest and legacy Catalog evidence. It
requires `eligibleForExecution: false` and rejects omitted or additional report
fields. Harness does not call Runtime, import its implementation, bind a project,
scan an unregistered directory or acquire consumer ownership.

An external synthetic campaign coordinates the Harness producer and a separate
Runtime source worker. The Runtime repository owns that worker and its fixed
material/legacy validators. The campaign checks fresh-process readback, old v3
reads before/after publication, complete Workspace byte snapshots and independent
consumer refusals for missing/disabled Registry roots, current permission,
revocation, inactive/foreign subjects, wrong root binding and missing/tampered
files. Each refusal must match the owning consumer's contract; Harness error
codes are not transferred to Runtime by assumption.

These are source-only evidence oracles, not installed transports or full RC
runners. Their `*_SOURCE_ASSERTIONS_PASSED` results close zero formal criteria.
External capture correctness and exact process/artifact identity must be
established separately. Complete historical replay, fresh installed products,
qualified real Hosts and all full RC03/RC04 obligations remain separate.

The existing supply tests below use a tiny toy CLI for transport refusal checks
and the actual source CLI with a separately prepared synthetic Catalog. The
cross-repository handoff campaign is external, not invoked by this command:

```bash
node --test tests/e2e/installed-probe-transport.test.mjs tests/v4.8.1-semantic-catalog-supply.test.mjs
```

The supply suite also stages the real Harness package allowlist and its locally
resolved dependencies into a fresh external installation. It checks the actual
CLI against synthetic Catalog bytes and committed publication receipts, verifies
that the pointer is unchanged, and rejects an altered installed CLI before
transport. The installation inventory binds copied source bytes only: it proves
neither Candidate provenance nor npm installation, qualified Codex execution,
real-model behavior or formal acceptance.
