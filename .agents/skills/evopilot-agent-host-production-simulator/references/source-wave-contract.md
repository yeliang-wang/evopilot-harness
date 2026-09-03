# Source Wave Contract

Use this contract only when an approved Evolution Target binds an external read-only Source Portfolio, a live GitHub discovery plan, or both. The Target and their exact digests are authority; this Skill never invents Source membership.

## Fixed Source wave

Before each case:

1. Verify the external manifest bytes against the Target-bound digest.
2. Resolve the case only by its stable case id and ordered Source ids. Reject missing, duplicated, reordered, drifted, or unbound entries.
3. Read or snapshot only those entries. Never modify, rename, move, delete, build, test, install, deploy, start, or execute them.
4. Use `SourceDescriptor/v1` as the Host transport. Preserve exact ordered-set membership and order.
5. Record only stable Source ids, safe labels or basenames, Source type, descriptor/snapshot digests and public resolved commits. Keep acceptance-machine absolute paths outside product, generated Skill, public evidence and release artifacts.

Complete the fixed wave for the exact candidate before starting any Target-declared live discovery wave.

## Live GitHub discovery wave

The repository-owned discovery executor is acceptance tooling, never Engine classification authority. It may run only after the exact pre-release candidate is frozen and the fixed Source wave has passed.

- Use the exact Target-bound `GitHubDiscoveryPlan/v1`; capture every declared official GitHub repository-search query, page and response.
- Fail closed on unavailable provider, rate-limit exhaustion, incomplete results, missing metadata, stale timing or partial strata. Never reuse an earlier search response as a fresh wave.
- Select and reject repositories using only the frozen pre-candidate rules. Candidate classification or Harness output must be unavailable to search, selection and oracle work.
- Resolve every selected repository to a full commit, acquire one static snapshot, validate the declared diversity constraints, and freeze the complete selection before WorkBuddy receives any selected Source.
- Create and explicitly confirm the expected-result oracle after Source freeze and before candidate execution. The oracle is independent acceptance evidence, not LLM, search-rank, Taxonomy, Eligibility, approval or publication authority.
- Run every frozen repository through every declared Host journey. Keep failures visible. No post-freeze replacement, cherry-picking, implicit refetch or oracle rewrite is allowed.

A later discovery run is a distinct append-only wave. It cannot overwrite a failed or completed prior wave and does not authorize product release.
