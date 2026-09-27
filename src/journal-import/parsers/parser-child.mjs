import "./network-guard.mjs";

let handled = false;
let terminating = false;

function failure(error) {
  return { ok: false, error: { code: typeof error?.code === "string" ? error.code : "PARSER_FAILED" } };
}

function deliver(message) {
  if (typeof process.send !== "function" || !process.connected) return Promise.reject(new Error("PARSER_IPC_UNAVAILABLE"));
  return new Promise((resolve, reject) => {
    process.send(message, (error) => error ? reject(error) : resolve());
  });
}

function finish(exitCode = 0) {
  terminating = true;
  process.exitCode = exitCode;
  if (process.connected) process.disconnect();
}

process.on("message", async (message) => {
  if (handled) return;
  handled = true;
  try {
    if (!message || typeof message !== "object") throw Object.assign(new Error("PARSER_REQUEST_INVALID"), { code: "PARSER_REQUEST_INVALID" });
    const adapter = message.format === "pdf"
      ? await import("./pdfjs-adapter.mjs")
      : await import("./text-adapter.mjs");
    const result = message.format === "pdf"
      ? await adapter.parsePdfFile(message)
      : await adapter.parseUtf8File(message);
    await deliver({ ok: true, result });
  } catch (error) {
    try { await deliver(failure(error)); }
    catch { process.exitCode = 1; }
  } finally { finish(process.exitCode ?? 0); }
});

async function fatal(error) {
  if (terminating) return;
  try { await deliver(failure(error)); }
  catch { /* The parent will observe the non-zero exit. */ }
  finally { finish(1); }
}

process.on("uncaughtException", (error) => {
  void fatal(error);
});
process.on("unhandledRejection", (error) => {
  void fatal(error);
});
