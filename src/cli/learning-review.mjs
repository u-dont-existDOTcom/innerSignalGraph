import { loadConfig } from "../core/config.mjs";
import { runCliMain } from "../core/cli-main.mjs";
import { getLiveLearningStore } from "../learning/live-store.mjs";

await runCliMain(async () => {
  const config = loadConfig();
  const store = getLiveLearningStore(config);
  const [command = "status", receipt, disposition] = process.argv.slice(2);
  if (command === "status") return { ok: true, command, status: await store.status() };
  if (command === "list") return { ok: true, command, records: await store.list() };
  if (command === "show") {
    if (!receipt) throw new Error("Usage: npm run learning:review -- show <ISL-LOCAL-receipt>");
    const record = await store.show(receipt);
    if (!record) throw new Error("Learning receipt was not found.");
    return { ok: true, command, record };
  }
  if (command === "decide") {
    if (!receipt || !disposition) throw new Error("Usage: npm run learning:review -- decide <ISL-LOCAL-receipt> <disposition>");
    return { ok: true, command, record: await store.decide(receipt, disposition) };
  }
  throw new Error("Learning review command must be status, list, show, or decide.");
});
