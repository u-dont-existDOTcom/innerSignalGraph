import { RuntimeError } from "../core/errors.mjs";
import { readOnOffSetting } from "../core/on-off-setting.mjs";

// The runner trial's switch and setting names, with nothing else, so the app's config (src/core/config.mjs) can read them
// without loading any of the trial's code: with the switch off, a fault in the trial can't stop the app.
export const RUNNER_TRIAL_SETTING = "INNER_SIGNAL_RUNNER_TRIAL";
export const RUNNER_TRIAL_SETTINGS_FILE = "INNER_SIGNAL_RUNNER_TRIAL_SETTINGS";
export const RUNNER_CLAUDE_CONFIG_DIR = "INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR";

// Off unless set to on; any value other than on or off stops startup with a message that names the setting, never its value.
export function readRunnerTrialSwitch(raw) {
  const reading = readOnOffSetting(raw);
  if (reading === null) throw new RuntimeError(`${RUNNER_TRIAL_SETTING} must be on or off.`, { code: "BAD_CONFIG" });
  return reading;
}
