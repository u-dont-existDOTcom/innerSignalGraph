#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { seal } from "./seal.mjs";
import { runAudit } from "./audit.mjs";
import { score, renderReport } from "./score.mjs";
import { selfcheck } from "./selfcheck.mjs";

const USAGE = `Commands (all folders outside Git):
  seal --out SEALED_DIR [--corpus main|holdout] (default: main)
  selfcheck --sealed SEALED_DIR
  audit --sealed SEALED_DIR --out RECEIPTS_DIR (--mock | --live) [--limit N] [--samples 1|2] [--model M] [--effort E] [--concurrency 1..3]
  score --run RECEIPTS_DIR
Live audit also requires INNER_SIGNAL_EVAL_ALLOW_SUBSCRIPTION_CLI=1 and no ANTHROPIC_API_KEY.`;

function parse(argv) {
  const [command, ...args] = argv, options = {};
  const flags = new Set(["mock", "live", "help"]), values = new Set(["out", "corpus", "sealed", "run", "limit", "samples", "model", "effort", "concurrency"]);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].slice(2);
    if (!args[i].startsWith("--") || Object.hasOwn(options, key)) throw new Error("Unknown or repeated argument.");
    if (flags.has(key)) options[key] = true;
    else if (values.has(key) && args[i + 1] && !args[i + 1].startsWith("--")) options[key] = args[++i];
    else throw new Error(`Invalid argument: --${key}`);
  }
  return { command, options };
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options: o } = parse(argv);
  if (!command || command === "--help" || o.help) { console.log(USAGE); return; }
  const allowed = { seal: ["out", "corpus"], selfcheck: ["sealed"], score: ["run"], audit: ["sealed", "out", "mock", "live", "limit", "samples", "model", "effort", "concurrency"] };
  if (!allowed[command] || Object.keys(o).some((k) => !allowed[command].includes(k))) throw new Error(USAGE);
  let result;
  if (command === "seal") result = await seal({ outDir: o.out, corpus: o.corpus });
  if (command === "selfcheck") result = await selfcheck({ sealedDir: o.sealed });
  if (command === "audit") {
    if (o.mock && o.live) throw new Error("Choose exactly one of --mock and --live.");
    result = await runAudit({ sealedDir: o.sealed, outDir: o.out, mode: o.live ? "live" : o.mock ? "mock" : null,
      limit: o.limit === undefined ? null : Number(o.limit), samples: o.samples === undefined ? 1 : Number(o.samples),
      model: o.model, effort: o.effort, concurrency: o.concurrency === undefined ? 1 : Number(o.concurrency),
      onProgress: (event) => console.error(`${event.call}: ${event.outcome}${event.verdict ? ` (${event.verdict})` : ""}`) });
  }
  if (command === "score") { result = await score({ runDir: o.run }); console.log(renderReport(result)); return result; }
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e.stack ?? e); process.exitCode = 1; });
