import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ValidationError } from "../../core/errors.mjs";
import { JOURNAL_GRAPH_CONTRACT } from "../contracts.mjs";

const parserDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(parserDirectory, "../../..");
const childModule = path.join(parserDirectory, "parser-child.mjs");
const defaults = JOURNAL_GRAPH_CONTRACT.source_defaults;
const pdfjsPackage = JSON.parse(readFileSync(path.join(projectRoot, "node_modules/pdfjs-dist/package.json"), "utf8"));
const SUPPORTED = Object.freeze({
  pdf: Object.freeze({
    mime_types: ["application/pdf"],
    adapter: "pdfjs-dist",
    installed_version: pdfjsPackage.version,
    license: pdfjsPackage.license,
    node_engines: pdfjsPackage.engines?.node ?? null,
    production_adapter: true
  }),
  text: Object.freeze({ mime_types: ["text/plain", "text/plain; charset=utf-8"], adapter: "node-utf8", installed_version: process.versions.node, production_adapter: true })
});

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

// The format a source is parsed as: PDF by extension, otherwise UTF-8 text. The runtime and the
// doctor both use this, so the doctor reports what an import will actually do.
export function sourceFormatForPath(filePath) {
  return path.extname(filePath).toLowerCase() === ".pdf" ? "pdf" : "text";
}

export function sourceParserCapabilities() {
  return structuredClone({ protocol_version: "1.0", formats: SUPPORTED });
}

// Parses either a file (inputPath) or bytes already held and verified by the caller (inputBytes),
// such as an authenticated archive. Bytes reach the parser process over IPC, and it may read no file.
export async function parseSourceFile({
  inputPath = null,
  inputBytes = null,
  format,
  timeoutMs = 30_000,
  byteLimit = defaults.file_max_bytes,
  pageLimit = defaults.file_max_pages,
  imageLimit = 100_000,
  representationByteLimit = defaults.file_max_bytes * 2,
  memoryLimitMb = 512
} = {}) {
  invariant((inputPath === null) !== (inputBytes === null), "SOURCE_INPUT_INVALID");
  if (inputBytes === null) invariant(typeof inputPath === "string" && path.isAbsolute(inputPath), "SOURCE_PATH_MUST_BE_ABSOLUTE");
  else invariant(inputBytes instanceof Uint8Array, "SOURCE_INPUT_INVALID");
  invariant(Object.hasOwn(SUPPORTED, format), "SOURCE_FORMAT_UNSUPPORTED");
  invariant(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, "PARSER_TIMEOUT_INVALID");
  invariant(Number.isSafeInteger(byteLimit) && byteLimit > 0, "SOURCE_BYTE_LIMIT_INVALID");
  invariant(Number.isSafeInteger(pageLimit) && pageLimit > 0, "SOURCE_PAGE_LIMIT_INVALID");
  if (inputBytes === null) {
    const information = await fs.lstat(inputPath);
    invariant(information.isFile() && !information.isSymbolicLink(), "SOURCE_NOT_REGULAR_FILE");
    if (information.size > byteLimit) throw new ValidationError("SOURCE_BYTE_LIMIT_EXCEEDED", { code: "SOURCE_BYTE_LIMIT_EXCEEDED" });
  } else if (inputBytes.byteLength > byteLimit) throw new ValidationError("SOURCE_BYTE_LIMIT_EXCEEDED", { code: "SOURCE_BYTE_LIMIT_EXCEEDED" });

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = fork(childModule, [], {
      execPath: process.execPath,
      execArgv: [
        `--max-old-space-size=${memoryLimitMb}`,
        "--permission",
        ...(inputBytes === null ? [`--allow-fs-read=${inputPath}`] : []),
        `--allow-fs-read=${parserDirectory}`,
        `--allow-fs-read=${path.join(projectRoot, "node_modules")}`
      ],
      cwd: projectRoot,
      env: { NODE_NO_WARNINGS: "1" },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "advanced"
    });
    const finish = (action) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new ValidationError("PARSER_TIMEOUT_EXCEEDED", { code: "PARSER_TIMEOUT_EXCEEDED" })));
    }, timeoutMs);
    timer.unref();
    child.once("error", () => finish(() => reject(new ValidationError("PARSER_PROCESS_FAILED", { code: "PARSER_PROCESS_FAILED" }))));
    child.once("exit", (code, signal) => {
      if (!settled) finish(() => reject(new ValidationError("PARSER_PROCESS_FAILED", { code: "PARSER_PROCESS_FAILED", details: { code, signal } })));
    });
    child.once("message", (message) => {
      if (!message?.ok) {
        const code = typeof message?.error?.code === "string" ? message.error.code : "PARSER_FAILED";
        finish(() => reject(new ValidationError(code, { code })));
        return;
      }
      finish(() => resolve(Object.freeze({
        ...message.result,
        parser: {
          ...message.result.parser,
          runtime: `node-${process.versions.node}`,
          isolation: {
            process_boundary: true,
            node_permission_model: true,
            network_modules_blocked: true,
            external_urls_followed: false,
            timeout_ms: timeoutMs,
            memory_limit_mb: memoryLimitMb,
            byte_limit: byteLimit,
            page_limit: pageLimit,
            image_limit: imageLimit
          }
        }
      })));
    });
    child.send({ inputPath, inputBytes, format, byteLimit, pageLimit, imageLimit, representationByteLimit });
  });
}
