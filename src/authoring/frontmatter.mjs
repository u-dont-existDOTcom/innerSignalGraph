import { parseDocument, stringify, visit, isAlias, isMap, isSeq, isScalar } from "yaml";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  throw error;
}

function assertAllowedYamlNode(node) {
  if (!node) return;
  if (isAlias(node)) fail("YAML_ALIAS_FORBIDDEN", "YAML aliases are forbidden.");
  if (node.anchor) fail("YAML_ANCHOR_FORBIDDEN", "YAML anchors are forbidden.");
  if (node.tag && !String(node.tag).startsWith("tag:yaml.org,2002:")) {
    fail("YAML_CUSTOM_TAG_FORBIDDEN", `YAML custom tag is forbidden: ${node.tag}`);
  }
  if (isMap(node)) {
    const seen = new Set();
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") fail("YAML_KEY_INVALID", "YAML keys must be strings.");
      if (pair.key.value === "<<") fail("YAML_MERGE_KEY_FORBIDDEN", "YAML merge keys are forbidden.");
      if (seen.has(pair.key.value)) fail("YAML_DUPLICATE_KEY", `Duplicate YAML key: ${pair.key.value}`);
      seen.add(pair.key.value);
    }
  }
  if (!isMap(node) && !isSeq(node) && !isScalar(node)) fail("YAML_NODE_FORBIDDEN", "Unsupported YAML node type.");
}

function assertAllowedJs(value, label = "frontmatter") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isInteger(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertAllowedJs(item, `${label}[${index}]`));
    return;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) {
      if (typeof key !== "string") fail("YAML_KEY_INVALID", `${label} contains a non-string key.`);
      assertAllowedJs(item, `${label}.${key}`);
    }
    return;
  }
  fail("YAML_VALUE_FORBIDDEN", `${label} contains an unsupported value type.`);
}

export function decodeUtf8(buffer, label = "file") {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    fail("NON_UTF8_INPUT", `${label} is not valid UTF-8.`, { cause: error.message });
  }
}

export async function readUtf8RegularFile(file) {
  return withOpenedRegularFile(file, async (handle) => decodeUtf8(await handle.readFile(), file));
}

export function parseFrontmatter(text, { label = "note" } = {}) {
  if (typeof text !== "string") fail("FRONTMATTER_INPUT_INVALID", `${label} must be text.`);
  if (text.includes("\r")) fail("UNSUPPORTED_LINE_ENDING", `${label} must use LF line endings.`);
  if (text.charCodeAt(0) === 0xfeff) fail("UTF8_BOM_FORBIDDEN", `${label} must not include a UTF-8 BOM.`);
  if (!text.startsWith("---\n")) fail("FRONTMATTER_MISSING", `${label} must begin with exactly one frontmatter document.`);
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) fail("FRONTMATTER_UNTERMINATED", `${label} frontmatter is unterminated.`);
  const source = text.slice(4, end);
  if (/^(?:---|\.\.\.)\s*$/m.test(source)) fail("MULTIPLE_YAML_DOCUMENTS", `${label} contains multiple YAML documents.`);
  const document = parseDocument(source, { schema: "core", uniqueKeys: true, merge: false, prettyErrors: true });
  if (document.errors.length) {
    const duplicate = document.errors.find((error) => /Map keys must be unique/i.test(error.message));
    fail(duplicate ? "YAML_DUPLICATE_KEY" : "YAML_INVALID", `${label} frontmatter is invalid: ${document.errors[0].message}`);
  }
  visit(document, { Node: (_, node) => assertAllowedYamlNode(node) });
  const data = document.toJS({ maxAliasCount: 0, mapAsMap: false });
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("FRONTMATTER_NOT_MAPPING", `${label} frontmatter must be a mapping.`);
  assertAllowedJs(data);
  return { data, body: text.slice(end + 5), source };
}

export function renderFrontmatter(data) {
  assertAllowedJs(data);
  const yaml = stringify(data, { lineWidth: 0, indent: 2, defaultStringType: "PLAIN", defaultKeyType: "PLAIN" });
  return `---\n${yaml}---\n`;
}
