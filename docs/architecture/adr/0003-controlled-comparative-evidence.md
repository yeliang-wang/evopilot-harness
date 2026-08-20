# ADR: Controlled Comparative Evidence And Calibration

## Status

Accepted for Engine v4.1.0.

## Context

`evopilot-harness` can already produce an evidence-linked Harness Asset Delta and require deterministic Evaluation and human review. It previously had no governed way to compare the same task under an immutable Baseline and Candidate, preserve repeated external observations, rescore those observations under a later scorer or policy, or replay matching and Proposal decisions over independently reviewed cases.

External execution results are evidence. They are not an instruction to approve, publish, activate, roll back, or execute a Harness. A valid comparison must therefore preserve exact context, uncertainty, conflicts, and authority boundaries rather than convert a higher score into an automatic lifecycle decision.

## Decision

1. The Engine accepts a versioned `HarnessComparisonEvidencePackage` only after schema, content digest, payload digest, approval, redaction, expiry, provenance, and immutable asset binding validation pass.
2. Baseline and Candidate evidence is comparable only when task, source snapshot, environment, model configuration, toolchain, EvaluationPack, scorer set, metric definitions, and asset bindings satisfy the selected `ComparisonPolicyPack`. Mixed contexts are separated into strata and produce no aggregate metric conclusion.
3. The deterministic scorer reports paired sample counts, wins, losses, ties, missing observations, uncertainty, conflicts, blocking safety regressions, limitations, and exactly one recommendation. It cannot make a universal-quality or causal claim.
4. Accepted packages and generated reports are immutable. Duplicate ingestion is idempotent; a conflicting package id is rejected. Rescoring creates a new report plus an append-only `HarnessComparisonRescoreRecord` bound to the exact source report, package set, scorer algorithm, and policy version.
5. Proposal Review may cite a current comparison report and distinguish expected effect from comparatively supported effect. Proposal approval and publication recompute the bound comparison assessment and fail closed on new evidence, conflict, tamper, or digest drift.
6. A reviewed `HarnessCalibrationCaseSet` may replay Baseline and Candidate matching or Proposal policies. Calibration reports ranking, abstention, false upgrade, false new profile, regressions, conflicts, and uncertainty. It never mutates or activates the candidate policy.
7. Comparison and calibration are available through atomic JSON CLI operations and the local stdio MCP operation protocol. Planned mutations require a confirmed `AgentOperationSession`. Generated reports enter `EVIDENCE_REVIEW_REQUIRED` and require exact report acknowledgement before safe completion.
8. Report acknowledgement proves only that the human reviewed the bound report. It is not Proposal approval, policy activation, rollback authorization, publication authorization, or source execution authorization.

## Added Engine Module Boundaries

| # | Module | Owns | Must not own |
|---|---|---|---|
| 25 | Comparison Evidence Intake/Immutable Store | Package inspection, validation, rejection records, idempotent content-addressed ingestion, provenance and immutable history | Source execution, asset mutation, scoring verdicts, approval, publication |
| 26 | Comparability/Paired Scoring | Exact-context checks, context strata, paired metrics, uncertainty, conflicts, safety blockers, bounded recommendation | Causal or universal claims, human approval, publication, rollback, policy activation |
| 27 | Versioned Rescoring | New scorer/policy binding, replacement chain, new immutable report and append-only rescore record | Raw-observation mutation, prior-report overwrite, active-policy mutation |
| 28 | Matching/Proposal Calibration | Reviewed case-set validation, Baseline/Candidate replay, error rates, abstention, ranking, regression and uncertainty | Creating ground truth from fixtures, changing active policy, automatic domain expansion, approval or publication |

ADR 0001's 24 core Engine modules remain unchanged. These four modules extend the Engine boundary to 28 modules. ADR 0002's five Agent-operation boundaries remain separate, for a total of 33 accepted product and operating boundaries.

## Data And Dependency Direction

```text
Externally produced execution observations
  -> Comparison Evidence Intake/Immutable Store
  -> Comparability/Paired Scoring
  -> immutable Comparison Report
  -> Proposal Review evidence or reviewed Calibration Case Set
  -> Matching/Proposal Calibration
  -> recommendation for a separate policy or asset review
```

Versioned rescoring reads immutable accepted packages and prior reports, then appends a replacement report and rescore record. It never rewrites an earlier node in the chain.

## Security And Authority

- Comparison and calibration modules may read approved, redacted files and Workspace assets. They may not invoke shell commands, build/test/deploy projects, or execute a Harness.
- LLM or semantic review may explain evidence but cannot replace the deterministic comparison recommendation or clear a safety, comparability, uncertainty, conflict, or digest gate.
- Harness Hub projects report status, recommendation, blockers, provenance, limitations, and next actions through a read-only surface. It does not expose raw sensitive observations or acquire mutation authority.
- A rollback recommendation is non-executing. Any future rollback action remains a separately reviewed lifecycle operation.

## Compatibility

- Existing v3/v4 Workspaces, Catalogs, Registry files, Harness assets, Proposals, EvaluationPacks, feedback packages, CLI commands, and Agent sessions remain readable.
- Legacy Proposals without governed comparison evidence remain valid unless an explicitly selected policy requires comparative evidence for their risk class.
- Existing v4 sessions without `evidenceReports` are initialized with an empty collection at runtime; their saved history is not rewritten merely for compatibility.
- The npm runtime package includes the new schemas, policy pack, Engine modules, Digital Expert contract, and MCP operations. It does not include source tests, governance state, or mutable Workspace content.

## Enforcement

- `npm run verify:architecture` checks all 28 Engine module anchors, report authority flags, source-execution prohibition, Catalog-write prohibition, comparison snapshot drift gates, calibration non-mutation, and exact report-review acknowledgement.
- `tests/v4.1.test.mjs` covers comparable improvement, safety regression, published-Candidate rollback recommendation, context mismatch, insufficient samples, immutable conflicts, rescoring history, Proposal binding drift, Advisor contradiction, calibration, CLI, Session resume, and real stdio MCP.
- `npm run package:smoke` installs a clean tarball and runs real comparison and calibration Sessions through the installed MCP process without resolving the source checkout.

## Consequences

- A Candidate can be supported, rejected, or left inconclusive by reproducible evidence without turning evidence into lifecycle authority.
- New scorer and policy versions can reinterpret immutable observations while preserving audit history.
- Calibration can improve matching and Proposal policy quality as reviewed evidence accumulates, without hard-coding domains or treating repository fixtures as production truth.
- v4.1.0 remains a Harness producer and governance system. It does not become a Goal Loop executor, benchmark runner, model trainer, or automatic asset optimizer.
