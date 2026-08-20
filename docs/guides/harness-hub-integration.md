# Harness Hub

Harness Hub is the standalone browser UI owned by `evopilot-harness`. It reads server-derived Workspace state and can run without EvoPilot or Dashboard.

![Harness Hub v3 assets, proposals, policy packs, and evaluation status](../assets/harness-hub.png)

## Run v3 Locally

```bash
export EVOPILOT_HARNESS_HOME="$HOME/.evopilot-harness"
node src/index.mjs workspace init --workspace "$EVOPILOT_HARNESS_HOME" --json

node src/index.mjs hub v3-serve \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --host 127.0.0.1 \
  --port 4176
```

Open `http://127.0.0.1:4176`.

The Hub exposes:

```text
GET /
GET /api/health
GET /api/hub/snapshot
GET /api/v3/snapshot
```

## What The Hub Shows

- Component, Profile, and Bundle inventory;
- Profile and Bundle Proposals waiting for review;
- Ontology, Matcher Policy, Advisor Policy, Comparison Policy, and Evaluation Pack versions;
- Catalog status, digest, and Workspace location;
- evidence-source types;
- GLM Advisor run count and server-derived token usage;
- feedback Package ingestion counts and rejection reasons;
- latest Outcome, Process, Safety, and Cost effectiveness summary with sample/source counts and uncertainty;
- controlled comparison package/report counts plus latest comparability, recommendation, uncertainty, blockers, limitations, provenance, and next action;
- calibration case/report counts plus latest policy bindings, ranking, abstention/error rates, regressions, conflicts, uncertainty, recommendation, and next action;
- a review-safe `produce` command for the next source input.

The browser is not an independent state store. It does not gain approval or publication authority from browser-local state. Use the CLI and server-side Workspace lifecycle for review, approval, validation, signing, and publication.

Feedback, comparison, and calibration are also read-only in the Hub. The HTTP surface accepts only GET; the browser cannot ingest evidence, acknowledge report review, create or approve a Proposal, activate policy, roll back, publish, or mutate a Harness asset.

The snapshot preserves path context without disclosing host filesystem locations. Paths below the external Workspace use `workspace:///...`; files from the installed package use `package:///...`. Consumers must treat these values as display and provenance references, not local filesystem commands.

## Snapshot For Automation

Write a v3 snapshot without starting the UI:

```bash
node src/index.mjs hub v3-snapshot \
  --workspace "$EVOPILOT_HARNESS_HOME" \
  --out "$EVOPILOT_HARNESS_HOME/cache/hub-snapshot.json" \
  --json
```

Automation should read JSON fields and stop on `nextAction`, review, blocker, evaluation, policy, or approval requirements.

## Dashboard Embedding

Another application may embed the standalone Hub:

```html
<iframe
  title="EvoPilot Harness Hub"
  src="http://127.0.0.1:4176"
></iframe>
```

The embedding application owns navigation and frame layout only. It must not copy Workspace state, implement a second approval path, or mutate Harness assets. EvoPilot project selection and execution evidence still come from EvoPilot, not from the embedded frame.

## Exposure And Security

The default host is loopback. The current standalone server does not establish a shared authentication or tenant boundary for an embedding product. Before binding to a non-loopback interface, place the Hub behind an operator-controlled access boundary and protect the Workspace filesystem.

Do not display or return raw API keys, Catalog private keys, unredacted production logs, or private source excerpts. See [Security](../../SECURITY.md).

## v2 Compatibility

The legacy `hub serve` and `hub snapshot` commands remain available for v2 Catalog automation. Use the [v2 compatibility guide](v2-compatibility.md) rather than mixing v2 snapshot state into v3 Workspace publication.
