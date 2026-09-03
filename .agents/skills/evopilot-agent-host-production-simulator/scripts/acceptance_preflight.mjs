#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  validateCandidateAcceptanceBinding,
  validateTargetManifest
} from "./modular_contracts.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return path.resolve(process.argv[index + 1]);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

let result;
try {
  const targetFile = option("--target");
  const targetManifestFile = option("--target-manifest");
  const candidateBindingFile = option("--candidate-binding");
  const artifactRootIndex = process.argv.indexOf("--artifact-root");
  const artifactRoot = artifactRootIndex >= 0
    ? path.resolve(process.argv[artifactRootIndex + 1])
    : path.dirname(candidateBindingFile);
  const target = readJson(targetFile);
  const targetManifest = readJson(targetManifestFile);
  const candidateBinding = readJson(candidateBindingFile);
  const errors = [
    ...validateTargetManifest(targetManifest, targetFile, target),
    ...validateCandidateAcceptanceBinding(candidateBinding, targetManifest, targetManifestFile, artifactRoot)
  ];
  result = {
    schema: "evopilot-candidate-acceptance-preflight/v1",
    status: errors.length ? "FAIL" : "PASS",
    targetId: target.id ?? null,
    targetRevision: target.revision ?? null,
    targetManifestId: targetManifest.id ?? null,
    candidateBindingId: candidateBinding.id ?? null,
    candidateId: candidateBinding.candidate?.id ?? null,
    errors,
    authority: "VALIDATION_ONLY_NO_INSTALLATION_ACCEPTANCE_WORKBUDDY_REPAIR_PUBLICATION_OR_RELEASE_AUTHORITY"
  };
} catch (error) {
  result = {
    schema: "evopilot-candidate-acceptance-preflight/v1",
    status: "FAIL",
    errors: [String(error.message)],
    authority: "VALIDATION_ONLY_NO_INSTALLATION_ACCEPTANCE_WORKBUDDY_REPAIR_PUBLICATION_OR_RELEASE_AUTHORITY"
  };
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(result.status === "PASS" ? 0 : 2);
