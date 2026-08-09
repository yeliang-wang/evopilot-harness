# Go Middleware Harness

Baseline for Go middleware, infrastructure services, gateways, control loops, and reliability-sensitive backends.

## Enterprise Knowledge Package

- Architecture: API, concurrency, storage, network dependency, config reload, controller/control-loop, and operational ownership boundaries.
- API contract: compatibility, idempotency, retry/backpressure behavior, context cancellation, and dependency failure modes.
- Exception handling: panic recovery, context deadline classification, dependency error wrapping, controller reconcile policy, and race/deadlock signals.
- Logs and diagnostics: structured logs with component/controller/resource identifiers, requestId/traceId, pprof snapshots, race output, benchmark/load evidence, and verification commands.
- Observability and APM: OpenTelemetry Go, Prometheus client, pprof, queue/reconcile metrics, goroutine and resource saturation alerts, SLO dashboards, and runbooks.
- Evidence and governance: race/build/test evidence, dependency failure proof, TargetEvidencePackage, PhasePackage, source closure, and ReleaseDecision.

## How EvoPilot Uses It

EvoPilot automatically matches this template for Go middleware or infrastructure projects when project context or the goal target references control loops, gateways, agents, observability components, or reliability-sensitive services.
