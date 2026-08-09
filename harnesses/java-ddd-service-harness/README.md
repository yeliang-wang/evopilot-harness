# Java DDD Service Harness

Baseline for Java enterprise services that use Spring Boot, tactical DDD, hexagonal boundaries, and repository-backed domain workflows.

## Enterprise Knowledge Package

- Architecture: domain/application/infrastructure/interfaces modules, aggregate invariants, repository contracts, and dependency direction.
- API contract: OpenAPI or Problem Details error contract, controller advice mapping, stable domain error codes, idempotency and compatibility gates.
- Exception handling: `@ControllerAdvice`, domain exception hierarchy, repository timeout classification, permission denial, and aggregate invariant regression tests.
- Logs and diagnostics: MDC-based requestId/traceId/spanId, aggregateId, tenant/workspace/project identifiers, JVM diagnostics, thread dump, heap info, and verification commands.
- Observability and APM: Spring Boot Actuator, Micrometer, OpenTelemetry Java instrumentation, Prometheus metrics, JVM health, JDBC pool telemetry, SLO dashboards, and runbooks.
- Evidence and governance: build/test/contract evidence, TargetEvidencePackage, PhasePackage, source closure, release decision, and explicit user/admin review.

## How EvoPilot Uses It

EvoPilot automatically matches this template for Java services when repository/runtime context and the goal loop target indicate DDD, Spring Boot, or enterprise service boundaries. The project profile then maps these controls onto the actual modules, commands, APIs, and evidence paths.
