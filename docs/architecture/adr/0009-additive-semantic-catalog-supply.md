# ADR 0009: Additive Semantic Catalog Supply

Status: Implementation decision within the approved 4.8.1 semantic Catalog
supply Target; not acceptance or Release evidence.

## Context and boundary

Separately published semantic documents are not discoverable through a v3
Harness-only Catalog. The accepted 4.8.1 Roadmap adds a supply path without
changing the producer/consumer ownership in [ADR 0001](0001-product-and-module-boundaries.md),
Session authority in [ADR 0002](0002-agent-native-harness-operations.md), or
semantic object contracts in [ADR 0008](0008-scalable-semantic-interoperability.md).
This supplements those decisions; it does not replace them or grant publication.

## Decision

- Registry continues to contain enabled Catalog roots only. Preserve the old
  `CATALOG.md`, `catalog.lock.json`, v3 schemas and published asset bytes.
- Add `SEMANTIC-CATALOG.json`, which points to a content-addressed complete
  generation under `semantic-catalog/`. Supply actual validated materials,
  provenance, independent publication receipts and exact v3 Harness membership.
  Embedded Skill discovery binds its parent ArtifactSet and JSON pointer.
- The Engine reads operator-owned, schema-validated scope/visibility and exact
  authority grants. Enabled roots, digests, source content, preview results and
  `PUBLISHED` labels cannot grant authority. Signing remains optional.
- Stage immutable materials, generation, request receipt and head history.
  Cooperating local publishers serialize with an exclusive lock and compare the
  exact expected head before the sole same-directory pointer rename. Readers
  validate an entire generation and recheck the pointer; no partial result or
  unindexed fallback is permitted.
- Publication, rollback and revocation need exact independent authorization.
  Rollback appends a new head referencing validated ancestor content; it does
  not move the pointer back to an old history node. Revocation is monotonic and
  removes complete dependent sets. Old material and evidence remain immutable.
- Record lock ownership before publication intent. A separate recovery grant
  binds Catalog, lock digest, expected head and request. Only an exited same-host
  local owner can be recovered; a live/reused PID, unknown owner or ambiguous
  history fails closed. Recovery archives the stale lock and its evidence,
  never replays publication, changes asset bytes or kills a process. Recovery
  itself has an exclusive guard and durable readback; an uncertain move is not
  repeated. Missing ownership and a crashed recovery guard require inspection.
- Plan confirmation remains distinct from each maintenance authorization.
  Engine idempotency replay revalidates current authority against the durable
  publication/recovery receipt. Historical receipt success is not permission
  to select currently revoked material.
- Runtime consumes configured published generations read-only. It cannot
  publish, revoke, recover locks or execute producer functions. Its active-binding
  checks belong to the separate Runtime 6.3.0 Target.

## Compatibility and limitations

No migration or relabeling of existing assets is performed. Engine 4.8.1 does
not turn `TerminalSemanticClosure.version=4.8.0` into a new asset version.
Existing consumers can ignore the additive files. This implementation currently
connects explicit workspace-local roots; it makes no multi-host filesystem,
remote service, mandatory-signature or hostile-same-OS-account isolation claim.
No scanning, network backfill or Source execution is introduced.

Resource bounds remain those of the approved supply contract; an override may
only reduce a bound. The complete exact-bound/one-over and interruption matrix,
wire-schema coverage, versioned repository corpus and separately authorized
installed-package/Host acceptance remain required before readiness.

## Evidence and consequences

The [implementation checkpoint](../../reference/semantic-catalog-implementation.md)
describes current source interfaces and verification scope. Synthetic tests
exercise concurrent publishers, stale heads, immutable history, before/after
pointer crashes, post-commit unlock failure, revoked authority, restart and
separate local stdio Session decisions. They do not prove real Host acceptance
or terminal series E2E. Append-only generations, lock archives and recovery
records consume storage; this decision does not authorize garbage collection.
