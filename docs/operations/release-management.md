# Release Management

`evopilot-harness` releases are independent from EvoPilot and Dashboard releases.

## When To Release

Create a new `evopilot-harness` release when any of these change:

- CLI behavior
- Harness Hub behavior
- Catalog contract
- Harness template contract
- source pack content that should be distributed as a tagged baseline
- release artifacts, Docker image, or deployment assets
- public README or technical documentation that defines operating behavior

README-only or docs-only changes can still justify a patch release when they change the documented operating contract.

## Local Release Checks

```bash
npm run check
git diff --check
npm run release:artifact
npm run verify:release-artifact
```

Release artifacts are written to:

```text
dist/release/
```

Required artifacts:

```text
evopilot-harness-<version>-source.tar.gz
evopilot-harness-<version>-sbom.spdx.json
evopilot-harness-<version>-provenance.json
SHA256SUMS
```

## Tag Rule

The release workflow requires the Git tag to match `package.json`:

```text
tag v1.1.0 -> package.json version 1.1.0
```

## GitHub Actions

The release workflow is `.github/workflows/release-artifacts.yml`. On tag push or manual dispatch, it:

1. checks out the tag
2. installs Node.js 22 dependencies
3. verifies the tag and package version match
4. runs `npm run check`
5. builds and pushes a GHCR image
6. builds release artifacts
7. verifies artifacts
8. creates or updates the GitHub Release
9. uploads release artifacts

## Version Guidance

- Patch: docs, CLI documentation, small Hub or validation fixes.
- Minor: new CLI commands, new Hub surfaces, new source types, new template capabilities.
- Major: Catalog contract break, EvoPilot compatibility break, or lifecycle boundary change.

The Registry upgrade that adds `registry publish`, `registry validate`, and Registry-aware Hub snapshots is released as `1.2.0`.
