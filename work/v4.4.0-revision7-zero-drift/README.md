# v4.4.0 Revision 7 zero-drift evidence

This directory contains the redacted real-host evidence for the complete-lifecycle revision 7 acceptance run. Raw WorkBuddy logs and credential-bearing configuration are intentionally excluded.

## Candidate provenance

- Package: `@evopilot/harness@4.4.0`
- Candidate tarball SHA-256: `605dd9a809d87586ef2b7dbff46b8b814a430d6a0147e64b153079152381923f`
- Installed runtime integrity digest: `sha256:6dd1047af5dc487dbe179c6285451a6446578152087c4c6a2b0b4ae3f3625355`
- WorkBuddy: `5.3.14`
- Session: `session-mt6me1z3-207fc77e63`
- Source checkout used by candidate: `false`

## Result

The five ordered business stages—Plan, Proposal Review, publication, Catalog validation, and Close—were rendered three times in WorkBuddy, through two WorkBuddy restarts, with Auto (`glm-5.2-a`) and fixed GLM-5.3 routes, and once through an independent stdio MCP Host. Every full transcript is byte-identical to `engine-canonical.md`:

- Canonical presentation digest: `sha256:7a0d0934b61a12d5eb132433e98ac1c15b6cbece14170661210e2b69130fcccd`
- Zero-drift report digest: `sha256:2da32d4c5d2ce6cfb7bc072d66e0d1cde0f27467e367172ea90fbe17d14d5ecc`
- Evidence-set digest: `sha256:61dc73d8e53c058e4bc3e722f0fd39e323cf43928cd6fd445ec21aa82f609a2b`
- Governed mutation replay count: `0`

Cross-day recovery uses the deterministic controlled acceptance clock for logical dates `2026-08-24` and `2026-08-25`. The Mac system clock was not changed; the physical WorkBuddy replays occurred on `2026-08-24`.

## Files

- `engine-canonical.md`: Engine-owned complete lifecycle baseline.
- `pass1-rendered.md`, `pass2-rendered.md`, `pass3-rendered.md`: exact WorkBuddy visible transcripts.
- `independent-host-rendered.md`: exact independent-Host transcript.
- `pass1-auto.png`, `pass2-restart1-glm53.png`, `pass3-restart2-auto.png`: visible WorkBuddy evidence.
- `revision7-zero-drift-report.json`: stage-by-stage provenance, digests, and zero-drift results.

This evidence proves presentation replay only. It does not replay approval, publication, close, cleanup, or any other governed mutation. The real Session close remains an independent human gate.
