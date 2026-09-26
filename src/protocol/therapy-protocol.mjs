import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The InnerSignal therapy protocol served over MCP. The packaged plugin skill is the
// single source: the same SKILL.md body and reference files that the Codex plugin bundles
// are read from the deployed build, hashed, and returned by the protocol tools. A map or
// rule fix therefore reaches MCP hosts when the server is redeployed, with no plugin
// reinstall.

export const THERAPY_PROTOCOL_ID = "inner-signal-therapy";

const DEFAULT_PLUGIN_ROOT = new URL("../../plugins/inner-signal-therapy/", import.meta.url);

// Fixed order: the always-read files first, in the order the skill lists them, then the
// conditional guide-referral file. Every always-read reference must be served, or an MCP
// host receives instructions to read a file it cannot see.
export const THERAPY_PROTOCOL_FILES = Object.freeze([
  "references/PROTECTIVE-COMPATIBILITY.md",
  "references/INNER-CHILD-THERAPY-MAP.md",
  "references/PHENOMENOLOGY-AND-REPRESENTATION.md",
  "references/PROTOCOL-STATE-PROVENANCE.md",
  "references/ROLE-BELIEF-INTEGRITY.md",
  "references/FOCUS-DISCIPLINE.md",
  "references/GUIDE-REFERRALS.md"
]);

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

// The skill body after its frontmatter; leading blank lines are dropped, the rest is kept byte for byte.
function skillBody(markdown) {
  const match = /^---\n[\s\S]*?\n---\n/u.exec(markdown);
  return (match ? markdown.slice(match[0].length) : markdown).replace(/^(?:[ \t]*\n)+/u, "");
}

function requireContent(text, label) {
  if (text.trim() === "") throw new TherapyProtocolUnavailableError(`The packaged ${label} is empty.`);
  return text;
}

const REFERENCE_PREFIX = "references/";

// Served text may name a reference only in one unambiguous form: a single-backtick inline code
// span holding exactly a served path, such as `references/FOCUS-DISCIPLINE.md`. Every other
// occurrence of "references/" is reported, whatever characters it uses: outside a code span, in a
// span opened or closed by a run of two or more backticks (whose content could run past the first
// backtick), in a span with anything more or less than a served path, or in one left unclosed on
// its line. The packaged skill already writes every reference this way.
export function unservedReferenceMentions(text) {
  const served = new Set(THERAPY_PROTOCOL_FILES);
  const unserved = [];
  for (let at = text.indexOf(REFERENCE_PREFIX); at !== -1; at = text.indexOf(REFERENCE_PREFIX, at + 1)) {
    const lineEnd = text.indexOf("\n", at) === -1 ? text.length : text.indexOf("\n", at);
    const close = text.indexOf("`", at);
    const singleOpen = at > 0 && text[at - 1] === "`" && text[at - 2] !== "`";
    const singleClose = close !== -1 && close < lineEnd && text[close + 1] !== "`";
    const span = singleOpen && singleClose ? text.slice(at, close) : null;
    if (span === null || !served.has(span)) unserved.push(text.slice(at, Math.min(lineEnd, at + 120)));
  }
  return unserved;
}

// A served text that names an unserved reference makes the protocol unavailable, not incomplete.
function requireServedReferences(texts) {
  for (const [label, text] of texts) {
    const [mention] = unservedReferenceMentions(text);
    if (mention !== undefined) {
      throw new TherapyProtocolUnavailableError(`The packaged ${label} names ${mention}, which this server does not serve.`);
    }
  }
}

export class TherapyProtocolUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "TherapyProtocolUnavailableError";
    this.code = "THERAPY_PROTOCOL_UNAVAILABLE";
  }
}

export function loadTherapyProtocol({ pluginRoot = DEFAULT_PLUGIN_ROOT } = {}) {
  const root = pluginRoot instanceof URL ? pluginRoot : pathToFileURL(`${path.resolve(String(pluginRoot))}${path.sep}`);
  try {
    const manifest = JSON.parse(fs.readFileSync(new URL(".codex-plugin/plugin.json", root), "utf8"));
    if (manifest.name !== THERAPY_PROTOCOL_ID || typeof manifest.version !== "string") {
      throw new Error("The packaged plugin manifest does not identify the InnerSignal therapy protocol.");
    }
    const instructions = requireContent(skillBody(fs.readFileSync(new URL("skills/inner-signal-therapy/SKILL.md", root), "utf8")), "skill instructions");
    const files = THERAPY_PROTOCOL_FILES.map((relative) => {
      const content = requireContent(fs.readFileSync(new URL(`skills/inner-signal-therapy/${relative}`, root), "utf8"), relative);
      return Object.freeze({ path: relative, sha256: sha256(content), bytes: Buffer.byteLength(content, "utf8"), content });
    });
    requireServedReferences([["skill instructions", instructions], ...files.map((file) => [file.path, file.content])]);
    const instructionsSha256 = sha256(instructions);
    const protocolSha256 = sha256(JSON.stringify({
      protocol_id: THERAPY_PROTOCOL_ID,
      version: manifest.version,
      instructions_sha256: instructionsSha256,
      files: files.map(({ path, sha256: digest }) => [path, digest])
    }));
    return Object.freeze({
      protocolId: THERAPY_PROTOCOL_ID,
      version: manifest.version,
      protocolSha256,
      instructions,
      instructionsSha256,
      files: Object.freeze(files)
    });
  } catch (error) {
    if (error instanceof TherapyProtocolUnavailableError) throw error;
    throw new TherapyProtocolUnavailableError("The InnerSignal therapy protocol could not be loaded from this build.", { cause: error });
  }
}

export function therapyProtocolManifest(protocol) {
  return {
    protocol_id: protocol.protocolId,
    version: protocol.version,
    protocol_sha256: protocol.protocolSha256,
    instructions_sha256: protocol.instructionsSha256,
    files: protocol.files.map(({ path, sha256: digest, bytes }) => ({ path, sha256: digest, bytes }))
  };
}

// Always the complete protocol: the instructions require every reference, so no subset is offered.
export function therapyProtocolPayload(protocol) {
  return {
    protocol_id: protocol.protocolId,
    version: protocol.version,
    protocol_sha256: protocol.protocolSha256,
    usage: "Follow the instructions for this InnerSignal therapy response. Paths such as `references/INNER-CHILD-THERAPY-MAP.md` in the instructions refer to the matching reference files returned here. Record `version` and `protocol_sha256` with any continuity handoff.",
    instructions: protocol.instructions,
    instructions_sha256: protocol.instructionsSha256,
    files: protocol.files.map(({ path, sha256: digest, bytes, content }) => ({ path, sha256: digest, bytes, content }))
  };
}
