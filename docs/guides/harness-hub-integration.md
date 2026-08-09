# Harness Hub Integration

Harness Hub is the standalone browser UI owned by `evopilot-harness`.

## Run Locally

```bash
node src/index.mjs hub serve --catalog published --source harnesses
```

Open:

```text
http://127.0.0.1:4176
```

The Hub serves:

```text
GET /
GET /api/hub/snapshot
```

## Snapshot

Generate a static snapshot:

```bash
node src/index.mjs hub snapshot \
  --catalog published \
  --source harnesses \
  --out ui/harness-hub/catalog-snapshot.json \
  --json
```

The UI first tries `/api/hub/snapshot`. If that request fails, it can read `catalog-snapshot.json`.

## Dashboard Embedding

Dashboard can embed the independent Hub in an iframe:

```html
<iframe
  title="EvoPilot Harness Hub"
  src="http://127.0.0.1:4176"
></iframe>
```

Recommended production shape:

```text
/                  -> evopilot-dashboard
/api/*             -> evopilot-api
/harness-hub/*     -> evopilot-harness-hub
```

Dashboard should only provide navigation and frame layout. Harness UI state belongs to `evopilot-harness`.

## Environment

```bash
EVOPILOT_HARNESS_HUB_HOST=0.0.0.0
EVOPILOT_HARNESS_HUB_PORT=4176
EVOPILOT_HARNESS_CATALOG_ROOT=published
EVOPILOT_HARNESS_SOURCE_ROOT=harnesses
```

## Boundaries

- The Hub can run without EvoPilot.
- The Hub can run without Dashboard.
- The Hub does not call EvoPilot APIs.
- Dashboard must not read local Harness files directly.
- EvoPilot selected Harness evidence should still come from EvoPilot planning responses.
