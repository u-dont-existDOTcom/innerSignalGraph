import { createInnerSignalServer } from "../server/create-server.mjs";
import { RUNTIME_VERSION } from "../core/runtime-version.mjs";

async function fetchText(base, pathname) {
  const response = await fetch(`${base}${pathname}`);
  return { response, text: await response.text() };
}

export async function runWebClientSmoke({ config, providers }) {
  const server = createInnerSignalServer({ config, providers });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const [index, script, correctionLearning, style, healthResponse] = await Promise.all([
      fetchText(base, "/"),
      fetchText(base, "/app.js"),
      fetchText(base, "/correction-learning.js"),
      fetchText(base, "/styles.css"),
      fetch(`${base}/health`)
    ]);
    const health = await healthResponse.json();
    const checks = {
      indexServed: index.response.ok && index.text.includes("Inner Signal") && index.text.includes("Structured awake hypnosis"),
      scriptServed: script.response.ok && script.text.includes("renderHypnosisRoute") && script.text.includes("/v1/therapy/respond") && script.text.includes("appendPlanTrace") && script.text.includes("priorCaseSnapshot"),
      correctionLearningSelfHosted: correctionLearning.response.ok
        && correctionLearning.text.includes("detectCorrectionSignal")
        && correctionLearning.text.includes("runtimeAuthority")
        && !correctionLearning.text.includes("https://")
        && !correctionLearning.text.includes("http://"),
      styleServed: style.response.ok && style.text.includes(".gate") && style.text.includes(".transcript"),
      healthDeclaresWeb: healthResponse.ok && health.webClient?.available === true && health.version === RUNTIME_VERSION,
      appOwnedReturnPresent: script.text.includes("plan.appOwned?.wakingReturn"),
      gateRouteIsolationPresent: script.text.includes("routeId === \"continue_inward\"") && script.text.includes("routeId === \"stay_external\""),
      guideGraphDeclared: health.endpoints?.includes("/v1/plan") && Boolean(health.therapy?.graphBundleVersion),
      planTracePresent: script.text.includes("Why this route") && style.text.includes(".plan-trace"),
      guidePacketScreenPresent: index.text.includes("Guide Packet")
        && index.text.includes("Behavioral decisions")
        && index.text.includes("Source identity diff")
        && script.text.includes("/v1/guides/import")
        && script.text.includes("candidate?.independentReview"),
      liveLocalLearningPresent: index.text.includes("continue with the default local contribution")
        && index.text.includes("account-identity shielding, not anonymity")
        && script.text.includes("/v1/learning/preview")
        && script.text.includes("/v1/learning/submit")
        && script.text.includes("/v1/learning/revoke")
        && correctionLearning.text.includes("inner-signal-live-learning-evidence-v1")
        && health.endpoints?.includes("/v1/learning/preview")
    };
    return { ok: Object.values(checks).every(Boolean), base, checks };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
