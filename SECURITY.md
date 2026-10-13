# Security boundary

Harness is a local, single-user service. It checks canonical workspace paths, OS ownership, private modes and explicit workspace identity; it rejects unsafe links and unknown nonempty roots. Its OS uid records are local decision evidence, not independent multiuser authentication. A malicious process running as the same uid can race filesystem changes; path checks do not defend against that threat.

Requests and retained sources are bounded data. They cannot supply executable evaluation code or a resolver. Trusted embedding code alone configures external Ontology resolution. Scope isolation and immutable dependency references do not authenticate externally supplied evidence. Construction and discovery are read-only; initialization and explicit mutations persist state.

Keep credentials, tokens, private source material, raw private receipts and sensitive paths out of public issues and pull requests. Use sanitized synthetic reproductions for public reports. Check the repository's [Security page](https://github.com/yeliang-wang/evopilot-harness/security) for any available reporting options before sharing sensitive details; this document does not designate an email address or promise a private reporting channel.

Initialization and blob creation can leave partial state or unreferenced blobs after failure. No automatic repair or garbage collection is provided. Preserve exact receipts after uncertain outcomes and inspect them before deciding on another request. See the [service guide](docs/service.md) for limits and transaction behavior.
