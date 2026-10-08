# Release Management

Engine releases and user Harness publications are different lifecycles.

| Lifecycle | Versioned unit | Requires GitHub Release |
|---|---|---|
| Engine release | CLI, schemas, algorithms, Hub, packaging, or normative operating contract | Yes, when maintainers choose to publish the change. |
| Harness publication | Component, Profile, Bundle, Packs, Evaluation, or Catalog membership in a user Workspace | No. |
| EvoPilot or Dashboard release | Separate project behavior | No, unless that project also changed. |

The [publication ledger](../releases/current-release.md) records independently
verified public versions, exact tags, immutable artifacts and acceptance limits.
Historical release notes retain their original evidence. Container publication
and remote deployment are outside the Harness release scope.

## Version Policy

- Patch: backward-compatible fixes or documentation corrections to the current contract.
- Minor: backward-compatible CLI, source, Hub, schema, or lifecycle capabilities.
- Major: incompatible asset, Catalog, Registry, CLI, or ownership-boundary changes.

Asset, Ontology, Policy, Evaluation, and Catalog versions remain independent from this Engine SemVer.

## 4.8.3 Candidate Boundary

The [4.8.3 source candidate](../releases/4.8.3.md) is **UNPUBLISHED; acceptance pending**. Keep public installation commands and the publication pointer at 4.8.2 until separately authorized publication is verified. The prior bounded source check passed 627 macOS tests (26 focused); it does not close Candidate or whole-Target acceptance.

The 4.8.3 Target inherits 313 unchanged definitions requiring current item-level impact review, plus six new criteria and three cases. Historical PASS is not transferred. Generated projections from unchanged Core and their verification are separate controlled work; source metadata alone does not establish their completion. No new live Host, model validation, managed enforcement, WorkBuddy qualification or UI acceptance is claimed.

## Prepare A Release

1. Run the Roadmap intent gate and bind an explicitly approved Evolution Target to the current Roadmap digest, finite scope, exact version and acceptance. Implementation approval does not grant release authority.
2. Synchronize package/lock metadata, Digital Expert version projections through `npm run digital-expert:generate`, changelog and versioned release notes. Keep immutable historical evidence unchanged.
3. Run the required checks and commit/push the exact source with its APPROVED Target. Current publication pointers remain tied to verified public state.
4. Dispatch `release-candidate.yml` with the full `commit_sha` and `target_id`. It checks the exact source in a separate worktree and builds the five-file Candidate once from a clean checkout.
5. Download the frozen Candidate, record its run ID, artifact ZIP digest and npm tarball digest, and complete the Target's current installed-artifact acceptance. Passing source tests alone is insufficient.
6. Pass the Target release gate with separate release authorization. Tag `v<package-version>` at the exact accepted Candidate commit.
7. Dispatch GitHub and npm promotion with that tag, `candidate_run_id`, `candidate_artifact_digest` and `candidate_package_digest`. Verify both public results independently before updating the publication ledger.

Required local gates:

```bash
npm run roadmap:check
npm run digital-expert:check
npm run verify:architecture
npm run check
npm run roadmap:release -- 4.8.2
git diff --check
```

Use the authorized version in the last command. WorkBuddy packaging or live Host
checks follow the exact Target scope; generated adapters alone do not establish
live Host acceptance. `npm run release:artifact` and `npm run verify:release-artifact`
are the clean-source builders/verifiers used by Candidate CI, not a permission to
rebuild accepted promotion bytes.

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

The Candidate workflow retains `evopilot-harness-<version>-candidate-release-set`.
Both promotion workflows verify that the successful Candidate run belongs to the
same repository and source commit, and that its unexpired artifact has the exact
five filenames, ZIP/tarball digests, checksums and clean-source provenance.

`.github/workflows/release-artifacts.yml` promotes the accepted files to a stable
GitHub Release using `docs/releases/<version>.md`. It does not rebuild or repack.
An existing asset with different bytes fails; successful publication is followed
by independent downloads and byte comparisons. `.github/workflows/npm-packages.yml`
independently promotes the same accepted npm tarball.

GitHub Release, npm publication and installed-artifact acceptance are separate
evidence layers. An accepted Candidate or one successful publication destination
does not establish the others. Container publication is not part of these workflows.

## npm Trusted Publishing

Public npm uses `.github/workflows/npm-packages.yml` only after a separate release authorization. Before dispatch, confirm namespace ownership for `@evopilot/harness` and bind the npm Trusted Publisher to repository `yeliang-wang/evopilot-harness`, workflow `npm-packages.yml`, and GitHub environment `npm`.

The workflow uses GitHub OIDC, npm `>=11.5.1`, and `npm publish --provenance`. The normal setup-node step omits `registry-url` and `always-auth`; a preflight before any npm Registry command rejects an explicitly supplied `NODE_AUTH_TOKEN`, and no token or secret fallback is allowed. It binds tag, package version, and dist-tag, then verifies Registry identity, integrity, signatures, SLSA provenance, exact install, `npm audit signatures`, bootstrap, and `npx` execution. See [npm Distribution](npm-distribution.md).

npm may expose package metadata before its attestations endpoint is globally readable. If publication succeeded but `npm audit signatures` returns `E404`, do not rerun `npm publish` for the immutable version. Verify the exact package and completed workflow steps, wait for Registry propagation, and repeat only the read-only audit and installation checks.

If the public package does not exist yet, do not weaken the normal workflow. Use the separately reviewed, manual-only `npm-first-publication.yml` Bootstrap once. It fails closed after the package exists and keeps npm identity, scope ownership, 2FA, temporary token, and Environment configuration in the independent [npm First-Publication Release Review](npm-first-publication-review.md). Revoke the temporary token and configure Trusted Publishing immediately after the first publication.

## Local-First Boundary

The default product and release contract is local-first. Docker and Compose are packaging and local operation options. ECS or another production platform is not part of the default release chain and must not be inferred from a GitHub Release or container publication.

No release action is implied by documentation edits. Commit, push, tag, GitHub Release, registry publication, or deployment requires separate explicit authorization.

Every future Engine release requires its own exact release authorization. npm and any remote deployment are separate actions; neither is inferred from implementation acceptance or a GitHub Release.
