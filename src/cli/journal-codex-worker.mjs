#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { runJournalCodexWorker } from "../journal-import/codex-worker.mjs";

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await runJournalCodexWorker(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${error?.code ?? "JOURNAL_CODEX_WORKER_FAILED"}\n`);
    process.exitCode = 1;
  }
}
