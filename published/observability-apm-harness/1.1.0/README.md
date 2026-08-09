# Observability APM Harness

Baseline for observability platforms, APM systems, telemetry collectors, metric/log/trace pipelines, alerting, and query/storage surfaces.

## Enterprise Knowledge Package

- Architecture: collector, ingestion, processor, exporter, storage, query, alerting, dashboard, and UI/API boundaries.
- Signal contract: traces, metrics, logs, profiles, events, resource attributes, context propagation, semantic conventions, schema compatibility, cardinality, and retention.
- Exception handling: malformed payload, collector receiver/processor/exporter failure, storage timeout, query timeout, alert route failure, data drop, and partial ingestion.
- Logs and diagnostics: pipeline/signal/component/tenant fields, droppedCount, cardinality budget evidence, retention proof, rule validation, dashboard export, and replayable telemetry samples.
- Observability and APM: OpenTelemetry Collector, Prometheus, SkyWalking-style APM, Grafana LGTM-style split signals, ingestion/query/storage/alert SLOs, and runbooks.
- Evidence and governance: telemetry sample evidence, alert/runbook evidence, TargetEvidencePackage, PhasePackage, source closure, and ReleaseDecision.

## How EvoPilot Uses It

EvoPilot automatically matches this template when a repository or goal target describes observability, APM, metrics, traces, logs, collectors, dashboards, or alerting. Current project profile generation binds one selected public HarnessTemplate plus active tenant/workspace policies; normal operators do not select this template manually.
