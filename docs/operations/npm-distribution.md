# npm Distribution And Installed Agent Operation

`@evopilot/harness` is the immutable npm distribution for operating EvoPilot Harness without a repository checkout. It contains the Engine, `evopilot-harness` binary, Digital Expert, Agent Adapters, local stdio MCP server, schemas, required built-in assets, and Harness Hub runtime files. Mutable user state always belongs in an external Workspace.

## Publication State

Source version, GitHub Release, and npm package are separate evidence layers. Container publication and deployment are outside this distribution scope. Before using a public package, verify the exact Registry version:

```bash
npm view @evopilot/harness@4.2.0 version
```

If the command does not return `4.2.0`, that public package is not available. A local `npm pack`, passing test, Git tag, or GitHub Release does not prove npm publication.

For the current release, the command returns `4.2.0`; npm reports it as `latest` with Registry signatures and SLSA provenance. The corresponding [GitHub Release](https://github.com/yeliang-wang/evopilot-harness/releases/tag/v4.2.0) remains a separate distribution layer.

## Choose One Installation Path

### Exact Public Package

Use only after the Registry check succeeds:

```bash
mkdir -p "$HOME/.evopilot-harness-runtime"
cd "$HOME/.evopilot-harness-runtime"
npm init -y
npm install --save-exact @evopilot/harness@4.2.1
./node_modules/.bin/evopilot-harness --version --json
```

### Local Release Tarball

Use this for release-candidate acceptance before public npm publication:

```bash
cd /absolute/path/to/evopilot-harness
npm run package:verify
npm pack --pack-destination /absolute/package/output

mkdir -p "$HOME/.evopilot-harness-runtime"
cd "$HOME/.evopilot-harness-runtime"
npm init -y
npm install --save-exact /absolute/package/output/evopilot-harness-4.2.1.tgz
./node_modules/.bin/evopilot-harness --version --json
```

### Source Checkout

Use a checkout for development and repository validation:

```bash
npm ci
npm run check
node src/index.mjs --version --json
```

Do not present source-checkout validation as installed-package evidence.

## Bootstrap An Agent Host

Run bootstrap from the installed package:

```bash
./node_modules/.bin/evopilot-harness agent bootstrap \
  --host workbuddy \
  --workspace "$HOME/.evopilot-harness" \
  --json
```

The result is read-only. It reports:

- exact package name, version, root, and distribution mode;
- packaged Adapter path and SHA-256;
- Product, Expert, Core, Agent protocol, and Engine API compatibility;
- supported MCP protocols;
- installed and exact version-pinned `npx` MCP commands;
- canonical external Workspace path and authority boundary.

Bootstrap never edits Agent configuration or initializes the Workspace. The Agent loads the returned Adapter and starts the exact MCP command. Its first product call is `inspect_capabilities`; it compares the Engine result with the Adapter before calling `prepare_workspace`.

## WorkBuddy

The installed package initializes a visible WorkBuddy Digital Expert through WorkBuddy's supported `expert-manager` validation and registration interface. Installation is never implicit in `agent bootstrap`; first preview the exact owned paths and MCP entry, then repeat with the returned digest:

```bash
evopilot-harness agent install --host workbuddy --workspace "$HOME/.evopilot-harness" --json
evopilot-harness agent install --host workbuddy --workspace "$HOME/.evopilot-harness" --confirm 'sha256:<planDigest>' --json
evopilot-harness agent status --host workbuddy --workspace "$HOME/.evopilot-harness" --json
```

`upgrade`, `repair`, and `uninstall` use the same preview-bound confirmation. The installer backs up managed configuration, preserves unrelated MCP servers, refuses to replace an unowned conflicting expert, and never removes the external Workspace. WorkBuddy is the first host implementation; the public lifecycle contract is host-neutral so another host can add its own supported adapter without exposing private fields in the core contract.

WorkBuddy must load the returned `workbuddy` Adapter and configure a project MCP server named `evopilot-harness` using the bootstrap command. Project MCP servers require explicit host approval. In headless mode use WorkBuddy's documented `enableAllProjectMcpServers` or `enabledMcpjsonServers` setting; do not modify user-global configuration during package acceptance.

WorkBuddy may dispatch an MCP call through its built-in `DeferExecuteTool`. A least-privilege read-only startup check permits only `DeferExecuteTool` and `mcp__evopilot-harness__inspect_capabilities`. Do not use `bypassPermissions` as conformance evidence.

The previously recorded WorkBuddy acceptance is bounded to the exact CLI path/version and package version used by that run. The v4.1 release line separately requires clean-tarball installed-package smoke that uses the installed binary and modules to complete real Comparison and Calibration Sessions through stdio MCP, including report review acknowledgement, with no source-checkout resolution. Neither layer proves public npm publication or every future Agent-host version.

## Package Boundary

The allowlist includes runtime code and definitions required by the Engine. It excludes:

- `.git`, `.github`, tests, scripts, governance files, and development evidence;
- user Organization Catalogs, published Workspace state, and Sessions;
- source projects, attachments, logs, and feedback payloads;
- `models.json`, API keys, tokens, credentials, private keys, and signatures;
- generated Registry and Catalog snapshots that belong to a user Workspace.

Validate the packed file manifest and secret/path policy with:

```bash
npm run package:verify
npm run package:smoke
```

`package:smoke` installs the tarball in a clean temporary directory and verifies CLI, bootstrap, Digital Expert, stdio MCP, tools/resources, external Workspace, shutdown, source-checkout exclusion, controlled Comparison processing, Calibration replay, and digest-bound evidence report acknowledgement.

## Trusted Publishing

`.github/workflows/npm-packages.yml` is the separately dispatched publication workflow for every version after the package exists. The npm Trusted Publisher must be bound to:

- repository `yeliang-wang/evopilot-harness`;
- workflow `npm-packages.yml`;
- GitHub environment `npm`.

The workflow uses GitHub OIDC and `npm publish --provenance`. Its `actions/setup-node` step deliberately omits `registry-url` and `always-auth`, so setup-node cannot inject the placeholder `NODE_AUTH_TOKEN` that conflicts with npm Trusted Publishing. A preflight runs before any npm Registry command and rejects any explicitly supplied `NODE_AUTH_TOKEN`; there is no secret or token fallback. Stable versions use `latest`; `alpha`, `beta`, and `rc` versions use matching dist-tags. After publication it verifies exact identity/version, dist-tag, integrity, Registry signatures, SLSA provenance, `npm audit signatures`, clean exact-version installation, bootstrap, and `npx` execution.

Registry metadata and the attestations endpoint can propagate at different times. During v4.1.1 publication, OIDC publish, metadata verification, and exact install succeeded, but the immediate signature audit received a transient attestations-endpoint `E404`; an independent audit passed after propagation. Treat this as a post-publication verification failure, not permission to republish the immutable version. See [Troubleshooting](troubleshooting.md#npm-audit-signatures-returns-e404-after-publication).

Publication still requires an approved Evolution Target release gate and separate user authorization. The workflow contract does not grant release authority.

## One-Time First Publication

npm cannot bind a Trusted Publisher to a package that does not exist yet. While an authenticated Registry probe proves `@evopilot/harness` is absent, `.github/workflows/npm-first-publication.yml` provides one explicit Bootstrap path:

- manual dispatch only, with exact package confirmation;
- protected GitHub Environment `npm-bootstrap` with a reviewed `NPM_BOOTSTRAP_EXPECTED_IDENTITY` variable;
- short-lived `NPM_BOOTSTRAP_TOKEN` exposed only to identity check, absence preflight, and publish;
- a package-existence preflight that returns `BLOCKED` as soon as any public version exists;
- the same provenance, Registry identity, integrity, signature, attestation, and clean-install verification as normal publishing.

The npm account, organization or scope, 2FA, token, GitHub Environment reviewers, and Trusted Publisher configuration are external release configuration. They require the independent [npm First-Publication Release Review](npm-first-publication-review.md) and are not created or stored by this repository.

After Bootstrap, revoke the token, remove the secret, configure the Trusted Publisher, and use only `npm-packages.yml`. A successful Bootstrap does not authorize another release.

See [Agent Quickstart](../agent/quickstart.md), [MCP Reference](../agent/mcp-reference.md), [Security](../../SECURITY.md), [Troubleshooting](troubleshooting.md), [Release Management](release-management.md), and [npm First-Publication Release Review](npm-first-publication-review.md).
