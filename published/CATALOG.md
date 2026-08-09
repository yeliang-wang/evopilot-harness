# Harness Catalog

This catalog is published by evopilot-harness. EvoPilot reads the fenced catalog block and then loads each published Harness definition by path.

Published Harness count: 9

- api-gateway-harness@2.2.0 (api-gateway)
- database-product-harness@2.2.0 (database-product)
- distributed-cache-harness@0.1.0 (distributed-cache)
- generic-management-software-harness@1.1.0 (runtime)
- go-middleware-harness@1.1.0 (runtime)
- java-ddd-service-harness@1.1.0 (runtime)
- node-saas-control-plane-harness@1.1.0 (runtime)
- observability-apm-harness@1.1.0 (runtime)
- python-enterprise-harness@1.1.0 (runtime)

```yaml evopilot-harness-catalog
catalogVersion: 1
catalogId: evopilot-public-harness-catalog
generatedAt: 2026-08-09T03:04:03.789Z
compatibleEvopilot: ">=2.5.0"
entries:
  - name: api-gateway-harness
    version: 2.2.0
    layer: domain
    domain: api-gateway
    status: published
    path: ./api-gateway-harness/2.2.0/template.yaml
    digest: sha256:072bf4b596280523a0085a139ee60e3328abb174d99c5b2178a49b2f85ea107b
    tags:
      - generic
      - domain
      - api-gateway
      - go
      - rust
      - java
      - node
      - api
      - gateway
      - product
      - ingress
      - controller
      - traffic
      - proxy
      - route
      - matching
      - upstream
      - selection
      - rate
      - limit
      - auth
      - policy
    matchSummary: Domain baseline for API gateway products.
  - name: database-product-harness
    version: 2.2.0
    layer: domain
    domain: database-product
    status: published
    path: ./database-product-harness/2.2.0/template.yaml
    digest: sha256:afc90f0f194cfa8dc23ff4b8a3a0d2cd509955e65a7382c2198b2f3a35be2d5e
    tags:
      - generic
      - domain
      - database-product
      - java
      - go
      - rust
      - cpp
      - database
      - product
      - self-developed
      - dbms
      - sql
      - engine
      - storage
      - query
      - optimizer
      - transaction
      - distributed
    matchSummary: Domain baseline for self-developed database products.
  - name: distributed-cache-harness
    version: 0.1.0
    layer: domain
    domain: distributed-cache
    status: published
    path: ./distributed-cache-harness/0.1.0/template.yaml
    digest: sha256:8b29dd4a78d311dcba5b26589edb03a6d7644760dfecb98d68004eb8c078bf56
    tags:
      - generic
      - domain
      - distributed-cache
      - go
      - java
      - rust
      - cpp
      - distributed
      - cache
      - product
      - redis-compatible
      - memcached-compatible
      - key-value
      - store
      - kv
      - ttl
      - eviction
    matchSummary: Domain baseline for self-developed distributed cache and key-value
      storage products.
  - name: generic-management-software-harness
    version: 1.1.0
    layer: runtime
    status: published
    path: ./generic-management-software-harness/1.1.0/template.yaml
    digest: sha256:308fb11cb6f6291b3866ff699ae2ff8f9fcc266dd3b3f6552e30136e33f43947
    tags:
      - generic
    matchSummary: Enterprise baseline for management software, workflow systems,
      admin products, reports, imports, exports, and integrations.
  - name: go-middleware-harness
    version: 1.1.0
    layer: runtime
    status: published
    path: ./go-middleware-harness/1.1.0/template.yaml
    digest: sha256:a1f56ec5a95feebe22aeaed44ba0039d9b6d253525c98ab45854d12c559ed33f
    tags:
      - go
    matchSummary: Enterprise Go baseline for middleware, control-loop, gateway, and
      infrastructure services.
  - name: java-ddd-service-harness
    version: 1.1.0
    layer: runtime
    status: published
    path: ./java-ddd-service-harness/1.1.0/template.yaml
    digest: sha256:52529e1a3070b4e7f7eef8fd8a6f2f3b32fa3e494b52e9bd6c469bd78de9f522
    tags:
      - java
    matchSummary: Enterprise Java baseline for DDD, Spring Boot, hexagonal services,
      and JVM release governance.
  - name: node-saas-control-plane-harness
    version: 1.1.0
    layer: runtime
    status: published
    path: ./node-saas-control-plane-harness/1.1.0/template.yaml
    digest: sha256:cf08fcd7edbf6ac69c09173457d71dff2def503bc50af01e09a4abccf99c8e34
    tags:
      - node
    matchSummary: Enterprise Node.js baseline for SaaS control planes, API
      platforms, tenant/workspace services, and workers.
  - name: observability-apm-harness
    version: 1.1.0
    layer: runtime
    status: published
    path: ./observability-apm-harness/1.1.0/template.yaml
    digest: sha256:5814daadc5e5bddc05e8837fa6c082c910692a4be57e7244c456237daa4e5a4f
    tags:
      - generic
    matchSummary: Enterprise baseline for observability platforms, APM systems,
      telemetry pipelines, and alerting/query surfaces.
  - name: python-enterprise-harness
    version: 1.1.0
    layer: runtime
    status: published
    path: ./python-enterprise-harness/1.1.0/template.yaml
    digest: sha256:0a9c78dabb1b05df00973d2624f533fe164f4862a3900ab07d416e91c093dd4c
    tags:
      - python
    matchSummary: Enterprise Python baseline for API services, platform tools, and
      async workers.
```
