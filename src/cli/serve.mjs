import { loadConfig } from "../core/config.mjs";
import { createProviders } from "../providers/factory.mjs";
import { listenInnerSignalLoopback } from "../server/listen-loopback.mjs";
import { recoverGuidePacketCandidateOnStartup } from "../guide-packet/autopilot.mjs";
import { loadPrivateRuntimeAccessFromEnvironment } from "../storage/private-runtime-environment.mjs";

const config = loadConfig();
const providers = createProviders(config);
const privateRuntime = await loadPrivateRuntimeAccessFromEnvironment();
const listener = await listenInnerSignalLoopback({
  config,
  providers,
  privateCaseAccessService: privateRuntime?.privateCaseAccessService ?? null,
  privateAuthContext: privateRuntime?.privateAuthContext ?? null
});

console.log(`Inner Signal runtime listening on ${listener.url}`);
console.log(`IPv4 fallback: ${listener.ipv4Url}${listener.ipv6Available ? " · IPv6 localhost enabled" : ""}`);

if (config.mode === "cli") {
  void recoverGuidePacketCandidateOnStartup({ config, providers })
    .then((recovery) => {
      if (recovery.recovered && !recovery.skipped) console.log("Guide Packet recovery resumed from the staged candidate.");
    })
    .catch((error) => {
      console.error(`Guide Packet recovery paused safely: ${error.message}`);
    });
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await listener.close();
  privateRuntime?.close();
}
process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
