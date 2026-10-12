# Harness 0.1.x roadmap

Harness 0.1.0 implements the approved local scope. This roadmap records current capabilities and remaining boundaries; it does not authorize additional features or assert product acceptance.

## Available capabilities

- Native v1 validation, supplied-evidence evaluation, deterministic delivery construction and verification for Component/Profile/Bundle/EvaluationPack assets.
- [Owned service](service.md) with scoped lifecycle, exact published dependencies, composed evaluation, durable receipts, CAS, restart recovery and inert historical source retention.
- [Independent CLI](cli.md) with read-only discovery and one explicit service request per invocation. It supplies no external Ontology resolver; the parent composition supplies the native published Ontology resolver through the service API.
- [Read-only semantic compatibility](semantic-consumer.md), preserving legacy concept comparison and exact canonical hashes. Unevaluated required relations are explicit `NOT_EVALUATED` constraints and yield `INDETERMINATE` unless concept checks already establish incompatibility.
- A hash-verified archive of 101 public sources. Historical imports reside only in an isolated acceptance workspace and do not become approved or published native assets automatically.

The parent EvoPilot Preview implements the Runtime/Harness/Ontology composition, MCP, Expert and connection support. Installed MCP is passive. Expert is off by default and requires explicit Preview selection and task activation of the current stdio connection, in a namespace separate from the old product. Operator verification covers two adapters sharing one verified daemon, session isolation, CAS, restart receipts and program uninstall preserving workspace data.

The [README](../README.md) records the current passing technical baseline. Service tests (SOURCE-CHECKOUT: `tests/e2e/service.test.mjs`), composition tests (SOURCE-CHECKOUT: `tests/e2e/composed-service.test.mjs`), CLI tests (SOURCE-CHECKOUT: `tests/e2e/cli.test.mjs`) and semantic tests (SOURCE-CHECKOUT: `tests/e2e/semantic-consumer.test.mjs`) cover implemented behavior. Run these tests from a source checkout; installed tarballs omit development scripts/tests. Machine checks, human decisions, evaluation, Runtime business completion and software Release are separate evidence and authority boundaries.

## Remaining scope

Desktop/Host acceptance status is supplied separately in a local report bound to the exact candidate; without that report, no acceptance claim is made. M0 and technical tests do not establish Host acceptance. GitHub execution, stable 1.0, production readiness and software Release are not claimed complete. Retained legacy sources do not demonstrate that all advanced feedback, calibration or matching algorithms have been ported.

Future development is limited to approved 0.1.x real-project feedback. No additional feature scope is proposed here. Existing audit records remain retained externally.
