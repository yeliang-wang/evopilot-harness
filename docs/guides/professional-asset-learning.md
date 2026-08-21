# Professional Asset Learning (v4.2 candidate)

Professional Asset Learning turns unresolved governed evidence into reviewable curriculum and completeness evidence. It does not train a model, fetch the web, execute a source project, approve a Proposal, or publish an asset.

## Trust boundary

Network or browser acquisition happens outside the Engine under explicit operator control. The Engine accepts only a static `ResearchEvidencePackage` whose bytes or canonical text, provenance, license, review, redaction, secret scan, trust classification, and digests can be validated. `ResearchAdapterManifest` is declarative: commands, scripts, hooks, modules, URL fetchers, executable expressions, and arbitrary plugins are rejected.

Community input uses `ContributionEvidencePackage`. Contributor provenance, contribution terms, positive and negative cases, duplicate/Catalog-overlap review, false-positive and false-negative considerations, and reviewer evidence remain visible. Acceptance creates evidence only and never writes a Catalog.

## Governed sequence

1. Inspect and validate an adapter, research package, contribution, curriculum entry, or domain/role proposal without mutating the Workspace.
2. Ingest the reviewed document into an append-only, content-addressed store. An identical replay is idempotent; the same immutable id with changed content is rejected.
3. Select exact curriculum entries into an immutable `AssetCurriculumSnapshot` under a policy and time boundary.
4. Bind selected, excluded, missing, and errored evidence plus exact Engine, schema, policy, scorer, environment, Workspace, retry, and receipt state in `EvidenceRunManifest`.
5. Produce a vector `ProfessionalCompletenessReport`. Contract coverage and independently reviewed accuracy remain separate; denominators, missing/error counts, blockers, uncertainty, and limitations remain visible.
6. A later policy may append a report and `ProfessionalCompletenessRescoreRecord`; it cannot rewrite evidence, the run manifest, or a prior report.
7. A `DomainRoleProposal` with domain-positive evidence, a negative boundary, Ontology/Catalog distinction, reviewed positive/negative cases, source diversity, and false-new-profile/false-upgrade analysis may become evidence for the existing `AssetDeltaProposal` lifecycle. It is not a second publication path.

## Agent and WorkBuddy operation

Use the version-matched Digital Expert from the installed npm package and its local stdio MCP command with an external Workspace. Choose the `learning` scenario and provide exact `learning.*` operations. The Session persists the Plan and operation receipts, can resume under another conforming host, and stops on the exact completeness report digest. Review acknowledgement uses `ACKNOWLEDGE_COMPLETENESS_REVIEW:<reportId>:<reportDigest>`; it is not approval, policy activation, or publication authorization.

Release-only WorkBuddy operation must resolve the Adapter, schemas, policy, Engine, and MCP server from the installed package. A source checkout is neither required nor accepted as installed-package evidence.

## Atomic compatibility CLI

The ordinary human path is the Digital Expert. CI and diagnostics may use `learning inspect|validate|ingest|snapshot|run-manifest|score|rescore|artifact` with `--json` and an explicit external `--workspace`. Mutating operations require a confirmed Agent Plan when invoked through MCP.

Existing v3/v4.1 assets, Proposals, Catalogs, comparison/calibration evidence, and Sessions remain readable. New storage is additive under `learning/`; legacy Workspaces are initialized lazily and are not eagerly rewritten.
