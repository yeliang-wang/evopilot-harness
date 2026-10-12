# Independent Harness CLI

`evopilot-next-harness` is the package bin for `src/cli.mjs` (also runnable as `node src/cli.mjs` in this checkout). Its owned relative modules and packaged assets work without a developer or parent repository. Node **24.14.0** is the supported baseline; `node:sqlite` is experimental and may print a runtime warning to stderr. stdout contains exactly one JSON envelope.

`capabilities`, `help`/`--help`, and `version`/`--version` require no workspace and create no filesystem state. Capabilities lists the exact owned service operations and limits. Full plugin/MCP, unified Expert/Host delivery and M3 parent provider wiring remain pending. Discovery and successful requests confer no acceptance or release authority.

```sh
evopilot-next-harness capabilities
evopilot-next-harness help
evopilot-next-harness version
```

## Explicit workspace and request

```sh
evopilot-next-harness request --workspace /absolute/operator/harness-workspace --workspace-id demo --request-file /absolute/operator/request.json
```

Both workspace flags are required. The root must be a canonical absolute path outside source/Git trees, with an existing parent and no linked ancestors. The service checks OS ownership, private modes and workspace identity; it does not adopt an unknown nonempty directory. `workspace-id` and scope `projectId` use lowercase slug syntax. No cwd, environment, historical path, glob or directory scan selects the request or workspace.

Omit `--request-file` to read one JSON request from stdin through EOF. The explicit file path must be absolute and identify a regular non-symlink file. Files and stdin are limited to **524288 bytes**, including JSON whitespace. Invalid UTF-8, malformed JSON, unsupported operations, wrong envelope fields and invalid scope are rejected before initialization. Nested input also follows the service's node/depth limits. Business validation occurs in the service; a syntactically valid but semantically invalid request can initialize an empty workspace before failing.

An initial scoped inspection explicitly initializes the workspace and returns its global revision (zero when new):

```json
{"operation":"workspace.inspect","scope":{"visibility":"public","projectId":"demo"},"input":{}}
```

Reads have exactly `operation`, `scope` and `input`. Writes additionally require `requestId` and `expectedRevision`. See [service operations](service.md) for the complete input fields. This complete source-only write stores inert synthetic data:

```json
{
  "operation": "legacy.import",
  "scope": {"visibility": "public", "projectId": "demo"},
  "input": {
    "raw": "{\"note\":\"synthetic source only\"}",
    "format": "json",
    "sourceLocator": "synthetic:cli-example",
    "sourceRevision": "1",
    "sourceVisibility": "public"
  },
  "requestId": "source-1",
  "expectedRevision": 0
}
```

For `asset.put`, input is `{"asset": <complete native asset>}`; the [synthetic examples](../examples/synthetic-harnesses.json) contain complete public models. An inserted asset is a draft with no review, approval or publication. Asset/source inspection, lifecycle and evaluation use the same exact service envelopes.

Inspect the receipt in a fresh process using:

```json
{"operation":"receipt.inspect","scope":{"visibility":"public","projectId":"demo"},"input":{"requestId":"source-1"}}
```

Use `workspace.inspect` to obtain the revision for a *new* intent. Retrying the same scoped request ID and identical operation/input returns the retained receipt even with a stale expected revision; it creates no duplicate write. Reusing the ID with changed intent yields `REQUEST_CONFLICT`. A new ID with a stale revision yields `REVISION_CONFLICT`. The CLI never refreshes CAS, retries, approves, publishes or runs another request automatically. After an uncertain response, inspect the exact receipt before choosing any next action.

The standalone CLI configures no external Ontology resolver. Operations needing one return `UNAVAILABLE_DEPENDENCY`; missing published Harness dependencies use that same service code. No request can inject a resolver, shell command, network action or executable evaluation JavaScript. Sources remain inert data. The CLI does not collect LLM credentials or use a retired Suite fallback.

## Output and exit status

Success: `{"ok":true,"product":"harness","version":"0.1.0","result":{},"authority":false}` (result varies by operation).

Failure: `{"ok":false,"error":{"code":"REVISION_CONFLICT","message":"Harness service request failed."},"authority":false}`. Error messages are fixed, sanitized text; they never echo caller contents, paths or stacks.

| Exit | Meaning |
| --- | --- |
| 0 | Discovery/help/version or one successful service request |
| 1 | Workspace initialization or service execution failed; inspect the error code |
| 2 | Argument, input file, decoding, byte/structure limit or request-envelope validation failed before initialization |

Unknown/duplicate flags, missing values, extra positional arguments and extra flags on discovery commands fail. `main(args, {stdin, stdout})` is exported for trusted code and returns the exit status; importing the module does not execute it or create state. There are no install or cleanup commands.

## Local verification

`node scripts/check.mjs` preserves the owned-import and frozen-v1 guards and verifies silent CLI import under read-only filesystem permissions. `node --test tests/e2e/cli.test.mjs` exercises actual CLI processes; `npm test` includes the existing suite. Operator tests require temporary filesystem workspace access. The bounded source sandbox cannot grant that access; those test cases must run in the operator environment. Neither tests nor CLI output establish acceptance.
