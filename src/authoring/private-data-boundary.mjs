import fs from "node:fs";
import path from "node:path";

const FORBIDDEN_CONTENT = [
  /\b(?:OPENAI|ANTHROPIC|GITHUB|GH)_(?:API_)?(?:KEY|TOKEN)\s*=/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /"recentTranscript"\s*:/i,
  /"browser(?:Chat|Conversation)"\s*:/i,
  /\bprivate chain[- ]of[- ]thought\b/i,
  /\btherapy transcript\b/i,
  /\b(?:user|assistant):\s.{40,}/i,
  /\/(?:home|Users)\/[A-Za-z0-9._-]+\//
];

export function assertPublicAuthoringText(text, { label = "authoring content" } = {}) {
  if (typeof text !== "string") throw new TypeError(`${label} must be text.`);
  const matched = FORBIDDEN_CONTENT.find((pattern) => pattern.test(text));
  if (matched) {
    const error = new Error(`${label} violates the public authoring privacy boundary.`);
    error.code = "PRIVATE_AUTHORING_CONTENT";
    throw error;
  }
  return text;
}

export function resolveInside(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.includes("\0")) {
    const error = new Error("Authoring path must be a non-empty relative path.");
    error.code = "AUTHORING_PATH_INVALID";
    throw error;
  }
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, relative);
  if (absolute !== absoluteRoot && !absolute.startsWith(`${absoluteRoot}${path.sep}`)) {
    const error = new Error(`Authoring path escapes its root: ${relative}`);
    error.code = "AUTHORING_PATH_TRAVERSAL";
    throw error;
  }
  return absolute;
}

export function assertNoSymlinkAncestors(root, relative, { allowMissingLeaf = true } = {}) {
  const absoluteRoot = path.resolve(root);
  const absolute = resolveInside(absoluteRoot, relative);
  const parts = path.relative(absoluteRoot, absolute).split(path.sep).filter(Boolean);
  let cursor = absoluteRoot;
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      if (error.code === "ENOENT" && (allowMissingLeaf || index < parts.length - 1)) break;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      const failure = new Error(`Authoring paths may not traverse symlinks: ${relative}`);
      failure.code = "AUTHORING_SYMLINK_FORBIDDEN";
      throw failure;
    }
  }
  return absolute;
}
