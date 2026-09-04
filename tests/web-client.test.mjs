import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { runWebClientSmoke } from "../src/autopilot/web-smoke.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("local web client serves therapy, hypnosis, local-data, and app-owned route controls", async () => {
  const config = loadConfig({ mode: "mock" });
  const providers = createProviders(config);
  const result = await runWebClientSmoke({ config, providers });
  assert.equal(result.ok, true);
  assert.equal(result.checks.appOwnedReturnPresent, true);
  assert.equal(result.checks.gateRouteIsolationPresent, true);
  assert.equal(result.checks.guideGraphDeclared, true);
  assert.equal(result.checks.planTracePresent, true);
  assert.equal(result.checks.guidePacketScreenPresent, true);
});

test("browser route renderer places the app-owned waking return last", async () => {
  const source = await fs.readFile(path.join(root, "apps/web/app.js"), "utf8");
  const functionStart = source.indexOf("export function renderHypnosisRoute");
  const functionEnd = source.indexOf("\n}\n\nfunction showPlan", functionStart);
  const functionText = source.slice(functionStart, functionEnd);
  assert.match(functionText, /plan\.appOwned\?\.wakingReturn/);
  assert.match(functionText, /joinParts\(\[announcement, body, plan\.appOwned\?\.wakingReturn\]\)/);
  assert.doesNotMatch(functionText, /aftercare/);
});

test("browser voice controls expose accessible deterministic playback and interruption recovery", async () => {
  const html = await fs.readFile(path.join(root, "apps/web/index.html"), "utf8");
  const app = await fs.readFile(path.join(root, "apps/web/app.js"), "utf8");
  const controller = await fs.readFile(path.join(root, "apps/web/speech-playback.js"), "utf8");

  assert.match(html, /id="speak-session"[^>]*>Read selected route aloud<\/button>/);
  assert.match(html, /id="pause-speaking"[^>]*>Pause voice<\/button>/);
  assert.match(html, /id="resume-speaking"[^>]*>Resume voice<\/button>/);
  assert.match(html, /id="stop-speaking"[^>]*>Stop voice<\/button>/);
  assert.match(html, /id="speech-playback-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(app, /createSpeechPlaybackController/);
  assert.match(app, /speechPlayback\.handleVisibilityChange\(document\.visibilityState\)/);
  assert.match(app, /window\.addEventListener\("pagehide", \(\) => speechPlayback\.stop\(\)\)/);
  assert.match(controller, /utterance\.rate = 0\.88/);

  const showPlanStart = app.indexOf("function showPlan");
  const showPlanEnd = app.indexOf("\n}\n\nfunction selectRoute", showPlanStart);
  const showPlan = app.slice(showPlanStart, showPlanEnd);
  assert.ok(showPlan.indexOf("speechPlayback.stop()") < showPlan.indexOf("currentPlan = plan"));

  const selectRouteStart = app.indexOf("function selectRoute");
  const selectRouteEnd = app.indexOf("\n}\n\nfunction guideTextList", selectRouteStart);
  const selectRoute = app.slice(selectRouteStart, selectRouteEnd);
  assert.ok(selectRoute.indexOf("speechPlayback.stop()") < selectRoute.indexOf("selectedRouteText = renderHypnosisRoute"));

  const activateTabStart = app.indexOf("function activateTab");
  const activateTabEnd = app.indexOf("\n}\n\nasync function checkHealth", activateTabStart);
  assert.match(app.slice(activateTabStart, activateTabEnd), /id !== "hypnosis".*speechPlayback\.stop\(\)/s);
});

test("roadmap policy advances routine phases without asking for logs", async () => {
  const roadmap = JSON.parse(await fs.readFile(path.join(root, "roadmap/roadmap.json"), "utf8"));
  assert.equal(roadmap.policy.advanceWithoutAsking, true);
  assert.equal(roadmap.policy.routineLogsAreInternal, true);
  assert.ok(roadmap.milestones.some((item) => item.id === "M002"));
});


test("web client exposes one-click privacy-safe recovery ZIP export", async () => {
  const html = await fs.readFile(path.join(root, "apps/web/index.html"), "utf8");
  const js = await fs.readFile(path.join(root, "apps/web/app.js"), "utf8");
  assert.match(html, /Export recovery ZIP/);
  assert.match(html, /excludes chat, therapy reasoning, development-case payloads/i);
  assert.match(js, /\/v1\/debug\/export/);
  assert.match(js, /body: JSON\.stringify\(\{ state \}\)/);
});


test("assistant messages can capture lightweight human development feedback into the exported state", async () => {
  const js = await fs.readFile(path.join(root, "apps/web/app.js"), "utf8");
  assert.match(js, /Good/);
  assert.match(js, /Needs work/);
  assert.match(js, /Too slow/);
  assert.match(js, /entry\.feedback = \{ rating, note/);
  assert.match(js, /\/v1\/debug\/feedback/);
});

test("therapy UI defaults to concise replies and exposes formulation only in explicit map-debug mode", async () => {
  const html = await fs.readFile(path.join(root, "apps/web/index.html"), "utf8");
  const js = await fs.readFile(path.join(root, "apps/web/app.js"), "utf8");
  assert.match(html, /id="therapy-response-mode"/);
  assert.match(html, /<option value="default" selected>Concise<\/option>/);
  assert.match(html, /<option value="map-debug">Map \/ debug<\/option>/);
  assert.match(js, /responseMode: \$\("#therapy-response-mode"\)/);
  assert.match(js, /entry\.responseMode === "map-debug" && entry\.mapDebug/);
  assert.match(js, /Case variables/);
  assert.match(js, /Rejected routes/);
  assert.match(js, /Next-question logic/);
});

test("web client exposes autonomous development status and only asks humans for policy decisions", async () => {
  const html = await fs.readFile(path.join(root, "apps/web/index.html"), "utf8");
  const js = await fs.readFile(path.join(root, "apps/web/app.js"), "utf8");
  assert.match(html, /Development automation/);
  assert.match(html, /Approve candidate/);
  assert.match(js, /\/v1\/dev\/status/);
  assert.match(js, /\/v1\/dev\/decision/);
  assert.match(js, /Human product decision required/);
});

test("development UI shows continuous roadmap work instead of implying it waits for another chat message", async () => {
  const js = await fs.readFile(path.join(root, "apps/web/app.js"), "utf8");
  assert.match(js, /Autonomous roadmap queued/);
  assert.match(js, /Auditing roadmap task/);
  assert.match(js, /Implementing roadmap task/);
  assert.doesNotMatch(js, /Idle — feedback and deterministic failures will be handled automatically/);
});

test("development UI keeps overall supervisor analysis visible while autonomous development runs", async () => {
  const html = await fs.readFile(path.join(root, "apps/web/index.html"), "utf8");
  const js = await fs.readFile(path.join(root, "apps/web/app.js"), "utf8");
  const css = await fs.readFile(path.join(root, "apps/web/styles.css"), "utf8");
  assert.match(html, /Overall development/);
  assert.match(html, /dev-overall-state/);
  assert.match(html, /dev-overall-detail/);
  assert.match(html, /dev-next-action/);
  assert.match(html, /dev-git-automation/);
  assert.match(js, /status\.supervisor/);
  assert.match(js, /status\.gitAutomation/);
  assert.match(js, /Diagnostics:.*pending/);
  assert.match(js, /Progress:/);
  assert.match(js, /progress\.assessment/);
  assert.match(js, /LONG_RUNNING_STAGE/);
  assert.match(js, /runtime-diagnostics/);
  assert.match(js, /BLOCKED_AUTO_RECOVERY/);
  assert.match(js, /Human action required/);
  assert.match(css, /\.dev-overall-analysis/);
});

test("web client exposes concise Guide Packet import, decision, install, rollback, and export controls", async () => {
  const html = await fs.readFile(path.join(root, "apps/web/index.html"), "utf8");
  const js = await fs.readFile(path.join(root, "apps/web/app.js"), "utf8");
  const css = await fs.readFile(path.join(root, "apps/web/styles.css"), "utf8");
  assert.match(html, /data-tab="guides"/);
  assert.match(html, /Guide Packet/);
  assert.match(html, /Import packet ZIP/);
  assert.match(html, /Behavioral decisions/);
  assert.match(html, /Guide-quality audit/);
  assert.match(html, /Source identity diff/);
  assert.match(html, /Opus source-role compilation/);
  assert.match(html, /Independent review/);
  assert.match(js, /candidate\?\.compilation/);
  assert.match(js, /candidate\?\.sourceDiff/);
  assert.match(js, /sectionDiff/);
  assert.match(js, /added .*changed .*removed/);
  assert.match(js, /candidate\?\.independentReview/);
  assert.match(js, /candidate\?\.regressionStatus/);
  assert.match(js, /regressionStatus\.results/);
  assert.match(html, /Rollback/);
  assert.match(js, /\/v1\/guides\/status/);
  assert.match(js, /\/v1\/guides\/import/);
  assert.match(js, /\/v1\/guides\/decision/);
  assert.match(js, /\/v1\/guides\/install/);
  assert.match(js, /\/v1\/guides\/rollback/);
  assert.match(js, /\/v1\/guides\/export/);
  assert.match(css, /\.guide-decision-card/);
});
