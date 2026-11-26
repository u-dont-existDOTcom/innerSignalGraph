import { RuntimeError, ValidationError } from "../core/errors.mjs";

// What runs in the trial's server that the page's Restart and Stop must not cut short (docs/superpowers/specs/
// 2026-11-26-runner-journal-upload-and-tab-design.md, sections 4.8, 8 and 10, pull request 2). Each piece of work is admitted while the
// gate is open and counted until it ends, however it ends. Restart and Stop close the gate only while nothing runs, in the same
// synchronous step that looks, so no work can be admitted between the look and the close; once it is closed, every new piece is
// refused (RUNNER_CLOSING) until the server stops. When the launcher can't be told, the gate opens again.
//
// The kinds: a reply (a turn, and the page's reconcile, which may deliver one) and a deletion (a case's, or its kept plan's). The
// journal steps' copy and cold test join them with the build that brings them into the server (pull request 3).
export const RUNNER_WORK_KINDS = Object.freeze(["reply", "deletion"]);
export const RUNNER_CLOSING_ACTIONS = Object.freeze(["restart", "stop"]);

// Fixed words, never a case's: what a request admitted after the close is told.
const CLOSING_WORDS = Object.freeze({
  restart: "The runner is restarting: send it again once the page is back.",
  stop: "The runner is stopping."
});

export function createRunnerWorkGate() {
  let closing = null;
  const counts = new Map(RUNNER_WORK_KINDS.map((kind) => [kind, 0]));
  const running = () => Object.freeze(RUNNER_WORK_KINDS.filter((kind) => counts.get(kind) > 0));
  return Object.freeze({
    // Admitted or refused before the first await, so a close can't fall between the look and the count.
    async run(kind, operation) {
      if (!counts.has(kind)) throw new ValidationError("This isn't a kind of the runner's work.");
      if (typeof operation !== "function") throw new ValidationError("The runner's work needs a function.");
      if (closing !== null) throw new RuntimeError(CLOSING_WORDS[closing], { code: "RUNNER_CLOSING" });
      counts.set(kind, counts.get(kind) + 1);
      try { return await operation(); }
      finally { counts.set(kind, counts.get(kind) - 1); }
    },
    // The kinds of work running now, in a fixed order.
    running,
    // Closes the gate for a restart or a stop, only when it is open and nothing runs.
    close(action) {
      if (!RUNNER_CLOSING_ACTIONS.includes(action)) throw new ValidationError("The runner closes for a restart or a stop.");
      if (closing !== null) return Object.freeze({ closed: false, reason: "closing", closing });
      const busy = running();
      if (busy.length) return Object.freeze({ closed: false, reason: "busy", running: busy });
      closing = action;
      return Object.freeze({ closed: true });
    },
    reopen() { closing = null; },
    // "open", or the action it was closed for.
    state() { return closing ?? "open"; }
  });
}

export function isRunnerWorkGate(value) {
  return Boolean(value) && ["run", "running", "close", "reopen", "state"].every((name) => typeof value[name] === "function");
}
