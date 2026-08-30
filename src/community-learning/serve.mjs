import path from "node:path";
import { projectRoot } from "../core/config.mjs";
import { listenInnerSignalCommunity } from "./listen.mjs";

function integerEnv(name, fallback, { min = 1, max = 65_535 } = {}) {
  const raw = process.env[name];
  const value = raw == null || raw === "" ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}

const host = process.env.COMMUNITY_HOST?.trim() || "127.0.0.1";
const port = integerEnv("PORT", integerEnv("COMMUNITY_PORT", 8790));
const rootDir = path.resolve(projectRoot, process.env.COMMUNITY_DATA_ROOT || "./.inner-signal-autopilot/community-learning");
const inviteCode = process.env.COMMUNITY_INVITE_CODE || "";
const moderatorKey = process.env.COMMUNITY_MODERATOR_KEY || "";
const sessionDays = integerEnv("COMMUNITY_SESSION_DAYS", 30, { min: 1, max: 365 });
const mainAppUrl = process.env.MAIN_APP_URL || "http://localhost:8787";

const listener = await listenInnerSignalCommunity({ rootDir, host, port, inviteCode, moderatorKey, sessionDays, mainAppUrl });
console.log(`InnerSignal Commons listening on ${listener.url}`);
console.log(host === "127.0.0.1" ? "Local invitation pilot: data remains on this machine." : "Network mode: invitation code enforcement is active.");
