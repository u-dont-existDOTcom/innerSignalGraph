export function deriveSpeechPlaybackUi(playback, hasSelectedRoute) {
  const ready = playback.supported && hasSelectedRoute;
  let status = "Choose a route to enable voice playback.";
  if (!playback.supported) status = "Voice playback is unavailable in this browser.";
  else if (playback.state === "speaking") status = "Voice playback is speaking.";
  else if (playback.state === "paused") status = "Voice playback is paused. Resume when you choose.";
  else if (hasSelectedRoute) status = "Voice playback is ready.";

  return {
    readDisabled: !ready || playback.state !== "idle",
    pauseDisabled: !ready || playback.state !== "speaking",
    resumeDisabled: !ready || playback.state !== "paused",
    stopDisabled: !ready || playback.state === "idle",
    status
  };
}

export function createSpeechPlaybackController({
  synthesis = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  onStateChange = () => {}
} = {}) {
  const supported = Boolean(
    synthesis
    && typeof synthesis.cancel === "function"
    && typeof synthesis.speak === "function"
    && typeof synthesis.pause === "function"
    && typeof synthesis.resume === "function"
    && typeof Utterance === "function"
  );
  let state = "idle";
  let currentUtterance = null;
  let generation = 0;

  function snapshot() {
    return { supported, state };
  }

  function transition(nextState) {
    if (state === nextState) return;
    state = nextState;
    onStateChange(snapshot());
  }

  function cancelOwnedUtterance() {
    generation += 1;
    currentUtterance = null;
    try {
      synthesis.cancel();
    } catch {
      // Browser speech teardown is best-effort; ownership is already invalidated.
    }
    transition("idle");
  }

  function start(selectedRouteText) {
    if (!supported || typeof selectedRouteText !== "string" || selectedRouteText.length === 0) return false;

    cancelOwnedUtterance();
    const ownerGeneration = generation;
    let utterance;
    try {
      utterance = new Utterance(selectedRouteText);
    } catch {
      return false;
    }
    utterance.rate = 0.88;
    currentUtterance = utterance;

    const finishOwnedUtterance = () => {
      if (generation !== ownerGeneration || currentUtterance !== utterance) return;
      currentUtterance = null;
      generation += 1;
      transition("idle");
    };
    utterance.onend = finishOwnedUtterance;
    utterance.onerror = finishOwnedUtterance;

    transition("speaking");
    try {
      synthesis.speak(utterance);
    } catch {
      finishOwnedUtterance();
      return false;
    }
    return true;
  }

  function stop() {
    if (!supported) return false;
    cancelOwnedUtterance();
    return true;
  }

  function pause() {
    if (!supported || state !== "speaking" || !currentUtterance) return false;
    try {
      synthesis.pause();
    } catch {
      return false;
    }
    transition("paused");
    return true;
  }

  function resume() {
    if (!supported || state !== "paused" || !currentUtterance) return false;
    try {
      synthesis.resume();
    } catch {
      return false;
    }
    transition("speaking");
    return true;
  }

  function handleVisibilityChange(visibilityState) {
    return visibilityState === "hidden" ? pause() : false;
  }

  return Object.freeze({ handleVisibilityChange, pause, resume, snapshot, start, stop });
}
