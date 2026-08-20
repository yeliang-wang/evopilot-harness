# v4.0.2 Acceptance

This page records the required validation surface for the v4.0.2 source candidate. A passing implementation suite does not authorize commit, GitHub Release, npm, GHCR, or deployment.

## Deterministic Commands

```bash
npm run roadmap:check
npm run roadmap:release -- 4.0.2 --json
npm run digital-expert:check
node --test tests/v4.test.mjs
npm run verify:architecture
npm run docs:links
npm test
npm run v3:check
npm run check
npm run package:verify
npm run package:smoke
npm run package:workbuddy
npm run release:artifact
npm run verify:release-artifact
git diff --check
```

## Covered Evidence

| Area | Evidence |
|---|---|
| Portable expert | Manifest/lock validation, Core digest, five generated Adapters, stale-Adapter rejection |
| Real MCP process | standard and optional extended initialize, MCP `2025-11-25`/older negotiation, tool/resource listing, tool calls, protocol mismatch, stdout framing, EOF/SIGTERM/forced stop |
| Network boundary | stdio capability and live process inspection show no TCP listener |
| Session | schema, atomic persistence, compatibility binding, digest drift rejection, stable operation idempotency receipts, cross-Adapter resume, fail-closed process-stop reconciliation, byte-for-byte preservation of incompatible persisted Sessions |
| Human gates | invalid continuation rejected; Plan, Proposal, Review, approval, and publication digests enforced |
| Engine authority | real v3 Engine production, Engine Proposal Review, approval, publication, and Catalog validation |
| Read/write integrity | complete Release-tree, source-tree, and models-file before/after digests; source command sentinel; recursive secret rejection; Workspace-root and internal-symlink confinement for Sessions, receipts, and Engine writes; migration journal identity, digest, and `migrationId` ownership checks before rollback |
| Cleanup | ownership-marked closed-session metadata only; assets, Catalogs, proposals, and sources preserved |
| Compatibility | existing v3 JSON CLI tests, asset validation, Catalog/Registry, migration, feedback, and v3 acceptance suites |
| Independent Adapter | Generic Agent Host and Codex protocol conformance execute equivalent Plans, Engine calls, stop points, and rendered decisions through separate real stdio MCP processes |
| npm package | Curated file manifest, forbidden path and secret scan, exact binary, package bootstrap, clean tarball install, real stdio MCP, no source checkout, and external Workspace boundary |
| WorkBuddy | The actual WorkBuddy CLI currently installed on the acceptance Mac (`2.106.4` for the recorded run) loads the packaged Adapter and project MCP from an isolated local tarball, connects 19 tools, completes one read-only `inspect_capabilities` call with request ids, and does not initialize the Workspace |
| Publication contract | OIDC Trusted Publishing, package/tag/dist-tag binding, provenance, Registry integrity/signatures/attestation, exact public install, and GHCR default-off policy are statically tested; public Registry evidence is still required after publication |
| Scenario closure | Versioned scenario matrix executes 10 bound runtime tests and covers 9 Evidence Sources, 8 terminal decisions, 44 Engine operations, and 14 lifecycle branches. Every Evidence Source passes through a real Digital Expert manifest read, stdio MCP process, persistent Session, explicit Plan confirmation, and recorded Engine result. Maintenance operations run through read-only diagnostics, confirmed Plans, or separate publication authorization according to their declared authority. |

Claude Code remains package-only until an actual host passes conformance. WorkBuddy evidence is bounded to the exact locally installed CLI path and version recorded by the acceptance report, the local v4.0.2 tarball, and the recorded read-only startup scenario. Do not convert it into public npm evidence or an unbounded future-host claim.

The automated v4 Review lifecycle uses a local deterministic HTTP contract reviewer while exercising the real Engine, Session, MCP process, approval binding, publication, and Catalog validation. It does not prove live GLM network connectivity. A production run that requires GLM must separately pass `llm v3-doctor` with the human-maintained model configuration.
