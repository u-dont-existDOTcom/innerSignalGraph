import { createInnerSignalServer } from "./create-server.mjs";
import { createPrivateTherapyModelRuntime } from "../supervisor/private-therapy-model-runtime.mjs";
import { createPrivateTherapyTurnController } from "../supervisor/private-therapy-turn-controller.mjs";
import { createPrivateSupervisorDraftService } from "../supervisor/private-supervisor-draft.mjs";
import { createRunnerTrialController } from "../runner-trial/trial-controller.mjs";

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Start Inner Signal on IPv4 loopback and, when the OS supports it, IPv6
 * loopback too. The application remains local-only; it never binds to a LAN
 * interface. `localhost` and `127.0.0.1` therefore both work on normal Linux
 * configurations without exposing therapy traffic to the local network.
 */
export async function listenInnerSignalLoopback({
  config,
  providers,
  privateCaseStore = null,
  privateCaseAccessService = null,
  privateAuthContext = null,
  privateTherapyController = null,
  privateSupervisorService = null,
  runnerTrialEvents = null,
  port = config.port
}) {
  const privateCaseSource = privateCaseAccessService ?? privateCaseStore;
  // With INNER_SIGNAL_RUNNER_TRIAL on, both listeners share the trial's controller and its event hub, so one case's turns are
  // still taken one at a time and each page's stream hears its own turn whichever address it used. It stops startup when the
  // trial can't be built (no vault, or settings that don't pass their checks), before anything listens.
  const runnerTrial = config.runnerTrialEnabled === true && !privateTherapyController
    ? createRunnerTrialController({ privateCaseSource, config })
    : null;
  const sharedPrivateTherapyController = privateTherapyController ?? runnerTrial?.controller ?? (privateCaseSource
    ? createPrivateTherapyTurnController({
        privateCaseSource,
        modelRuntime: createPrivateTherapyModelRuntime({ privateCaseSource, providers, config }),
        responseEvidence: { enforced: config.responseEvidenceEnforced === true },
        maximumInvocationAttempts: config.privateRuntimeInvocationAttempts ?? 2
      })
    : null);
  const sharedRunnerTrialEvents = runnerTrial?.events ?? runnerTrialEvents;
  // One supervisor draft service for both listeners, so one case's reviews are taken one at a time across them.
  const sharedPrivateSupervisorService = privateSupervisorService ?? (privateCaseSource
    ? createPrivateSupervisorDraftService({
        privateCaseSource,
        modelRuntime: createPrivateTherapyModelRuntime({ privateCaseSource, providers, config }),
        maximumInvocationAttempts: config.privateRuntimeInvocationAttempts ?? 2
      })
    : null);
  const serverOptions = {
    config,
    providers,
    privateCaseStore,
    privateCaseAccessService,
    privateAuthContext,
    privateTherapyController: sharedPrivateTherapyController,
    privateSupervisorService: sharedPrivateSupervisorService,
    runnerTrialEvents: sharedRunnerTrialEvents,
    // The trial's settings, so /health can show the page its arrangement.
    runnerTrialSettings: runnerTrial?.settings ?? null
  };
  const ipv4 = createInnerSignalServer(serverOptions);
  await listen(ipv4, port, "127.0.0.1");
  const actualPort = ipv4.address().port;

  let ipv6 = null;
  try {
    ipv6 = createInnerSignalServer(serverOptions);
    await listen(ipv6, actualPort, "::1");
  } catch (error) {
    await closeServer(ipv6).catch(() => {});
    ipv6 = null;
    if (!["EADDRNOTAVAIL", "EAFNOSUPPORT", "EPROTONOSUPPORT", "EINVAL", "EADDRINUSE"].includes(error?.code)) {
      await closeServer(ipv4).catch(() => {});
      throw error;
    }
  }

  return {
    port: actualPort,
    url: `http://localhost:${actualPort}`,
    ipv4Url: `http://127.0.0.1:${actualPort}`,
    ipv6Available: Boolean(ipv6),
    servers: [ipv4, ...(ipv6 ? [ipv6] : [])],
    async close() {
      await Promise.all([closeServer(ipv4), closeServer(ipv6)]);
    }
  };
}
