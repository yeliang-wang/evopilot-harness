# Harness Catalog

This catalog is published by evopilot-harness. Each entry has a legacy-compatible template path and a Harness Asset v2 envelope for professional review, provenance, and quality evidence.

Published Harness count: 9
Harness Asset API: evopilot.dev/v2
Minimum quality score: 0.9

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
catalogVersion: 2
catalogId: evopilot-public-harness-catalog
generatedAt: 2026-08-09T05:24:19.115Z
generatedBy: evopilot-harness
release: v4.1.1
assetApiVersion: evopilot.dev/v2
assetKind: HarnessAsset
compatibleEvopilot: ">=3.0.0"
qualityReport:
  schema: evopilot-harness-catalog-quality/v2
  assetCount: 9
  minScore: 0.9
  averageScore: 0.96
  failedAssets: []
entries:
  - name: api-gateway-harness
    version: 2.3.0
    apiVersion: evopilot.dev/v2
    kind: HarnessAsset
    layer: domain
    domain: api-gateway
    status: published
    path: ./api-gateway-harness/2.3.0/template.yaml
    digest: sha256:637e55ca3683a7e9eb0522ac7e9322575a0b05dad3d8330969f8b332fe205e95
    assetPath: ./api-gateway-harness/2.3.0/asset.yaml
    assetDigest: sha256:7d6c4282d4834a48cf36272d9ddabe475a297388b62ac06ce82ed9ccee170422
    qualityScore: 1
    qualityStatus: PASS
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
    provenance:
      generatedBy: evopilot-harness
      generatedAt: 2026-08-09T05:24:19.115Z
      templateDigest: sha256:637e55ca3683a7e9eb0522ac7e9322575a0b05dad3d8330969f8b332fe205e95
  - name: database-product-harness
    version: 2.3.0
    apiVersion: evopilot.dev/v2
    kind: HarnessAsset
    layer: domain
    domain: database-product
    status: published
    path: ./database-product-harness/2.3.0/template.yaml
    digest: sha256:0a9c1424c884b75cb9f4460961b395ab699cc45dfb430e7a34ed109df6ca9963
    assetPath: ./database-product-harness/2.3.0/asset.yaml
    assetDigest: sha256:9a8304227bf7b6a849f1b4774127f9038db68f75022683c8a35acc2ffe0275f8
    qualityScore: 1
    qualityStatus: PASS
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
    provenance:
      generatedBy: evopilot-harness
      generatedAt: 2026-08-09T05:24:19.115Z
      templateDigest: sha256:0a9c1424c884b75cb9f4460961b395ab699cc45dfb430e7a34ed109df6ca9963
  - name: distributed-cache-harness
    version: 0.2.0
    apiVersion: evopilot.dev/v2
    kind: HarnessAsset
    layer: domain
    domain: distributed-cache
    status: published
    path: ./distributed-cache-harness/0.2.0/template.yaml
    digest: sha256:9daea6b5e967187f0e1502cb53595bd748491ce533ffd3ad3167233cf31ad9cc
    assetPath: ./distributed-cache-harness/0.2.0/asset.yaml
    assetDigest: sha256:4a550f4d16fe8cccb6b76ccbf8f360e6469e4751a48152363e9f636b59ccec2c
    qualityScore: 1
    qualityStatus: PASS
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
    provenance:
      generatedBy: evopilot-harness
      generatedAt: 2026-08-09T05:24:19.115Z
      templateDigest: sha256:9daea6b5e967187f0e1502cb53595bd748491ce533ffd3ad3167233cf31ad9cc
  - name: generic-management-software-harness
    version: 1.2.0
    apiVersion: evopilot.dev/v2
    kind: HarnessAsset
    layer: domain
    domain: management-software
    status: published
    path: ./generic-management-software-harness/1.2.0/template.yaml
    digest: sha256:b59902bad09f9f2fd542fccb1477ed4a33ba98c2dbc95a165088439fa992c096
    assetPath: ./generic-management-software-harness/1.2.0/asset.yaml
    assetDigest: sha256:c36d2506a30add81d53c3705dfafaf533eb74dc7394e6a9547b4f1dbb0acde36
    qualityScore: 1
    qualityStatus: PASS
    tags:
      - generic
      - domain
      - management-software
    matchSummary: Enterprise baseline for management software, workflow systems,
      admin products, reports, imports, exports, and integrations.
    provenance:
      generatedBy: evopilot-harness
      generatedAt: 2026-08-09T05:24:19.115Z
      templateDigest: sha256:b59902bad09f9f2fd542fccb1477ed4a33ba98c2dbc95a165088439fa992c096
  - name: go-middleware-harness
    version: 1.2.0
    apiVersion: evopilot.dev/v2
    kind: HarnessAsset
    layer: runtime
    status: published
    path: ./go-middleware-harness/1.2.0/template.yaml
    digest: sha256:26de1113e842846c4ca491a8293f4327cd361b6451c8b0e9ce96a5f3d072069e
    assetPath: ./go-middleware-harness/1.2.0/asset.yaml
    assetDigest: sha256:d6a97b798f140d7cb0f9730bafab337a24efca0d2b3df51142276ca1ef7bdbe6
    qualityScore: 0.9
    qualityStatus: PASS
    tags:
      - go
      - runtime
    matchSummary: Enterprise Go baseline for middleware, control-loop, gateway, and
      infrastructure services.
    provenance:
      generatedBy: evopilot-harness
      generatedAt: 2026-08-09T05:24:19.115Z
      templateDigest: sha256:26de1113e842846c4ca491a8293f4327cd361b6451c8b0e9ce96a5f3d072069e
  - name: java-ddd-service-harness
    version: 1.2.0
    apiVersion: evopilot.dev/v2
    kind: HarnessAsset
    layer: runtime
    status: published
    path: ./java-ddd-service-harness/1.2.0/template.yaml
    digest: sha256:2714f53e7de70f574ab2075344df37aa49bdf246ca8ac6042cc8afca963678e2
    assetPath: ./java-ddd-service-harness/1.2.0/asset.yaml
    assetDigest: sha256:05e9f3f274f39382ad49a18795d8a5acf4c6121ee5878893af75027cc4fd35c1
    qualityScore: 0.9
    qualityStatus: PASS
    tags:
      - java
      - runtime
    matchSummary: Enterprise Java baseline for DDD, Spring Boot, hexagonal services,
      and JVM release governance.
    provenance:
      generatedBy: evopilot-harness
      generatedAt: 2026-08-09T05:24:19.115Z
      templateDigest: sha256:2714f53e7de70f574ab2075344df37aa49bdf246ca8ac6042cc8afca963678e2
  - name: node-saas-control-plane-harness
    version: 1.2.0
    apiVersion: evopilot.dev/v2
    kind: HarnessAsset
    layer: runtime
    status: published
    path: ./node-saas-control-plane-harness/1.2.0/template.yaml
    digest: sha256:0450e4113c45f469ef6434314df0159ba43f20ee076cba2d488662d722c28103
    assetPath: ./node-saas-control-plane-harness/1.2.0/asset.yaml
    assetDigest: sha256:3a786b0339162a9b9d7171a50dc5daf10dc7c4601f9d91e843e284b2533afccc
    qualityScore: 0.9
    qualityStatus: PASS
    tags:
      - node
      - runtime
    matchSummary: Enterprise Node.js baseline for SaaS control planes, API
      platforms, tenant/workspace services, and workers.
    provenance:
      generatedBy: evopilot-harness
      generatedAt: 2026-08-09T05:24:19.115Z
      templateDigest: sha256:0450e4113c45f469ef6434314df0159ba43f20ee076cba2d488662d722c28103
  - name: observability-apm-harness
    version: 1.2.0
    apiVersion: evopilot.dev/v2
    kind: HarnessAsset
    layer: domain
    domain: observability-apm
    status: published
    path: ./observability-apm-harness/1.2.0/template.yaml
    digest: sha256:bc0887efe01b1cc7e902ffa6696b089a7486cfa62432068ecb85fdf1ed198f8e
    assetPath: ./observability-apm-harness/1.2.0/asset.yaml
    assetDigest: sha256:8569ac13e9240480724773709c8f407f4621714e35f0f73bfbb334fc196935e8
    qualityScore: 1
    qualityStatus: PASS
    tags:
      - generic
      - domain
      - observability-apm
    matchSummary: Enterprise baseline for observability platforms, APM systems,
      telemetry pipelines, and alerting/query surfaces.
    provenance:
      generatedBy: evopilot-harness
      generatedAt: 2026-08-09T05:24:19.115Z
      templateDigest: sha256:bc0887efe01b1cc7e902ffa6696b089a7486cfa62432068ecb85fdf1ed198f8e
  - name: python-enterprise-harness
    version: 1.2.0
    apiVersion: evopilot.dev/v2
    kind: HarnessAsset
    layer: runtime
    status: published
    path: ./python-enterprise-harness/1.2.0/template.yaml
    digest: sha256:99e4e6612dd492941cd6540e779fcf20492e6bfd8bbe17790dd568ffa4ab60c0
    assetPath: ./python-enterprise-harness/1.2.0/asset.yaml
    assetDigest: sha256:fbab78b58a4980ab1dc92c42d1ab3af7a8e680ff6c372e70a393e2c669e7b5bb
    qualityScore: 0.9
    qualityStatus: PASS
    tags:
      - python
      - runtime
    matchSummary: Enterprise Python baseline for API services, platform tools, and
      async workers.
    provenance:
      generatedBy: evopilot-harness
      generatedAt: 2026-08-09T05:24:19.115Z
      templateDigest: sha256:99e4e6612dd492941cd6540e779fcf20492e6bfd8bbe17790dd568ffa4ab60c0
```
