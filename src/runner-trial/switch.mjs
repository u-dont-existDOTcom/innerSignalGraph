import { RuntimeError } from "../core/errors.mjs";
import { readOnOffSetting } from "../core/on-off-setting.mjs";

// The runner trial's switch and setting names, with nothing else, so the app's config (src/core/config.mjs) can read them
// without loading any of the trial's code: with the switch off, a fault in the trial can't stop the app.
export const RUNNER_TRIAL_SETTING = "INNER_SIGNAL_RUNNER_TRIAL";
export const RUNNER_TRIAL_SETTINGS_FILE = "INNER_SIGNAL_RUNNER_TRIAL_SETTINGS";
export const RUNNER_CLAUDE_CONFIG_DIR = "INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR";

// The plan kept for next time (design, section 9): its own switch, off by default and off until the owner has seen the rule text.
// It means something only while INNER_SIGNAL_RUNNER_TRIAL is on; with the trial off it changes nothing.
export const RUNNER_KEPT_PLAN_SETTING = "INNER_SIGNAL_RUNNER_KEPT_PLAN";

// The emergency number at once for a message the crisis section sends there now though the person hasn't said they've acted or are
// about to (design, section 9b): its own switch, off by default and off until the owner says. Meaningful only while
// INNER_SIGNAL_RUNNER_TRIAL is on.
export const RUNNER_NUMBER_NOW_SETTING = "INNER_SIGNAL_RUNNER_NUMBER_NOW";

// The "Send feedback about InnerSignal" link (feedback place design, section 14, branch claude/feedback-place-20261122): its own
// switch, off until the feedback page is released, so the trial never links to a page that isn't there. Meaningful only while
// INNER_SIGNAL_RUNNER_TRIAL is on.
export const RUNNER_FEEDBACK_LINK_SETTING = "INNER_SIGNAL_RUNNER_FEEDBACK_LINK";

// The case the trial's page uses: the one the trial vault's credentials grant (scripts/runner-trial-start.mjs passes it). With the
// trial on, /health names it, and a page holding another case (a fresh browser makes up its own) takes it before its reconcile.
// Meaningful only while INNER_SIGNAL_RUNNER_TRIAL is on.
export const RUNNER_TRIAL_CASE_ID_SETTING = "INNER_SIGNAL_RUNNER_TRIAL_CASE_ID";
// The form the start script makes, which is also the page's own: "case-" and a random (version 4) UUID, in lowercase.
export const RUNNER_TRIAL_CASE_ID_PATTERN = /^case-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function readSwitch(raw, name) {
  const reading = readOnOffSetting(raw);
  if (reading === null) throw new RuntimeError(`${name} must be on or off.`, { code: "BAD_CONFIG" });
  return reading;
}

// Off unless set to on; any value other than on or off stops startup with a message that names the setting, never its value.
export function readRunnerTrialSwitch(raw) {
  return readSwitch(raw, RUNNER_TRIAL_SETTING);
}

// Read the same way as the trial's switch.
export function readRunnerKeptPlanSwitch(raw) {
  return readSwitch(raw, RUNNER_KEPT_PLAN_SETTING);
}

// Read the same way as the trial's switch.
export function readRunnerNumberNowSwitch(raw) {
  return readSwitch(raw, RUNNER_NUMBER_NOW_SETTING);
}

// Read the same way as the trial's switch.
export function readRunnerFeedbackLinkSwitch(raw) {
  return readSwitch(raw, RUNNER_FEEDBACK_LINK_SETTING);
}

// Absent or blank is none. Any other value must be a case id of the start script's form, or startup stops with a message that
// names the setting and never the value.
export function readRunnerTrialCaseId(raw) {
  if (raw == null || raw.trim() === "") return null;
  const value = raw.trim();
  if (!RUNNER_TRIAL_CASE_ID_PATTERN.test(value)) {
    throw new RuntimeError(`${RUNNER_TRIAL_CASE_ID_SETTING} must be a case id of the form case-<random UUID>, as scripts/runner-trial-start.mjs makes it.`, { code: "BAD_CONFIG" });
  }
  return value;
}
