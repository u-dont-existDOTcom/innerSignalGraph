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

// Fixed order: the four always-read files first (as the skill instructs), then the
// conditional guide-referral file.
export const THERAPY_PROTOCOL_FILES = Object.freeze([
  "references/PROTECTIVE-COMPATIBILITY.md",
  "references/INNER-CHILD-THERAPY-MAP.md",
  "references/PHENOMENOLOGY-AND-REPRESENTATION.md",
  "references/PROTOCOL-STATE-PROVENANCE.md",
  "references/GUIDE-REFERRALS.md"
]);

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function skillBody(markdown) {
  const match = /^---\n[\s\S]*?\n---\n/u.exec(markdown);
  return (match ? markdown.slice(match[0].length) : markdown).trim();
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
    const instructions = skillBody(fs.readFileSync(new URL("skills/inner-signal-therapy/SKILL.md", root), "utf8"));
    const files = THERAPY_PROTOCOL_FILES.map((relative) => {
      const content = fs.readFileSync(new URL(`skills/inner-signal-therapy/${relative}`, root), "utf8");
      return Object.freeze({ path: relative, sha256: sha256(content), bytes: Buffer.byteLength(content, "utf8"), content });
    });
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

export function therapyProtocolPayload(protocol, { paths = null } = {}) {
  const wanted = paths == null ? null : new Set(paths);
  if (wanted && [...wanted].some((entry) => !THERAPY_PROTOCOL_FILES.includes(entry))) {
    throw Object.assign(new Error("Unknown therapy protocol file."), { code: "THERAPY_PROTOCOL_FILE_UNKNOWN" });
  }
  return {
    protocol_id: protocol.protocolId,
    version: protocol.version,
    protocol_sha256: protocol.protocolSha256,
    usage: "Follow `instructions` for this InnerSignal therapy response. Paths such as `references/INNER-CHILD-THERAPY-MAP.md` in the instructions refer to the matching entries in `files`. Record `version` and `protocol_sha256` with any continuity handoff.",
    instructions: protocol.instructions,
    files: protocol.files
      .filter(({ path }) => !wanted || wanted.has(path))
      .map(({ path, sha256: digest, content }) => ({ path, sha256: digest, content }))
  };
}
