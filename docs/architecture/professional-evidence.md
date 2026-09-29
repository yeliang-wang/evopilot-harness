# Evidence-bound professional facts

Harness reasoning extracts explicit professional declarations from the frozen,
redacted Evidence Graph. Supported declarations include JSON fields, Markdown
sections and labeled lines for business objects, capabilities, tasks, roles,
constraints, workflows, failure modes, recovery strategies, validators, positive
and negative cases, risks, expected effects and counter-evidence. Field names
are generic; their values belong to the Source.

Type and callable declarations in supported source-code files are also retained
as structural object and task candidates. They remain explicitly unvalidated;
their names do not establish business meaning, a professional role, a working
validator or Harness Eligibility. This evidence does not feed the existing
matching or Profile-generation policy.

Each extracted fact retains its Evidence Graph identifier, Source content and
excerpt digests, field pointer or line, extraction method and uncertainty. A
declaration proves only that the Source says something. It does not prove that
a capability works, that a validator ran, or that a Harness is eligible.
Unstated fields remain missing. Extraction is bounded and reports truncation.
Repository-governance and other excluded context remain in the full audit graph
but cannot establish product facts.

Fresh Proposal Review views bind these facts through the immutable reasoning
result and Proposal. A changed citation, graph, reasoning result or extracted
value fails the binding check. Existing persisted results and presentations
are not rewritten or silently re-extracted. Source ingestion remains static:
the extractor does not run project commands, follow URLs, call an LLM or change
eligibility, approval or publication decisions.
