import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

// This separate trusted validator was not supplied with the source release.
// Do not submit a tool-permitted visual packet unless its audited executable
// is actually installed; tool-source display is not proof of safe inspection.
// Deliberate release gate. A file appearing on disk is not proof that the
// missing validator underwent independent source and safety review.
export const sourceImageValidatorAvailable=()=>false;

/** Inspect syntax only. Model-authored code is never executed by this process. */
export async function verifySourceImageInspection({ codes, statuses, attachedFiles }) {
  return new Promise((resolve) => {
    const child = execFile("python3", ["-I", fileURLToPath(new URL("./source-image-inspection.py", import.meta.url))],
      { timeout: 5000, maxBuffer: 65536, env: { PATH: process.env.PATH }, encoding: "utf8" },
      (error, stdout) => {
        if (error) return resolve({ verified: false, inspected_attachment_sha256s: [], operations: [] });
        try { resolve(JSON.parse(stdout)); }
        catch { resolve({ verified: false, inspected_attachment_sha256s: [], operations: [] }); }
      });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ codes, statuses, attached_files: attachedFiles }));
  });
}
