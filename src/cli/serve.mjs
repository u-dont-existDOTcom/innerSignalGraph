import { loadConfig } from "../core/config.mjs";
import { createProviders } from "../providers/factory.mjs";
import { listenInnerSignalLoopback } from "../server/listen-loopback.mjs";
import { recoverGuidePacketCandidateOnStartup } from "../guide-packet/autopilot.mjs";
import { loadPrivateRuntimeAccessFromEnvironment, scrubPrivateCaseTokens } from "../storage/private-runtime-environment.mjs";
import { createRunnerLauncherLink } from "../runner-trial/launcher-link.mjs";

const config = loadConfig();
let listener = null;
let privateRuntime = null;
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await listener?.close();
  privateRuntime?.close();
}
const stopServer = () => { void shutdown().then(() => process.exit(0)); };
// The runner trial's launcher (scripts/runner-launcher.mjs), only with the trial and INNER_SIGNAL_RUNNER_LAUNCHER on: its IPC channel
// carries the page's Restart and Stop to it, and without the channel the server doesn't start, so the page never offers either in vain.
// The launcher owns the server's life: from here on, its channel closing (the launcher gone) stops the server, also in the middle of
// the start below, so no runner is left that its page can't restart or stop.
const runnerLauncher = config.runnerTrialEnabled === true && config.runnerLauncherEnabled === true ? createRunnerLauncherLink(process, { onGone: stopServer }) : null;
const providers = createProviders(config);
privateRuntime = await loadPrivateRuntimeAccessFromEnvironment(process.env, { responseEvidenceEnforced: config.responseEvidenceEnforced });
// The case tokens are read once, above; no subprocess this server starts (a model CLI's capability check included) inherits them
// (Codex's review 1, finding 9).
scrubPrivateCaseTokens(process.env);
listener = await listenInnerSignalLoopback({
  config,
  providers,
  privateCaseAccessService: privateRuntime?.privateCaseAccessService ?? null,
  privateAuthContext: privateRuntime?.privateAuthContext ?? null,
  privateCaseAuthContexts: privateRuntime?.privateCaseAuthContexts ?? new Map(),
  runnerLauncher
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

process.once("SIGINT", stopServer);
process.once("SIGTERM", stopServer);
