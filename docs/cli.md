# Harness CLI

The current CLI accepts native operations using the same envelope as the
[native service](native-harness.md#operations). Inspect with
`evopilot-next-harness capabilities`; mutations require `requestId` and the
current owner `expectedRevision`.

```sh
evopilot-next-harness request \
  --workspace /absolute/private/state \
  --workspace-id my-workspace \
  --toolchain /absolute/verified/native-toolchain.json \
  --request-file /absolute/native-request.json
```

`standard.inspect` is discovery. The authoring sequence is
`native.package.put`, `native.package.validate`, `native.package.review`,
`native.package.decide`, `native.package.publish`, then
`native.package.readback`. Passing validation cannot supply the human decision.
Use the pinned [toolchain preparation](native-harness.md#installed-tools).
Requests cannot inject trusted providers or executable overrides.

Historical JSON reads remain available through `request`; new historical writes
return `HISTORICAL_READ_ONLY`. Use `native.receipt.inspect` for native receipts
and `receipt.inspect` for historical ones. Read the owner global revision again
after each mutation or failed claimed operation. Discovery has no state writes.

A response is one JSON line. Exit 0 means the operation returned; inspect its
quality result separately. Exit 2 is invalid input/usage; exit 1 is service
failure. Errors do not echo raw exception text or request contents. After a lost
response inspect the original receipt; do not invent a new request ID to retry
uncertain execution. No CLI success grants software release authority.

See the [standard](../specifications/v1/README.md),
[native lifecycle tutorial](../examples/native/tutorial.mjs), and
[documentation index](README.md).
