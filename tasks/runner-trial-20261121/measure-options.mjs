// The measurement harness's command line (measure.mjs), kept apart from it so a test can read it: loading measure.mjs makes its
// results folder and runs its command at once. Nothing here calls a model.

// The arguments after the command, read as the harness has always read them: each --name takes the argument after it as its value,
// so a flag with no value (--number-now) is present with the next option, or nothing, as its value.
export function parseHarnessArgs(argv) {
  return Object.fromEntries(argv.reduce((pairs, value, index, all) => (value.startsWith("--") ? [...pairs, [value.slice(2), all[index + 1]]] : pairs), []));
}

// What batch gives the runtime from its command line, with the arm's own settings, spread into createRunnerTrialRuntime:
//   --provisional-levels acted_or_about_to,wants_to_die   also a provisional reply for someone who wants to die (design, section 4);
//                                                         without it, each arm's default (acted_or_about_to only)
//   --number-now                                          INNER_SIGNAL_RUNNER_NUMBER_NOW's runtime option (design, section 9b). It
//                                                         takes no value, so "--number-now off" is refused, never read as on.
export function batchRuntimeOptions(args, armSettings = {}) {
  const flag = args["number-now"];
  if (flag !== undefined && !String(flag).startsWith("--")) throw new Error("--number-now takes no value.");
  return {
    settings: { ...armSettings, ...(args["provisional-levels"] ? { provisionalLevels: args["provisional-levels"].split(",") } : {}) },
    numberNowEnabled: Object.hasOwn(args, "number-now")
  };
}

// A turn's crisis reading in batch's per-turn results: its level and reason as before, and with --number-now its number_now (null
// when the crisis reader gave no reading).
export function crisisReadingResult(crisis, { numberNowEnabled = false } = {}) {
  if (!crisis) return null;
  return { level: crisis.level, reason: crisis.reason, ...(numberNowEnabled ? { number_now: crisis.unread === true ? null : crisis.number_now === true } : {}) };
}
