# Semantic Catalog implementation checkpoint

Audience: Harness maintainers implementing the approved 4.8.1 semantic supply
Target. Status: **internal implementation in progress**, not a released API,
Candidate, acceptance result, or operator publication procedure.

The current package version remains 4.8.0 until the owning 4.8.1 implementation
and distribution projections are complete. Existing semantic assets, including
`TerminalSemanticClosure.version=4.8.0`, are not relabeled.

## Implemented internal layers

- [`catalog-contract.mjs`](../../src/v4/semantics/catalog-contract.mjs) defines
  the additive pointer/generation identities, exact finite default budgets,
  bounded configuration, graph checks and redacted diagnostics.
  Five additive wire schemas cover pointer, generation, publication receipt,
  lock owner and recovery receipt. Regenerate with
  `node scripts/generate-semantic-catalog-schemas.mjs`; verify without writes
  using the same command with `--check`. Wire shape validation supplements
  canonical digest, graph and material reconstruction checks; it cannot prove
  publication authority. Existing path/resource diagnostics take precedence.
- [`catalog-store.mjs`](../../src/v4/semantics/catalog-store.mjs) provides an
  internal store with immutable generation/material/receipt files, full staged
  readback, exclusive cross-process locking and an expected-head pointer switch.
  It never writes `CATALOG.md`, `catalog.lock.json`, or Registry entries.
- [`catalog-budget.mjs`](../../src/v4/semantics/catalog-budget.mjs) supplies one
  monotonic deadline and sticky cancellation context for service preparation,
  policy reads and nested store work. It is an internal Engine context, not a
  callback supplied by a Catalog document or CLI input.
- [`catalog-materials.mjs`](../../src/v4/semantics/catalog-materials.mjs) checks
  supplied ArtifactSet/Skill, snapshot, Pack, Foundation, profile, index,
  projection, round-trip, support and v3 Harness objects. It re-derives key
  cross-bindings rather than accepting object hashes alone.
- [`catalog-generation.mjs`](../../src/v4/semantics/catalog-generation.mjs)
  assembles complete content-addressed generations and resolves their actual
  materials. Embedded Skill discovery points into its parent ArtifactSet;
  internal dependencies do not acquire invented semantic versions.
- [`catalog-supply.mjs`](../../src/v4/semantics/catalog-supply.mjs) connects the
  store to explicitly enabled workspace-local Registry roots and original v3
  Catalog membership. Publication, rollback, revocation and crash-lock recovery
  are wired through CLI, Engine and local stdio MCP Sessions, with separate
  read-only previews and receipt inspection.

The store requires trusted Engine callbacks for publication authority, current
entry permission and complete material validation. They are internal functions,
not fields that may be supplied by a Catalog document, Source, CLI caller or
Agent. A pure material-validation result does not prove configured Catalog
membership or authorize publication. The service reads an operator-owned policy
selected by `config.yaml`'s `semanticCatalogPolicy` field. The policy binds the
configured root, current project scope/visibility, independent asset publication
grants and an exact Catalog publication grant. Neither input files nor these
operations may create or update that policy. Enabled Registry membership alone
is not authority. See the [policy schema](../../schemas/semantic-catalog-policy-v1.schema.json).

## Development operation surface

These are source-checkout interfaces under implementation, not a released
installation guide. Atomic CLI operations are `semantic catalog-preview`,
`semantic catalog-inspect`, `semantic catalog-readback` and
`semantic catalog-publish`; each supports `--workspace` and `--json`.

Engine operation ids are `semantic.catalog.preview`, `semantic.catalog.inspect`,
`semantic.catalog.readback` and `semantic.catalog.publish`. Preview binds
`catalogId`, `file` and canonical `inputDigest`; publication also binds
`expectedGenerationDigest`, `expectedHead` (`EMPTY` or the exact pointer digest),
`requestId` and `publication`. Readback uses `catalogId` and `requestId`.
The Catalog grant subject binds the exact generation, expected head, action and
request digest; it cannot be reused for another request.

Additional maintenance operations follow the same CLI/Engine naming mapping:

| Engine operation | Additional exact input | Access |
|---|---|---|
| `semantic.catalog.transition-preview` | `transition=ROLLBACK` plus `targetPointerDigest`, or `transition=REVOKE` plus `revokedDigests`; both bind `expectedHead` | Read-only |
| `semantic.catalog.rollback` | `targetPointerDigest`, `expectedHead`, `expectedGenerationDigest`, `requestId`, `publication` | Separate publication decision |
| `semantic.catalog.revoke` | `revokedDigests`, `expectedHead`, `expectedGenerationDigest`, `requestId`, `publication` | Separate publication decision |
| `semantic.catalog.recovery-inspect` | `catalogId` | Read-only lock inspection |
| `semantic.catalog.recover` | `expectedLockDigest`, `expectedHead`, `recoveryId`, `publication` | Separate recovery decision |
| `semantic.catalog.recovery-readback` | `recoveryId` | Read-only recovery receipt |

All accept `catalogId`. CLI names use `semantic catalog-<operation-suffix>`;
`--revoked-digests` is a JSON array. Rollback and revocation grant subjects also
bind `transitionDigest` from the preview. Recovery uses a distinct
`CATALOG_RECOVERY` policy grant bound to Catalog, lock, expected head and recovery
request. A publication grant cannot authorize recovery.

MCP exposes read-only operations through `run_engine_diagnostic`.
Publication requires a maintenance plan and, after plan confirmation, separate
`authorize_plan_publication_operation` authorization. That Session decision does
not replace the operator policy's independent asset, Catalog and recovery grants.
Cached Engine publication success is revalidated through durable readback; a
revoked grant cannot be bypassed by an old Engine receipt. No retry republishes
an uncertain operation. These interfaces never modify the original v3 Catalog.

## Failure and recovery behavior

The publication request id has a durable intent receipt before visibility.
`SEMANTIC-CATALOG.json` is switched only after staged readback. Contending
cooperating processes cannot both publish against the same expected head.
Before the pointer switch, failure exposes no partial generation. Once a switch
has been attempted, an uncertain result requires receipt readback, not replay.
Committed receipts can be found through bounded immutable head history.

A crashed writer's lock is not stolen based on elapsed time. Readback returns
`COMMITTED` when proven or `UNKNOWN`; it does not infer that an uncertain request
never took effect. Recovery separately binds the exact local lock owner and
current head. Only a provably exited process on the same host/root is eligible;
an alive, reused, unknown, missing or malformed owner fails closed. No process
is terminated. After separate recovery authorization, bounded history or the
unchanged pre-publication head establishes `COMMITTED` or `NOT_COMMITTED`.
The stale lock is moved to append-only recovery evidence, not deleted. Materials,
intent receipts and heads remain untouched; an uncertain original request is
never retried automatically. A failed/ambiguous recovery move requires readback,
not another move. A crashed recovery guard itself remains a manual inspection
stop; there is no recursive lock-stealing mechanism.

Service configuration, policy and input reads are asynchronous and chunked.
An already-cancelled operation stops before configuration work. The deadline
does not restart when a preview, transition or recovery enters another store
method. Read-only policy callbacks race against timeout/cancellation; a late
callback result cannot revive a stopped operation. File handles and started
material readers are closed/drained before their read operation exits.

Mutating filesystem calls are never detached through a timeout race. Checks
surround the pointer and recovery-lock visibility switches; cancellation after
a switch attempt returns `UNKNOWN`, followed by fresh readback without replay.
This is cooperative bounded execution, not OS-level preemption: an in-flight
filesystem syscall, synchronous JSON/schema computation or durable cleanup may
finish after the deadline before the operation reports its result. These limits
must not be described as a hard wall-clock service-level guarantee.

Recovery interruption tests cover guard creation, durable recovery receipt,
before/after the lock move, and cleanup failure. A retained guard is not stolen.
An existing receipt without its recovered lock archive remains `UNKNOWN`; an
archived lock supports readback without a second move. In-memory `PREFLIGHT`
records and mismatched original publication ids cannot become completed
recovery evidence.

Read-only consumers must never perform that repair. Local filesystem checks reject symlinks/hardlinks and
changed read paths; they are not a claim of isolation from an attacker with
concurrent unrestricted write access to the same OS account.

New generations must retain all prior revocation digests. Revocation drops any
complete semantic set referencing the revoked material; it does not leave partial
sets. Rollback selects only a verified ancestor and publishes a new pointer with
the current head as predecessor. It cannot restore any revoked dependency.
Historical `COMMITTED` readback proves a past publication, not current asset
eligibility. Old generations and receipts remain intact. Selection/active-binding behavior across growth,
revocation and rollback still needs the consumer integration described below.

## Local verification

From the repository root, with the repository dependencies available:

```bash
node --test tests/v4.8.1-semantic-catalog-*.test.mjs
```

These tests use disposable local synthetic fixtures. Store tests intentionally
use a minimal test-only validator; material tests separately exercise actual
semantic object shapes. Supply integration tests additionally publish and
discover a complete synthetic generation through the actual Engine and local
stdio Session protocol, including negative authorization cases and permission
revocation. This is not an installed-package test, a real Host run, or terminal
series E2E, and does not close any Target criterion.

Contract tests exercise the actual 4096-entry, 16384-edge and 64-level graph
boundaries and one-over rejection. Store tests publish/read a real 16 MiB
material and read exact 64 KiB pointer / 4 MiB generation files, rejecting one
extra byte. A separate test reads sixteen actual 16 MiB fixture files (256 MiB
total), then verifies a one-byte-over aggregate is rejected before any material
file is opened. This is an actual storage read using the test-only material
validator, not a production semantic closure, full-size publication or memory
service-level guarantee. Each material read is also capped by its validated
entry byte count before allocation/body reading; a forged small declaration
cannot cause a read up to the larger global per-file maximum. Instrumented readers
verify concurrency four and a tightened limit of one, cancellation closes all
readers without returning a partial generation, and a controlled monotonic clock
checks the exact 5000 ms lock-wait boundary. The Registry accepts sixteen enabled
roots and rejects a seventeenth without scanning unrelated roots.

The service-level dependency matrix removes and tampers with every distinct
material file in a complete synthetic generation, checks failure without partial
results, restores the fixture and verifies the original pointer. Pure material
tests reject unsupported schemas and unbound fields for every supplied dependency
class. Crash tests cover before/after generation write and before/after pointer
switch, with separately authorized synthetic recovery and no original-request
replay. These local matrices do not transfer evidence to installed-package or
real-Host acceptance.

The [4.8.1 repository case plan](../../tests/e2e/versions/4.8.1/case-plan.json)
binds five RC definitions and ten machine variants to the exact approved Target.
See [repository E2E instructions](../../tests/e2e/README.md#481-development-case-plan)
for its combined definition/historical-projection/local-test command. The
historical 4.6/4.7/4.8 index and manifests remain unchanged. This is supporting
development coverage, not an installed-version RC replay or acceptance record.

## Remaining implementation

1. Complete the required historical impact/regression matrix and installed-build
   binding of the local resource, hostile-content and interruption checks. Current
   synthetic boundary coverage is not installed-package or real-Host acceptance.
2. Complete installed-version 4.8.1 case runners, cumulative replay mapping and
   generated product/version projections without altering historical cases.
3. Implement Runtime 6.3.0 read-only consumption and Expert 2.3.0 guidance under
   their separately approved Targets. Dashboard is not a dependency.

Candidate construction, installed-package/real-Host acceptance, terminal series
E2E and Release retain their separate authorization boundaries. No current or
inherited Target criterion is closed by this checkpoint.
