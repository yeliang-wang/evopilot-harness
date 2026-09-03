---
name: evopilot-agent-host-production-simulator
description: Prepare real third-party Agent-host acceptance for an installed evopilot-harness Digital Expert. WorkBuddy is operated independently by a designated human from complete runbooks and closes only on the human's final RC-range declaration; independent Hosts may use reviewed automation. Use for released packages or explicitly authorized pre-release candidates, never for Harness product reasoning or direct Engine operation.
---

# EvoPilot Agent Host Production Simulator

Prepare the visible human path through a real third-party Agent host. Keep this Skill as a thin runbook and Host-transport layer: the installed Digital Expert and deterministic Engine own all Harness semantics.

## Run

1. Read [the stable Core contract](core/stable-core-contract.md), [the simulation contract](references/simulation-contract.md), [the evidence contract](references/evidence-contract.md), and [the Candidate acceptance-binding contract](references/candidate-acceptance-binding.md). Select the exact Compatibility Adapter and the Candidate-neutral Target manifest whose Target revision and digests match; the current v4.5.0 manifest is [Target revision 15](acceptance/manifests/v4.5.0-target-revision-15.json).
2. For WorkBuddy, read [the WorkBuddy profile](profiles/workbuddy.md) and the compact-journey rules in [the simulation contract](references/simulation-contract.md). Generate or load the complete exact per-case runbook set from the approved Target and exact Candidate formation record; never infer either from the installed Skill's location or a hard-coded Candidate number.
3. Assemble or load the exact external, append-only Candidate Acceptance Binding for those runbooks. Before requesting acceptance authorization, run the deterministic cross-layer preflight for the Target, Target manifest, Candidate package/manifest, installation identity, Source/model bindings, runbook-set manifest and acceptance plan. Do not open an RC batch when this preflight is not `PASS`; after it passes, present all applicable WorkBuddy runbooks to the designated human and stop without observing or operating WorkBuddy.
4. Request no WorkBuddy session, transcript, screenshot, screen recording, log, receipt, digest, per-case report or intermediate acknowledgement. Keep every WorkBuddy human-operation leg `PENDING` until the designated human sends the final declared RC range as completed; then apply the Target's declaration transition exactly.
5. For an independent conformant, deterministic, weak, or hostile Host, reviewed automation may execute the declared adapter without changing Engine semantics or satisfying a WorkBuddy requirement. Before a counted classification journey, run the schema-checked [`project_classification_evidence.mjs`](scripts/project_classification_evidence.mjs) projection preflight and read only the declared current result paths; a runner-side projection correction is append-only and never re-executes the Engine. Once the exact bounded plan is authorized, continue automatically until failure, stale evidence, uncertain mutation or a declared human gate; do not ask again merely to navigate to its next machine step.
6. For a multi-stage independent-Host batch, read [the Acceptance Fast Path](references/acceptance-fast-path.md). Use one external resumable state, reuse completed stages, isolate runner/transport failures from product failures, and validate any authorized conditional decision replay against the fresh current Frame.
7. On interruption, read [failure recovery](references/failure-recovery.md); for fixed and live Source waves read [the Source-wave contract](references/source-wave-contract.md); before retaining artifacts read [security and redaction](references/security-and-redaction.md).

## Canonical source

This repository Skill directory is authoritative. A separately installed copy is a synchronized operating artifact only. Before acceptance, run `scripts/sync_installed_skill.py check --target <installed-skill-path>`; on drift, stop before RC execution and synchronize only under explicit Skill-maintenance authority. Never copy an installed manifest or rule back into the repository without review.

## Authority

- Host interaction is transport. Never rewrite Engine results, infer evidence, approve, publish, mutate policy or construct a human decision.
- “Continue”, “start”, “proceed”, “继续” and “开始” are navigation only—never Plan confirmation, approval, acknowledgement, retry, cleanup or publication authority.
- WorkBuddy human gates are performed independently by the designated human from the frozen runbooks; Codex neither observes them nor asks for intermediate reports. Independent automated Hosts still stop at every exact current human gate required by their adapter.
- Never read, transcribe, paste, store, screenshot, or return API keys, tokens, cookies, credentials, private keys or authorization headers.
- Never execute Source-project commands or modify Evidence Sources, installed Harness packages, model configuration or unrelated Host state.
- For WorkBuddy, Codex never performs or observes visible actions and never requests an execution artifact. A partial message, per-case update or navigation word does not pass the declared range; only the exact final range-completion declaration does. Do not substitute CLI, direct Engine, synthetic Host or independent Host for that declaration.
- A failed Source remains visible and blocking. Do not remove, replace, re-adjudicate, or silently rerun it after Candidate output.
- A runner, projection, Skill-drift or Host-transport failure is not a product failure. Preserve it, apply the exact fast-path failure class, and rerun only the allowed affected scope. A product-behavior failure still requires a new Candidate, impact closure and the complete Target-required matrix.
- Never report 100% pass before every non-WorkBuddy criterion passes independently and the final WorkBuddy range-completion declaration is received.
- Do not perform GHCR publication, deployment, GitHub Release, npm publication, Harness Asset publication, or cleanup without its separate explicit authority.

## Result

For WorkBuddy, return only the Target-declared before/after completion state driven by the designated human's final range declaration; do not create an execution-evidence package. For independent Hosts, produce the declared redacted structured evidence and final `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN` outcome. Neither path grants release authority.
