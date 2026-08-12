import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

async function findLedger(config, ledgerId) {
  if (!ledgerId) return null;
  let names = [];
  try { names = await fs.readdir(config.ledgerDir); } catch { return null; }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const value = JSON.parse(await fs.readFile(path.join(config.ledgerDir, name), 'utf8'));
      if (value?.ledgerId === ledgerId) return { name, payload: value };
    } catch {}
  }
  return null;
}

export async function recordAutomaticDevelopmentIncident(config, input = {}) {
  const ledger = await findLedger(config, input.ledgerId);
  const record = {
    format: "inner-signal-development-case-v1",
    at: new Date().toISOString(),
    origin: input.origin ?? "automatic-contract",
    feedback: {
      ledgerId: input.ledgerId ?? `automatic-${randomUUID()}`,
      rating: input.rating ?? "needs-work",
      note: String(input.note ?? "Automatic runtime contract failure.").slice(0, 4000),
      processingTier: input.processingTier ?? "",
      processingMs: Number.isFinite(Number(input.processingMs)) ? Number(input.processingMs) : null,
      graphBundleVersion: input.graphBundleVersion ?? ""
    },
    incident: input.incident ?? null,
    ledgerFound: Boolean(ledger),
    ledgerFile: ledger?.name ?? null,
    ledger: ledger?.payload ?? null,
    automationState: "pending-development-review"
  };
  const dir = path.join(config.autopilotStateDir, "development-feedback");
  await fs.mkdir(dir, { recursive: true });
  const stamp = record.at.replace(/[:.]/g, '-');
  const filePath = path.join(dir, `${stamp}-automatic-${randomUUID()}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`);
  return { record, filePath };
}
