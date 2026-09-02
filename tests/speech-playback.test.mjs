import test from "node:test";
import assert from "node:assert/strict";
import {
  createSpeechPlaybackController,
  deriveSpeechPlaybackUi
} from "../apps/web/speech-playback.js";

function createHarness({ cancelEndsActiveUtterance = false } = {}) {
  const calls = [];
  const utterances = [];
  let activeUtterance = null;

  class FakeUtterance {
    constructor(value) {
      this.text = value;
      this.rate = 1;
      this.onend = null;
      this.onerror = null;
      utterances.push(this);
    }
  }

  const synthesis = {
    cancel() {
      calls.push("cancel");
      if (cancelEndsActiveUtterance) activeUtterance?.onend?.();
    },
    speak(utterance) {
      calls.push(`speak:${utterance.text}`);
      activeUtterance = utterance;
    },
    pause() {
      calls.push("pause");
    },
    resume() {
      calls.push("resume");
    }
  };
  const transitions = [];
  const controller = createSpeechPlaybackController({
    synthesis,
    Utterance: FakeUtterance,
    onStateChange: (snapshot) => transitions.push(snapshot)
  });
  return { calls, controller, synthesis, transitions, utterances };
}

test("starting playback speaks the exact selected route text at rate 0.88", () => {
  const { calls, controller, utterances } = createHarness();
  const selectedRouteText = "  Keep the leading spaces.\n\nWake fully now.  ";

  assert.equal(controller.start(selectedRouteText), true);
  assert.equal(controller.snapshot().state, "speaking");
  assert.equal(utterances.length, 1);
  assert.equal(utterances[0].text, selectedRouteText);
  assert.equal(utterances[0].rate, 0.88);
  assert.deepEqual(calls, ["cancel", `speak:${selectedRouteText}`]);
});

test("replacement playback invalidates and cancels the old utterance before speaking the new one", () => {
  const { calls, controller, utterances } = createHarness({ cancelEndsActiveUtterance: true });
  controller.start("first route");
  const first = utterances[0];

  controller.start("second route");

  assert.deepEqual(calls, ["cancel", "speak:first route", "cancel", "speak:second route"]);
  assert.equal(controller.snapshot().state, "speaking");
  first.onend();
  assert.equal(controller.snapshot().state, "speaking");
});

test("Stop cancels synchronously, becomes idle, and repeated Stop actions are idempotent", () => {
  const { calls, controller } = createHarness();
  controller.start("route");

  assert.doesNotThrow(() => controller.stop());
  assert.equal(controller.snapshot().state, "idle");
  assert.doesNotThrow(() => controller.stop());
  assert.equal(controller.snapshot().state, "idle");
  assert.deepEqual(calls, ["cancel", "speak:route", "cancel", "cancel"]);
});

test("Pause and Resume are valid only for the owned active utterance", () => {
  const { calls, controller } = createHarness();
  assert.equal(controller.pause(), false);
  assert.equal(controller.resume(), false);

  controller.start("route");
  assert.equal(controller.pause(), true);
  assert.equal(controller.snapshot().state, "paused");
  assert.equal(controller.pause(), false);
  assert.equal(controller.resume(), true);
  assert.equal(controller.snapshot().state, "speaking");
  assert.equal(controller.resume(), false);
  assert.deepEqual(calls, ["cancel", "speak:route", "pause", "resume"]);
});

test("visibility interruption pauses but becoming visible never resumes automatically", () => {
  const { calls, controller } = createHarness();
  controller.start("route");

  assert.equal(controller.handleVisibilityChange("hidden"), true);
  assert.equal(controller.snapshot().state, "paused");
  assert.equal(controller.handleVisibilityChange("visible"), false);
  assert.equal(controller.snapshot().state, "paused");
  assert.equal(calls.includes("resume"), false);

  assert.equal(controller.resume(), true);
  assert.equal(controller.snapshot().state, "speaking");
  assert.deepEqual(calls, ["cancel", "speak:route", "pause", "resume"]);
});

test("delayed end or error events from an invalidated utterance cannot change newer playback", () => {
  const { controller, utterances } = createHarness();
  controller.start("old route");
  const oldUtterance = utterances[0];
  controller.start("new route");
  const newUtterance = utterances[1];

  oldUtterance.onend();
  oldUtterance.onerror(new Error("stale"));
  assert.equal(controller.snapshot().state, "speaking");

  newUtterance.onend();
  assert.equal(controller.snapshot().state, "idle");
});

test("a current utterance error returns playback to idle", () => {
  const { controller, utterances } = createHarness();
  controller.start("route");
  utterances[0].onerror(new Error("speech failed"));
  assert.equal(controller.snapshot().state, "idle");
});

test("unsupported speech synthesis remains unavailable without throwing", () => {
  const transitions = [];
  const controller = createSpeechPlaybackController({
    synthesis: null,
    Utterance: null,
    onStateChange: (snapshot) => transitions.push(snapshot)
  });

  assert.deepEqual(controller.snapshot(), { supported: false, state: "idle" });
  assert.equal(controller.start("route"), false);
  assert.equal(controller.pause(), false);
  assert.equal(controller.resume(), false);
  assert.equal(controller.stop(), false);
  assert.deepEqual(transitions, []);
});

test("construction and speak failures return false and leave playback idle", () => {
  const methods = {
    cancel() {},
    speak() {},
    pause() {},
    resume() {}
  };
  class ThrowingUtterance {
    constructor() {
      throw new Error("construction failed");
    }
  }
  const constructionFailure = createSpeechPlaybackController({ synthesis: methods, Utterance: ThrowingUtterance });
  assert.equal(constructionFailure.start("route"), false);
  assert.equal(constructionFailure.snapshot().state, "idle");

  class FakeUtterance {}
  const speakFailure = createSpeechPlaybackController({
    synthesis: { ...methods, speak() { throw new Error("speak failed"); } },
    Utterance: FakeUtterance
  });
  assert.equal(speakFailure.start("route"), false);
  assert.equal(speakFailure.snapshot().state, "idle");
});

test("control availability is deterministic for unsupported, idle-ready, speaking, and paused states", () => {
  assert.deepEqual(
    deriveSpeechPlaybackUi({ supported: false, state: "idle" }, true),
    {
      readDisabled: true,
      pauseDisabled: true,
      resumeDisabled: true,
      stopDisabled: true,
      status: "Voice playback is unavailable in this browser."
    }
  );
  assert.deepEqual(
    deriveSpeechPlaybackUi({ supported: true, state: "idle" }, true),
    {
      readDisabled: false,
      pauseDisabled: true,
      resumeDisabled: true,
      stopDisabled: true,
      status: "Voice playback is ready."
    }
  );
  assert.deepEqual(
    deriveSpeechPlaybackUi({ supported: true, state: "speaking" }, true),
    {
      readDisabled: true,
      pauseDisabled: false,
      resumeDisabled: true,
      stopDisabled: false,
      status: "Voice playback is speaking."
    }
  );
  assert.deepEqual(
    deriveSpeechPlaybackUi({ supported: true, state: "paused" }, true),
    {
      readDisabled: true,
      pauseDisabled: true,
      resumeDisabled: false,
      stopDisabled: false,
      status: "Voice playback is paused. Resume when you choose."
    }
  );
  assert.deepEqual(
    deriveSpeechPlaybackUi({ supported: true, state: "idle" }, false),
    {
      readDisabled: true,
      pauseDisabled: true,
      resumeDisabled: true,
      stopDisabled: true,
      status: "Choose a route to enable voice playback."
    }
  );
});
