# AI Agent Scenario Coverage

This matrix is for third-party AI agents that simulate human operation through `evopilot-harness` CLI documentation.

## Scenario Matrix

| Scenario | Actor | Commands | Human stop point | Success evidence |
|---|---|---|---|---|
| Publish existing Harness Catalog and Registry | Agent or admin | `harness list`, `harness validate --strict`, `catalog publish --strict`, `catalog validate`, `registry publish`, `registry validate` | Stop on validation blockers | `status=VALIDATED`, template quality scores, Registry digest, Catalog digest, entry digests |
| Single-source detection | Agent and admin | `detect --source-project ... --json` | Stop when `autoMatch.decision=REVIEW_REQUIRED` or a new target needs review | `sourceProfile`, `autoMatch`, parent candidates |
| GitHub repository detection and evolution | Agent and admin | `detect --github-repo ... --json`, then `evolve --github-repo ... --json` | Stop at `REVIEW_REQUIRED`; do not pass raw GitHub tokens | GitHub repository/ref/commit/cache metadata, source profile, auto-match decision, `draft.template.definitionQuality` |
| Batch source detection | Agent and admin | `detect batch --source-root ... --include-modules --json` | Stop after presenting detections; do not publish automatically | detected roles, targets, decisions, confidence |
| Corpus source-root evolution | Agent and admin | `corpus scan`, `corpus plan`, `corpus review`, `corpus approve`, `corpus publish` | Stop before corpus approval | group targets, selected projects, duplicate projects, group validation, publication groups |
| One-command corpus evolution | Agent and admin | `evolve corpus --source-root ... --include-modules --json` | Stop at `REVIEW_REQUIRED` unless explicit approval metadata is supplied | `corpusId`, discovered/evaluated count, duplicate count, group draft digests |
| One-command source evolution | Agent and admin | `detect --source-project ... --json`, then `evolve --source-project ... --json` | Stop at `REVIEW_REQUIRED` | source coverage, source profile, auto-match decision, draft digest |
| Review-gated evolution | Agent and admin | `evolution create`, `advance`, `review`, `impact`, `approve`, `publish` | Stop before approval | approval actor, confirmation, publication root |
| Attachment-driven evolution | Agent and admin | `evolve --attachment ... --file ... --json` | Stop at draft review | source digests and draft files |
| Production log learning | Agent and admin | `evolve --production-log ... --json` | Stop if sensitive material is still visible | redaction flag, runtime evidence guidance |
| Controlled Baseline/Candidate comparison | Digital Expert + Agent + reviewer | MCP `comparison` Plan or `comparison validate|process|report --json` | Stop at `EVIDENCE_REVIEW_REQUIRED`; acknowledge only the exact report | immutable bindings, comparability/strata, paired metrics, uncertainty, conflicts, safety blockers, recommendation, report digest |
| Append-only comparison rescoring | Digital Expert + Agent + reviewer | MCP maintenance Plan or `comparison rescore --json` | Stop for replacement-report review | source/replacement report digests, scorer/policy version, reason, raw/prior mutation flags |
| Matching and Proposal calibration | Digital Expert + Agent + reviewer | MCP `calibration` Plan or `calibration validate|ingest|run|report --json` | Stop at `EVIDENCE_REVIEW_REQUIRED`; never activate policy | independently reviewed cases, policy bindings, ranking, abstention/error rates, regressions, conflicts, uncertainty |
| Hub operation | Operator | `hub snapshot`, `hub serve` | Stop if Registry validation fails or Catalog status is not `READY` | `/api/hub/snapshot`, Registry status, Catalog table, Harness cards |
| EvoPilot hand-off | EvoPilot operator | Configure `EVOPILOT_HARNESS_REGISTRY_CONFIG` | Stop if EvoPilot plan lacks `selectedHarness` | EvoPilot `plan.selectedHarness` fields |

## Agent Report Contract

Every completed scenario summary must include:

- command run
- process exit code
- JSON schema and status
- `nextAction`
- source count and source digests when sources were used
- GitHub source repository, ref, resolved commit, and cache path when `--github-repo` is used
- source profile primary role, recommended Harness, architecture signals, negative signals, and sensitive material findings
- auto-match target Harness, version, confidence, parent candidates, candidate scores, and reasons
- validation blockers
- strict template quality scores when applicable
- draft digest and draft directory
- definition quality objective, focus areas, and non-goals
- for corpus runs: `corpusId`, discovered/evaluated count, duplicate count, every target Harness id, selected projects, duplicate projects, group validation, and group draft digest
- approval actor and confirmation when approval occurred
- publication Harness root, Catalog root, and Registry path when publication occurred
- Registry digest, Catalog id, Catalog digest, and entry digests after publication
- comparison Package/Report identity and digests, exact context and asset bindings, paired count, metrics, strata, uncertainty, conflicts, safety blockers, limitations, recommendation, and authority flags
- rescore source/replacement bindings, scorer and policy versions, reason, and immutable-history proof
- calibration Case Set/Report identity and digests, independent review evidence, policy bindings, ranking, abstention, false-upgrade, false-new-profile, regressions, conflicts, uncertainty, and `activePolicyMutated=false`

## Human Approval

AI agents must not fabricate approval metadata. When a command needs `--confirmed-by` and `--confirmation`, the values must come from a real administrator action.

## Stop Rules

Stop on:

```text
BLOCKED
FAILED
REJECTED
NON_COMPARABLE
NEED_MORE_EVIDENCE
CONFLICT
EVIDENCE_REVIEW_REQUIRED
non-zero exit code
validation blockers
missing source file
missing harness-registry.yaml
missing CATALOG.md
missing evopilot-harness-catalog fenced block
nextAction=review-approve-harness
nextAction=review-approve-corpus-plan
nextAction=review-candidate-match
nextAction=repair-draft-validation
nextAction=repair-corpus-plan-validation
```

Comparison or calibration report acknowledgement records review only. It does not approve or publish a Proposal, activate a policy, authorize rollback, or execute a Harness.
