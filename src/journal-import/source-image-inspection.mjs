import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Bound the accepted static AST policy to exact reviewed release-source bytes.
// A stray, replaced or symlinked validator must never enable source-bound tools.
const validatorPath = fileURLToPath(new URL("./source-image-inspection.py", import.meta.url));
const VALIDATOR_SHA256 = "14d72490c08855ea4ce919e83d0ec573d693b28d41f1984817e130ac3b0f1032";
const denied = () => ({
  verified: false,
  inspected_attachment_sha256s: [],
  operations: []
});

export function sourceImageValidatorAvailable() {
  try {
    const stat = lstatSync(validatorPath);
    return stat.isFile() && !stat.isSymbolicLink()
      && createHash("sha256").update(readFileSync(validatorPath)).digest("hex")
         === VALIDATOR_SHA256;
  } catch {
    return false;
  }
}

/** Static AST inspection only. Never execute code provided by the model. */
export async function verifySourceImageInspection({ codes, statuses, attachedFiles }) {
  if (!sourceImageValidatorAvailable()) return denied();
  if (!Array.isArray(codes) || !Array.isArray(statuses) || !attachedFiles
      || typeof attachedFiles !== "object" || Array.isArray(attachedFiles)) return denied();
  const input = JSON.stringify({ codes, statuses, attached_files: attachedFiles });
  if (Buffer.byteLength(input, "utf8") > 65536) return denied();

  return await new Promise((resolve) => {
    const child = execFile("python3", ["-I", validatorPath],
      {
        timeout: 5000,
        maxBuffer: 65536,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
        encoding: "utf8"
      },
      (error, stdout) => {
        if (error) return resolve(denied());
        try {
          const response = JSON.parse(stdout);
          const allow = new Set(Object.values(attachedFiles));
          if (response?.verified !== true
              || !Array.isArray(response?.inspected_attachment_sha256s)
              || !response.inspected_attachment_sha256s.length
              || !response.inspected_attachment_sha256s.every(d => allow.has(d))
              || !Array.isArray(response?.operations)
              || !response.operations.includes("display_source_image")) return resolve(denied());
          resolve({
            verified: true,
            inspected_attachment_sha256s: response.inspected_attachment_sha256s,
            operations: response.operations
          });
        } catch {
          resolve(denied());
        }
      });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
