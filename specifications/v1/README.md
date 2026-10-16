# Harness native v1

Harness owns SRE/QA delivery criteria expressed in native Rego v1 and evaluated by OPA/Conftest. It does not execute Maven, deployments or arbitrary shell recipes; Runtime owns approved collection and protected evidence receipts.

[Adoption and limits](adoption.md) · [support matrix](support-matrix.json) · [layout](directory-layout.json) · [conformance cases](conformance-cases.json) · [re-extraction](re-extraction.md) · [native API](../../docs/native-harness.md).

## Content

UTF-8 policy/*.rego is authoritative; policy/*_test.rego uses stable test_ID names. The catalog indexes exact data.namespace.rule queries, source IDs, quality domain, targets, observation/parameter refs and mandatory positive/negative case IDs. Parameters live once in data/*.json under params and are bounded by parameter-schema.json. Frozen conftest.toml and a pure capabilities allowlist prevent ambient shell or policy execution changes.

Source bindings distinguish observed/inferred, bind exact source revision/digest and map every mandatory requirement to rules and fixtures. Public and private assets use the same standard. The author cannot establish project completeness by shrinking the package requirements: Runtime independently fixes that denominator.

## Validation and outputs

Manifest paths/content hashes → source and coverage closure → upstream OPA AST/catalog/test identity → strict compile → Conftest verify → OPA exact test ID report → locked positive/negative fixtures in both engines → actual observation in both engines. Any missing, skipped, duplicated, erroneous or inconsistent result fails. Warnings block; ordinary log WARN text only matters if an explicit project rule interprets it.

Reports retain native stdout/stderr, exit/signal/timeout, effective configuration, exact toolchain/standard/package digests and optional Runtime context. A synthetic/imported observation never proves actual source execution. Dependencies require trusted owner readback; caller supplied ontologyPassed is not used.

Lifecycle: put → validate → review → explicit decide → immutable publish/readback. Every mutation has CAS and idempotent durable receipts. RUNNING after interruption is unresolved and replay does not redispatch. Legacy JSON assets are historical read-only.
