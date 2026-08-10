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
| `harness validate --json` | `status`, `harnessCount`, `strict`, `quality[]`, `checks[]`, `blockers[]` |
| `detect --json` | `status`, `sourceCoverage`, `sourceProfile`, `autoMatch`, `nextAction` |
| `detect batch --json` | `status`, `discoveredCount`, `evaluatedCount`, `detections[]`, `nextAction` |
| `corpus scan --json` | `status`, `sourceRoot`, `discoveredCount`, `evaluatedCount`, `groups[]`, `nextAction` |
| `corpus plan --json` | `corpusId`, `status`, `discovery`, `duplicateCount`, `groups[]`, `validation`, `nextAction` |
| `corpus approve --json` | `corpusId`, `status`, `approval`, `nextAction` |
| `corpus publish --json` | `corpusId`, `status`, `publication`, `nextAction` |
| `evolution create --json` | `evolutionId`, `status`, `sources[]`, `nextAction` |
| `evolution advance --json` | `sourceCoverage`, `sourceProfile`, `autoMatch`, `draft`, `validation`, `nextAction` |
| `evolution approve --json` | `status`, `approval`, `nextAction` |
| `evolution publish --json` | `status`, `publication`, `impactReport`, `nextAction` |
| `evolve --json` | `evolutionId`, `status`, `sourceProfile`, `autoMatch`, `sourceCoverage`, `validation`, `draft`, `publication`, `nextAction` |
| `evolve corpus --json` | `corpusId`, `status`, `discovery`, `duplicateCount`, `groups[]`, `validation`, `publication`, `nextAction` |
| `hub snapshot --json` | `status`, `project`, `catalog`, `harnesses[]`, `evolutions[]`, `corpora[]`, `sourceTypes[]`, `lifecycleCommands[]` |

## Stop Conditions

Stop and report the current JSON response when any of these are true:

```text
status=BLOCKED
status=FAILED
blockers.length > 0
nextAction=review-approve-harness
nextAction=review-approve-corpus-plan
nextAction=review-candidate-match
nextAction=repair-draft-validation
nextAction=repair-corpus-plan-validation
nextAction=publish-catalog-directory-and-configure-evopilot-catalog-dir
nextAction=publish-registry-and-configure-evopilot
process exit code != 0
```

`nextAction=review-approve-harness` is not an error. It means an administrator must review the generated draft before approval.
`nextAction=review-approve-corpus-plan` has the same meaning for grouped corpus drafts.

## Required Report Fields

Automation summaries must include:

- `evolutionId`
- source count and source digests
- `sourceProfile.primaryRole`, recommended Harness id, architecture signals, negative signals, and sensitive material findings
- auto-match decision, confidence, target Harness id, target version, parent candidates, candidate scores, and reasons
- validation status and blockers
- strict template quality scores when validation is run with `--strict`
- draft Harness id, version, digest, and draft path
- approval actor and confirmation when present
- publication Harness id, version, Harness root, Catalog root, and Registry file when present
- for corpus runs: `corpusId`, source root, discovered/evaluated count, duplicate count, group count, every target Harness id, selected project count, duplicate project count, and group validation status
- Registry digest, Catalog id, Catalog digest, entry path, and entry digest after publication
- `nextAction`

## EvoPilot Hand-Off

After publication, do not call EvoPilot from this CLI. Report the Registry file to the EvoPilot operator:

```text
EVOPILOT_HARNESS_REGISTRY_CONFIG=/path/to/evopilot-harness/harness-registry.yaml
```

EvoPilot planning must then report `plan.selectedHarness` from its own API/CLI response.
