# Python Enterprise Harness

Baseline for enterprise Python projects such as API services, platform tools, and async workers.

## Enterprise Knowledge Package

- Architecture: layered application/domain/infrastructure boundaries, repository and dependency direction, explicit service readiness.
- API contract: OpenAPI or interface contract, stable error envelope, idempotency and compatibility checks.
- Exception handling: FastAPI exception handlers, ASGI middleware, domain exception mapper, dependency timeout and permission-denial classification.
- Logs and diagnostics: JSON logs with requestId, traceId, spanId, tenantId, workspaceId, projectId, errorCode, rootCauseHint, changed files, failing command, and verification command.
- Observability and APM: OpenTelemetry instrumentation, Prometheus-compatible metrics, health/readiness probes, dependency spans, SLO dashboards, alert routing, and runbooks.
- Evidence and release governance: command evidence, TargetEvidencePackage, PhasePackage, source closure, release decision, no silent active selected Harness binding mutation.

## How EvoPilot Uses It

During project onboarding, EvoPilot detects Python project context and goal loop target text, then automatically matches this template when it is the best baseline. The generated selectedHarness plan binding explains how the specific project implements or extends these controls.
