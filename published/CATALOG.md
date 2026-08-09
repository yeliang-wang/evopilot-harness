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
generatedAt: 2026-08-09T05:24:19.115Z
compatibleEvopilot: ">=3.0.0"
entries:
  - name: api-gateway-harness
    version: 2.2.0
    layer: domain
    domain: api-gateway
    status: published
    path: ./api-gateway-harness/2.2.0/template.yaml
    digest: sha256:ed1b776b195c430e2ea4475fb850ddafb86a20323fb67369cae826ff18668b3a
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
    digest: sha256:8f63149373a7e3339cf19fa52e9a9a9795bef0568b58c4bd233a231115845c6b
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
    digest: sha256:88e728596bc395b592d7fbcbefb81ba15d38a62415168e8d3ec6ccd99a6d4cf0
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
    digest: sha256:567f6fcb97ae4c6b62ea54bae81ef4451c46dbaeeb5e959f7e12cbefece5910f
    tags:
      - generic
    matchSummary: Enterprise baseline for management software, workflow systems,
      admin products, reports, imports, exports, and integrations.
  - name: go-middleware-harness
    version: 1.1.0
    layer: runtime
    status: published
    path: ./go-middleware-harness/1.1.0/template.yaml
    digest: sha256:a1bce5550b01f337c10d3d53c5c0236c1b380ae672c7372153d5cfa4bf8c0ab2
    tags:
      - go
    matchSummary: Enterprise Go baseline for middleware, control-loop, gateway, and
      infrastructure services.
  - name: java-ddd-service-harness
    version: 1.1.0
    layer: runtime
    status: published
    path: ./java-ddd-service-harness/1.1.0/template.yaml
    digest: sha256:2ce7d785fa646f6ca491c2354689c06148e071c11b76d0cf4e0206872f995edd
    tags:
      - java
    matchSummary: Enterprise Java baseline for DDD, Spring Boot, hexagonal services,
      and JVM release governance.
  - name: node-saas-control-plane-harness
    version: 1.1.0
    layer: runtime
    status: published
    path: ./node-saas-control-plane-harness/1.1.0/template.yaml
    digest: sha256:899643201676228935c423146cc20413392280ff201ccfc275fd5e4ad895bbfe
    tags:
      - node
    matchSummary: Enterprise Node.js baseline for SaaS control planes, API
      platforms, tenant/workspace services, and workers.
  - name: observability-apm-harness
    version: 1.1.0
    layer: runtime
    status: published
    path: ./observability-apm-harness/1.1.0/template.yaml
    digest: sha256:2051efbb3096dda596810c48d53b5a949114436c4aac7e0b4f8a1a821df2a91c
    tags:
      - generic
    matchSummary: Enterprise baseline for observability platforms, APM systems,
      telemetry pipelines, and alerting/query surfaces.
  - name: python-enterprise-harness
    version: 1.1.0
    layer: runtime
    status: published
    path: ./python-enterprise-harness/1.1.0/template.yaml
    digest: sha256:9cdf453a0fd3e5069a7cd1e8ebda78ace03a6142b5263e024cf6770b3c01ebc6
    tags:
      - python
    matchSummary: Enterprise Python baseline for API services, platform tools, and
      async workers.
```
