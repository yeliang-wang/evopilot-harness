# npm First-Publication Release Review

This is the external review checklist for creating `@evopilot/harness` in the public npm Registry exactly once. It does not authorize a release and must not contain an npm token, recovery code, password, private key, or 2FA secret.

## When This Review Applies

Use this review only while an authenticated Registry probe proves that `@evopilot/harness` does not exist. Once the package exists, `.github/workflows/npm-first-publication.yml` must refuse to publish and every later version must use `.github/workflows/npm-packages.yml` with npm Trusted Publishing.

## External Configuration Review

Record evidence, not secret values:

- the separately authorized Git tag and exact package version;
- the npm identity that owns or can publish to the `@evopilot` scope;
- scope-ownership evidence and intended public access;
- npm account 2FA status and recovery ownership;
- a short-lived, least-privilege publish token suitable for the initial package only;
- GitHub Environment `npm-bootstrap`, required reviewers, non-secret variable `NPM_BOOTSTRAP_EXPECTED_IDENTITY`, and secret presence under `NPM_BOOTSTRAP_TOKEN`;
- confirmation that the normal `npm` Environment has no long-lived npm token and is reserved for OIDC Trusted Publishing;
- the Evolution Target release-authorization digest and exact action list.

Do not put these account values into `package.json`, repository files, workflow inputs, logs, issue comments, or the Evolution Target.

## Pre-Publish Gate

From the reviewed tag, require all of the following:

```bash
npm run roadmap:release -- 4.0.2
npm run check
npm run package:workbuddy
npm run release:artifact
npm run verify:release-artifact
npm run package:bootstrap:preflight
git diff --check
```

The last command must return `status: READY` and `packageState: ABSENT`. `BLOCKED`, `FAILED`, a timeout, an authentication problem, or an ambiguous Registry response stops the publication.

## Bootstrap Dispatch

Dispatch `NPM First Publication Bootstrap` only after the separate Release Review authorizes the `npm` action. Supply the exact tag and the confirmation text:

```text
FIRST_PUBLISH @evopilot/harness
```

The workflow runs in the protected `npm-bootstrap` Environment, requires `npm whoami` to match `NPM_BOOTSTRAP_EXPECTED_IDENTITY`, rechecks package absence with authentication, publishes with provenance, and verifies the public package before clean installation.

## Mandatory Closure

After a successful first publication:

1. Verify exact version, dist-tag, integrity, Registry signatures, SLSA provenance, signature audit, CLI, Agent bootstrap, and clean installation evidence.
2. Revoke the Bootstrap token and remove `NPM_BOOTSTRAP_TOKEN` from the `npm-bootstrap` Environment.
3. Configure npm Trusted Publisher for repository `yeliang-wang/evopilot-harness`, workflow `npm-packages.yml`, and GitHub Environment `npm`.
4. Record that subsequent publication is OIDC-only and that the Bootstrap workflow now fails with `PACKAGE_ALREADY_EXISTS`.

GitHub Release, npm publication, optional GHCR publication, and local validation remain separate evidence layers.
