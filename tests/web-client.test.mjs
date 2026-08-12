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
