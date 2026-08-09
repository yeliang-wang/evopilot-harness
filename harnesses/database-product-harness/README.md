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
evopilot harness template pack validate harness-templates/public/database-product-harness --json
evopilot harness template pack publish harness-templates/public/database-product-harness --json
```

Publishing creates or replaces the control-plane `database-product-harness@2.2.0` version according to server-side RBAC, validation, digesting, persistence, and audit rules.
