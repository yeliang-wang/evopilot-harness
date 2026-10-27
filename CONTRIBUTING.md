# Contributing to Harness

Make Harness changes in [yeliang-wang/evopilot-harness](https://github.com/yeliang-wang/evopilot-harness), the owner repository. Use a normal GitHub account and real, attributable commits; do not fabricate identities, signatures or verification results. Open an issue or pull request there with a concrete problem, scoped change and reproduction evidence. Keep secrets and private project data out of both.

Use Node 24.14.0 and this checkout's lockfile:

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
```

Build compiles strict TypeScript and cleans only generated dist. Check verifies compiled package exports and consumer types. Tests may create isolated temporary workspaces. Report the commands actually run and any limitations. Preserve existing assertions, frozen v1 fixtures, vendor bytes and provenance.

Harness owns declarative QA, evidence evaluation and its asset lifecycle. Runtime and Ontology changes belong in their respective owner repositories. The [parent composition](https://github.com/yeliang-wang/evopilot) tracks product revisions through Git submodule gitlinks: land the owner change first, then propose an explicit parent gitlink update to that real commit. Do not copy sibling implementations into Harness.

Describe behavior, compatibility and validation in each pull request. Technical success does not grant Host acceptance or release authority. Follow the [parent release procedure](https://github.com/yeliang-wang/evopilot/blob/main/docs/github-release.md) under the current explicit release authorization.

## Documentation consistency

`npm run check` includes `scripts/check-documentation.mjs`. Keep the README, documentation index, current changelog section and default installation examples aligned with `package.json`; retain explicitly historical version records. Run `node --test tests/e2e/documentation.test.mjs` for the gate regression cases. Source documentation updates do not replace existing tags or release archives.

## Bilingual entry points

Update `README.md` and `README_CN.md` together when changing behavior descriptions, versions, prerequisites, commands or limits. Follow [bilingual maintenance](docs/documentation-languages.md) ([简体中文](docs/zh-CN/documentation-languages.md)). `npm run check` runs the synchronization guard; semantic translation review remains required. Include available Chinese pages in future packages without replacing historical releases.
