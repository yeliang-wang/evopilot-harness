# Repository E2E corpus

This directory is the discoverable, repository-local index for governed
`evopilot-harness` end-to-end cases. It does not replace or revise an Evolution
Target.

## Authority model

- `governance/targets/*.json` owns acceptance meaning, case status, evidence,
  approval, validation, and release authority.
- `tests/e2e/versions/*/manifest.json` is a read-only projection bound to the
  exact SHA-256 of one authoritative Target file.
- Large or private Host evidence stays outside this repository. A manifest
  points to the Target fields that contain the immutable evidence references;
  it never copies the evidence itself.
- Historical validation proves that the repository projection still matches
  the accepted record. It does not replay external effects or re-authorize a
  prior release.

## Run

Validate the complete version index:

```bash
node scripts/validate-repository-e2e.mjs
```

Validate one checked-in manifest:

```bash
node scripts/validate-repository-e2e.mjs \
  --manifest tests/e2e/versions/4.8.0/manifest.json
```

The command reads repository files only and emits a machine-readable report.
Any Target digest drift, unsupported version, unsafe path, missing or reordered
case, coverage mismatch, evidence-pointer mismatch, or embedded authority field
fails closed.

## Layout

- [`index.json`](index.json) lists supported version projections.
- [`schema/manifest.schema.json`](schema/manifest.schema.json) defines the
  machine-readable manifest shape.
- [`scenarios/target-case-projection.json`](scenarios/target-case-projection.json)
  defines the shared read-only validation journey.
- `versions/<version>/manifest.json` binds one version to its exact Target and
  RC01-RC05 projections.

Git history and release tags retain prior corpus revisions. New product
versions add a new version manifest; shared validation behavior remains in the
scenario profile and validator.
