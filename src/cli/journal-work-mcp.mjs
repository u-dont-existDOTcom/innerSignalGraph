#!/usr/bin/env node
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { assertJournalWorkExchangeRoot, createJournalWorkExchange,
  journalWorkExchangeSecret, resolveJournalWorkExchangeRoot } from "../journal-import/work-exchange.mjs";
import { createJournalWorkTools } from "../server/journal-work-tools.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CASE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const PRINCIPAL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;

function option(argv, flag) {
  const index = argv.indexOf(flag);
  return index < 0 ? null : argv[index + 1];
}

export function parseJournalWorkMcpArgs(argv) {
  const configPath = option(argv, "--config");
  const principal = option(argv, "--principal");
  const tier = option(argv, "--tier");
  const stageDir = option(argv, "--stage-dir");
  if (!configPath || !path.isAbsolute(configPath) || !PRINCIPAL.test(principal ?? "")
    || (tier !== null && !["standard", "hardest"].includes(tier))
    || (argv.includes("--stage-dir") && (stageDir === null || !path.isAbsolute(stageDir) || tier === "hardest"
      || argv.filter((value) => value === "--stage-dir").length !== 1))) {
    throw new Error("Usage: journal:work:mcp -- --config <absolute private run config> --principal <name> [--tier hardest]");
  }
  return { configPath: path.normalize(configPath), principal, tier, stageDir };
}

function response(id, result) { return { jsonrpc: "2.0", id, result }; }
function toolResult(outcome) {
  const value = outcome.toolError ?? outcome.value;
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value,
    isError: Boolean(outcome.toolError) };
}

export async function runJournalWorkMcp(argv, {
  stdin = process.stdin, stdout = process.stdout, environment = process.env
} = {}) {
  const args = parseJournalWorkMcpArgs(argv);
  const config = await withOpenedRegularFile(args.configPath, async (handle, info) => {
    if ((info.mode & 0o077) !== 0) throw new Error("Private journal configuration must have mode 0600 or stricter.");
    return JSON.parse(await handle.readFile("utf8"));
  });
  const caseId = config?.target_profile?.case_id;
  if (!CASE_ID.test(caseId ?? "")) throw new Error("Private journal configuration has no valid target case.");
  const configuredRoot = environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT;
  if (!configuredRoot || !path.isAbsolute(configuredRoot)) throw new Error("Journal work exchange configuration is unavailable.");
  const secret = await journalWorkExchangeSecret(environment);
  const root = await resolveJournalWorkExchangeRoot(configuredRoot, { outside: repositoryRoot });
  await assertJournalWorkExchangeRoot(root);
  const exchange = createJournalWorkExchange({ root, secret });
  await exchange.removeStaleTemporaries();
  const tools = createJournalWorkTools({ exchange, caseId, tier: args.tier, stageDir: args.stageDir,
    authorizeCase: async () => ({ principalId: `local:${args.principal}` }) });
  const send = (message) => stdout.write(`${JSON.stringify(message)}\n`);
  const lines = readline.createInterface({ input: stdin, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    let request;
    try { request = JSON.parse(line); }
    catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON." } }); continue; }
    if (request.method === "notifications/initialized") continue;
    if (request.method === "initialize") {
      send(response(request.id, { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "inner-signal-journal-work", version: "1.0" } }));
    } else if (request.method === "tools/list") {
      send(response(request.id, { tools: tools.definitions }));
    } else if (request.method === "tools/call") {
      const outcome = await tools.call(request.params?.name, request.params?.arguments ?? {}, {});
      send(response(request.id, toolResult(outcome)));
    } else send({ jsonrpc: "2.0", id: request.id ?? null, error: { code: -32601, message: "Method not found." } });
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await runJournalWorkMcp(process.argv.slice(2)); }
  catch (error) {
    // Never include packet or answer values in diagnostics.
    process.stderr.write(`journal work MCP unavailable: ${error?.code ?? error?.name ?? "error"}\n`);
    process.exitCode = 1;
  }
}
