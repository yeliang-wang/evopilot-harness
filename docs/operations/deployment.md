# Deployment

Harness Hub can run as a local process, Docker container, or Compose service.

## Local Process

```bash
npm install
node src/index.mjs hub serve --host 127.0.0.1 --port 4176 --catalog published --source harnesses
```

Open:

```text
http://127.0.0.1:4176
```

## Docker

Build locally:

```bash
docker build -t evopilot-harness:local .
docker run --rm -p 4176:4176 evopilot-harness:local
```

The container runs:

```text
node src/index.mjs hub serve --host 0.0.0.0 --port 4176 --catalog published --source harnesses
```

## Compose

```bash
docker compose up -d
docker compose ps
```

Default image:

```text
ghcr.io/yeliang-wang/evopilot-harness:1.1.0
```

Override image and port:

```bash
EVOPILOT_HARNESS_IMAGE=evopilot-harness:local \
EVOPILOT_HARNESS_HUB_PORT=4176 \
docker compose up -d
```

## Health

```bash
curl -fsS http://127.0.0.1:4176/api/hub/snapshot
```

The snapshot response should include:

```text
schema=evopilot-harness-hub-snapshot/v1
status=READY
catalog.entryCount > 0
```

## Dashboard Reverse Proxy

Recommended path layout:

```text
/                  -> evopilot-dashboard
/api/*             -> evopilot-api
/harness-hub/*     -> evopilot-harness-hub
```

Keep Harness Hub deployment independent. Dashboard embeds it; it does not own Hub state.
