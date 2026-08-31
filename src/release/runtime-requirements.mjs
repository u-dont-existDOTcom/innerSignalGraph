export const RECOMMENDED_NODE_VERSION = "24.18.0";
export const SUPPORTED_NODE_MAJOR = 24;
export const SUPPORTED_NODE_RANGE = ">=24 <25";

const NODE_VERSION = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseNodeVersion(value) {
  if (typeof value !== "string") return null;
  const match = NODE_VERSION.exec(value.trim());
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  const [major, minor, patch] = parts;
  return { major, minor, patch, normalized: `${major}.${minor}.${patch}` };
}

export function evaluateNodeRuntime(value) {
  const parsed = parseNodeVersion(value);
  if (!parsed) {
    return {
      ok: false,
      code: "INVALID_NODE_VERSION",
      detected: typeof value === "string" && value.trim() ? value.trim() : null,
      supportedRange: SUPPORTED_NODE_RANGE,
      recommendedVersion: RECOMMENDED_NODE_VERSION,
      recommendedMatch: false
    };
  }
  const ok = parsed.major === SUPPORTED_NODE_MAJOR;
  return {
    ok,
    code: ok ? "SUPPORTED_NODE_MAJOR" : "UNSUPPORTED_NODE_MAJOR",
    detected: parsed.normalized,
    version: parsed,
    supportedRange: SUPPORTED_NODE_RANGE,
    recommendedVersion: RECOMMENDED_NODE_VERSION,
    recommendedMatch: parsed.normalized === RECOMMENDED_NODE_VERSION
  };
}

export function assertSupportedNodeRuntime(value) {
  const result = evaluateNodeRuntime(value);
  if (!result.ok) {
    const error = new Error(`Node.js ${SUPPORTED_NODE_RANGE} is required; found ${result.detected ?? "unknown"}. Recommended patch: ${RECOMMENDED_NODE_VERSION}.`);
    error.code = result.code;
    error.details = result;
    throw error;
  }
  return result;
}
