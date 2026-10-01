import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stringify } from "yaml";
import { resolveTaxonomy } from "../src/v4/classification/taxonomy.mjs";
import { analyzeSourceTaxonomy } from "../src/v4/classification/engine.mjs";

const declaration = {
  apiVersion: "harness.evopilot.io/v1", kind: "Taxonomy",
  metadata: { namespace: "test.example", name: "serialization", version: "1.0.0" },
  spec: {
    engineRange: ">=4.5.0 <5.0.0",
    requiredCapabilities: ["taxonomy-c14n/v1", "source-concept-hypothesis/v1", "open-world-taxonomy-classifier/v1", "taxonomy-decision-aggregate/v1"],
    axisPolicies: { domainCardinality: "SINGLE", productCardinality: "SINGLE" },
    domains: [{ id: "domain", label: "domain", assignable: false }],
    products: [{ id: "product", label: "product", assignable: false }]
  }
};

function fixture(text, extension = "yaml") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-taxonomy-serialization-"));
  const file = path.join(root, `input.${extension}`);
  fs.writeFileSync(file, text);
  return { root, file };
}

test("ordinary JSON and YAML retain identical canonical Taxonomy snapshots", () => {
  const yaml = fixture(stringify(declaration));
  const json = fixture(JSON.stringify(declaration), "json");
  try {
    assert.deepEqual(resolveTaxonomy(yaml.file), resolveTaxonomy(json.file));
    const quoted = structuredClone(declaration);
    quoted.spec.domains[0].label = "literal &anchor *alias !tag << text";
    const literal = fixture(stringify(quoted));
    try { assert.deepEqual(resolveTaxonomy(literal.file), resolveTaxonomy(quoted)); }
    finally { fs.rmSync(literal.root, { recursive: true, force: true }); }
  } finally {
    fs.rmSync(yaml.root, { recursive: true, force: true });
    fs.rmSync(json.root, { recursive: true, force: true });
  }
});

test("unsafe YAML forms fail before Source processing and Advisor invocation", async () => {
  const yaml = stringify(declaration);
  const variants = [
    yaml.replace("kind: Taxonomy", "kind: &kind Taxonomy"),
    yaml.replace("kind: Taxonomy", "kind: *unbound"),
    yaml.replace("kind: Taxonomy", "kind: !LocalTag Taxonomy"),
    yaml.replace("metadata:\n", "metadata:\n  <<: { namespace: injected }\n"),
    yaml.replace("kind: Taxonomy", "kind: Taxonomy\nkind: Taxonomy"),
    `${yaml}\n---\nextra: true\n`
  ];
  for (const text of variants) {
    const { root, file } = fixture(text); let calls = 0;
    try {
      assert.throws(() => resolveTaxonomy(file), { code: "TAXONOMY_SERIALIZATION_UNSAFE" });
      await assert.rejects(analyzeSourceTaxonomy({
        source: path.join(root, "SOURCE_MUST_NOT_BE_OPENED"), taxonomy: file,
        advisorProvider: () => { calls++; throw new Error("ADVISOR_MUST_NOT_RUN"); }
      }), { code: "TAXONOMY_SERIALIZATION_UNSAFE" });
      assert.equal(calls, 0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test("invalid UTF-8 in JSON or YAML is rejected before Source processing", async () => {
  for (const extension of ["json", "yaml"]) {
    const document = structuredClone(declaration);
    document.spec.domains[0].label = "UTF8_SENTINEL";
    const text = extension === "json" ? JSON.stringify(document) : stringify(document);
    const [before, after] = text.split("UTF8_SENTINEL");
    for (const invalidBytes of [[0xc0, 0xaf], [0xc3, 0x28], [0xe2, 0x82]]) {
      const { root, file } = fixture(Buffer.concat([Buffer.from(before), Buffer.from(invalidBytes), Buffer.from(after)]), extension);
      let calls = 0;
      try {
        assert.throws(() => resolveTaxonomy(file), { code: "TAXONOMY_SERIALIZATION_UNSAFE" });
        await assert.rejects(analyzeSourceTaxonomy({
          source: path.join(root, "SOURCE_MUST_NOT_BE_OPENED"), taxonomy: file,
          advisorProvider: () => { calls++; throw new Error("ADVISOR_MUST_NOT_RUN"); }
        }), { code: "TAXONOMY_SERIALIZATION_UNSAFE" });
        assert.equal(calls, 0);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
  }
});

test("malformed JSON and non-finite JSON numbers produce typed serialization blockers", () => {
  const json = JSON.stringify(declaration);
  for (const text of [json + " trailing", json.replace('"label":"domain"', '"label":1e400'), json.replace('"label":"domain"', '"label":-1e400')]) {
    const { root, file } = fixture(text, "json");
    try { assert.throws(() => resolveTaxonomy(file), { code: "TAXONOMY_SERIALIZATION_UNSAFE" }); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});
