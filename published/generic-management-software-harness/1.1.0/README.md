# Generic Management Software Harness

Baseline for enterprise management software, admin consoles, workflow systems, reporting platforms, import/export systems, and integration-heavy business tools.

## Enterprise Knowledge Package

- Architecture: user, role, permission, workflow, approval, audit, reporting, import/export, integration, and background job boundaries.
- API and business contract: RBAC matrix, record-level and field-level rules, workflow state machine, approval transitions, idempotency, import validation, export authorization, and report reconciliation.
- Exception handling: business rule violation, permission denial, workflow transition denial, import row failure, integration failure, report mismatch, and user-action mapping.
- Logs and diagnostics: structured audit and business event logs with tenant/workspace/actor/role/businessObject/recordId/workflowState/errorCode fields.
- Observability and APM: workflow transition metrics, approval latency, import failure rate, report reconciliation delta, permission denial count, business event traces, alerts, and runbooks.
- Evidence and governance: RBAC proof, workflow case, audit sample, report reconciliation, integration proof, TargetEvidencePackage, PhasePackage, source closure, and ReleaseDecision.

## How EvoPilot Uses It

EvoPilot automatically matches this template when project context or goal target text indicates management software, business workflows, admin systems, reporting, approvals, import/export, or enterprise integrations.
