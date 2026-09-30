import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertJournalWorkExchangeRoot,
  createJournalWorkDispatchReader,
  resolveJournalWorkExchangeRoot
} from "../journal-import/work-exchange.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [command, ...options] = process.argv.slice(2);

async function main() {
  if (command !== "dispatch" || options.some((option) => option !== "--json") || options.filter((option) => option === "--json").length > 1) {
    throw Object.assign(new Error("JOURNAL_WORK_COMMAND_INVALID"), { code: "JOURNAL_WORK_COMMAND_INVALID" });
  }
  const configuredRoot = process.env.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT;
  if (!configuredRoot) throw Object.assign(new Error("JOURNAL_WORK_EXCHANGE_ROOT_REQUIRED"), { code: "JOURNAL_WORK_EXCHANGE_ROOT_REQUIRED" });
  const root = await resolveJournalWorkExchangeRoot(configuredRoot, { outside: repositoryRoot });
  await assertJournalWorkExchangeRoot(root);
  const records = await createJournalWorkDispatchReader({ root }).listDispatch();
  const now = Date.now();
  for (const record of records) {
    if (Date.parse(record.expires_at) <= now) continue;
    const { work_id, role, output_schema_name, model, effort, tier = "standard", issued_at, expires_at, answered } = record;
    process.stdout.write(`${JSON.stringify({ work_id, role, output_schema_name, model, effort, tier, issued_at, expires_at, answered })}\n`);
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${typeof error?.code === "string" ? error.code : "JOURNAL_WORK_DISPATCH_FAILED"}\n`);
  process.exitCode = 1;
}
