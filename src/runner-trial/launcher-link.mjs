import { RuntimeError, ValidationError } from "../core/errors.mjs";
import { RUNNER_LAUNCHER_SETTING } from "./switch.mjs";

// The channel between the trial's server and the launcher that started it (scripts/runner-launcher.mjs; docs/superpowers/specs/
// 2026-11-26-runner-journal-upload-and-tab-design.md, section 10): the launcher starts the server with an IPC channel and
// INNER_SIGNAL_RUNNER_LAUNCHER on, and the server asks it over that channel to restart it or to stop it. A message is one of two
// fixed values and carries nothing else: no case and no word.
export const LAUNCHER_MESSAGE_KIND = "inner-signal-runner-launcher";
export const LAUNCHER_ACTIONS = Object.freeze(["restart", "stop"]);

export function launcherMessage(action) {
  if (!LAUNCHER_ACTIONS.includes(action)) throw new ValidationError("The launcher is asked to restart or to stop.");
  return Object.freeze({ kind: LAUNCHER_MESSAGE_KIND, action });
}

// The action a message from the server asks for, or null for anything else.
export function readLauncherMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message) || Object.keys(message).length !== 2) return null;
  return message.kind === LAUNCHER_MESSAGE_KIND && LAUNCHER_ACTIONS.includes(message.action) ? message.action : null;
}

// The server's end of the channel. `channel` is the server's process (process.send, process.connected and its "disconnect" event), which
// the launcher gave an IPC channel. Without one the server doesn't start, so its page never offers a Restart or a Stop that can't work.
// `onGone` is called once the channel closes (the launcher is gone): it is listened for in the same step that finds the channel open, so
// a launcher that goes at any moment after, the server's start included, is never missed.
export function createRunnerLauncherLink(channel, { onGone = null } = {}) {
  if (!channel || typeof channel.send !== "function" || channel.connected !== true) {
    throw new RuntimeError(`${RUNNER_LAUNCHER_SETTING} is on, but this server has no channel to a launcher: scripts/runner-launcher.mjs starts it with one.`, { code: "BAD_CONFIG" });
  }
  if (onGone !== null) {
    if (typeof onGone !== "function" || typeof channel.once !== "function") throw new ValidationError("The launcher's going needs a function, and a channel that tells it.");
    channel.once("disconnect", onGone);
  }
  return Object.freeze({
    // Settles once the message is handed to the channel, or fails (RUNNER_LAUNCHER_UNREACHABLE) when it can't be.
    ask(action) {
      const message = launcherMessage(action);
      return new Promise((resolve, reject) => {
        const unreachable = () => reject(new RuntimeError("The launcher couldn't be reached.", { code: "RUNNER_LAUNCHER_UNREACHABLE" }));
        if (channel.connected !== true) { unreachable(); return; }
        try { channel.send(message, (error) => (error ? unreachable() : resolve())); } catch { unreachable(); }
      });
    }
  });
}

export function isRunnerLauncherLink(value) {
  return Boolean(value) && typeof value.ask === "function";
}
