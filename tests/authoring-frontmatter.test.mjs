import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseFrontmatter, readUtf8RegularFile, renderFrontmatter } from "../src/authoring/frontmatter.mjs";
import { parseAuthoringNote, PAYLOAD_START, PAYLOAD_END } from "../src/authoring/note-parser.mjs";
import { assertSafeNodeFilenameId, assertUniquePortableIds, validateSchema } from "../src/authoring/contract.mjs";
import { assertNoSymlinkAncestors, assertPublicAuthoringText, resolveInside } from "../src/authoring/private-data-boundary.mjs";

const hash = "a".repeat(64);
const currentFrontmatter = {
  authoring_contract: "inner-signal-authoring-node-current-v1",
  entity_type: "graph-node",
  projection_mode: "current",
  generated: true,
  graph_id: "inner-child-directed-graph",
  node_id: "IC.TEST",
  title: "Test node",
  kind: "decision-node",
  tier: 3,
  priority: 50,
  authority: "author-framework",
  graph_tags: ["test"],
  source_refs: ["IC.GUARDS"],
  base_record_sha256: hash,
  base_graph_sha256: hash,
  projection_input_sha256: hash
};
const payload = {
  activation: { all: [], any: [], none: [] },
  recommendations: [],
  avoid: [],
  successSignals: [],
  effects: { deferNodes: [], blockNodes: [], requiredNuance: [], forbiddenOverclaims: [] },
  defaultQuestion: ""
};

function note(frontmatter = currentFrontmatter, value = payload) {
  return `${renderFrontmatter(frontmatter)}\n# Test\n\n${PAYLOAD_START}\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n${PAYLOAD_END}\n`;
}

test("restricted frontmatter and the node payload parse without coercion", () => {
  const parsed = parseAuthoringNote(note());
  assert.deepEqual(parsed.data, currentFrontmatter);
  assert.deepEqual(parsed.payload, payload);
  assert.equal(typeof parsed.data.priority, "number");
});

test("frontmatter rejects duplicate keys, anchors, aliases, tags, merge keys, multiple documents, and CRLF", () => {
  const invalid = [
    ["YAML_DUPLICATE_KEY", "---\na: 1\na: 2\n---\n"],
    ["YAML_ANCHOR_FORBIDDEN", "---\na: &base value\n---\n"],
    ["YAML_ANCHOR_FORBIDDEN", "---\na: &base value\nb: *base\n---\n"],
    ["YAML_CUSTOM_TAG_FORBIDDEN", "---\na: !custom value\n---\n"],
    ["YAML_MERGE_KEY_FORBIDDEN", "---\na: {x: 1}\nb: {<<: {x: 1}}\n---\n"],
    ["MULTIPLE_YAML_DOCUMENTS", "---\na: 1\n...\n---\n"],
    ["UNSUPPORTED_LINE_ENDING", "---\r\na: 1\r\n---\r\n"]
  ];
  for (const [code, source] of invalid) assert.throws(() => parseFrontmatter(source), { code });
});

test("frontmatter rejects YAML spellings that silently coerce ambiguous scalars", () => {
  for (const source of ["01", "0x10", "~", ".inf", "000000"]) {
    assert.throws(() => parseFrontmatter(`---\nvalue: ${source}\n---\n`), { code: "YAML_IMPLICIT_SCALAR_FORBIDDEN" });
  }
  assert.deepEqual(parseFrontmatter("---\ninteger: 10\nflag: true\nempty: null\n---\n").data, { integer: 10, flag: true, empty: null });
});

test("schema validation rejects unknown keys and invalid types without mutating input", () => {
  const unknown = { ...currentFrontmatter, typo_priority: 5 };
  const snapshot = structuredClone(unknown);
  assert.throws(() => validateSchema("nodeCurrent", unknown), { code: "AUTHORING_SCHEMA_INVALID" });
  assert.deepEqual(unknown, snapshot);
  assert.throws(() => validateSchema("nodeCurrent", { ...currentFrontmatter, priority: "50" }), { code: "AUTHORING_SCHEMA_INVALID" });
});

test("every authoring schema compiles under Ajv strict mode", () => {
  for (const name of ["projectionManifest", "nodeCurrent", "nodeProposal", "edgeCurrent", "edgeProposal", "proposalManifest", "proposalReceipt", "overlay", "canvas", "nodePayload", "projectionIndex"]) {
    assert.throws(() => validateSchema(name, {}), { code: "AUTHORING_SCHEMA_INVALID" });
  }
});

test("payload parser rejects malformed or multiple markers, unknown fields, and frontmatter overlap", () => {
  assert.throws(() => parseAuthoringNote(note().replace(PAYLOAD_END, "")), { code: "PAYLOAD_MARKERS_INVALID" });
  assert.throws(() => parseAuthoringNote(`${note()}\n${PAYLOAD_START}\n${PAYLOAD_END}\n`), { code: "PAYLOAD_MARKERS_INVALID" });
  assert.throws(() => parseAuthoringNote(note(currentFrontmatter, { ...payload, typo: true })), { code: "PAYLOAD_UNKNOWN_FIELD" });
  assert.throws(() => parseAuthoringNote(note(currentFrontmatter, { ...payload, activation: { any: [{ field: "activation", op: "eq", value: 3 }] } })), { code: "AUTHORING_SCHEMA_INVALID" });
  assert.throws(() => parseAuthoringNote(note({ ...currentFrontmatter, activation: "bad" })), { code: "AUTHORING_SCHEMA_INVALID" });
});

test("portable ids reject ambiguous filenames and case-fold collisions", () => {
  for (const value of ["../escape", "CON", "aux.txt", "IC.NODE.", "IC.NODE.md", "a/b", "a\\b"]) {
    assert.throws(() => assertSafeNodeFilenameId(value), { code: "UNSAFE_NODE_FILENAME" });
  }
  assert.throws(() => assertUniquePortableIds(["IC.NODE", "ic.node"]), { code: "AUTHORING_ID_CASE_COLLISION" });
});

test("exact UTF-8 reader rejects invalid bytes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-authoring-utf8-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "bad.md");
  await fs.writeFile(file, Buffer.from([0xc3, 0x28]));
  await assert.rejects(() => readUtf8RegularFile(file), { code: "NON_UTF8_INPUT" });
});

test("privacy and path boundaries fail closed", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-authoring-path-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.throws(() => resolveInside(root, "../escape"), { code: "AUTHORING_PATH_TRAVERSAL" });
  assert.throws(() => assertPublicAuthoringText("OPENAI_API_KEY=secret"), { code: "PRIVATE_AUTHORING_CONTENT" });
  await fs.symlink(os.tmpdir(), path.join(root, "linked"));
  assert.throws(() => assertNoSymlinkAncestors(root, "linked/file.md"), { code: "AUTHORING_SYMLINK_FORBIDDEN" });
});
