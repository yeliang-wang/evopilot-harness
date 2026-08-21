# Release Management

Engine releases and user Harness publications are different lifecycles.

| Lifecycle | Versioned unit | Requires GitHub Release |
|---|---|---|
| Engine release | CLI, schemas, algorithms, Hub, packaging, or normative operating contract | Yes, when maintainers choose to publish the change. |
| Harness publication | Component, Profile, Bundle, Packs, Evaluation, or Catalog membership in a user Workspace | No. |
| EvoPilot or Dashboard release | Separate project behavior | No, unless that project also changed. |

Current published Engine release: [`v4.2.0`](../releases/4.2.0.md). Verify the latest completed GitHub Release and public npm version independently. Implementation and acceptance do not authorize commit, tag, GitHub Release, or npm publication. Container publication and deployment are outside this product's release scope. Historical notes are indexed in [Release Notes](../releases/README.md).

## Current Publication Ledger

| Layer | v4.1.2 evidence | Status |
|---|---|---|
| Source | Tag `v4.1.2` | Published on `main` and bound to the immutable release tag. |
| CI | Commit and tag workflows for `v4.1.2` | Required to complete before release closure. |
| GitHub artifacts | `v4.1.2` source archive, npm tarball, SPDX SBOM, provenance, and checksums | Built and verified by the tag workflow. |
| GitHub Release | [v4.1.2](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v4.1.2) | Published, not draft or prerelease. |
| npm | [`@evopilot/harness@4.1.2`](https://www.npmjs.com/package/@evopilot/harness/v/4.1.2) | Published as `latest` with Registry signatures and SLSA provenance. |
| npm workflow | Trusted Publishing for tag `v4.1.2` | OIDC-only publication with exact-version installation and Agent/MCP smoke. |
| GHCR / remote deployment | Not included in the v4.1.2 authorization | Not published or deployed by this release. |

## Version Policy

- Patch: backward-compatible fixes or documentation corrections to the current contract.
- Minor: backward-compatible CLI, source, Hub, schema, or lifecycle capabilities.
- Major: incompatible asset, Catalog, Registry, CLI, or ownership-boundary changes.

Asset, Ontology, Policy, Evaluation, and Catalog versions remain independent from this Engine SemVer.

## Prepare A Release

1. Confirm the intended version and release scope.
2. Update `package.json`, `package-lock.json`, `CHANGELOG.md`, and `docs/releases/<version>.md` together when a new version is authorized.
3. Run the complete source and documentation gates.
4. Build and verify source, npm, SBOM, provenance, and checksum artifacts.
5. Commit and push the exact validated source.
6. Create tag `v<package-version>` at that commit.
7. Let the release workflow publish immutable artifacts and the GitHub Release.

Local gates:

```bash
npm run check
npm run package:workbuddy
git diff --check
npm run release:artifact
npm run verify:release-artifact
```

## Artifacts

`npm run release:artifact` writes:

```text
dist/release/
  evopilot-harness-<version>-source.tar.gz
  evopilot-harness-<version>.tgz
  evopilot-harness-<version>-sbom.spdx.json
  evopilot-harness-<version>-provenance.json
  SHA256SUMS
```

Artifact verification checks the expected files, checksums, npm allowlist boundary, package metadata, and release provenance. Release source must match the tagged commit.

## Tag And Workflow Contract

The Git tag must exactly match `package.json`:

```text
tag v4.1.2 -> package.json version 4.1.2
```

`.github/workflows/release-artifacts.yml`:

1. checks out the requested tag;
2. installs Node.js 22 dependencies;
3. rejects a tag/package version mismatch;
4. runs `npm run check`;
5. builds and verifies source, npm tarball, SBOM, provenance, and checksum artifacts;
6. optionally builds and pushes immutable GHCR image tags only for a separately authorized manual dispatch with `publish_ghcr=true`;
7. creates or updates the GitHub Release from `docs/releases/<version>.md`;
8. uploads the verified artifacts.

GitHub Release, npm publication, optional GHCR publication, and local artifact verification are separate evidence layers. Verify each one before claiming the complete release chain succeeded.

## npm Trusted Publishing

Public npm uses `.github/workflows/npm-packages.yml` only after a separate release authorization. Before dispatch, confirm namespace ownership for `@evopilot/harness` and bind the npm Trusted Publisher to repository `yeliang-wang/evopilot-harness`, workflow `npm-packages.yml`, and GitHub environment `npm`.

The workflow uses GitHub OIDC, npm `>=11.5.1`, and `npm publish --provenance`. The normal setup-node step omits `registry-url` and `always-auth`; a preflight before any npm Registry command rejects an explicitly supplied `NODE_AUTH_TOKEN`, and no token or secret fallback is allowed. It binds tag, package version, and dist-tag, then verifies Registry identity, integrity, signatures, SLSA provenance, exact install, `npm audit signatures`, bootstrap, and `npx` execution. See [npm Distribution](npm-distribution.md).

npm may expose package metadata before its attestations endpoint is globally readable. If publication succeeded but `npm audit signatures` returns `E404`, do not rerun `npm publish` for the immutable version. Verify the exact package and completed workflow steps, wait for Registry propagation, and repeat only the read-only audit and installation checks.

If the public package does not exist yet, do not weaken the normal workflow. Use the separately reviewed, manual-only `npm-first-publication.yml` Bootstrap once. It fails closed after the package exists and keeps npm identity, scope ownership, 2FA, temporary token, and Environment configuration in the independent [npm First-Publication Release Review](npm-first-publication-review.md). Revoke the temporary token and configure Trusted Publishing immediately after the first publication.

## Local-First Boundary

The default product and release contract is local-first. Docker and Compose are packaging and local operation options. ECS or another production platform is not part of the default release chain and must not be inferred from a GitHub Release or container publication.

No release action is implied by documentation edits. Commit, push, tag, GitHub Release, registry publication, or deployment requires separate explicit authorization.

Every future Engine release still requires its own exact release authorization. npm, GHCR, and remote deployment are separate actions; none is inferred from implementation acceptance or a GitHub Release.
