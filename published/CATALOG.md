# Harness Catalog

This catalog is published by evopilot-harness. EvoPilot reads the fenced catalog block and then loads each published Harness definition by path.

Published Harness count: 9

- api-gateway-harness@2.3.0 (api-gateway)
- database-product-harness@2.3.0 (database-product)
- distributed-cache-harness@0.2.0 (distributed-cache)
- generic-management-software-harness@1.2.0 (management-software)
- go-middleware-harness@1.2.0 (runtime)
- java-ddd-service-harness@1.2.0 (runtime)
- node-saas-control-plane-harness@1.2.0 (runtime)
- observability-apm-harness@1.2.0 (observability-apm)
- python-enterprise-harness@1.2.0 (runtime)

```yaml evopilot-harness-catalog
catalogVersion: 1
catalogId: evopilot-public-harness-catalog
generatedAt: 2026-08-09T05:24:19.115Z
compatibleEvopilot: ">=3.0.0"
entries:
  - name: api-gateway-harness
    version: 2.3.0
    layer: domain
    domain: api-gateway
    status: published
    path: ./api-gateway-harness/2.3.0/template.yaml
    digest: sha256:637e55ca3683a7e9eb0522ac7e9322575a0b05dad3d8330969f8b332fe205e95
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
    version: 2.3.0
    layer: domain
    domain: database-product
    status: published
    path: ./database-product-harness/2.3.0/template.yaml
    digest: sha256:0a9c1424c884b75cb9f4460961b395ab699cc45dfb430e7a34ed109df6ca9963
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
    version: 0.2.0
    layer: domain
    domain: distributed-cache
    status: published
    path: ./distributed-cache-harness/0.2.0/template.yaml
    digest: sha256:9daea6b5e967187f0e1502cb53595bd748491ce533ffd3ad3167233cf31ad9cc
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
    version: 1.2.0
    layer: domain
    domain: management-software
    status: published
    path: ./generic-management-software-harness/1.2.0/template.yaml
    digest: sha256:b59902bad09f9f2fd542fccb1477ed4a33ba98c2dbc95a165088439fa992c096
    tags:
      - generic
      - domain
      - management-software
    matchSummary: Enterprise baseline for management software, workflow systems,
      admin products, reports, imports, exports, and integrations.
  - name: go-middleware-harness
    version: 1.2.0
    layer: runtime
    status: published
    path: ./go-middleware-harness/1.2.0/template.yaml
    digest: sha256:26de1113e842846c4ca491a8293f4327cd361b6451c8b0e9ce96a5f3d072069e
    tags:
      - go
      - runtime
    matchSummary: Enterprise Go baseline for middleware, control-loop, gateway, and
      infrastructure services.
  - name: java-ddd-service-harness
    version: 1.2.0
    layer: runtime
    status: published
    path: ./java-ddd-service-harness/1.2.0/template.yaml
    digest: sha256:2714f53e7de70f574ab2075344df37aa49bdf246ca8ac6042cc8afca963678e2
    tags:
      - java
      - runtime
    matchSummary: Enterprise Java baseline for DDD, Spring Boot, hexagonal services,
      and JVM release governance.
  - name: node-saas-control-plane-harness
    version: 1.2.0
    layer: runtime
    status: published
    path: ./node-saas-control-plane-harness/1.2.0/template.yaml
    digest: sha256:0450e4113c45f469ef6434314df0159ba43f20ee076cba2d488662d722c28103
    tags:
      - node
      - runtime
    matchSummary: Enterprise Node.js baseline for SaaS control planes, API
      platforms, tenant/workspace services, and workers.
  - name: observability-apm-harness
    version: 1.2.0
    layer: domain
    domain: observability-apm
    status: published
    path: ./observability-apm-harness/1.2.0/template.yaml
    digest: sha256:bc0887efe01b1cc7e902ffa6696b089a7486cfa62432068ecb85fdf1ed198f8e
    tags:
      - generic
      - domain
      - observability-apm
    matchSummary: Enterprise baseline for observability platforms, APM systems,
      telemetry pipelines, and alerting/query surfaces.
  - name: python-enterprise-harness
    version: 1.2.0
    layer: runtime
    status: published
    path: ./python-enterprise-harness/1.2.0/template.yaml
    digest: sha256:99e4e6612dd492941cd6540e779fcf20492e6bfd8bbe17790dd568ffa4ab60c0
    tags:
      - python
      - runtime
    matchSummary: Enterprise Python baseline for API services, platform tools, and
      async workers.
```
