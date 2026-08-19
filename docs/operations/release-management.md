# Release Management

Engine releases and user Harness publications are different lifecycles.

| Lifecycle | Versioned unit | Requires GitHub Release |
|---|---|---|
| Engine release | CLI, schemas, algorithms, Hub, packaging, or normative operating contract | Yes, when maintainers choose to publish the change. |
| Harness publication | Component, Profile, Bundle, Packs, Evaluation, or Catalog membership in a user Workspace | No. |
| EvoPilot or Dashboard release | Separate project behavior | No, unless that project also changed. |

Current Engine release: [`v4.0.1`](../releases/4.0.1.md). The `v4.0.0` source tag did not produce a GitHub Release and is superseded. Historical notes are indexed in [Release Notes](../releases/README.md).

## Version Policy

- Patch: backward-compatible fixes or documentation corrections to the current contract.
- Minor: backward-compatible CLI, source, Hub, schema, or lifecycle capabilities.
- Major: incompatible asset, Catalog, Registry, CLI, or ownership-boundary changes.

Asset, Ontology, Policy, Evaluation, and Catalog versions remain independent from this Engine SemVer.

## Prepare A Release

1. Confirm the intended version and release scope.
2. Update `package.json`, `package-lock.json`, `CHANGELOG.md`, and `docs/releases/<version>.md` together when a new version is authorized.
3. Run the complete source and documentation gates.
4. Build and verify release artifacts.
5. Commit and push the exact validated source.
6. Create tag `v<package-version>` at that commit.
7. Let the release workflow publish immutable artifacts and the GitHub Release.

Local gates:

```bash
npm run check
git diff --check
npm run release:artifact
npm run verify:release-artifact
```

## Artifacts

`npm run release:artifact` writes:

```text
dist/release/
  evopilot-harness-<version>-source.tar.gz
  evopilot-harness-<version>-sbom.spdx.json
  evopilot-harness-<version>-provenance.json
  SHA256SUMS
```

Artifact verification checks the expected files, checksums, package metadata, and release provenance. Release source must match the tagged commit.

## Tag And Workflow Contract

The Git tag must exactly match `package.json`:

```text
tag v4.0.1 -> package.json version 4.0.1
```

`.github/workflows/release-artifacts.yml`:

1. checks out the requested tag;
2. installs Node.js 22 dependencies;
3. rejects a tag/package version mismatch;
4. runs `npm run check`;
5. builds and pushes immutable GHCR image tags for version and commit;
6. builds and verifies source, SBOM, provenance, and checksum artifacts;
7. creates or updates the GitHub Release from `docs/releases/<version>.md`;
8. uploads the verified artifacts.

GitHub Release, GHCR publication, and local artifact verification are separate evidence layers. Verify each one before claiming the complete release chain succeeded.

## Local-First Boundary

The default product and release contract is local-first. Docker and Compose are packaging and local operation options. ECS or another production platform is not part of the default release chain and must not be inferred from a GitHub Release or container publication.

No release action is implied by documentation edits. Commit, push, tag, GitHub Release, registry publication, or deployment requires separate explicit authorization.

Every future Engine release still requires its own exact release authorization. npm and remote deployment are not part of v4.0.1.
