# Node SaaS Control Plane Harness

Baseline for Node.js SaaS control planes, API platforms, tenant/workspace services, and worker-backed products.

## Enterprise Knowledge Package

- Architecture: tenant/workspace/RBAC/audit/API/worker boundaries, service/repository split, and queue or background-job ownership.
- API contract: OpenAPI, idempotency, pagination, tenant isolation, error envelope, audit event contract, and compatibility gates.
- Exception handling: NestJS filters or Express middleware, domain/service errors, RBAC denial, tenant isolation violation, queue poison message, and retry policy.
- Logs and diagnostics: JSON logs with requestId, traceId, tenantId, workspaceId, actorId, workerId, queue id, errorCode, nextAction, and verification command.
- Observability and APM: OpenTelemetry JS, pino/winston structured logs, Prometheus metrics, event loop lag, queue lag, worker failure rate, and SLO dashboards.
- Evidence and governance: tenant isolation evidence, RBAC matrix, audit sample, worker evidence, TargetEvidencePackage, PhasePackage, source closure, and ReleaseDecision.

## How EvoPilot Uses It

EvoPilot automatically matches this template when repository/runtime context and goal target text indicate a Node.js SaaS control plane or API/worker system. The project profile maps the generic tenant, RBAC, audit, worker, and observability controls onto the actual codebase.
