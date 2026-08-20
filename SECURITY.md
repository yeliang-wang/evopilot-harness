# Security Policy

## Supported Versions

Security fixes are applied to the latest released version unless maintainers explicitly announce another supported line.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases | No |

The v2 CLI is a compatibility surface inside the current release; historical v2 releases are not a separate supported security line.

## Report A Vulnerability

Do not open a public issue containing exploit details, credentials, private source material, production logs, or sensitive endpoints.

Use the repository's GitHub **Security** tab and **Report a vulnerability** action when it is available. Otherwise, contact the repository owner through a private channel listed on the owner's GitHub profile. Include the affected version, reproduction conditions, impact, and a minimal redacted proof.

Maintainers should acknowledge the report privately, confirm scope, coordinate a fix and release, and publish disclosure details only after affected users have a reasonable upgrade path.

## Sensitive Data Rules

- Never commit `models.json`, API keys, signing private keys, source-project secrets, or unredacted production logs.
- Use a disposable `EVOPILOT_HARNESS_HOME` for tests involving untrusted evidence.
- Treat GitHub repository URLs, attachments, and logs as untrusted evidence inputs.
- Treat Baseline/Candidate comparison packages, metric values, scorer references, and calibration case sets as untrusted until schema, digest, approval, redaction, expiry, provenance, review, and immutable asset bindings pass.
- Do not execute source-project build, test, deploy, or business commands during evidence ingestion.
- Keep Catalog private keys outside the repository and restrict their filesystem permissions.
- Never edit accepted comparison packages or prior reports. Use an append-only rescore record for a reviewed scorer or policy change.
- A Comparison or Calibration Report may recommend review only. Do not wire recommendations or report acknowledgement directly to approval, publication, policy activation, rollback, or execution.

## Package Supply Chain

- Install an exact `@evopilot/harness@<version>`; do not substitute a similarly named package or an unreviewed dist-tag.
- Verify Registry integrity, signatures, provenance, and `npm audit signatures` before treating a public package as a released Engine.
- The default npm publication path uses GitHub OIDC Trusted Publishing. The only token-backed path is the separately reviewed first-publication Bootstrap while the package is absent; use a short-lived, least-privilege token, revoke it immediately after Bootstrap, and never reuse that workflow for later versions.
- Treat the installed package as read-only. Keep Workspaces, user Catalogs, Sessions, evidence, model configuration, credentials, and keys outside the package root.
- Bootstrap reports configuration; it must not edit Codex, WorkBuddy, Claude Code, or another host. Project MCP approval and tool permissions remain host-owned decisions.
- MCP and the Digital Expert are operation surfaces, not sandbox or authentication boundaries. Use host permissions and OS isolation for untrusted environments.

For operational constraints, see [Deployment](docs/operations/deployment.md) and [Troubleshooting](docs/operations/troubleshooting.md).
