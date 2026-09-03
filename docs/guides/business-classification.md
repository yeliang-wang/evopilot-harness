# Source-first business classification

v4.5 starts an unknown-Source evolution request by answering a user question: “What kind of material is this, and where does it belong in my classification scheme?” Classification is not Harness Eligibility. It is a separate, earlier decision with no Proposal, approval, publication, or Taxonomy-mutation authority.

## User journey

1. The user supplies a static Source path and one user-owned 业务分类方案.
2. The Engine validates and canonicalizes the scheme before reading the Source.
3. Without seeing the selected business labels and without an LLM, the Engine builds an immutable Source concept hypothesis from static files, dependencies, and citations.
4. The classifier records exact, BM25, embedding, structured, and exclusion signals. One configured Advisor call may compare only the bounded candidates and cited evidence.
5. The deterministic Engine presents 业务领域, 产品或系统类型, 分类覆盖情况, reasons, Source clues, alternatives, and one finite next action.
6. A complete match still proves no Harness suitability. Only a separate explicit user choice creates an immutable handoff into the independent retained Harness lifecycle.

The four classification results are:

| User meaning | Internal result | Next action |
|---|---|---|
| The current scheme covers the Source | `TAXONOMY_MATCHED` | Review, then explicitly choose whether to continue to Harness Eligibility. |
| The scheme lacks a suitable category | `TAXONOMY_EXTENSION_SUGGESTED` | Add the proposed name, definition, and parent to the user-owned scheme; explicitly re-analyze. |
| The Source is too weak to classify | `TAXONOMY_EVIDENCE_INSUFFICIENT` | Add static Source evidence; do not add a category yet. |
| Multiple categories remain plausible | `TAXONOMY_AMBIGUOUS` | Clarify the boundary or add discriminating static evidence. |

Mixed axes fold in this order: ambiguity, insufficient evidence, scheme extension, match. Each lower-priority axis remains visible. A failed or uncertain Advisor call returns `ANALYSIS_BLOCKED_ADVISOR` and never silently falls back to a broader result.

## Taxonomy/v1

The resource is data only. It cannot contain code, classifier weights, thresholds, prompts, provider settings, lifecycle decisions, or publication instructions.

```yaml
apiVersion: harness.evopilot.io/v1
kind: Taxonomy
metadata:
  namespace: my-company.engineering
  name: software-classification
  version: 1.0.0
spec:
  engineRange: ">=4.5.0 <4.6.0"
  requiredCapabilities:
    - taxonomy-c14n/v1
    - source-concept-hypothesis/v1
    - open-world-taxonomy-classifier/v1
    - taxonomy-decision-aggregate/v1
  axisPolicies:
    domainCardinality: SINGLE
    productCardinality: SINGLE
  domains:
    - id: technology
      label: 技术领域
      assignable: false
    - id: middleware
      label: 中间件
      definition: 为应用提供通用基础能力的软件领域。
      parents: [technology]
      assignable: true
      positiveEvidenceHints: [cache, message queue, service discovery]
  products:
    - id: infrastructure-system
      label: 基础软件系统
      assignable: false
    - id: distributed-cache
      label: 分布式缓存
      definition: 提供键值缓存、过期、淘汰和复制能力的系统。
      parents: [infrastructure-system]
      assignable: true
      positiveEvidenceHints: [redis, ttl, eviction, replication]
```

The Semantic Foundation defines only the two orthogonal axes and hierarchy/assignability relations. It contains no built-in business values. Different users may use different roots, labels, definitions, depths, and single/multiple cardinality without an Engine release.

## Canonical validation and limits

`taxonomy-c14n/v1` applies NFKC normalization, locale-independent lowercase and whitespace collapse to labels and aliases, and case-preserving NFKC/whitespace normalization to definitions and hints. It sorts nodes, aliases, parents, hints, and capabilities; canonical JSON is RFC 8785 over this bounded data shape and the content is SHA-256 bound.

Validation fails before Source reasoning for an unsupported schema, Engine range or capability set; digest drift; normalized collision; missing parent; cycle; or any exceeded limit:

- 1 MiB document; 8192 nodes total and 4096 per axis; hierarchy depth 32; 262144 closure edges.
- 32 aliases, 8 parents, 32 positive hints, and 32 exclusion hints per node.
- 65536 aliases and 131072 hints in the complete scheme.
- 256 Unicode scalar values per label or alias, 4096 per definition, and 512 per hint.
- 63 ASCII bytes per name, node id, or namespace segment; 253 ASCII bytes for the complete dotted namespace.

## Evidence and authority

A positive match or extension suggestion needs at least two immutable Source citations from two semantically independent non-LLM evidence families. Different projections of the same underlying content do not count twice: for example, a lexical citation and a purpose projection derived from one README form one semantic evidence origin. Test, fixture, example, sample, and vendored paths are low-trust signals and cannot satisfy that minimum. The Advisor cannot supply the minimum, choose the result, add a category, change policy, execute the Source, create a Proposal, approve, or publish. An Advisor contradiction can reject a candidate, but it cannot by itself create a missing category; without an independently corroborated unresolved concept the result remains evidence-insufficient.

The checked-in 48-case Gold evaluation is a bounded release-candidate gate. Its perfect expected-result threshold is not a claim of general production accuracy.
