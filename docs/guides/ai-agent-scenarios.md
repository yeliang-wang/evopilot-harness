# AI Agent Scenario Coverage

This matrix is for third-party AI agents that simulate human operation through `evopilot-harness` CLI documentation.

## Scenario Matrix

| Scenario | Actor | Commands | Human stop point | Success evidence |
|---|---|---|---|---|
| Publish existing Harness Catalog and Registry | Agent or admin | `harness list`, `harness validate`, `catalog publish`, `catalog validate`, `registry publish`, `registry validate` | Stop on validation blockers | `status=VALIDATED`, Registry digest, Catalog digest, entry digests |
| One-command source evolution | Agent and admin | `evolve --source-project ... --json` | Stop at `REVIEW_REQUIRED` | source coverage, auto-match decision, draft digest |
| Review-gated evolution | Agent and admin | `evolution create`, `advance`, `review`, `impact`, `approve`, `publish` | Stop before approval | approval actor, confirmation, publication root |
| Attachment-driven evolution | Agent and admin | `evolve --attachment ... --file ... --json` | Stop at draft review | source digests and draft files |
| Production log learning | Agent and admin | `evolve --production-log ... --json` | Stop if sensitive material is still visible | redaction flag, runtime evidence guidance |
| Hub operation | Operator | `hub snapshot`, `hub serve` | Stop if Registry validation fails or Catalog status is not `READY` | `/api/hub/snapshot`, Registry status, Catalog table, Harness cards |
| EvoPilot hand-off | EvoPilot operator | Configure `EVOPILOT_HARNESS_REGISTRY_CONFIG` | Stop if EvoPilot plan lacks `selectedHarness` | EvoPilot `plan.selectedHarness` fields |

## Agent Report Contract

Every completed scenario summary must include:

- command run
- process exit code
- JSON schema and status
- `nextAction`
- source count and source digests when sources were used
- auto-match target Harness, version, confidence, and reasons
- validation blockers
- draft digest and draft directory
- approval actor and confirmation when approval occurred
- publication Harness root, Catalog root, and Registry path when publication occurred
- Registry digest, Catalog id, Catalog digest, and entry digests after publication

## Human Approval

AI agents must not fabricate approval metadata. When a command needs `--confirmed-by` and `--confirmation`, the values must come from a real administrator action.

## Stop Rules

Stop on:

```text
BLOCKED
FAILED
non-zero exit code
validation blockers
missing source file
missing harness-registry.yaml
missing CATALOG.md
missing evopilot-harness-catalog fenced block
nextAction=review-approve-harness
nextAction=repair-draft-validation
```
