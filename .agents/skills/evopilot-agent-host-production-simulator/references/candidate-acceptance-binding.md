# Candidate Acceptance Binding

Keep the Target Acceptance Manifest stable for the lifetime of one approved
Target revision. It binds Target identity, coverage, Host policy, extension
requirements, prohibited effects and authority boundaries. It must not contain
a Candidate id, package digest, installation identity or attempt status.

The current manifest schema is `evopilot-real-host-acceptance-manifest/v3` and
contains no `candidate` object. An already-bound v2 manifest may be resumed
only when its candidate object is generic `EXTERNAL_CANDIDATE_BINDING`
metadata with no Candidate id or digest. A v2 manifest pinned to Candidate
bytes is invalid and must not open a new batch.

Create one external `evopilot-candidate-acceptance-binding/v1` record for each
Candidate attempt. Store it in the authorized acceptance evidence directory,
never in the installed Skill or product repository. The record binds:

- the exact Target and Target-manifest digest;
- Candidate id, package and candidate-manifest digests, release-state label and
  proof that a source checkout is not the runtime;
- exact runbook-set and acceptance-plan files plus any Source portfolio, model
  route, installation-tree or selection artifacts required by the Target;
- bounded continuation policy and all retained authority stops;
- append-only lineage to any superseded attempt.

Before requesting acceptance authorization, run
`scripts/acceptance_preflight.mjs` against the Target, Target manifest,
Candidate binding and every bound artifact. `PASS` means only that the layers
are internally consistent; it grants no installation, acceptance, WorkBuddy,
repair, publication or release authority.

After the exact acceptance plan is authorized, continue its already bounded
machine steps without asking for navigation confirmation again. Stop only at a
declared human gate, a failed or stale binding, an uncertain mutation, a scope
change, or exhausted authority. A repaired or rebuilt Candidate receives a new
append-only binding; it does not revise the Target manifest unless Target
coverage, Host policy or another stable acceptance rule actually changed.
