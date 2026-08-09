# API Gateway Harness

Domain-first executable HarnessTemplate for API gateway products.

Use this pack when EvoPilot is onboarding a gateway, ingress, traffic proxy, or service-mesh gateway product that needs route, upstream, policy, plugin, protocol, load, and observability evidence.

## Layers

- Domain: `api-gateway`
- Compatibility: `http-gateway`, `ingress-compatible`, `envoy-compatible`
- Architecture: `edge-gateway`, `service-mesh-gateway`, `multi-tenant-gateway`
- Runtime: `go`, `rust`, `java`, `node`, `generic`

## Project Required Actions

- Declare the gateway product boundary and reference project roles.
- Map listener, route, upstream, policy, plugin, and protocol boundaries to repository paths.
- Bind route contract and policy matrix commands.
- Bind plugin lifecycle, hot reload, failure isolation, and load regression commands.
- Produce `route-table`, `policy-matrix`, `plugin-report`, and `load-summary`.

## Administrator Flow

```bash
evopilot harness template pack validate harness-templates/public/api-gateway-harness --json
evopilot harness template pack publish harness-templates/public/api-gateway-harness --json
```
