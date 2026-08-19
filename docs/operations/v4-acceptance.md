# v4.0.0 Acceptance

This page records the required validation surface for the local v4.0.0 candidate. A passing implementation suite does not authorize a Release.

## Deterministic Commands

```bash
npm run roadmap:check
npm run roadmap:release -- 4.0.0 --json
npm run digital-expert:check
node --test tests/v4.test.mjs
npm run verify:architecture
npm run docs:links
npm test
npm run v3:check
npm run check
git diff --check
```

## Covered Evidence

| Area | Evidence |
|---|---|
| Portable expert | Manifest/lock validation, Core digest, five generated Adapters, stale-Adapter rejection |
| Real MCP process | initialize, tool/resource listing, tool calls, protocol mismatch, stdout framing, EOF/SIGTERM/forced stop |
| Network boundary | stdio capability and live process inspection show no TCP listener |
| Session | schema, atomic persistence, compatibility binding, digest drift rejection, stable operation idempotency receipts, cross-Adapter resume, fail-closed process-stop reconciliation, byte-for-byte preservation of incompatible persisted Sessions |
| Human gates | invalid continuation rejected; Plan, Proposal, Review, approval, and publication digests enforced |
| Engine authority | real v3 Engine production, Engine Proposal Review, approval, publication, and Catalog validation |
| Read/write integrity | complete Release-tree, source-tree, and models-file before/after digests; source command sentinel; recursive secret rejection; Workspace-root and internal-symlink confinement for Sessions, receipts, and Engine writes; migration journal identity, digest, and `migrationId` ownership checks before rollback |
| Cleanup | ownership-marked closed-session metadata only; assets, Catalogs, proposals, and sources preserved |
| Compatibility | existing v3 JSON CLI tests, asset validation, Catalog/Registry, migration, feedback, and v3 acceptance suites |
| Independent Adapter | Generic Agent Host and Codex protocol conformance execute equivalent Plans, Engine calls, stop points, and rendered decisions through separate real stdio MCP processes |
| Scenario closure | Versioned scenario matrix executes 10 bound runtime tests and covers 9 Evidence Sources, 8 terminal decisions, 44 Engine operations, and 14 lifecycle branches. Every Evidence Source passes through a real Digital Expert manifest read, stdio MCP process, persistent Session, explicit Plan confirmation, and recorded Engine result. Maintenance operations run through read-only diagnostics, confirmed Plans, or separate publication authorization according to their declared authority. |

WorkBuddy and Claude Code Adapter files are packaged, but actual host support remains capability-gated until those installed hosts pass the same conformance. Do not convert packaged instructions into an unverified runtime-support claim.

The automated v4 Review lifecycle uses a local deterministic HTTP contract reviewer while exercising the real Engine, Session, MCP process, approval binding, publication, and Catalog validation. It does not prove live GLM network connectivity. A production run that requires GLM must separately pass `llm v3-doctor` with the human-maintained model configuration.
