# npm Distribution And Installed Agent Operation

`@evopilot/harness` is the immutable npm distribution for operating EvoPilot Harness without a repository checkout. It contains the Engine, `evopilot-harness` binary, Digital Expert, Agent Adapters, local stdio MCP server, schemas, required built-in assets, and Harness Hub runtime files. Mutable user state always belongs in an external Workspace.

## Publication State

Source version, GitHub Release, and npm package are separate evidence layers. Container publication and deployment are outside this distribution scope. Before using a public package, verify the exact Registry version:

```bash
npm view @evopilot/harness@4.8.2 version
```

If the command does not return `4.8.2`, that public package is not available. A local `npm pack`, passing test, Git tag, or GitHub Release does not prove npm publication.

The public installation version documented here is `4.8.2`; the [publication ledger](../releases/current-release.md) records verified public availability. Verify npm Registry metadata, signatures, provenance, and the corresponding GitHub Release independently before relying on either distribution layer.

For a new installation, follow [Agent Quickstart](../agent/quickstart.md). The default-branch documentation includes corrections made after 4.8.1 publication; the old README inside the immutable 4.8.1 tarball is not replaced. See [documentation and immutable artifacts](../releases/current-release.md#documentation-and-immutable-artifacts).

The [4.8.3 source candidate](../releases/4.8.3.md) is **UNPUBLISHED; acceptance pending**. Source metadata does not advance the public release pointer or authorize publication. Keep public installation at 4.8.2 until 4.8.3 publication is separately authorized and verified.

To diagnose availability of this exact source candidate version:

```bash
npm view @evopilot/harness@4.8.3 version
```

A missing version means 4.8.3 is not publicly available. This candidate-specific diagnostic does not replace the verified 4.8.2 publication facts in the publication ledger or establish candidate acceptance.

## Promote An Accepted Candidate

The 4.8.1 publication workflows promote the frozen Release Candidate files.
Complete exact installed-Candidate acceptance and the separate Evolution Target
release gate before dispatching either workflow. A successful Candidate build,
artifact digest, or this transport's byte verification is not release authority.

Both `Release Artifacts` and `NPM Package` require the authorized tag,
`candidate_run_id`, `candidate_artifact_digest` (the Actions ZIP's `sha256:`
digest), and `candidate_package_digest` (the accepted npm tarball's `sha256:`
digest). The tag must resolve to the Candidate's exact source commit. The
preflight refuses a failed, expired, foreign, forked or substituted Candidate,
verifies the complete five-file release set and clean source provenance, and
checks the source archive against the checked-out tag. It never runs a build or
packs a new npm archive.

`Release Artifacts` is manual: pushing a tag alone does not publish. It uploads
the accepted files, compares existing assets before resuming, never overwrites
different bytes, and downloads the final release for byte comparison. It does
not publish containers. `NPM Package` keeps the existing `npm` environment and
OIDC Trusted Publishing identity, publishes the verified tarball with lifecycle
scripts disabled, then compares public Registry integrity with that exact
tarball before checking provenance and a fresh public installation. An existing
public version is verified, never replaced. Keep the Candidate artifact until
both independent public distribution checks finish; an expired artifact is a
stop, not permission to rebuild it.

## Choose One Installation Path

### Exact Public Package

Use only after the Registry check succeeds:

```bash
mkdir -p "$HOME/.evopilot-harness-runtime"
cd "$HOME/.evopilot-harness-runtime"
npm init -y
npm install --save-exact @evopilot/harness@4.8.2
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
npm install --save-exact /absolute/package/output/evopilot-harness-4.8.2.tgz
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

`mcp.installedCommand.command` is a bare binary name, so it requires a `PATH` entry in the Host process. With the local npm installation above, use an absolute path to `node_modules/.bin/evopilot-harness`, or copy the exact command and arguments under `mcp.exactNpxCommand`. A relative `./node_modules/.bin` path only works while the process is in the installation directory. Bootstrap supports `codex`, `workbuddy`, `claude-code`, `generic`, and `mcp`; the managed `agent install/status/upgrade/repair/uninstall` commands currently implement WorkBuddy only.

Bootstrap and `agent status` report Harness LLM initialization independently from package installation. An installed expert can therefore report `status=INSTALLED` with `initializationStatus=ACTION_REQUIRED`. After the human edits the external Workspace `models.json` locally, the Digital Expert calls `initialize_model_configuration`. A configuration-only inspection plus a successful minimal live doctor yields `CONFIGURED_AND_VERIFIED` and a secret-free mode-`0600` receipt in the external Workspace. Harness never imports the Agent host's model credential, and an upgrade or repair never overwrites the human-maintained configuration.

## WorkBuddy

The installed package initializes a visible WorkBuddy Digital Expert through WorkBuddy's supported `expert-manager` validation and registration interface. Installation is never implicit in `agent bootstrap`; first preview the exact owned paths and MCP entry, then repeat with the returned digest:

```bash
./node_modules/.bin/evopilot-harness agent install --host workbuddy --workspace "$HOME/.evopilot-harness" --json
# After reviewing the preview, replace <returned-planDigest> with its exact value.
./node_modules/.bin/evopilot-harness agent install --host workbuddy --workspace "$HOME/.evopilot-harness" --confirm '<returned-planDigest>' --json
./node_modules/.bin/evopilot-harness agent status --host workbuddy --workspace "$HOME/.evopilot-harness" --json
```

`upgrade`, `repair`, and `uninstall` use the same preview-bound confirmation. The installer backs up managed configuration, preserves unrelated MCP servers, refuses to replace an unowned conflicting expert, and never removes the external Workspace. WorkBuddy is the first host implementation; the public lifecycle contract is host-neutral so another host can add its own supported adapter without exposing private fields in the core contract.

The detected WorkBuddy desktop app version and its CLI version are separate bindings. The installer checks a known desktop app version against `5.x`; historical CLI evidence such as `2.106.4` does not replace that check or prove current live compatibility. Live Host acceptance remains version-specific; consult the [publication ledger](../releases/current-release.md#acceptance-and-explicit-limits).

WorkBuddy must load the returned `workbuddy` Adapter and configure a project MCP server named `evopilot-harness` using the bootstrap command. Project MCP servers require explicit host approval. In headless mode use WorkBuddy's documented `enableAllProjectMcpServers` or `enabledMcpjsonServers` setting; do not modify user-global configuration during package acceptance.

WorkBuddy may dispatch an MCP call through its built-in `DeferExecuteTool`. A least-privilege read-only startup check permits only `DeferExecuteTool` and `mcp__evopilot-harness__inspect_capabilities`. Do not use `bypassPermissions` as conformance evidence.

The previously recorded WorkBuddy acceptance is bounded to the exact CLI path/version and package version used by that run. The v4.1 release line separately requires clean-tarball installed-package smoke that uses the installed binary and modules to complete real Comparison and Calibration Sessions through stdio MCP, including report review acknowledgement, with no source-checkout resolution. Neither layer proves public npm publication or every future Agent-host version.

## Package Boundary

The allowlist includes runtime code and definitions required by the Engine. It excludes:

- `.git`, `.github`, tests, scripts, governance files, repository `docs/`, and development evidence;
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

The package README links to maintained online documentation because repository `docs/` is excluded. `package:verify` checks local links and image targets in every packed Markdown file against the actual npm file inventory, including package-boundary escapes. A file that exists only in the source tree cannot satisfy this check. External URL availability and heading anchors are outside this local-file gate. Correct future package documentation through a new independently versioned publication; never change an existing tarball, tag or accepted digest.

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
