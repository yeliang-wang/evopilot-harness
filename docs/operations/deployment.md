# Deployment

## v3 Runtime Layout

The container treats `/app` as the Engine and `/data` as `EVOPILOT_HARNESS_HOME`. The entrypoint initializes missing bootstrap assets in `/data` and serves Harness Hub v3. Persist `/data`; Harness assets, evidence, feedback Packages/Reports, proposals, policies, evaluations, signatures, and Catalog versions must survive Engine image upgrades.

```bash
docker compose up -d
curl http://127.0.0.1:4176/api/health
curl http://127.0.0.1:4176/api/v3/snapshot
```

Do not bake a production `models.json` or signing private key into the image. Mount or provision them in the writable runtime boundary with appropriate permissions.

Harness Hub can run as a local process, Docker container, or Compose service.

## Local Process

```bash
npm install
export EVOPILOT_HARNESS_HOME="$HOME/.evopilot-harness"
node src/index.mjs workspace init --workspace "$EVOPILOT_HARNESS_HOME" --json
node src/index.mjs hub v3-serve --workspace "$EVOPILOT_HARNESS_HOME" --host 127.0.0.1 --port 4176
```

Open:

```text
http://127.0.0.1:4176
```

## Docker

Build locally:

```bash
docker build -t evopilot-harness:local .
docker volume create evopilot-harness-data
docker run --rm --read-only --tmpfs /tmp \
  -p 4176:4176 \
  -v evopilot-harness-data:/data \
  evopilot-harness:local
```

The container runs:

```text
node scripts/container-entrypoint.mjs
```

The entrypoint initializes `/data` when needed and serves Hub v3 on `0.0.0.0:4176`. The image root filesystem is read-only; only the mounted `/data` Workspace and `/tmp` tmpfs are writable.

## Compose

```bash
docker compose up -d
docker compose ps
```

Default image:

```text
ghcr.io/yeliang-wang/evopilot-harness:4.0.1
```

This is the latest published image after the tag workflow and immutable digest are verified. Do not use the failed `4.0.0` source tag. v4 ordinary operation is local-first through stdio MCP; no remote production deployment is part of the default release contract.

Override image and port:

```bash
EVOPILOT_HARNESS_IMAGE=evopilot-harness:local \
EVOPILOT_HARNESS_HUB_PORT=4176 \
docker compose up -d
```

## Health

```bash
curl -fsS http://127.0.0.1:4176/api/health
curl -fsS http://127.0.0.1:4176/api/v3/snapshot
```

The snapshot response should include:

```text
schema=evopilot-harness-hub-snapshot/v3
status=READY
catalog.entryCount > 0
assetCounts.HarnessComponent > 0
assetCounts.HarnessProfile > 0
assetCounts.HarnessBundle > 0
```

## Dashboard Reverse Proxy

Recommended path layout:

```text
/                  -> evopilot-dashboard
/api/*             -> evopilot-api
/harness-hub/*     -> evopilot-harness-hub
```

Keep Harness Hub deployment independent. Dashboard embeds it; it does not own Hub state.
