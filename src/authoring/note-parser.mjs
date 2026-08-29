import { parseFrontmatter, readUtf8RegularFile } from "./frontmatter.mjs";
import { schemaNameForContract, validateSchema, NODE_PAYLOAD_FIELDS } from "./contract.mjs";

export const PAYLOAD_START = "<!-- inner-signal:payload:start -->";
export const PAYLOAD_END = "<!-- inner-signal:payload:end -->";

function occurrences(text, token) {
  return text.split(token).length - 1;
}

function payloadPolicy(data) {
  if (data.authoring_contract === "inner-signal-authoring-node-current-v1") return "required";
  if (data.authoring_contract === "inner-signal-authoring-node-proposal-v1") return data.operation === "remove" ? "optional" : "required";
  return "forbidden";
}

export function parseAuthoringNote(text, { label = "note", payload = null } = {}) {
  const parsed = parseFrontmatter(text, { label });
  const schemaName = schemaNameForContract(parsed.data.authoring_contract);
  if (!schemaName) {
    const error = new Error(`${label} has an unknown authoring contract.`);
    error.code = "UNKNOWN_AUTHORING_CONTRACT";
    throw error;
  }
  validateSchema(schemaName, parsed.data, { label: `${label} frontmatter` });
  const selectedPayloadPolicy = payload ?? payloadPolicy(parsed.data);

  const startCount = occurrences(parsed.body, PAYLOAD_START);
  const endCount = occurrences(parsed.body, PAYLOAD_END);
  if (selectedPayloadPolicy === "forbidden" && (startCount || endCount)) {
    const error = new Error(`${label} must not contain a structured payload.`);
    error.code = "PAYLOAD_FORBIDDEN";
    throw error;
  }
  if (selectedPayloadPolicy === "forbidden") return { ...parsed, payload: null };
  if (selectedPayloadPolicy === "optional" && startCount === 0 && endCount === 0) return { ...parsed, payload: null };
  if (startCount !== 1 || endCount !== 1) {
    const error = new Error(`${label} must contain exactly one payload block.`);
    error.code = "PAYLOAD_MARKERS_INVALID";
    throw error;
  }
  const start = parsed.body.indexOf(PAYLOAD_START) + PAYLOAD_START.length;
  const end = parsed.body.indexOf(PAYLOAD_END);
  if (end <= start) {
    const error = new Error(`${label} payload markers are out of order.`);
    error.code = "PAYLOAD_MARKERS_INVALID";
    throw error;
  }
  const fenced = parsed.body.slice(start, end).trim();
  const match = fenced.match(/^```json\n([\s\S]*?)\n```$/);
  if (!match) {
    const error = new Error(`${label} payload must be one JSON code fence.`);
    error.code = "PAYLOAD_FENCE_INVALID";
    throw error;
  }
  let payloadValue;
  try {
    payloadValue = JSON.parse(match[1]);
  } catch (error) {
    const failure = new Error(`${label} payload is invalid JSON: ${error.message}`);
    failure.code = "PAYLOAD_JSON_INVALID";
    throw failure;
  }
  if (!payloadValue || typeof payloadValue !== "object" || Array.isArray(payloadValue)) {
    const error = new Error(`${label} payload must be an object.`);
    error.code = "PAYLOAD_OBJECT_REQUIRED";
    throw error;
  }
  const unknown = Object.keys(payloadValue).filter((key) => !NODE_PAYLOAD_FIELDS.includes(key));
  if (unknown.length) {
    const error = new Error(`${label} payload contains unknown fields: ${unknown.join(", ")}`);
    error.code = "PAYLOAD_UNKNOWN_FIELD";
    throw error;
  }
  const overlap = Object.keys(payloadValue).filter((key) => Object.hasOwn(parsed.data, key));
  if (overlap.length) {
    const error = new Error(`${label} repeats fields in frontmatter and payload: ${overlap.join(", ")}`);
    error.code = "PAYLOAD_FRONTMATTER_OVERLAP";
    throw error;
  }
  validateSchema("nodePayload", payloadValue, { label: `${label} payload` });
  return { ...parsed, payload: payloadValue };
}

export function nodeRecordFromAuthoringNote(text, options = {}) {
  const parsed = parseAuthoringNote(text, options);
  if (!parsed.data.authoring_contract.includes("node-")) {
    const error = new Error(`${options.label ?? "note"} is not a node note.`);
    error.code = "AUTHORING_NODE_NOTE_REQUIRED";
    throw error;
  }
  if (!parsed.payload) return null;
  return {
    id: parsed.data.node_id,
    title: parsed.data.title,
    kind: parsed.data.kind,
    tier: parsed.data.tier,
    priority: parsed.data.priority,
    activation: parsed.payload.activation,
    sourceRefs: parsed.data.source_refs,
    authority: parsed.data.authority,
    recommendations: parsed.payload.recommendations,
    avoid: parsed.payload.avoid,
    successSignals: parsed.payload.successSignals,
    tags: parsed.data.graph_tags,
    effects: parsed.payload.effects,
    defaultQuestion: parsed.payload.defaultQuestion
  };
}

export async function readAuthoringNote(file, options = {}) {
  return parseAuthoringNote(await readUtf8RegularFile(file), { ...options, label: options.label ?? file });
}
