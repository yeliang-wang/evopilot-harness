# Native standard adoption

This table is generated from support-matrix.json. Rego/Conftest are upstream formats and tools; package, source, parameter and project coverage files are EvoPilot conventions, not a universal industry Harness standard.

| ID | Adopted meaning | Status | Tests |
|---|---|---|---|
| rego-v1 | Rego v1 native policy and strict compilation | SUPPORTED | H_NATIVE_POLICY, H_STRICT |
| conftest-results | deny/violation/warn and fail-on-warn=true | SUPPORTED | H_NATIVE_CASES, H_WARN_BLOCK |
| native-tests | Conftest verify plus exact OPA test IDs and fail-on-empty | SUPPORTED | H_TEST_IDS, H_TEST_EMPTY, H_TEST_SKIP, H_TEST_DUPLICATE |
| capabilities | Explicit pure builtin allowlist and allow_net=[] | RESTRICTED | H_CAPABILITY_NETWORK, H_CAPABILITY_CLOCK |
| input-format | One manifested normalized JSON observation; JSON parameter data | RESTRICTED | H_OBSERVATION, H_CONFIGURATION |
| namespace | Literal namespaces and complete catalog matched to upstream AST | RESTRICTED | H_CATALOG, H_NAMESPACE |
| source-coverage | EvoPilot source provenance and mandatory requirements closure | SUPPORTED | H_SOURCE, H_REQUIREMENTS, H_SOURCE_FRAGMENT, H_MISSING_INPUT |
| project-parameters | EvoPilot typed bounded parameter schema, no implicit defaults | RESTRICTED | H_PARAMETERS |
| native-network | Policy HTTP/DNS/network or automatic policy updates | UNSUPPORTED | H_CAPABILITY_NETWORK |
| legacy-json | Old JSON rule operators for new writes | UNSUPPORTED | H_LEGACY_WRITE |
| policy-exceptions | Exceptions, omitted mandatory queries or skipped cases | UNSUPPORTED | H_TEST_SKIP, H_CATALOG |

Unknown or unsupported executable behavior is rejected; parser acceptance alone does not imply adoption. All mandatory native rules and fixed positive/negative cases must execute. Never interpret Conftest successes as business coverage.
