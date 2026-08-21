# Simulation Contract

## Preconditions

- The user names or accepts one host, target Harness version, scenario, Evidence Sources, and evidence destination.
- Installation/update, attachment upload, Plan confirmation, Proposal approval, publication, retry, cleanup, and any other mutation retain separate authority. Earlier authorization does not authorize a later gate.
- The tested runtime must be outside the Harness source checkout. Repository files may define this Skill and tests but are not production runtime evidence.

## State model

Track `DISCOVERED`, `PREVIEWED`, `INSTALLED`, `HOST_OPEN`, `EXPERT_SELECTED`, `EVIDENCE_ATTACHED`, `CAPABILITY_BOUND`, `SESSION_ACTIVE`, `HUMAN_GATE`, `TERMINAL`, or `BLOCKED`. Record the transition evidence; do not infer it from a requested click.

At `HUMAN_GATE`, stop after rendering the exact object and digest. Ask one plain-language decision. The Digital Expert, not the simulator, constructs any Engine-required internal token after the human explicitly decides.

## Source independence

Record `npm view` evidence for the exact public version, resolve the installed package root, and prove that the package, CLI, adapter, Workspace, and host test directory are outside the repository checkout. A local tarball is pre-release evidence and must be labeled as such.

## Extensibility

Shared flow ends at observable intentions: preview install, open host, select expert, attach evidence, send goal, inspect structured tool result, pause at gate, resume from durable state, and report. Profiles implement only these host actions. Adding a host must not change the shared authority or evidence rules.
