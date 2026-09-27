import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {digest,readYaml,writeJson,writeYaml} from '../../src/v3/utils.mjs';
import {publishCatalog} from '../../src/v3/catalog.mjs';
import {initializeWorkspace} from '../../src/v3/workspace.mjs';
import {assembleSemanticGeneration} from '../../src/v4/semantics/catalog-generation.mjs';
import {SEMANTIC_POLICY_SCHEMA,semanticPublicationSubject} from '../../src/v4/semantics/catalog-supply.mjs';
import {semanticSupplyFixture} from './semantic-supply.mjs';

// External synthetic Workspace only; never writes a repository Catalog.
export function preparedSemanticSupply(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "semantic-supply-integration-")));
  t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  initializeWorkspace(home);
  const set = semanticSupplyFixture();
  const organization = path.join(home, "catalogs/organization");
  for (const {document} of set.harnessAssets) writeYaml(path.join(organization, "assets", document.kind, document.metadata.id, document.metadata.version, "asset.yaml"), document);
  assert.equal(publishCatalog({roots: [path.join(organization, "assets")], out: organization, generatedAt: "2026-09-21T00:00:00.000Z"}).status, "PUBLISHED");
  const index = JSON.parse(fs.readFileSync(path.join(organization, "catalog.lock.json"), "utf8"));
  for (const item of set.harnessAssets) item.entry = index.entries.find(entry => entry.kind === item.document.kind && entry.id === item.document.metadata.id && entry.version === item.document.metadata.version);
  const input = {schema: "evopilot-harness-semantic-supply-input/v1", sets: [set]};
  const built = assembleSemanticGeneration({catalogId: "organization", sets: input.sets});
  const publication = {decision: "AUTHORIZED", actor: "fixture-publisher", authorizationDigest: digest("synthetic-catalog-decision")};
  const policy = {schema: SEMANTIC_POLICY_SCHEMA, catalogs: [{id: "organization", permission: "GRANTED", trustContext: "synthetic-local",
    rootBindingDigest: digest({id: "organization", root: "./catalogs/organization"}),
    scopes: [{scope: built.generation.sets[0].scope, visibilities: ["PUBLIC", "DOMAIN", "PRIVATE"]}],
    grants: [
      {...set.artifactSet.spec.publication, purpose: "ASSET_PUBLICATION", subjectDigest: set.artifactSet.artifactSetDigest, revoked: false, expiresAt: null},
      {...set.closure.publication, purpose: "ASSET_PUBLICATION", subjectDigest: set.closure.closureDigest, revoked: false, expiresAt: null},
      {...publication, purpose: "CATALOG_PUBLICATION", subjectDigest: semanticPublicationSubject({catalogId: "organization",
        generationDigest: built.generation.generationDigest, expectedHead: null, requestId: "first"}), revoked: false, expiresAt: null}
    ]}]};
  const configFile = path.join(home, "config.yaml");
  writeYaml(configFile, {...readYaml(configFile), semanticCatalogPolicy: "./semantic-catalog-policy.json"});
  writeJson(path.join(home, "semantic-catalog-policy.json"), policy);
  writeJson(path.join(home, "input.json"), input);
  const request = {home, action: "publish", catalogId: "organization", file: "input.json", inputDigest: digest(input),
    expectedGenerationDigest: built.generation.generationDigest, expectedHead: "EMPTY", requestId: "first", publication};
  return {home, organization, input, built, policy, request};
}
