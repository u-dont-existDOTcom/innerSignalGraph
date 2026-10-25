import fs from "node:fs";
import path from "node:path";

/**
 * The real location of a path: symbolic links in the part that exists are resolved, and the part
 * that doesn't exist yet (a receipt or root about to be created) is kept as written.
 */
export function realLocation(candidate) {
  let existing = path.resolve(candidate);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(existing), ...rest); }
    catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      const parent = path.dirname(existing);
      if (parent === existing) return path.join(existing, ...rest);
      rest.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

/**
 * Whether a path lies outside a directory, judged on real locations: an outside path whose ancestor
 * links back into the directory is inside, and a name inside it that merely starts with ".." (such
 * as "..private") is inside too.
 */
export function isOutside(directory, candidate) {
  const relative = path.relative(realLocation(directory), realLocation(candidate));
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}
