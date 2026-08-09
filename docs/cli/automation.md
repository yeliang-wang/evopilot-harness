# EvoPilot Harness CLI Automation

This guide is for WorkBuddy, Codex, Claude Code, other AI agents, and CI jobs that automate `evopilot-harness`.

## Contract

- Use JSON output whenever available.
- Do not parse human-readable CLI output for automation.
- Treat `status`, `blockers`, and `nextAction` as control-flow fields.
- Stop on `BLOCKED`, `FAILED`, validation blockers, missing files, missing Catalog blocks, approval gates, or non-zero exit codes.
- Do not invent administrator confirmations.
- Do not send raw secrets in source material. Redaction is a safety layer, not permission to include secrets.

## Common Parse Fields

| Command | Required Fields |
|---|---|
| `catalog publish --json` | `status`, `catalogId`, `out`, `templateCount`, `entries[]`, `catalogDigest` |
| `catalog validate --json` | `status`, `source`, `entryCount`, `checks[]`, `blockers[]` |
| `harness list --json` | `status`, `source`, `count`, `harnesses[]`, `nextAction` |
| `harness inspect --json` | `status`, `harness`, `template`, `templateDigest`, `paths` |
| `harness validate --json` | `status`, `harnessCount`, `checks[]`, `blockers[]` |
| `evolution create --json` | `evolutionId`, `status`, `sources[]`, `nextAction` |
| `evolution advance --json` | `sourceCoverage`, `autoMatch`, `draft`, `validation`, `nextAction` |
| `evolution approve --json` | `status`, `approval`, `nextAction` |
| `evolution publish --json` | `status`, `publication`, `impactReport`, `nextAction` |
| `evolve --json` | `evolutionId`, `status`, `autoMatch`, `sourceCoverage`, `validation`, `draft`, `publication`, `nextAction` |
| `hub snapshot --json` | `status`, `project`, `catalog`, `harnesses[]`, `evolutions[]`, `sourceTypes[]`, `lifecycleCommands[]` |

## Stop Conditions

Stop and report the current JSON response when any of these are true:

```text
status=BLOCKED
status=FAILED
blockers.length > 0
nextAction=review-approve-harness
nextAction=repair-draft-validation
nextAction=publish-catalog-directory-and-configure-evopilot-catalog-dir
process exit code != 0
```

`nextAction=review-approve-harness` is not an error. It means an administrator must review the generated draft before approval.

## Required Report Fields

Automation summaries must include:

- `evolutionId`
- source count and source digests
- auto-match decision, confidence, target Harness id, target version, and reasons
- validation status and blockers
- draft Harness id, version, digest, and draft path
- approval actor and confirmation when present
- publication Harness id, version, Harness root, and Catalog root when present
- Catalog id, Catalog digest, entry path, and entry digest after publication
- `nextAction`

## EvoPilot Hand-Off

After publication, do not call EvoPilot from this CLI. Report the Catalog directory to the EvoPilot operator:

```text
EVOPILOT_HARNESS_CATALOG_DIRS=/path/to/evopilot-harness/published
```

EvoPilot planning must then report `plan.selectedHarness` from its own API/CLI response.
