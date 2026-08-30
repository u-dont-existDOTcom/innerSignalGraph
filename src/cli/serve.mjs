import path from "node:path";
import { loadConfig } from "../core/config.mjs";
import { createProviders } from "../providers/factory.mjs";
import { listenInnerSignalLoopback } from "../server/listen-loopback.mjs";
import { recoverGuidePacketCandidateOnStartup } from "../guide-packet/autopilot.mjs";
import { listenInnerSignalCommunity } from "../community-learning/listen.mjs";

function booleanEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  if (["1", "true", "yes", "on"].includes(raw.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(raw.toLowerCase())) return false;
  throw new Error(`${name} must be true or false.`);
}

function integerEnv(name, fallback, { min = 1, max = 65_535 } = {}) {
  const raw = process.env[name];
  const value = raw == null || raw === "" ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}

const config = loadConfig();
const providers = createProviders(config);
const listener = await listenInnerSignalLoopback({ config, providers });

console.log(`Inner Signal runtime listening on ${listener.url}`);
console.log(`IPv4 fallback: ${listener.ipv4Url}${listener.ipv6Available ? " · IPv6 localhost enabled" : ""}`);

if (booleanEnv("COMMUNITY_ENABLED", true)) {
  try {
    const communityPort = integerEnv("COMMUNITY_PORT", 8790);
    const communityRoot = path.join(config.autopilotStateDir, "community-learning");
    const community = await listenInnerSignalCommunity({
      rootDir: communityRoot,
      port: communityPort,
      host: "127.0.0.1",
      inviteCode: process.env.COMMUNITY_INVITE_CODE ?? "",
      moderatorKey: process.env.COMMUNITY_MODERATOR_KEY ?? "",
      requireInviteCode: false,
      sessionDays: integerEnv("COMMUNITY_SESSION_DAYS", 30, { min: 1, max: 365 }),
      mainAppUrl: listener.url
    });
    console.log(`InnerSignal Commons listening on ${community.url}`);
  } catch (error) {
    console.error(`InnerSignal Commons did not start: ${error.message}`);
  }
}

if (config.mode === "cli") {
  void recoverGuidePacketCandidateOnStartup({ config, providers })
    .then((recovery) => {
      if (recovery.recovered && !recovery.skipped) console.log("Guide Packet recovery resumed from the staged candidate.");
    })
    .catch((error) => {
      console.error(`Guide Packet recovery paused safely: ${error.message}`);
    });
}
