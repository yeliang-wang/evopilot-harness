# OpenSLO v1 implementation profile

This additive online profile uses [OpenSLO v1](https://github.com/OpenSLO/OpenSLO/blob/e0259752f252276485cfa2708dac2db00c2f3464/website/docs/specification.md) at the pinned upstream revision recorded in [sources.json](sources.json). It does not replace the immutable corrected native [specifications/v1](../../v1/README.md). Native policy packages still use Rego v1 and the pinned OPA/Conftest toolchain.

The [schema](profile.schema.json), [example](example.json) and provenance are hashed in [manifest.json](manifest.json). This is a bounded implementation profile, **not full OpenSLO compliance**. Provider-specific `metricSource.spec` properties are an EvoPilot convention permitted by the extensible OpenSLO data-source definition.

## Supported configuration

- `apiVersion: openslo/v1`, `kind: SLO`; one service and one inline ratio indicator.
- One `good` and one `total` Prometheus metric source. Each declares `query`, `freshnessQuery` and `unit` (`events` or `events_per_second`). Both units must match. Queries should retain the exact `service`, `environment` and `deployment` labels.
- One rolling window with a positive integer duration and `s`, `m`, `h`, `d` or `w` suffix. Maximum 30 days. No implicit numeric duration.
- `budgetingMethod: RatioTimeslices`; one objective with fractional `target` in `[0,1)` and a `timeSliceWindow`. A window must contain 2–2048 complete slices; slice size is at most one hour and divides the window exactly.
- Unknown fields, calendar windows, `targetPercent`, composite objectives, other budgeting methods and other providers are rejected.

For a window ending at `E`, duration `W` and step `S`, queries cover `E-W+S, …, E` inclusive: exactly `W/S` points. The measured SLI is the **arithmetic mean of each complete slice's good/total ratio**, matching OpenSLO RatioTimeslices. It is not a ratio of accumulated counts. A zero denominator, negative value, good greater than total, missing sample, non-finite value, unexpected labels, stale source timestamp or partial-provider warning yields `INCOMPLETE`, with no measured ratio or healthy verdict.

Configuration and measurement are distinct records. A schema-valid SLO contains no assertion that the service meets its objective. The owner retains the four actual Prometheus response digests, sample values, source timestamps, window, binding digest and diagnostic codes. `freshnessQuery` must expose the original source sample timestamp, for example `timestamp(service_probe_success{...})`; query evaluation timestamps alone do not establish freshness. Freshness tolerance is explicit private server configuration, bounded to 1–300 seconds.

## Service and policy binding

Each immutable binding identifies a service, environment, deployment revision, provider ID, Alertmanager source ID and a published native Harness policy reference. That reference pins its package, corrected-v1 standard and contract. The native policy must declare `onlineTarget` equal to the OpenSLO target and a mandatory ratio rule. A different deployment, threshold or policy requires a new binding and exact review; old evidence is preserved.

The native observation has origin `runtime-observation`, source revision equal to the deployment revision, source digest equal to the retained measurement digest, and `values.online` containing ratio, target, window boundaries, service/environment/deployment and binding/measurement digests. Both the core objective comparison and native validation must pass. Actual OPA/Conftest command receipts remain attached to each result.

## Provider and scope limits

Prometheus uses only `GET /api/v1/query_range` at a configured origin. HTTPS is required except numeric loopback HTTP. Redirects are rejected. Each query has a five-second deadline, 1 MiB response bound and explicit 2048-sample ceiling. Credentials are private server-side file references, never SLO or policy contents.

Alertmanager uses the authenticated default v4 webhook format tested with 0.28.1. Batches contain at most 128 alerts and must be untruncated, with exact service/environment/deployment labels. Its fingerprint plus start time correlates an alert episode. Repeated and out-of-order firing/resolved events cannot erase a newer recovery. The managed receiver binds numeric loopback only; remote ingress/TLS is user operated and outside this Preview.

The supported adapter targets and upstream protocol links are in [sources.json](sources.json). A Prometheus-compatible implementation is not presumed supported without testing. Source naming, units, thresholds and business applicability require project-specific review.

## Evidence and lifecycle

Harness owns bindings, windows, incidents and regression evidence. Runtime receives trusted findings as `REVIEW_REQUIRED` repair candidates. A Warning or finding cannot select a patch version, approve a Target, deploy a service, weaken a rule or mutate Ontology. A regression comparison must retain actual same-policy native failure and later native success; publication of changed rules still uses the normal reviewed native lifecycle.

See the [online API](../../../docs/online-harness.md) and [synthetic native policy](../../../examples/native/online-package.mjs). The sample threshold is illustrative, not a production commitment.
