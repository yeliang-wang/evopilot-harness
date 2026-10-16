# Native Harness guide and API

The current v0.3 correction uses [Rego v1](https://www.openpolicyagent.org/docs/policy-language), [OPA tests](https://www.openpolicyagent.org/docs/policy-testing) and [Conftest](https://www.conftest.dev/options/) directly. They are upstream language/tool contracts, not an industry-wide standard for all QA/SRE assets. EvoPilot's own package, source, coverage and lifecycle conventions are defined in [specifications/v1](../specifications/v1/README.md).

## Choose the right workflow

For an existing project, freeze a read-only source revision and independently enumerate requirements before extracting rules. For an unimplemented design, freeze the reviewed design instead and retain `design-declaration` evidence. Both workflows use the same public/private package shape; design validation does not imply implementation completion. Expert and Codex are supplied by [parent EvoPilot](https://github.com/yeliang-wang/evopilot).

`examples/native/package.mjs` creates a wholly synthetic illustrative package from the installed standard pins. It demonstrates successful checks, a nonzero test exit, missing evidence and a warning threshold; none of its synthetic assertions represents a real project execution.

Run the complete synthetic lifecycle in an automatically removed temporary Workspace:

```sh
node examples/native/tutorial.mjs /absolute/path/to/verified/native-toolchain.json
```

The tutorial's decision marker applies only to its synthetic fixture. It never supplies a real project's domain approval.

## Installed tools

A trusted host supplies `nativeToolchain` when constructing `createHarnessService`. The constructor uses the canonical `NativeToolchain` contract: exact installation lock, OS/architecture, named `conftest` and `opa` executables/version/SHA256, dependency lock and resource bounds. Versions are Conftest 0.71.1 (embedded OPA 1.21.1) and OPA CLI 1.21.2. These are different engines and both must agree on every supported fixture and observation.

The parent installer creates this lock. Never place executable paths or a replacement capability file in an MCP/package validation request. Commands use argument arrays, a private temporary directory, no shell, a minimal environment, one finite timeout budget shared by the entire validation and bounded output. Each command captures at most 2 MiB and the accumulated output budget is the lower of 2 MiB or one eighth of the installed maximum package size; exceeding a limit produces ERROR with retained output prefixes. `CONFTEST_*` from the user's shell is not inherited. Interpreted capabilities are not an operating-system sandbox. Runtime separately owns business command collection.

## Create and inspect

```js
import { createHarnessService } from '@evopilot-next/harness/service';
import { inspectHarnessStandard } from '@evopilot-next/harness/native';

const standard = inspectHarnessStandard();
const service = createHarnessService(
  { workspaceRoot: absolutePrivateStateRoot, workspaceId: 'my-workspace' },
  { nativeToolchain: trustedInstalledToolchain }
);
service.initialize();
const scope = { visibility: 'private', projectId: 'my-project' };
const revision = service.execute({ operation: 'workspace.inspect', scope, input: {} }).revision;
const receipt = await service.native({
  operation: 'native.package.put', scope,
  input: { package: packageFromReviewedSource },
  requestId: 'put-first', expectedRevision: revision
});
```

`NativePackage` carries `{manifest,files}`: UTF-8 original native files keyed by normalized relative path. The manifest lists every path/content SHA256 and entrypoint, the exact owner standard pins/contract digest and source binding file. All I/O uses these bytes, not arbitrary user-supplied filesystem paths. Unmanifested files, source gaps, reserved directories, case collisions, traversal, missing pointers and byte changes are rejected.

## Standalone CLI

After installing the package, `evopilot-next-harness request --workspace /absolute/private/state --workspace-id my-workspace --toolchain /absolute/verified/native-toolchain.json --request-file /absolute/request.json` routes the same native envelopes to the owning service. The explicit toolchain file is local trusted configuration; package/MCP request fields cannot replace executables. `capabilities` lists current native operations and retained historical readers. New historical `asset.*` writes are refused; exact retained receipts remain readable. See [CLI](cli.md).

## Exact sources and coverage

A source entry contains `id`, `locator`, `revision`, `digest`, `status`, `visibility` and `contentPath`. The content path addresses manifested original UTF-8 bytes beneath `sources/`; a source hash without its original content is insufficient. Each mapping binds `requirementId`, target `ruleId` via `targetId`, `sourceId`, `revision`, `fileDigest`, `selector`, `fragmentDigest`, `status` and, for inference, a nonempty `rationale`.

Selectors are either `{kind:'json-pointer',pointer:'/path'}` or `{kind:'lines',start:1,end:3}`. JSON fragments use `nativeSha256(selectedValue)`. Line fragments use original UTF-8 `split('\n').slice(start-1,end).join('\n')`, retain CR bytes and add no trailing LF; their digest is `nativeBytesDigest(fragment)`. Missing selectors, stale revisions, altered file bytes and incorrect fragment hashes fail before a native policy process runs. Parent independently checks these retained files against the project's frozen source inventory; a self-consistent package alone does not prove extraction completeness.

The schemas for [packages](../specifications/v1/package.schema.json), [source bindings](../specifications/v1/source-bindings.schema.json), [coverage](../specifications/v1/coverage.schema.json), [catalogs](../specifications/v1/rule-catalog.schema.json), [parameters](../specifications/v1/configuration.schema.json) and [observations](../specifications/v1/evidence.schema.json) close structural fields. The owner additionally checks cross-file identities, required sets, declared/query AST identity and native execution. These are explicit EvoPilot adoption rules.

## Operations

The async `service.native(request)` envelope is `{operation,scope,input}`. Mutations add `requestId` and `expectedRevision` and return a durable receipt. Read the global revision again after each mutation; failed claimed operations also retain a receipt and advance it.

| Operation | Input | Result |
|---|---|---|
| `standard.inspect` | `{}` | Actual normative file digest, lock, contract and support matrix |
| `native.package.put` | `{package}` | Draft reference; old validation/decision cleared |
| `native.package.inspect` | `{id,version}` | Exact package and owner state |
| `native.package.list` | `{}` | Scoped native references/publication state |
| `native.package.validate` | `{id,version,observation?,context?}` | Stored raw native report and exact input/configuration identities |
| `native.package.review` | `{id,version}` | Review bound to passing baseline report, package and dependencies |
| `native.package.decide` | `{id,version,reviewDigest,decision,humanEvidenceRef}` | Explicit domain decision |
| `native.package.publish` | `{id,version}` | Immutable exact reviewed reference and package |
| `native.package.readback` | `{id,version}` | Published owner readback |
| `native.receipt.inspect` | `{requestId}` | Retained terminal or unresolved receipt |

A nonterminal receipt has `result: null`; inspect it before reading operation results. `SUCCEEDED` means the owner operation finished: for validation, also require `executionStatus: SUCCEEDED` and `qualityStatus: PASS`. Native errors never become a PASS merely because a receipt exists.

Workflow: **put → validate → review → decide → publish**. Changing rules, evidence baseline, parameters, toolchain or standard cannot inherit an old approval. A published content version is immutable; a later real observation may be validated against it with a separate receipt. Baseline publication review uses the package's own fixed observation and positive/negative tests, independently of Runtime business execution.

## Reports and provenance

`validateNativeHarness(package, trustedToolchain, options)` is a nonpersistent native validation API. It validates every mandatory query and fixed case with both engines. Every catalog `inputRefs` item is an RFC 6901 JSON Pointer. Each rule requires passing, rejecting and missing-input fixtures; `coverage.cases[].missingInputRefs` names pointers that the adapter verifies are actually absent. Missing values must trigger the expected rule rather than silently producing an empty result. OPA AST parsing identifies names; it rejects duplicate test declarations, omitted mandatory queries, reserved packages and skipped tests. Conftest `verify` has no complete successful test IDs and can exit zero on empty or skipped tests; its success alone never suffices. OPA exact IDs and `--fail-on-empty` are also mandatory. `warn` blocks completion.

An observation has `schema`, `origin`, `source:{revision,digest}` and `values`. `execution-result` additionally requires `collectionReceiptRef:{id,digest,claimId}` and `sourceScopeDigest`. These declarations are not credentials: Runtime must read the protected collection receipt and recompute values from raw output before using them for project completion. Synthetic/imported/design observations do not become real execution evidence by passing native rules.

Reports identify each requirement by its source-binding requirement ID and each fixed case by its case ID; an additional `actual-observation` variant reports that requirement’s actual rule outcomes. Every expected variant must be compared against Runtime’s independently frozen denominator.

Optional `context` is the exact Runtime workspace/scope/candidate/claim/input/configuration/source/requirements binding. Its `inputDigest` identifies the Runtime composition; the report separately names `observationDigest`. `effectiveConfigDigest` is `nativeSha256({params: effectiveParameters})`. Missing or mismatched context cannot establish a project completion certificate.

Dependency references are resolved through trusted `resolveNativeDependency`, not through input booleans such as `ontologyPassed`. The result must be the exact published reference in the same workspace and permitted scope. A collection receipt and a later Runtime Run have distinct claim IDs; each remains bound to its own stage, while the source scope must agree.

## Retry, errors and history

A durable RUNNING claim is committed before any native process. Repeating its request ID reads that claim and never redispatches. An interrupted RUNNING receipt is unresolved; it cannot certify completion. A changed request with the same ID fails. Native execution errors/timeouts are separate from completed evaluations reporting quality failures. All raw output and diagnostic states remain visible. Native admission and terminal events form an append-only revision audit; owner Workspace snapshots and signed relocations include native packages, reports, receipts and that audit alongside retained historical data. A copied database missing native rows or containing a changed receipt cannot pass snapshot inspection.

Old `execute` mutation routes return `HISTORICAL_READ_ONLY`; existing exact receipts may be replayed read-only. Historical assets, source bytes and decisions remain queryable. The first corrected-native write marks state schema 2, which old v0.2 readers reject. Restore a consistent historical snapshot when rolling back; do not downgrade a mixed database in place.

## Reproduce tests

```sh
npm ci --ignore-scripts
npm run build
npm run check
EVOPILOT_TEST_NATIVE_TOOLCHAIN=/absolute/path/to/verified/native-toolchain.json npm test
```

The variable supplies host test construction, not a product request. Missing tools fail E2E; tests do not silently skip. Historical fixture writers exist only under `tests/fixtures`, are pinned to the old source commit, and are excluded from installed package files. They construct synthetic historical states for readback/corruption/relocation tests; they do not enable legacy writes in the current service.
