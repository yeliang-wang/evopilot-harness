# Database Product Harness

Domain-first executable HarnessTemplate for self-developed database products.

Use this pack when EvoPilot is onboarding the owner's database product and needs control rules for SQL compatibility, storage/query/transaction engines, recovery, performance, upgrade, and operations evidence.

PostgreSQL, MySQL, SQLite, CockroachDB, TiDB, or similar systems are references only: compatibility corpora, SQL dialect examples, protocol references, or differential oracles. They are not the default product being evolved.

## Layers

- Domain: `database-product`
- Compatibility: `postgres-compatible`, `mysql-compatible`, `ansi-sql`
- Architecture: `single-node`, `distributed`, `htap`, `mpp`
- Runtime: `java`, `go`, `rust`, `cpp`, `generic`

## Project Required Actions

- Declare the self-developed database product boundary and reference database roles.
- Map parser, planner, executor, storage, transaction, replication, and recovery modules to repository paths.
- Bind SQL compatibility and protocol compatibility commands.
- Bind transaction isolation, crash recovery, upgrade, and benchmark regression commands.
- Produce `sql-compatibility-report`, `differential-oracle-report`, `crash-recovery-log`, and `benchmark-summary`.

## Administrator Flow

```bash
evopilot-harness harness validate database-product-harness --json
evopilot-harness harness publish database-product-harness --source harnesses --out published --json
evopilot-harness catalog validate --source published --json
```

Publishing writes `database-product-harness@2.2.0` into the usable Catalog directory. EvoPilot reads that directory dynamically and records the selected Harness in goal plan `selectedHarness`.
