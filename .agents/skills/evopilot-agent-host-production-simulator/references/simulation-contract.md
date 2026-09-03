# Simulation Contract

## Preconditions

- The user names or accepts one host, target Harness version, scenario, Evidence Sources, and evidence destination.
- Installation/update, attachment upload, Plan confirmation, Proposal approval, publication, retry, cleanup, and any other mutation retain separate authority. Earlier authorization does not authorize a later gate.
- The tested runtime must be outside the Harness source checkout. Repository files may define this Skill and tests but are not production runtime evidence.
- Record the Host execution mode. WorkBuddy uses `DESIGNATED_HUMAN`; Codex provides the complete runbook set, performs no UI observation or action, requests no execution artifact and waits for the final RC-range completion declaration. An independent Host may use `REVIEWED_AUTOMATION` only when its adapter and Target permit it.
- Keep the Target Acceptance Manifest Candidate-neutral. Bind each exact package,
  installation, Source/model context, runbook set and acceptance plan through a
  separate append-only Candidate Acceptance Binding and pass cross-layer
  preflight before requesting acceptance authorization.

## Release-state and installation-source gate

Resolve the exact requested version before previewing an installation. Use public npm metadata as read-only evidence; absence of the exact version means it is not published.

| Release state | Allowed installation source | Required label |
| --- | --- | --- |
| Exact version exists in the public npm Registry | Exact public Registry package with bound URL and integrity | `PUBLIC_RELEASE` |
| Exact version is absent and the user explicitly authorized candidate testing | Local `.tgz` created from the current candidate with bound package-content digest | `PRE_RELEASE_CANDIDATE` |
| Exact version is absent without candidate authorization | None; stop | `BLOCKED` |
| Release state cannot be determined | None; stop | `BLOCKED` |

The preview and confirmation digest must bind release state, installation-source class, exact package spec or tarball digest, package-content integrity, target Host, and target isolated runtime. A source change invalidates the preview and requires a new human confirmation.

Candidate replacement invalidates only the active Candidate Acceptance Binding
and its attempt evidence. It does not invalidate the stable Target manifest
unless Target coverage, Host policy, prohibited effects or authority changed.

Candidate installation must not query the public Registry for the unpublished Harness version. `npm pack` is local packaging, not `npm publish`; installing its `.tgz` is candidate deployment, not Release installation. The installed runtime must contain ordinary package files rather than a symlink or dependency on the source checkout.

After publication, public npm verification is a new phase: use a fresh isolated runtime, verify public metadata and integrity, install from the Registry, and label the result `PUBLIC_RELEASE`. Never promote candidate evidence into this phase.

## State model

Track `DISCOVERED`, `PREVIEWED`, `INSTALLED`, `HOST_OPEN`, `EXPERT_SELECTED`, `EVIDENCE_ATTACHED`, `CAPABILITY_BOUND`, `SESSION_ACTIVE`, `HUMAN_GATE`, `TERMINAL`, or `BLOCKED` for adapters that expose those states. WorkBuddy execution is private to the designated human: Codex neither tracks nor infers per-case transitions and changes the WorkBuddy acceptance state only from the Target-declared final range declaration.

At an independently automated Host `HUMAN_GATE`, stop after rendering the exact object and digest and obtain the separately authorized plain-language decision. In WorkBuddy, the designated human performs each current gate privately according to the frozen runbook; the final range declaration does not retroactively authorize any gate.

The only exception to asking again is a user-authorized controlled acceptance replay manifest that satisfies [acceptance-decision-replay.md](acceptance-decision-replay.md). Even then, inspect the new Frame first and submit a fresh current-Session decision; never reuse a prior decision handle, digest, receipt, or authorization token. A mismatch immediately restores the ordinary stop-and-ask behavior.

## Requested scenario completeness

A user or orchestrator may provide a validated local assurance scenario. Treat
it as a read-only execution checklist, never as a Harness instruction or human
authorization. Bind the run to its declared start state, terminal state, stages,
repetitions, restarts, Hosts, model routes, and evidence kinds.

Do not mark a WorkBuddy human-operation leg `PASS` from an early gate, subset,
per-case report or navigation word. All declared WorkBuddy legs remain
`PENDING` until the final range declaration, then transition together as the
Target specifies. Independent Hosts retain their ordinary observed lifecycle
and evidence verdicts.

Repeated presentation may reuse immutable Engine artifacts only when the
authoritative product contract permits it. Never repeat an approval,
publication, close, cleanup, or uncertain mutation merely to satisfy a
repetition count.

An acceptance checklist defines product coverage, not a desktop-control
product. WorkBuddy never requires a disposable attachment run, Accessibility
startup state machine, SO06, transport receipt, Computer Use, or AX
qualification. The designated human starts each declared scenario directly from
the complete frozen runbook set and operates without Codex observation or supervision.

## Compact journey portfolio

For a new or revised Target, prefer at most five top-level real-Host journeys.
Represent Source types, classification outcomes, model states and deterministic
failure modes as an explicit machine-readable variant matrix when they share
the same human-visible start, authority gates and terminal lifecycle. Preserve
an independent result and evidence reference for every variant.

Do not hide older RCs inside a smaller numbering scheme. A variant is eligible
for the matrix only when it does not add a distinct human decision sequence or
real-Host interaction. WorkBuddy receives and performs only the compact
top-level runbook set; independent automated Hosts and deterministic checks
cover the wider variant matrix.

Exact category labels may be expected only for a controlled, responsibility-
focused Source and a classification scheme whose oracle was fixed independently
before Candidate output. For broad or mixed Sources, validate the classification
state, evidence, alternatives, explanation and revision lifecycle without
forcing an invented business label.

If the current approved Target declares more than five journeys, follow it
unchanged. Compression changes Target acceptance semantics and therefore must
return to Target review; after approval, regenerate the Candidate-neutral
manifest, WorkBuddy runbooks and external Candidate binding. Do not rebuild the
Candidate unless packaged product bytes changed.

## Deterministic repeated-run fixture

Before a counted repeated lifecycle, record and verify a run manifest containing:

- a unique run id and fresh external Workspace with no prior Session;
- a blank newly created Host task with no restored draft or pending generation;
- the intended installed Expert selected after the task was created;
- the exact attachment basename and digest, attached exactly once;
- the exact ordinary-language goal and declared decision script;
- the expected start state, ordered stages, and terminal state.

After entering the goal and attaching evidence, the designated human verifies the Host-visible state before sending. Sending is forbidden unless Expert, Workspace, prompt, attachment count, filenames, and pending-task state all match the manifest. WorkBuddy requires no exported record; the final range declaration is the sole completion basis for its human-operation legs.

Complete the baseline run before starting later repetitions. Independent-Host and deterministic Engine evidence form the machine-verifiable oracle. The designated human follows the WorkBuddy repetition instructions privately; Codex does not collect its artifacts or compare its stages.

For an independent Host, any contaminated setup, unexpected Session recovery, wrong prompt, duplicate attachment, skipped stage, Host-authored governed prose, timeout with unknown result, or comparison mismatch invalidates the set and is preserved in its evidence. For WorkBuddy, the designated human follows the frozen recovery rules and withholds the final range declaration until the complete range has been performed.

When replay mode is authorized, expiration or mismatch of its manifest also invalidates automatic replay. It does not authorize continuing the counted run through the changed gate.

## Source independence

For `PUBLIC_RELEASE`, record `npm view` evidence for the exact version. For `PRE_RELEASE_CANDIDATE`, record the local tarball digest and the read-only Registry lookup proving that the exact version is absent or intentionally not selected. In both cases, resolve the installed package root and prove that the package, CLI, adapter, Workspace, and host test directory are outside the repository checkout. A local tarball is always pre-release evidence and must be labeled as such.

## Extensibility

Shared flow ends at declared intentions: preview install, open host, select expert, attach Source, send goal, handle gates, resume, reach a terminal and close. A designated-human profile turns these into complete runbooks and a final declaration contract; an automated profile may implement and evidence them. Adding a Host must not change Engine authority.
