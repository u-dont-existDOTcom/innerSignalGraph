import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { RUNNER_FEEDBACK_LINK_SETTING, readRunnerFeedbackLinkSwitch } from "../src/runner-trial/switch.mjs";
import { FEEDBACK_PAGE_URL } from "../src/feedback/address.mjs";

// The trial page's link to InnerSignal's feedback page (feedback place design, section 14, branch claude/feedback-place-20261122).
const read = (relative) => fs.readFile(new URL(`../${relative}`, import.meta.url), "utf8");

test("the feedback link has its own switch, off unless set on", () => {
  assert.equal(RUNNER_FEEDBACK_LINK_SETTING, "INNER_SIGNAL_RUNNER_FEEDBACK_LINK");
  assert.equal(readRunnerFeedbackLinkSwitch(undefined), false);
  assert.equal(readRunnerFeedbackLinkSwitch("on"), true);
  assert.throws(() => readRunnerFeedbackLinkSwitch("maybe"), /INNER_SIGNAL_RUNNER_FEEDBACK_LINK must be on or off/u);
});

test("the page's link opens the server's one feedback address in a new tab, hidden until /health turns it on", async () => {
  const html = await read("apps/web/index.html");
  assert.match(html, /<p id="runner-feedback" class="small runner-feedback" hidden><a id="runner-feedback-link" target="_blank" rel="noopener noreferrer">Send feedback about InnerSignal<\/a><\/p>/u);
  assert.equal(/id="runner-feedback-link"[^>]*href=/u.test(html), false, "no address in the page itself");
  const app = await read("apps/web/app.js");
  assert.match(app, /applyRunnerFeedbackLink\(health\.runnerFeedbackLink === "on" \? health\.feedbackPageUrl : null\)/u);
  const server = await read("src/server/create-server.mjs");
  assert.match(server, /feedbackPageUrl: FEEDBACK_PAGE_URL/u);
  assert.match(FEEDBACK_PAGE_URL, /^https:\/\/[A-Za-z0-9.-]+\/feedback$/u);
});
