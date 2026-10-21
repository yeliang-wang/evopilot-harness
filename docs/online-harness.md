# Online Harness API

For integrators using v0.6 Preview, `createHarnessService(...).online(envelope)` is the owning online API introduced in v0.5. The parent supplies configured providers and the independent worker. Construction, registration and inspection do not select or start monitoring. The [response API](response.md) links retained findings to reviewed guidance and dispositions; alert recovery alone does not establish a verified problem closure.

Import adapter factories and profile types from `@evopilot-next/harness/online`. `createPrometheusCollector` accepts trusted private connection configuration; `createAlertmanagerReceiver` authenticates real receiver traffic before exposing a temporary trusted receipt. Neither callback is accepted through an MCP request. The standalone CLI registers no external provider.

| Operation | Input | Result / boundary |
|---|---|---|
| `online.inspect` | `{}` | Revision, bindings, observation summaries, incidents, pending delivery and limits |
| `online.binding.put` | `{spec}` | Immutable service/deployment/SLO/policy candidate; initially unselected |
| `online.binding.inspect` | `{id}` | Exact review digest, decision and watermarks |
| `online.binding.decide` | `{id,reviewDigest,decision,humanEvidenceRef}` | Exact native decision evidence; no automatic approval |
| `online.binding.select` | `{id,selected}` | Explicit schedule selection; approval required to enable |
| `online.evaluate` | `{id,windowEnd}` | Retained window claim and complete immutable observation |
| `online.observation.inspect` | `{id}` | Measurement and actual native report, including failures |
| `online.tick` | `{}` | Bounded selected-schedule processing and pending finding delivery |
| `online.alert.ingest` | `{sourceId,digest}` | Requires an authenticated trusted receiver receipt; arbitrary JSON claims are rejected |
| `online.finding.inspect` / `online.finding.deliver` | `{id}` | Immutable finding / reconciled Runtime delivery |
| `online.incident.inspect` | `{id}` | Current state and retained history |
| `online.regression.verify` | `{faultId,recoveryId}` | Same-policy actual failure/success comparison, `REVIEW_REQUIRED` |
| `online.receipt.inspect` | `{requestId}` | Original retained mutation receipt |

All envelopes carry explicit `scope: {visibility,projectId}`. `put`, `decide`, `select`, `evaluate`, `alert.ingest` and `regression.verify` also require `requestId` and current online `expectedRevision`. `tick` and `finding.deliver` perform bounded reconciliation of already selected/retained work. A CAS failure is diagnostic, not permission to silently refresh a human decision.

`spec` contains `id`, `serviceId`, `environment`, `deploymentRevision`, `providerId`, `alertSourceId`, `policy`, `slo`, `intervalSeconds`. IDs are bounded slugs. Interval is 1–86400 seconds, no shorter than the SLO slice and an exact multiple of it. See the [normative profile](../specifications/online/v1/README.md) for SLO fields, units, calculations and exclusions. Review evidence follows [native decisions](native-decisions.md), using operation `online.binding.decide`.

Online records share the owner SQLite transaction and protected snapshot, with database marker **4**. Schema-3 and older readers must reject newly written online state. Native and feedback operations cannot downgrade this marker. Same-window retries retain the existing observation; interrupted read-only collection may be repeated for that exact pending window. It does not replay a business Run. Each tick processes at most eight windows per requested scope and reports backlog explicitly. Store limits are finite (6000 records and 10000 audit transitions); hitting them stops progress with diagnostics rather than pruning evidence or claiming health.

Errors include `ONLINE_APPROVAL_REQUIRED`, `ONLINE_POLICY_TARGET_MISMATCH`, `ONLINE_IMMUTABLE_BINDING`, `ONLINE_NOT_SELECTED`, `ONLINE_WINDOW`, `ALERT_UNVERIFIED`, `ALERT_UNAUTHORIZED`, `ALERT_SERVICE_MISMATCH`, and `REVISION_CONFLICT`. Provider auth, timeout, stale/missing sample and resource errors produce incomplete observations or retained delivery diagnostics. HTTP responses and logs never echo credentials or provider response bodies.

The [parent user guide](https://github.com/yeliang-wang/evopilot/blob/main/docs/online-harness.md) explains Codex setup and supervised lifecycle. Standalone SDK users are responsible for equivalent authenticated ingress, selection and stopped-state backup coordination.
