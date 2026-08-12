import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../core/config.mjs";

const ROOT_ENTRIES = [
  "src", "apps", "guides", "guide-graphs", "guide-packets", "corpus", "tests", "scripts",
  "package.json", "run-autopilot.sh", ".env.cli.example"
];
const ENV_KEYS = new Set([
  "INNER_SIGNAL_MODE", "OPENAI_MODEL", "ANTHROPIC_MODEL", "ANTHROPIC_ESCALATION_MODEL",
  "RESPONSE_RENDERER_MODEL", "ADJUDICATOR_PROVIDER", "THERAPY_PROCESSING_MODE", "PORT",
  "CODEX_REASONING_EFFORT", "CLAUDE_EFFORT", "GUIDE_PACKET_ROOT"
]);

async function walk(target, root, files) {
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return;
  if (stat.isFile()) {
    files.push(path.relative(root, target));
    return;
  }
  if (!stat.isDirectory()) return;
  const entries = await fs.readdir(target, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (["node_modules", ".git", ".inner-signal-autopilot", "ledgers"].includes(entry.name)) continue;
    await walk(path.join(target, entry.name), root, files);
  }
}

async function envMaterial(root) {
  const text = await fs.readFile(path.join(root, ".env"), "utf8").catch(() => "");
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
    .filter(([key]) => ENV_KEYS.has(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export async function computeRuntimeFingerprint(root = projectRoot) {
  const files = [];
  for (const entry of ROOT_ENTRIES) await walk(path.join(root, entry), root, files);
  files.sort();
  const hash = crypto.createHash("sha256");
  hash.update("inner-signal-runtime-fingerprint-v1\n");
  for (const relative of files) {
    hash.update(`FILE:${relative}\n`);
    hash.update(await fs.readFile(path.join(root, relative)));
    hash.update("\n");
  }
  hash.update("ENV\n");
  hash.update(await envMaterial(root));
  return hash.digest("hex");
}
