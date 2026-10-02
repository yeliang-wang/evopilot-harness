# Current published release: evopilot-harness 4.8.1

Verified publication date: **2026-10-02**. This page records the completed
release and approved acceptance scope. The [publication evidence](../../governance/releases/semantic-convergence-20261002-publication.json)
binds exact tags, immutable artifact digests, package integrity and acceptance.

## Public distribution

- [GitHub Release v4.8.1](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v4.8.1): public stable release, five frozen assets verified.
- [npm @evopilot/harness@4.8.1](https://www.npmjs.com/package/@evopilot/harness/v/4.8.1): exact-version fresh installation, Registry signatures/provenance and local stdio MCP verified.
- Tag source: `6afda3bc4f118b5f966eaa7e1a970387a97785a6`.

Harness distribution is GitHub Release, npm and local stdio MCP. Container or
remote-service deployment is outside this release scope. Semantic asset versions
remain independent; `TerminalSemanticClosure.version=4.8.0` is unchanged.

## Acceptance and explicit limits

The approved acceptance scope is **1103/1103 PASS with NO_REGRESSION**:
Harness 303, Runtime 400, and Expert 400. The terminal series journey used real
Codex execution, independent business/Harness validation, Target completion and
exact receipt readback after Runtime restart. Its demonstration Goal was **one
of four Targets complete**, not whole-Goal completion.

Real Host acceptance is Codex-only. A new 90-minute soak and Runtime/Expert
native credential entry, submission and cancellation were explicitly excluded
and remain `SKIPPED_BY_USER_NOT_PASS`. Existing configuration was reused. Other
live Hosts, cross-Host equivalence and long-duration stability are not claimed.

## Documentation and immutable artifacts

Current installation and operating guidance lives on the repository's default
branch. This documentation correction follows publication; existing tags,
source archives, npm tarballs and their embedded README copies remain immutable.
It does not rebuild, republish or change product behavior. Historical release
and Candidate notes preserve their original evidence and are not current
installation instructions.
