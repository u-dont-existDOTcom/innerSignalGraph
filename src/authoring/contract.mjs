import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { sha256Bytes } from "./canonical-json.mjs";

export const AUTHORING_CONTRACTS = Object.freeze({
  projection: "inner-signal-authoring-projection-v1",
  nodeCurrent: "inner-signal-authoring-node-current-v1",
  nodeProposal: "inner-signal-authoring-node-proposal-v1",
  edgeCurrent: "inner-signal-authoring-edge-current-v1",
  edgeProposal: "inner-signal-authoring-edge-proposal-v1",
  proposal: "inner-signal-authoring-proposal-v1",
  receipt: "inner-signal-authoring-receipt-v1",
  overlay: "inner-signal-map-overlay-v1"
});

export const PROPOSAL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/;
export const HASH_PATTERN = /^[a-f0-9]{64}$/;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(moduleDir, "../..");
export const authoringRoot = path.join(repositoryRoot, "authoring");
export const schemaRoot = path.join(authoringRoot, "schemas");

const SCHEMA_FILES = Object.freeze({
  projectionManifest: "authoring-projection-manifest.schema.json",
  nodeCurrent: "node-current-note.schema.json",
  nodeProposal: "node-proposal-note.schema.json",
  edgeCurrent: "edge-current-note.schema.json",
  edgeProposal: "edge-proposal-note.schema.json",
  proposalManifest: "proposal-manifest.schema.json",
  proposalReceipt: "proposal-receipt.schema.json",
  overlay: "map-overlay.schema.json",
  canvas: "json-canvas-subset.schema.json",
  nodePayload: "graph-node-payload.schema.json",
  projectionIndex: "projection-index-note.schema.json"
});

const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false
});
const validators = new Map();

function validatorFor(name) {
  const file = SCHEMA_FILES[name];
  if (!file) throw new Error(`Unknown authoring schema: ${name}`);
  if (!validators.has(name)) {
    const schema = JSON.parse(fs.readFileSync(path.join(schemaRoot, file), "utf8"));
    validators.set(name, ajv.compile(schema));
  }
  return validators.get(name);
}

export function validateSchema(name, value, { label = name } = {}) {
  const validate = validatorFor(name);
  if (!validate(value)) {
    const detail = validate.errors
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ");
    const failure = new Error(`${label} failed schema validation: ${detail}`);
    failure.code = "AUTHORING_SCHEMA_INVALID";
    failure.details = validate.errors;
    throw failure;
  }
  return value;
}

export function schemaNameForContract(contract) {
  const names = {
    [AUTHORING_CONTRACTS.nodeCurrent]: "nodeCurrent",
    [AUTHORING_CONTRACTS.nodeProposal]: "nodeProposal",
    [AUTHORING_CONTRACTS.edgeCurrent]: "edgeCurrent",
    [AUTHORING_CONTRACTS.edgeProposal]: "edgeProposal",
    [AUTHORING_CONTRACTS.proposal]: "proposalManifest"
  };
  return names[contract] ?? null;
}

export function assertProposalId(value) {
  if (!PROPOSAL_ID_PATTERN.test(value)) {
    const error = new Error(`Proposal id is invalid: ${value}`);
    error.code = "INVALID_PROPOSAL_ID";
    throw error;
  }
  return value;
}

export function assertSafeNodeFilenameId(value) {
  const windowsDevice = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  if (
    typeof value !== "string" ||
    value.length > 180 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ||
    value.endsWith(".") ||
    value.toLowerCase().endsWith(".md") ||
    windowsDevice.test(value)
  ) {
    const error = new Error(`Node id is unsafe as a filename: ${value}`);
    error.code = "UNSAFE_NODE_FILENAME";
    throw error;
  }
  return value;
}

export function edgeDigest({ graphId, from, relation, to }) {
  for (const [label, value] of Object.entries({ graphId, from, relation, to })) {
    if (typeof value !== "string" || !value) throw new Error(`Edge ${label} must be a non-empty string.`);
  }
  return sha256Bytes(Buffer.from(`${graphId}\0${from}\0${relation}\0${to}`, "utf8"));
}

export function edgeId(edge) {
  return `edge-${edgeDigest(edge).slice(0, 16)}`;
}

export const NODE_PAYLOAD_FIELDS = Object.freeze([
  "activation",
  "recommendations",
  "avoid",
  "successSignals",
  "effects",
  "defaultQuestion"
]);

export const NODE_FRONTMATTER_TO_RECORD = Object.freeze({
  node_id: "id",
  title: "title",
  kind: "kind",
  tier: "tier",
  priority: "priority",
  authority: "authority",
  graph_tags: "tags",
  source_refs: "sourceRefs"
});

export const SEMANTIC_FIELD_POLICY = Object.freeze({
  id: "prohibited-direct-edit",
  graphId: "substantive",
  title: "reviewed-substantive",
  kind: "substantive-structural",
  tier: "substantive-routing",
  priority: "substantive-routing",
  activation: "substantive-routing-safety",
  sourceRefs: "provenance-policy",
  authority: "provenance-policy",
  recommendations: "therapeutic-response",
  avoid: "therapeutic-safety",
  successSignals: "therapeutic-evaluation",
  tags: "reviewed-metadata",
  effects: "substantive-effects",
  defaultQuestion: "substantive-response-routing",
  description: "reviewed-metadata",
  edges: "substantive-topology",
  contractVersion: "immutable",
  version: "generated",
  bundleVersion: "generated",
  sourceRevision: "generated"
});

export function assertUniquePortableIds(values, { label = "ids" } = {}) {
  const seen = new Map();
  for (const value of values) {
    assertSafeNodeFilenameId(value);
    const folded = value.toLowerCase();
    if (seen.has(folded)) {
      const error = new Error(`${label} collide on a case-insensitive filesystem: ${seen.get(folded)} and ${value}`);
      error.code = "AUTHORING_ID_CASE_COLLISION";
      throw error;
    }
    seen.set(folded, value);
  }
  return values;
}
