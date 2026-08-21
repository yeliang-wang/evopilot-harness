# v3 Product Boundary

## Definition

An EvoPilot Harness is a versioned executable asset package for one class of repeatable engineering task. It declares the model-external environment, allowed actions, constraints, required evidence, and validators that turn an uncertain model recommendation into a reviewable production workflow.

This definition deliberately narrows the product. `evopilot-harness` does not classify the entire software world and does not build an unrestricted knowledge base. It answers only these questions:

1. Is the supplied material eligible to become Harness execution knowledge?
2. Which published Harness assets are related to the evidence?
3. Should the evidence evolve an existing Profile, compose a Bundle, propose a new Profile, record no change, or request more evidence?
4. Which asset, Ontology, Policy, and Evaluation deltas require review?

## Ownership

`evopilot-harness` owns:

- source ingestion and redacted snapshots;
- Evidence Graph creation;
- Harness eligibility and candidate reasoning;
- Ontology, Matcher Policy, Advisor Policy, and Evaluation Packs;
- GLM Advisor calls and replay evidence;
- Component, Profile, and Bundle lifecycle;
- proposal review, approval, signing, and Catalog publication;
- the standalone Harness Hub;
- v2-to-v3 migration and rollback.

It does not own:

- third-party project onboarding into EvoPilot;
- project profiles or goal-loop targets;
- Harness execution inside an EvoPilot project loop;
- project evidence packages or release decisions;
- EvoPilot or Dashboard releases.

## Version Independence

There are independent version axes:

| Axis | Example | Changes when |
|---|---|---|
| Engine | `@evopilot/harness@4.1.2` | Digital Expert, Agent protocol, CLI, schemas, algorithms, UI, or runtime code changes. |
| Asset | `redis-client-profile@0.1.0` | A Component, Profile, or Bundle is reviewed and evolved. |
| Ontology | `software-engineering@1.0.0` | Concepts or role relationships change. |
| Policy | `default-advisor@1.2.1` | Weights, thresholds, risk rules, Advisor contract, or Proposal Review contract changes. |
| Evaluation/Feedback | Evaluation versions and Package/Report digests | Evaluation criteria, execution evidence, or aggregate scope changes. |
| Asset Delta | Proposal and exact before/after digests | A reviewed evidence-linked change or no-change conclusion is created. |
| Catalog | Catalog digest and signature | Published asset membership or metadata changes. |

Publishing a user Harness asset does not require an Engine release.

## Canonical And Exported Assets

The canonical v3 asset uses `harness.evopilot.io/v3` and is product-neutral. A Bundle may include an adapter projection such as:

```text
exports/evopilot/template.yaml
```

That file is an export, not the source of truth. This keeps v3 independently operable while allowing a future EvoPilot consumer to read a compatible projection.

## Registry Boundary

One `CATALOG.md` lists concrete assets in one Catalog. `harness-registry.yaml` lists Catalog roots, priority, and enablement. The Registry never duplicates individual asset entries.

v3 publication does not modify EvoPilot. A future consumer can resolve Catalog roots in read-only mode and choose a published Bundle at execution time.
