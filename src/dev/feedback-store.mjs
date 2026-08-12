import fs from "node:fs/promises";
import path from "node:path";

const RATINGS = new Set(["good", "needs-work", "too-slow"]);

function safe(value, max = 2000) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

async function findLedger(ledgerDir, ledgerId) {
  let names = [];
  try { names = await fs.readdir(ledgerDir); } catch { return null; }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const payload = JSON.parse(await fs.readFile(path.join(ledgerDir, name), "utf8"));
      if (payload?.ledgerId === ledgerId) return { name, payload };
    } catch { /* ignore unrelated/corrupt file */ }
  }
  return null;
}

export async function recordDevelopmentFeedback(config, input = {}) {
  const rating = safe(input.rating, 32);
  if (!RATINGS.has(rating)) throw new Error("Development feedback rating is invalid.");
  const ledgerId = safe(input.ledgerId, 128).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!ledgerId) throw new Error("Development feedback requires a decision ledger ID.");
  const ledger = await findLedger(config.ledgerDir, ledgerId);
  const record = {
    format: "inner-signal-development-case-v1",
    at: new Date().toISOString(),
    feedback: {
      ledgerId,
      rating,
      note: safe(input.note),
      processingTier: safe(input.processingTier, 64),
      processingMs: Number.isFinite(Number(input.processingMs)) ? Number(input.processingMs) : null,
      graphBundleVersion: safe(input.graphBundleVersion, 128)
    },
    ledgerFound: Boolean(ledger),
    ledgerFile: ledger?.name ?? null,
    ledger: ledger?.payload ?? null,
    automationState: rating === "good" ? "reference-positive" : "pending-development-review"
  };
  const dir = path.join(config.autopilotStateDir, "development-feedback");
  await fs.mkdir(dir, { recursive: true });
  const stamp = record.at.replace(/[:.]/g, "-");
  const filePath = path.join(dir, `${stamp}-${ledgerId}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { ok: true, record, filePath };
}
