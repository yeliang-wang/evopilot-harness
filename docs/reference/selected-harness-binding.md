# Selected Harness Binding

`selectedHarness` is written by EvoPilot, not by `evopilot-harness`.

`evopilot-harness` publishes Catalog entries. EvoPilot reads those entries during goal planning and records the selected entry as evidence.

## Example

```yaml
schema: evopilot-goal-plan-selected-harness/v1
harnessId: distributed-cache-harness
version: 0.1.0
domain: distributed-cache
catalogId: evopilot-public-harness-catalog
catalogDigest: sha256:...
entryPath: ./distributed-cache-harness/0.1.0/template.yaml
entryDigest: sha256:...
selectionReasons:
  - goal mentions cache, ttl, eviction, and failover
  - source metadata matches distributed-cache signals
```

## Reporting Fields

Agents operating EvoPilot after Catalog publication should report:

- `selectedHarness.harnessId`
- `selectedHarness.version`
- `selectedHarness.domain`
- `selectedHarness.catalogId`
- `selectedHarness.catalogDigest`
- `selectedHarness.entryPath`
- `selectedHarness.entryDigest`
- `selectedHarness.selectionReasons`

## Immutability

Existing EvoPilot plans keep the selected Harness digest they used. Republishing a Catalog does not rewrite old plans. New or regenerated plans can bind the newer Harness version.
