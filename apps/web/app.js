import { createSpeechPlaybackController, deriveSpeechPlaybackUi } from "./speech-playback.js";
import { initSupervisorPanel } from "./supervisor-panel.js";

const STORAGE_KEY = "inner-signal-settings-v1";
const LEGACY_STORAGE_KEYS = ["inner-signal-runtime-v0100", "inner-signal-runtime-v093", "inner-signal-runtime-v092", "inner-signal-runtime-v091", "inner-signal-runtime-v090", "inner-signal-runtime-v080", "inner-signal-runtime-v070", "inner-signal-runtime-v060"];
const state = loadState();
let currentPlan = null;
let selectedRouteText = "";
let guidePacketStatus = null;

const speechPlayback = createSpeechPlaybackController({
  synthesis: window.speechSynthesis,
  Utterance: window.SpeechSynthesisUtterance,
  onStateChange: syncSpeechPlaybackControls
});

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

// ---- Runner trial (docs/superpowers/specs/2026-11-21-runner-trial-design.md, sections 4, 7 and 8) ----------------------------
// Everything below is used only while /health says runnerTrial is on. Model and person text is always set with textContent.
// runner-trial-page:start
// The trial's fixed words, copied from src/runner-trial/notices.mjs because the browser can't import server modules.
// tests/runner-trial-server.test.mjs checks that they are byte-identical to the server's.
const EMERGENCY_LINE = "In danger right now? Call your local emergency number: 112 in the EU (and from mobiles in many other countries), 911 in the US and Canada, 999 in the UK.";
const PROVISIONAL_PREFIX = "Provisional urgent response: ";
const THINKING_LINE = "Thinking more about the full response...";
const CLOSING_REASONS = Object.freeze({
  checks_failed: "No reply passed its checks.",
  plan_limit: "The model plan's limit is reached.",
  sign_in_needed: "A model sign-in needs renewing.",
  timeout: "It took too long.",
  refused: "A model declined to answer.",
  provider_failed: "A model call failed.",
  interrupted: "The app stopped before the reply was finished."
});
const RUNNER_PROGRESS_LABEL = "Writing and checking a reply…";
const RUNNER_ONLY_KINDS = Object.freeze(["provisional", "emergency_line", "divider"]);
// The plan kept for next time (design, section 9), used only while /health says runnerKeptPlan is on.
const RESUME_QUESTION = "Pick up where we left off?";
const RESUME_YES = "Yes";
const RESUME_FRESH = "Start fresh";
const KEPT_PLAN_DELETE_NOTE = "This removes the kept plan. Its words are still in the stored conversation, which can't be edited; deleting them too means deleting the case.";
const KEPT_PLAN_KEPT_LINE = "Kept for next time: the lines of your plan and today's date, encrypted on this computer for 30 days.";
const KEPT_PLAN_GONE_LINE = "No kept plan remains.";

// Reads the trial's newline-delimited JSON answer. Every line before the last is an event of the turn and goes to onEvent; the
// last is the reply ("final", returned) or why there is none ("error", thrown). A line split across chunks is joined first, and a
// line that isn't JSON is skipped.
async function readRunnerStream(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let last = null;
  const take = (line) => {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (!event || typeof event !== "object") return;
    if (event.type === "final" || event.type === "error") last = event;
    else onEvent(event);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    if (done) buffer += decoder.decode();
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      take(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  take(buffer);
  if (last?.type === "final") return last;
  throw new Error(last?.type === "error" && last.error ? last.error : "The reply stream ended before the reply.");
}

// The conversation item an event of the turn adds, or null: the provisional reply, headed with its prefix and followed by the
// thinking line until the full reply comes, or the emergency line, highlighted.
function runnerEventEntry(event, exchangeId, at = new Date().toISOString()) {
  if (event?.type === "provisional" && typeof event.text === "string") {
    return { role: "assistant", kind: "provisional", exchangeId, content: PROVISIONAL_PREFIX + event.text, thinking: true, at };
  }
  if (event?.type === "emergency_line") return { role: "notice", kind: "emergency_line", exchangeId, content: EMERGENCY_LINE, at };
  return null;
}

// What the stored turn showed before its reply, as conversation items, for an answer that came without live events (a JSON
// answer, a replay of a finished turn, a turn the page gets back when it loads): the provisional reply with its prefix and the
// highlighted emergency line, exactly as the live events add them. `shown` lists the kinds the live events already added.
function runnerStoredEntries(result, exchangeId, shown = [], at = new Date().toISOString()) {
  const entries = [];
  if (typeof result?.provisional === "string" && result.provisional && !shown.includes("provisional")) {
    entries.push({ ...runnerEventEntry({ type: "provisional", text: result.provisional }, exchangeId, at), thinking: false });
  }
  if (result?.emergencyLineShown === true && !shown.includes("emergency_line")) entries.push(runnerEventEntry({ type: "emergency_line" }, exchangeId, at));
  return entries;
}

// A finished turn the page gets back when it loads (the server's reconcile): the person's message, what showed before the reply,
// then the reply, or the closing notice with its reason outside it.
function runnerReplayEntries(turn, at = new Date().toISOString()) {
  if (!turn || typeof turn.exchangeId !== "string") return [];
  const entries = [];
  if (typeof turn.userMessage === "string") entries.push({ id: `${turn.exchangeId}-user`, exchangeId: turn.exchangeId, role: "user", content: turn.userMessage, at });
  entries.push(...runnerStoredEntries(turn, turn.exchangeId, [], at));
  if (typeof turn.answer === "string") {
    entries.push({
      id: `${turn.exchangeId}-assistant`,
      exchangeId: turn.exchangeId,
      role: "assistant",
      content: turn.answer,
      at,
      ...(turn.closing ? { kind: "closing", closingReason: runnerClosingReason(turn.closing) } : {})
    });
  }
  return entries;
}

// The parts of a trial turn on the page, in the order it shows them: the person's message, the provisional reply, the emergency
// line and the reply (a closing notice is the reply of a turn closed without one).
const RUNNER_TURN_PARTS = Object.freeze(["user", "provisional", "emergency_line", "reply"]);

// Which part of its turn a conversation item is, or null for an item that is none (the line a failed request left, a divider).
function runnerTurnPart(entry) {
  if (entry?.role === "user") return "user";
  if (entry?.kind === "provisional" || entry?.kind === "emergency_line") return entry.kind;
  return entry?.role === "assistant" && entry.error !== true ? "reply" : null;
}

// Whether the page (`therapy`) shows every part of a turn the server sent back.
function runnerTurnShown(therapy, turn) {
  const shown = new Set(therapy.filter((entry) => entry?.exchangeId === turn?.exchangeId).map((entry) => runnerTurnPart(entry)));
  const parts = runnerReplayEntries(turn).map((entry) => runnerTurnPart(entry));
  return parts.length > 0 && parts.every((part) => shown.has(part));
}

// Adds to the page (`therapy`, changed in place) the parts of a turn the server sent back that it doesn't show yet, and never one it
// shows already. A turn the page doesn't hold goes at the end. The missing parts of a turn it holds go into that turn, each before
// the turn's first later part, or else after the turn's last item: a page whose stream failed after the person's message gets the
// provisional reply, the emergency line and the reply there, after the line the failure left. Returns whether the page now shows
// every part of the turn.
function mergeRunnerTurn(therapy, turn, at = new Date().toISOString()) {
  for (const entry of runnerReplayEntries(turn, at)) {
    const part = runnerTurnPart(entry);
    const own = [];
    therapy.forEach((item, index) => { if (item?.exchangeId === turn.exchangeId) own.push(index); });
    if (own.some((index) => runnerTurnPart(therapy[index]) === part)) continue;
    const later = own.find((index) => RUNNER_TURN_PARTS.indexOf(runnerTurnPart(therapy[index])) > RUNNER_TURN_PARTS.indexOf(part));
    therapy.splice(later ?? (own.length ? own.at(-1) + 1 : therapy.length), 0, entry);
  }
  return runnerTurnShown(therapy, turn);
}

// What the page shows of the turns its reconcile got back (design, section 8), changing `therapy` in place, and the cursor that
// follows. Each turn is merged into the page (mergeRunnerTurn), except one still coming in on this page (`inFlight`), which its own
// stream shows. The cursor moves through the turns in order while the page shows each one whole, and stops before the first it
// doesn't, so a later reconcile gets that one back.
function showRunnerTurns(therapy, turns, shownThrough, inFlight = new Set(), at = new Date().toISOString()) {
  let cursor = shownThrough;
  let advancing = true;
  for (const turn of turns) {
    if (typeof turn?.exchangeId !== "string") continue;
    const shown = !inFlight.has(turn.exchangeId) && mergeRunnerTurn(therapy, turn, at);
    advancing = advancing && shown;
    if (advancing) cursor = turn.exchangeId;
  }
  return cursor;
}

// Whether the page shows the reply of every turn it holds after the cursor `shownThrough` (of every turn it holds, when it doesn't
// show the cursor's turn), so the cursor may move to a turn just shown without passing one whose stream failed: that turn stays
// after the cursor, and a later reconcile brings back what it missed.
function runnerRepliesShownAfter(therapy, shownThrough) {
  const from = therapy.findLastIndex((entry) => typeof shownThrough === "string" && entry?.exchangeId === shownThrough) + 1;
  const parts = new Map();
  for (const entry of therapy.slice(from)) {
    if (typeof entry?.exchangeId !== "string") continue;
    if (!parts.has(entry.exchangeId)) parts.set(entry.exchangeId, new Set());
    parts.get(entry.exchangeId).add(runnerTurnPart(entry));
  }
  return [...parts.values()].every((shown) => shown.has("reply"));
}

// Why a turn closed without a reply, in plain words, shown outside the reply.
function runnerClosingReason(closing) {
  return closing && typeof closing.reason_code === "string" && Object.hasOwn(CLOSING_REASONS, closing.reason_code) ? CLOSING_REASONS[closing.reason_code] : "";
}

function runnerProgressText(step, startedAt, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${RUNNER_PROGRESS_LABEL} ${typeof step === "string" && step ? `${step} · ` : ""}${seconds} s`;
}

// What the page asks the server for when it loads (design, section 8). The page keeps no transcript across a reload, only the
// exchange of the last turn it showed: that cursor is used only while the page still shows that turn, and the server then sends
// the turns after it. A page that doesn't show it (a reload) asks for the whole current conversation, with what each turn showed.
function runnerReconcileRequest(caseId, therapy, shownThrough) {
  const showsEarlierTurns = typeof shownThrough === "string" && Array.isArray(therapy) && therapy.some((entry) => entry?.exchangeId === shownThrough);
  return showsEarlierTurns ? { caseId, afterExchangeId: shownThrough } : { caseId, conversation: "current" };
}

// What the page says outside the reply after a turn that kept a plan ("kept") or deleted the kept plan ("deleted"); nothing otherwise.
function keptPlanStatusText(action) {
  return action === "kept" ? KEPT_PLAN_KEPT_LINE : action === "deleted" ? KEPT_PLAN_GONE_LINE : "";
}

// Whether the page asks "Pick up where we left off?" when it loads: the case has a conversation and the next message opens a new
// one. The server says nothing of a kept plan, so the question shows whether or not one is kept.
function runnerAsksResumeOnLoad(resume) {
  return resume?.hasConversation === true && resume?.nextStartsNewConversation === true;
}

// What the next message tells the server of the answer: Yes (true) or Start fresh (false), only while the question is shown and
// only once it is answered. An unanswered question sends nothing, which the server reads as no Yes.
function runnerResumeField(shown, answer) {
  return shown === true && typeof answer === "boolean" ? { resumeConfirmed: answer } : {};
}

// The fields of the page's state that aren't the case's: what the person set, the case id (the next message starts an empty case
// under it), how the server stores cases and whether this browser holds data of older versions. Every other field is the case's,
// a field added later included.
const PAGE_STATE_KEPT_AFTER_DELETION = Object.freeze(["settings", "caseId", "privateStorageMode", "legacyPrivateDataDetected"]);

// After "Delete this case" succeeded: the state keeps only what isn't the case's, and every other field takes its empty value
// (`empty` is the state of a page that never held a case), so the backup export and the recovery ZIP hold nothing of the case.
function forgetDeletedCase(pageState, empty) {
  const kept = Object.fromEntries(PAGE_STATE_KEPT_AFTER_DELETION.filter((key) => Object.hasOwn(pageState, key)).map((key) => [key, pageState[key]]));
  for (const key of Object.keys(pageState)) delete pageState[key];
  return Object.assign(pageState, empty, kept);
}

// The case the page takes when it loads with the trial on: the one /health names (the case the trial vault's credentials grant,
// INNER_SIGNAL_RUNNER_TRIAL_CASE_ID) when it isn't the page's own, and null otherwise. Only an id of the start script's form, which
// is also the page's own (scripts/runner-trial-start.mjs).
const RUNNER_CASE_ID = /^case-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function runnerCaseToAdopt(health, caseId) {
  if (health?.runnerTrial !== "on" || typeof health.runnerCaseId !== "string" || !RUNNER_CASE_ID.test(health.runnerCaseId)) return null;
  return health.runnerCaseId === caseId ? null : health.runnerCaseId;
}

// The fields a page that takes the trial's case keeps: what the person set, and whether this browser holds data of older versions
// (the browser's, not a case's). Every other field takes a fresh page's value (`empty`), with the trial's case id. The page keeps no
// transcript of its own, so the reconcile that follows brings the case's conversation back.
const PAGE_STATE_KEPT_ON_ADOPTION = Object.freeze(["settings", "legacyPrivateDataDetected"]);
function adoptRunnerCase(pageState, empty, caseId) {
  const kept = Object.fromEntries(PAGE_STATE_KEPT_ON_ADOPTION.filter((key) => Object.hasOwn(pageState, key)).map((key) => [key, pageState[key]]));
  for (const key of Object.keys(pageState)) delete pageState[key];
  return Object.assign(pageState, empty, kept, { caseId });
}

// The badge's words for the trial's arrangement (/health's runnerArrangement): who reads, writes and checks. Fixed words only;
// an arrangement it can't read gives "Runner trial" alone, never the usual app's models.
const RUNNER_PROVIDER_NAMES = Object.freeze({ claude: "Claude", codex: "GPT" });
const RUNNER_WRITER_WORDS = Object.freeze({ focused: "focused writer", whole: "whole writer" });
const RUNNER_CHECKER_WORDS = Object.freeze({ whole: "one whole checker", split: "split checkers" });
function runnerArrangementText(arrangement) {
  const word = (words, key) => (typeof key === "string" && Object.hasOwn(words, key) ? words[key] : null);
  const names = (list) => (Array.isArray(list) && list.length > 0 && list.every((provider) => word(RUNNER_PROVIDER_NAMES, provider)) ? list.map((provider) => RUNNER_PROVIDER_NAMES[provider]).join(" + ") : null);
  const parts = [names(arrangement?.readers), word(RUNNER_WRITER_WORDS, arrangement?.writerMode), names(arrangement?.writer), word(RUNNER_CHECKER_WORDS, arrangement?.checkerMode), names(arrangement?.checkers)];
  if (parts.some((part) => part === null)) return "Runner trial";
  const [readers, writer, writes, checkers, checks] = parts;
  return `Runner trial: readers on ${readers} · ${writer} on ${writes} · ${checkers} on ${checks}`;
}
// runner-trial-page:end

// `inFlight`: the exchanges of the trial turns this page is still receiving, which a reconcile leaves to their own stream.
// `keptPlanOn`: the plan kept for next time is on; `hasConversation`: the case has a conversation (from the server, or a turn sent);
// `resumeShown` and `resumeAnswer`: "Pick up where we left off?" is shown, and its answer (true, false, or null before one).
const runnerTrial = { on: false, newConversation: false, inFlight: new Set(), keptPlanOn: false, hasConversation: false, resumeShown: false, resumeAnswer: null };
const RUNNER_RECONCILE_LABEL = "Looking for a reply that finished while this page was closed…";
let healthChecked = Promise.resolve();

function syncRunnerNewConversation() {
  const button = $("#runner-new-conversation");
  button.setAttribute("aria-pressed", runnerTrial.newConversation ? "true" : "false");
  button.classList.toggle("selected", runnerTrial.newConversation);
}

function applyRunnerTrial(on) {
  runnerTrial.on = on;
  $("#runner-trial-banner").hidden = !on;
  const line = $("#runner-emergency-line");
  line.textContent = on ? EMERGENCY_LINE : "";
  line.hidden = !on;
  $("#runner-new-conversation").hidden = !on;
  $("#runner-delete-case").hidden = !on;
  // The usual app's pipeline sentences and its reasoning-depth menu don't apply to the trial; "not emergency care" stays.
  $("#therapy-pipeline-description").hidden = on;
  $("#therapy-processing-mode-label").hidden = on;
  if (!on) runnerTrial.newConversation = false;
  syncRunnerNewConversation();
}

// The trial page's link to InnerSignal's feedback page (feedback place design, section 14): shown only while /health says
// runnerFeedbackLink is on and the runner trial is on, with the one address the server gives, and only an https address whose path
// is /feedback. It opens in a new tab and sends no referrer.
function applyRunnerFeedbackLink(address) {
  const valid = runnerTrial.on && typeof address === "string" && /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/feedback$/u.test(address);
  const link = $("#runner-feedback-link");
  if (valid) link.setAttribute("href", address);
  else link.removeAttribute("href");
  $("#runner-feedback").hidden = !valid;
}

// The plan kept for next time (design, section 9): the question a new conversation opens with, its two answers, the line that says
// what happened to the kept plan, and the button that deletes it. Every word is fixed and set with textContent.
function applyRunnerKeptPlan(on) {
  runnerTrial.keptPlanOn = on && runnerTrial.on;
  $("#runner-delete-kept-plan").hidden = !runnerTrial.keptPlanOn;
  $("#runner-resume-question").textContent = runnerTrial.keptPlanOn ? RESUME_QUESTION : "";
  $("#runner-resume-yes").textContent = runnerTrial.keptPlanOn ? RESUME_YES : "";
  $("#runner-resume-fresh").textContent = runnerTrial.keptPlanOn ? RESUME_FRESH : "";
  if (!runnerTrial.keptPlanOn) {
    showRunnerResume(false);
    setRunnerKeptPlanStatus("");
  }
}

function syncRunnerResume() {
  for (const [selector, value] of [["#runner-resume-yes", true], ["#runner-resume-fresh", false]]) {
    const button = $(selector);
    button.setAttribute("aria-pressed", runnerTrial.resumeAnswer === value ? "true" : "false");
    button.classList.toggle("selected", runnerTrial.resumeAnswer === value);
  }
}

// Shows "Pick up where we left off?" (before anything else of the new conversation, above the message box) or hides it. A question
// shown anew starts unanswered; one already shown keeps the answer the person gave.
function showRunnerResume(show) {
  if (show === true && runnerTrial.resumeShown) return;
  runnerTrial.resumeShown = show === true && runnerTrial.keptPlanOn;
  runnerTrial.resumeAnswer = null;
  $("#runner-resume").hidden = !runnerTrial.resumeShown;
  syncRunnerResume();
}

function setRunnerKeptPlanStatus(words) {
  const line = $("#runner-kept-plan-status");
  line.textContent = words;
  line.hidden = !words;
}

// When the page loads with the trial on (design, section 8): the server closes any turn of this case that a restart left
// unfinished (and delivers one that was already approved), then sends back the turns that finished after the last one this page
// showed, such as a reply that came while the page was closed. While a turn of the case is still running on the server, it waits.
// A turn the page holds only in part (its stream failed) gets what it missed; the cursor passes only turns the page shows whole.
async function reconcileRunnerCase() {
  const progress = $("#runner-progress");
  progress.hidden = false;
  progress.textContent = RUNNER_RECONCILE_LABEL;
  try {
    const response = await fetch("/v1/runner/reconcile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runnerReconcileRequest(state.caseId, state.therapy, state.runnerShownThrough))
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload?.turns)) return;
    // With the kept plan on: a new conversation opens with "Pick up where we left off?" whenever an earlier one exists.
    if (runnerTrial.keptPlanOn && payload.resume) {
      runnerTrial.hasConversation = payload.resume.hasConversation === true;
      if (runnerAsksResumeOnLoad(payload.resume)) showRunnerResume(true);
    }
    state.runnerShownThrough = showRunnerTurns(state.therapy, payload.turns, state.runnerShownThrough, runnerTrial.inFlight);
    if (payload.turns.length) {
      saveState();
      renderTherapy();
    }
  } catch {
    // The page works without it: the next message closes what a restart left unfinished.
  } finally {
    progress.hidden = true;
    progress.textContent = "";
  }
}

// One trial turn on the page: the indicator with the step and the seconds so far, and the items its events add.
function beginRunnerTurn(exchangeId) {
  const newConversation = runnerTrial.newConversation;
  runnerTrial.newConversation = false;
  syncRunnerNewConversation();
  // The answer to "Pick up where we left off?" goes with this message, and the question and the kept-plan line go.
  const resume = runnerResumeField(runnerTrial.resumeShown, runnerTrial.resumeAnswer);
  if (runnerTrial.resumeShown) showRunnerResume(false);
  if (runnerTrial.keptPlanOn) setRunnerKeptPlanStatus("");
  runnerTrial.hasConversation = true;
  const progress = $("#runner-progress");
  const startedAt = Date.now();
  let step = "";
  const showProgress = () => { progress.textContent = runnerProgressText(step, startedAt); };
  progress.hidden = false;
  showProgress();
  const timer = setInterval(showProgress, 1000);
  const added = [];
  let finished = false;
  runnerTrial.inFlight.add(exchangeId);
  return {
    newConversation,
    resume,
    onEvent(event) {
      if (finished) return;
      if (event?.type === "status") {
        if (typeof event.step === "string") step = event.step;
        showProgress();
        return;
      }
      const entry = runnerEventEntry(event, exchangeId);
      if (!entry) return;
      added.push(entry);
      state.therapy.push(entry);
      renderTherapy();
    },
    // `result` is the answer, when there is one: what its stored turn showed and no live event brought (a JSON answer, a replay)
    // is added here, as the stream would have added it. The page writes the reply or the failure's line right after this, with
    // no wait in between, so a reconcile never sees the turn between the two.
    finish(result = null) {
      if (finished) return;
      finished = true;
      runnerTrial.inFlight.delete(exchangeId);
      clearInterval(timer);
      progress.hidden = true;
      progress.textContent = "";
      for (const entry of added) entry.thinking = false;
      if (result) state.therapy.push(...runnerStoredEntries(result, exchangeId, added.map((entry) => entry.kind)));
      renderTherapy();
    }
  };
}

async function postRunnerTurn(body, turn) {
  const response = await fetch("/v1/therapy/respond", {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/x-ndjson" },
    body: JSON.stringify(body)
  });
  if (response.ok && response.body && (response.headers.get("content-type") || "").includes("application/x-ndjson")) {
    return readRunnerStream(response, (event) => turn.onEvent(event));
  }
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}.`);
  return payload;
}

function runnerLine(className, words) {
  const line = document.createElement("p");
  line.className = className;
  line.textContent = words;
  return line;
}

// The state of a page that holds no case: what a first visit starts from, and every field's value once "Delete this case" ran.
function emptyPageState() {
  return {
    therapy: [],
    hypnosisHistory: [],
    settings: {},
    caseId: `case-${crypto.randomUUID()}`,
    // The runner trial: the exchange of the last turn this page showed, so a page that still shows it gets back only what
    // finished after it.
    runnerShownThrough: null,
    caseSnapshot: null,
    interventionContract: null,
    priorProcessingTier: "",
    durableCaseState: null,
    caseStateView: null,
    lastStateDiff: null,
    trackerEntries: [],
    journalEntries: [],
    lastHandoffId: null,
    handoffStatus: null,
    privateStorageMode: "unknown",
    legacyPrivateDataDetected: false
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const empty = emptyPageState();
    return {
      ...empty,
      settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {},
      caseId: typeof parsed.caseId === "string" ? parsed.caseId : empty.caseId,
      runnerShownThrough: typeof parsed.runnerShownThrough === "string" ? parsed.runnerShownThrough : null,
      legacyPrivateDataDetected: LEGACY_STORAGE_KEYS.some((key) => localStorage.getItem(key))
    };
  } catch {
    return emptyPageState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: state.settings, caseId: state.caseId, ...(state.runnerShownThrough ? { runnerShownThrough: state.runnerShownThrough } : {}) }));
  renderDataSummary();
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
  }
  button.disabled = busy;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function compactPlan(plan, responseContract = null) {
  if (!plan || typeof plan !== "object") return null;
  const rawSecondary = Array.isArray(plan.displayTrace?.secondaryJobs) ? plan.displayTrace.secondaryJobs : (Array.isArray(plan.secondaryJobs) ? plan.secondaryJobs : []);
  const realizedIds = new Set(Array.isArray(responseContract?.realizedNodeIds) ? responseContract.realizedNodeIds : []);
  const secondaryJobs = realizedIds.size ? rawSecondary.filter((item) => realizedIds.has(item.id)) : rawSecondary;
  return {
    graphBundleVersion: plan.graphBundleVersion || null,
    primaryJob: plan.primaryJob || null,
    secondaryJobs,
    deferredNodes: Array.isArray(plan.displayTrace?.deferredNodes) ? plan.displayTrace.deferredNodes : [],
    blockedNodes: Array.isArray(plan.displayTrace?.blockedNodes) ? plan.displayTrace.blockedNodes : [],
    nextQuestion: text(plan.nextQuestion),
    sequencingNotes: Array.isArray(plan.graphTrace?.sequencingNotes) ? plan.graphTrace.sequencingNotes : [],
    coverageWarning: Array.isArray(responseContract?.missingRealizationNodeIds) && responseContract.missingRealizationNodeIds.length
      ? `Renderer omitted: ${responseContract.missingRealizationNodeIds.join(", ")}`
      : ""
  };
}

function appendPlanTrace(block, plan) {
  if (!plan?.primaryJob) return;
  const details = document.createElement("details");
  details.className = "plan-trace";
  const summary = document.createElement("summary");
  summary.textContent = "Why this route";
  details.append(summary);

  const rows = [
    ["Primary job", plan.primaryJob.title],
    ["Secondary", (plan.secondaryJobs || []).map((item) => item.title).join("; ")],
    ["Deferred", (plan.deferredNodes || []).map((item) => item.title).join("; ")],
    ["Blocked", (plan.blockedNodes || []).map((item) => item.title).join("; ")],
    ["Next discriminating question", plan.nextQuestion],
    ["Graph", plan.graphBundleVersion],
    ["Renderer coverage", plan.coverageWarning]
  ].filter(([, value]) => text(value));
  const list = document.createElement("dl");
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    list.append(term, description);
  }
  details.append(list);
  block.append(details);
}


function setMessageFeedback(entry, rating) {
  const note = rating === "needs-work"
    ? (prompt("Optional: what felt wrong or missing? One sentence is enough.", entry.feedback?.note || "") || "").trim()
    : "";
  entry.feedback = { rating, note, at: new Date().toISOString() };
  saveState();
  renderTherapy();
  if (entry.ledgerId) {
    postJson("/v1/debug/feedback", {
      ledgerId: entry.ledgerId,
      rating,
      note,
      processingTier: entry.processingTier || "",
      processingMs: entry.processingMs || null,
      graphBundleVersion: entry.graphBundleVersion || ""
    }).catch(() => {});
  }
}

function appendFeedbackControls(block, entry) {
  const row = document.createElement("div");
  row.className = "feedback-controls";
  const choices = [["good", "Good"], ["needs-work", "Needs work"], ["too-slow", "Too slow"]];
  for (const [rating, label] of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "feedback-button";
    if (entry.feedback?.rating === rating) button.classList.add("selected");
    button.textContent = label;
    button.addEventListener("click", () => setMessageFeedback(entry, rating));
    row.append(button);
  }
  if (entry.feedback?.note) {
    const note = document.createElement("span");
    note.className = "feedback-note";
    note.textContent = entry.feedback.note;
    row.append(note);
  }
  block.append(row);
}

function renderTherapy() {
  const root = $("#therapy-transcript");
  root.replaceChildren();
  if (!state.therapy.length) {
    const empty = document.createElement("p");
    empty.className = "small";
    empty.textContent = "No local transcript yet.";
    root.append(empty);
    return;
  }
  for (const entry of state.therapy) {
    // Runner trial items: the emergency line put into the conversation, and where a new conversation began.
    if (entry.kind === "emergency_line") {
      const item = runnerLine("runner-emergency", entry.content);
      item.setAttribute("role", "note");
      root.append(item);
      continue;
    }
    if (entry.kind === "divider") {
      root.append(runnerLine("runner-divider", entry.content));
      continue;
    }
    const block = document.createElement("div");
    block.className = `message ${entry.role === "user" ? "user" : "assistant"}`;
    const role = document.createElement("span");
    role.className = "role";
    role.textContent = entry.role === "user" ? "You" : "Inner Signal";
    const body = document.createElement("div");
    body.textContent = entry.content;
    block.append(role, body);
    if (entry.role === "assistant" && entry.kind !== "provisional") {
      appendPlanTrace(block, entry.plan);
      if (entry.processingTier && entry.kind !== "closing") {
        const tier = document.createElement("span");
        tier.className = "processing-tier";
        const timing = Number.isFinite(entry.processingMs) ? ` · ${(entry.processingMs / 1000).toFixed(1)}s` : "";
        tier.textContent = `Reasoning: ${entry.processingTier}${entry.routingReason ? ` · ${entry.routingReason}` : ""}${timing}`;
        block.append(tier);
      }
      appendFeedbackControls(block, entry);
    }
    root.append(block);
    // Outside the reply: the thinking line under a provisional reply until the full one comes, and a closed turn's reason.
    if (entry.kind === "provisional" && entry.thinking) root.append(runnerLine("runner-thinking", THINKING_LINE));
    if (entry.kind === "closing" && entry.closingReason) root.append(runnerLine("runner-closing-reason", entry.closingReason));
  }
  root.scrollTop = root.scrollHeight;
}

function recentTranscript() {
  return state.therapy.filter((item) => !RUNNER_ONLY_KINDS.includes(item.kind)).slice(-10).map((item) => `${item.role.toUpperCase()}: ${item.content}`).join("\n\n");
}

function structuredTranscript() {
  return state.therapy.filter((item) => item.id && item.exchangeId && ["user", "assistant"].includes(item.role)).map((item) => ({
    id: item.id,
    exchange_id: item.exchangeId,
    role: item.role,
    text: item.content,
    at: item.at,
    episode_id: item.episodeId || null
  }));
}

function renderCaseState(mode = "state") {
  const root = $("#case-state-output");
  if (!root) return;
  const value = mode === "diff" ? state.lastStateDiff : state.caseStateView;
  root.textContent = value ? JSON.stringify(value, null, 2) : "No structured case-state evidence is available yet.";
  $("#case-storage-status").textContent = state.privateStorageMode === "encrypted"
    ? "Encrypted private storage is active. Raw transcript and journal content are not shown here."
    : "Session-only mode: sensitive case content is held in memory and will be lost when this page closes.";
}

function renderHandoffStatus() {
  const root = $("#handoff-status");
  const exportButton = $("#export-private-handoff");
  if (!root || !exportButton) return;
  exportButton.disabled = !state.lastHandoffId;
  if (!state.handoffStatus) {
    root.textContent = "No private handoff has been created in this session.";
    return;
  }
  if (state.handoffStatus.handoff_status === "READY_FOR_FRESH_SESSION_TEST") {
    root.textContent = `Encrypted handoff ${state.lastHandoffId} was stored and verified locally. It is ready for a clean-session test; it is not complete until FRESH_SESSION_GREEN.`;
    return;
  }
  const failures = state.handoffStatus.continuation_safety?.failures ?? [];
  root.textContent = `Encrypted handoff ${state.lastHandoffId} is blocked and not continuation-safe.${failures.length ? ` ${failures.join("; ")}` : ""}`;
}

function trackerNumber(selector) {
  const raw = $(selector)?.value;
  return raw === "" || raw == null ? null : Number(raw);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}.`);
  return payload;
}


async function getJson(url) {
  const response = await fetch(url, { headers: { "accept": "application/json" } });
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}.`);
  return payload;
}

async function postBinary(url, body, contentType = "application/zip") {
  const response = await fetch(url, { method: "POST", headers: { "content-type": contentType }, body });
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}.`);
  return payload;
}

async function downloadResponse(url, fallbackName) {
  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Download failed with status ${response.status}.`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

let devDecisionJobId = "";
const roadmapActivityLabels = {
  queued: "Autonomous roadmap queued",
  auditing: "Auditing roadmap task",
  repairing: "Implementing roadmap task"
};
function formatElapsed(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) < 0) return "";
  const seconds = Math.floor(Number(ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}
function overallDevelopmentLabel(value) {
  return ({
    WORKING: "Working", REPAIRING: "Repairing", REVIEWING: "Reviewing",
    VERIFYING: "Verifying", LIVE_REGRESSION: "Live regression", RECOVERING: "Recovering",
    BLOCKED_AUTO_RECOVERY: "Blocked — auto-recovery", WAITING_FOR_HUMAN: "Human product decision required",
    COMPLETE: "Complete", IDLE: "Idle"
  })[value] || value || "Unknown";
}
function renderGitAutomation(gitAutomation = {}) {
  const update = gitAutomation.update || {};
  const diagnostics = gitAutomation.diagnostics || {};
  const progress = gitAutomation.progress || {};
  const commits = update.installedCommit || update.availableCommit
    ? ` · installed ${update.installedCommit || "unknown"} · available ${update.availableCommit || "unknown"}`
    : "";
  const branch = diagnostics.branch || "runtime-diagnostics";
  const pending = Number.isInteger(diagnostics.pending) ? diagnostics.pending : 0;
  const remotePath = diagnostics.path ? ` · ${diagnostics.path}` : "";
  const lastSync = diagnostics.lastSyncAt ? ` · ${new Date(diagnostics.lastSyncAt).toLocaleString()}` : "";
  const progressAssessment = ({
    ADVANCING: "advancing",
    LONG_RUNNING_STAGE: "long-running stage",
    WAITING_FOR_HUMAN: "waiting for human",
    BLOCKED: "blocked",
    COMPLETE: "complete",
    IDLE: "idle",
    WORKER_NOT_RUNNING: "worker not running"
  })[progress.assessment] || "unknown";
  const progressBranch = progress.branch || "runtime-diagnostics";
  const progressPath = progress.path ? ` · ${progress.path}` : "";
  const progressSync = progress.lastSyncAt ? ` · ${new Date(progress.lastSyncAt).toLocaleString()}` : "";
  $("#dev-git-automation").textContent = `Git update: ${update.status || "not-checked"}${commits}. Diagnostics: ${diagnostics.status || "not-synced"} · ${pending} pending · ${branch}${remotePath}${lastSync}. Progress: ${progress.status || "not-synced"} · ${progressAssessment} · ${progressBranch}${progressPath}${progressSync}`;
}
async function refreshDevelopmentStatus() {
  const summary = $("#dev-automation-summary");
  const decisionBox = $("#dev-human-decision");
  const panel = $("#dev-automation");
  try {
    const status = await getJson("/v1/dev/status");
    renderGitAutomation(status.gitAutomation);
    if (!status.enabled) {
      summary.textContent = "Development automation off";
      $("#dev-overall-state").textContent = "Off";
      panel.classList.add("compact");
      decisionBox.hidden = true;
      return;
    }
    const supervisor = status.supervisor || {};
    const overall = supervisor.overall || "IDLE";
    $("#dev-overall-state").textContent = overallDevelopmentLabel(overall);
    $("#dev-overall-state").dataset.state = overall;
    const task = supervisor.current?.task || supervisor.blockedTasks?.[0] || null;
    const rootIssue = supervisor.statusDomain === "guide-packet"
      ? supervisor.blocker || ""
      : supervisor.lastAnalysis?.root_issue || supervisor.blocker || "";
    $("#dev-overall-detail").textContent = task
      ? `${task.id}: ${task.name}${rootIssue ? ` — ${rootIssue}` : ""}`
      : (rootIssue || "No active engineering blocker.");
    const current = supervisor.current;
    $("#dev-current-stage").textContent = current
      ? `Current stage: ${current.stage || current.status || "working"}${current.model ? ` · ${current.model}` : ""}${current.elapsedMs != null ? ` · ${formatElapsed(current.elapsedMs)}` : ""}${current.detail ? ` · ${current.detail}` : ""}`
      : "Current stage: none";
    const last = supervisor.lastEvent;
    $("#dev-last-event").textContent = last
      ? `Last event: ${last.stage} ${last.status}${last.at ? ` · ${new Date(last.at).toLocaleTimeString()}` : ""}`
      : "Last event: none recorded";
    $("#dev-next-action").textContent = `Next automatic action: ${supervisor.nextAutomaticLabel || supervisor.nextAutomaticAction || "NONE"}`;
    $("#dev-human-required").textContent = supervisor.humanActionRequired ? "Human action required: Yes" : "Human action required: No";
    summary.textContent = supervisor.statusSummary || "Deterministic state is the source of truth.";
    const running = supervisor.worker?.running === true;
    const active = !["IDLE", "COMPLETE"].includes(overall);
    panel.classList.toggle("compact", !(running || active));

    const latest = status.latest;
    const activeRoadmap = status.roadmap?.active || null;
    if (supervisor.statusDomain !== "guide-packet" && latest?.status === "awaiting-human") {
      devDecisionJobId = latest.jobId;
      const packet = latest.humanDecisionPacket || {};
      $("#dev-human-reason").textContent = packet.reason || latest.humanDecisionReason || "This candidate changes substantive product policy.";
      $("#dev-human-effect").textContent = packet.behavioralEffect ? `Behavioral effect: ${packet.behavioralEffect}` : "";
      $("#dev-human-worst").textContent = packet.worstPlausibleFailure ? `Worst plausible failure: ${packet.worstPlausibleFailure}` : "";
      $("#dev-human-default").textContent = packet.recommendedDefault || "";
      decisionBox.hidden = false;
    } else if (supervisor.statusDomain !== "guide-packet" && activeRoadmap?.state?.status === "awaiting-human") {
      devDecisionJobId = `roadmap:${activeRoadmap.id}`;
      const packet = activeRoadmap.state.humanDecisionPacket || {};
      $("#dev-human-reason").textContent = packet.reason || `Roadmap task ${activeRoadmap.name} requires a product decision.`;
      $("#dev-human-effect").textContent = packet.behavioralEffect ? `Behavioral effect: ${packet.behavioralEffect}` : "";
      $("#dev-human-worst").textContent = packet.worstPlausibleFailure ? `Worst plausible failure: ${packet.worstPlausibleFailure}` : "";
      $("#dev-human-default").textContent = packet.recommendedDefault || "";
      decisionBox.hidden = false;
    } else {
      devDecisionJobId = "";
      decisionBox.hidden = true;
    }
  } catch (error) {
    $("#dev-overall-state").textContent = "Status unavailable";
    $("#dev-overall-detail").textContent = error.message;
    summary.textContent = `Development worker status unavailable: ${error.message}`;
    decisionBox.hidden = true;
  }
}

async function submitDevelopmentDecision(decision) {
  if (!devDecisionJobId) return;
  await postJson("/v1/dev/decision", { jobId: devDecisionJobId, decision });
  await refreshDevelopmentStatus();
}

function joinParts(parts) {
  return parts.map(text).filter(Boolean).join("\n\n");
}

export function renderHypnosisRoute(plan, routeId) {
  if (!plan?.gate?.routeIds?.includes(routeId)) throw new Error("Unknown hypnosis route.");
  const announcement = text(plan.appOwned?.announcements?.[routeId]);
  let body = "";
  if (routeId === "continue_inward") {
    const route = plan.components?.continue_inward || {};
    body = joinParts([route.induction, route.deepening, route.target_work, route.integration, route.return_lead]);
  } else if (routeId === "stay_external") {
    const route = plan.components?.stay_external || {};
    body = joinParts([route.grounding, route.ordinary_choice]);
  } else {
    body = text(plan.appOwned?.endBody);
  }
  return joinParts([announcement, body, plan.appOwned?.wakingReturn]);
}

function syncSpeechPlaybackControls(playback = speechPlayback.snapshot()) {
  const hasSelectedRoute = selectedRouteText.length > 0;
  const view = deriveSpeechPlaybackUi(playback, hasSelectedRoute);
  $("#speak-session").disabled = view.readDisabled;
  $("#pause-speaking").disabled = view.pauseDisabled;
  $("#resume-speaking").disabled = view.resumeDisabled;
  $("#stop-speaking").disabled = view.stopDisabled;
  $("#speech-playback-status").textContent = view.status;
}

function showPlan(plan) {
  speechPlayback.stop();
  currentPlan = plan;
  selectedRouteText = "";
  $("#hypnosis-result").hidden = false;
  $("#hypnosis-pre-gate").textContent = plan.preGateTranscript;
  $("#hypnosis-gate").hidden = false;
  $("#hypnosis-route").hidden = true;
  $("#hypnosis-route").textContent = "";
  $("#gate-title").textContent = plan.gate.title;
  $("#gate-intro").textContent = plan.gate.intro;
  $("#gate-note").textContent = plan.gate.note;
  const actions = $("#gate-actions");
  actions.replaceChildren();
  for (const routeId of plan.gate.routeIds) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = plan.gate.labels[routeId];
    button.dataset.routeId = routeId;
    button.addEventListener("click", () => selectRoute(routeId));
    actions.append(button);
  }
  syncSpeechPlaybackControls();
}

function selectRoute(routeId) {
  speechPlayback.stop();
  selectedRouteText = renderHypnosisRoute(currentPlan, routeId);
  $("#hypnosis-route").textContent = selectedRouteText;
  $("#hypnosis-route").hidden = false;
  $("#hypnosis-gate").hidden = true;
  syncSpeechPlaybackControls();
  state.hypnosisHistory.push({
    at: new Date().toISOString(),
    target: currentPlan.target,
    routeId,
    preGateTranscript: currentPlan.preGateTranscript,
    selectedRouteText,
    aftercare: currentPlan.aftercare
  });
  saveState();
}

function guideTextList(values) {
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  return items.length ? items.join(", ") : "None";
}

function guideDecisionButton(label, decision, candidateId, card) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = decision === "approve" ? "" : "secondary";
  button.textContent = label;
  if (card.status === decision) button.classList.add("selected");
  button.addEventListener("click", async () => {
    let note = "";
    if (decision === "edit") note = prompt("Describe the exact change you want. The current guide remains installed until a revised packet is reviewed.", card.ownerNote || "") || "";
    await postJson("/v1/guides/decision", { candidateId, cardId: card.id, decision, note });
    await refreshGuidePacketStatus();
    await refreshDevelopmentStatus();
  });
  return button;
}

function renderGuidePacketStatus(status) {
  guidePacketStatus = status;
  const installed = status?.installed;
  const candidate = status?.candidate;
  $("#guide-installed-summary").textContent = installed
    ? `${installed.packetVersion} · revision ${installed.packetRevision} · ${installed.graphBundleVersion || "graph version unavailable"}`
    : "No versioned packet installed; the bundled validated guides remain active.";
  $("#guide-candidate-summary").textContent = candidate
    ? `${candidate.packetVersion} · ${candidate.status} · SHA-256 ${String(candidate.packetSha256 || "").slice(0, 16)}…`
    : "No candidate staged.";
  $("#guide-verification-summary").textContent = candidate
    ? `Verified: ${candidate.verification?.ok ? "yes" : "no"}. Quality findings: ${Object.entries(candidate.verification?.qualityCounts || {}).map(([key, value]) => `${key} ${value}`).join(", ") || "none"}.`
    : "Waiting for a packet.";
  const compilation = candidate?.compilation;
  $("#guide-compilation-summary").textContent = compilation
    ? `${compilation.status} · ${compilation.compiler?.model || "compiler unavailable"} · ${compilation.report?.summary || "No summary."}`
    : candidate ? "Opus source-role compilation is pending." : "No candidate compilation.";
  const independentReview = candidate?.independentReview;
  $("#guide-review-summary").textContent = independentReview
    ? `${independentReview.status} · ${independentReview.reviewer?.model || "reviewer unavailable"} · ${independentReview.finalAudit?.summary || independentReview.independentAudit?.summary || "No summary."}`
    : candidate ? "Independent review is pending." : "No candidate review.";
  const sourceDiff = candidate?.sourceDiff;
  $("#guide-source-diff-summary").textContent = sourceDiff
    ? sourceDiff.guides.map((item) => {
        const sectionDiff = item.sectionDiff;
        const sectionSummary = sectionDiff
          ? ` · sections: added ${sectionDiff.added.length}, changed ${sectionDiff.changed.length}, removed ${sectionDiff.removed.length}`
          : "";
        return `${item.id}: ${String(item.currentSourceSha256 || "none").slice(0, 10)}… → ${String(item.candidateSourceSha256 || "none").slice(0, 10)}… (${item.changed ? "changed" : "unchanged"})${sectionSummary}`;
      }).join(" · ")
    : "No candidate source comparison.";
  const regressionStatus = candidate?.regressionStatus;
  $("#guide-regression-summary").textContent = regressionStatus
    ? `${regressionStatus.passed}/${regressionStatus.count} pass · ${regressionStatus.results.map((item) => `${item.id}: ${item.status}`).join(" · ")}`
    : candidate ? `Affected cases: ${guideTextList(candidate.affectedCases)} · exact replay pending.` : "None.";

  const cardsRoot = $("#guide-decision-cards");
  cardsRoot.replaceChildren();
  if (!candidate?.decisionCards?.length) {
    const empty = document.createElement("p");
    empty.className = "small";
    empty.textContent = "No substantive decisions are pending.";
    cardsRoot.append(empty);
  } else {
    for (const card of candidate.decisionCards) {
      const article = document.createElement("article");
      article.className = "guide-decision-card";
      const heading = document.createElement("h4");
      heading.textContent = card.title;
      const current = document.createElement("p");
      current.innerHTML = "";
      const currentStrong = document.createElement("strong"); currentStrong.textContent = "Current: ";
      current.append(currentStrong, document.createTextNode(card.current || "No equivalent installed behavior."));
      const proposed = document.createElement("p");
      const proposedStrong = document.createElement("strong"); proposedStrong.textContent = "Candidate: ";
      proposed.append(proposedStrong, document.createTextNode(card.candidate || ""));
      const effect = document.createElement("p");
      const effectStrong = document.createElement("strong"); effectStrong.textContent = "Behavioral effect: ";
      effect.append(effectStrong, document.createTextNode(card.behavioralEffect || ""));
      const worst = document.createElement("p");
      const worstStrong = document.createElement("strong"); worstStrong.textContent = "Worst plausible failure: ";
      worst.append(worstStrong, document.createTextNode(card.worstPlausibleFailure || ""));
      const meta = document.createElement("p");
      meta.className = "small";
      meta.textContent = `Provenance: ${card.provenance || "unresolved"} · Affected regressions: ${guideTextList(card.affectedRegressions)} · Decision: ${card.status || "pending"}`;
      const actions = document.createElement("div"); actions.className = "actions wrap";
      actions.append(
        guideDecisionButton("Approve", "approve", candidate.packetId, card),
        guideDecisionButton("Keep current", "keep-current", candidate.packetId, card),
        guideDecisionButton("Edit", "edit", candidate.packetId, card)
      );
      article.append(heading, current, proposed, effect, worst, meta, actions);
      cardsRoot.append(article);
    }
  }

  const qualityRoot = $("#guide-quality-summary");
  qualityRoot.replaceChildren();
  const findings = candidate?.qualityAudit?.findings || [];
  if (!findings.length) {
    qualityRoot.textContent = candidate ? "No quality findings." : "No candidate audit.";
  } else {
    for (const finding of findings.slice(0, 30)) {
      const item = document.createElement("div");
      item.className = `guide-quality-item severity-${finding.severity || "info"}`;
      const title = document.createElement("strong"); title.textContent = `${String(finding.severity || "info").toUpperCase()}: ${finding.title || finding.code}`;
      const detail = document.createElement("span"); detail.textContent = finding.detail || finding.message || "";
      item.append(title, detail);
      qualityRoot.append(item);
    }
  }
  $("#guide-packet-install").disabled = !candidate?.allApproved;
  $("#guide-packet-rollback").disabled = !(status?.history?.length);
  $("#guide-packet-export").disabled = !installed;
}

async function refreshGuidePacketStatus() {
  const status = await getJson("/v1/guides/status");
  renderGuidePacketStatus(status);
  return status;
}

function renderDataSummary() {
  const persisted = { settings: state.settings, caseId: state.caseId };
  $("#data-summary").textContent = JSON.stringify({
    sensitiveSessionMode: state.privateStorageMode,
    therapyMessagesInMemory: state.therapy.length,
    hypnosisSessionsInMemory: state.hypnosisHistory.length,
    trackerEntriesInMemory: state.trackerEntries.length,
    journalEntriesInMemory: state.journalEntries.length,
    browserStoredSettingsBytesApprox: new Blob([JSON.stringify(persisted)]).size,
    legacyPrivateDataDetected: state.legacyPrivateDataDetected
  }, null, 2);
  const legacy = $("#legacy-data-notice");
  if (legacy) legacy.hidden = !state.legacyPrivateDataDetected;
}


async function exportDiagnosticZip(button) {
  setBusy(button, true, "Collecting recovery ZIP…");
  try {
    const response = await fetch("/v1/debug/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Diagnostic export failed with status ${response.status}.`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] || `inner-signal-diagnostic-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(`Could not export recovery ZIP: ${error.message}`);
  } finally {
    setBusy(button, false);
  }
}

function activateTab(id) {
  if (id !== "hypnosis") speechPlayback.stop();
  for (const button of $$(".tab")) button.classList.toggle("active", button.dataset.tab === id);
  for (const panel of $$(".panel")) {
    const active = panel.id === id;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  }
}

async function checkHealth() {
  const badge = $("#runtime-status");
  try {
    const response = await fetch("/health");
    const health = await response.json();
    if (!response.ok || !health.ok) throw new Error("Runtime health check failed.");
    const versionLabel = $("#runtime-version");
    if (versionLabel && health.version) {
      const repair = health.localRepair?.jobId ? ` · local repair ${String(health.localRepair.jobId).slice(0, 8)}` : "";
      versionLabel.textContent = `Inner Signal runtime v${health.version}${repair}`;
    }
    badge.className = "status ok";
    // With the trial on, the badge shows who reads, writes and checks, not the usual app's models (the trial doesn't use them).
    badge.textContent = health.runnerTrial === "on" ? runnerArrangementText(health.runnerArrangement) : `${health.models.anthropic} + ${health.models.openai} · ${health.therapy.graphBundleVersion}`;
    applyRunnerTrial(health.runnerTrial === "on");
    applyRunnerKeptPlan(health.runnerKeptPlan === "on");
    applyRunnerFeedbackLink(health.runnerFeedbackLink === "on" ? health.feedbackPageUrl : null);
    // A page holding another case than the trial's (a fresh browser makes up its own) takes the trial's before its reconcile, as a
    // fresh page for that case: its settings stay, and what it showed of the other case goes.
    const adoptedCaseId = runnerTrial.on ? runnerCaseToAdopt(health, state.caseId) : null;
    if (adoptedCaseId) {
      adoptRunnerCase(state, emptyPageState(), adoptedCaseId);
      supervisorPanel?.clear();
      saveState();
      renderTherapy();
    }
    if (runnerTrial.on) await reconcileRunnerCase();
    state.privateStorageMode = health.privateCaseStorage?.available ? "encrypted" : "session_only";
    if (health.privateCaseStorage?.available) {
      try {
        const saved = await getJson(`/v1/case/state?caseId=${encodeURIComponent(state.caseId)}`);
        state.durableCaseState = saved.durableCaseState || null;
        state.caseStateView = saved.caseState || null;
        state.lastStateDiff = saved.caseStateDiff || null;
      } catch {}
    }
    renderCaseState();
    renderHandoffStatus();
  } catch (error) {
    badge.className = "status error";
    badge.textContent = error.message;
  }
}

for (const button of $$(".tab")) button.addEventListener("click", () => activateTab(button.dataset.tab));
const supervisorPanel = initSupervisorPanel({ getCaseId: () => state.caseId });

$("#therapy-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#therapy-message").value.trim();
  if (!message) return;
  // The page knows whether the runner trial is on before it sends anything, so its line and stream are there from the first message.
  await healthChecked;
  const button = $("#therapy-send");
  const priorTranscript = recentTranscript();
  const priorTranscriptEntries = structuredTranscript();
  const exchangeId = `exchange-${crypto.randomUUID()}`;
  const userTurnId = `${exchangeId}-user`;
  const assistantTurnId = `${exchangeId}-assistant`;
  state.therapy.push({ id: userTurnId, exchangeId, role: "user", content: message, at: new Date().toISOString() });
  saveState();
  renderTherapy();
  $("#therapy-message").value = "";
  setBusy(button, true, "Reasoning…");
  const runnerTurn = runnerTrial.on ? beginRunnerTurn(exchangeId) : null;
  try {
    const request = {
      userMessage: message,
      caseId: state.caseId,
      exchangeId,
      userTurnId,
      assistantTurnId,
      recentTranscript: priorTranscript,
      recentTranscriptEntries: priorTranscriptEntries,
      durableCaseState: state.durableCaseState,
      trackerEntries: state.trackerEntries,
      userFacts: [],
      processingMode: $("#therapy-processing-mode")?.value || "auto",
      priorCaseSnapshot: state.caseSnapshot,
      priorInterventionContract: state.interventionContract,
      priorProcessingTier: state.priorProcessingTier,
      ...(runnerTurn?.newConversation ? { newConversation: true } : {}),
      ...(runnerTurn?.resume ?? {})
    };
    const result = runnerTurn ? await postRunnerTurn(request, runnerTurn) : await postJson("/v1/therapy/respond", request);
    runnerTurn?.finish(result);
    // What happened to the kept plan in this turn, said outside the reply in fixed words (the writer can't know what was kept).
    if (runnerTurn && runnerTrial.keptPlanOn) setRunnerKeptPlanStatus(keptPlanStatusText(result.keptPlan));
    const answer = text(result.answer) || text(result.decision_summary) || "The runtime returned no answer text.";
    state.caseSnapshot = result.caseFormulation && typeof result.caseFormulation === "object" ? result.caseFormulation : state.caseSnapshot;
    state.interventionContract = result.interventionContract && typeof result.interventionContract === "object" ? result.interventionContract : state.interventionContract;
    state.priorProcessingTier = result.processingTier || result.mode || state.priorProcessingTier || "";
    state.durableCaseState = result.durableCaseState || state.durableCaseState;
    state.caseStateView = result.caseState || state.caseStateView;
    state.lastStateDiff = result.caseStateDiff || null;
    state.privateStorageMode = result.privateCaseStorage || state.privateStorageMode;
    state.therapy.push({
      id: assistantTurnId,
      exchangeId,
      role: "assistant",
      content: answer,
      at: new Date().toISOString(),
      ledgerId: result.decisionLedgerId,
      graphBundleVersion: result.graphBundleVersion,
      plan: compactPlan(result.interventionContract, result.responseContract),
      processingTier: result.processingTier || result.mode || "unknown",
      routingReason: result.routingReason || "",
      processingMs: Number(result.processingMs) || null,
      responseContract: result.responseContract || null,
      // A runner-trial turn closed without a reply: its notice is the reply, and the reason shows outside it.
      ...(result.closing ? { kind: "closing", closingReason: runnerClosingReason(result.closing) } : {})
    });
    // The cursor moves to this turn only if no earlier turn after it still misses its reply (a failed stream), so a reconcile
    // can bring that reply back.
    if (runnerTurn && runnerRepliesShownAfter(state.therapy, state.runnerShownThrough)) state.runnerShownThrough = exchangeId;
    saveState();
    renderTherapy();
    renderCaseState("diff");
  } catch (error) {
    runnerTurn?.finish();
    // The line belongs to its exchange, so a reply a reconcile brings back later goes after it, in the same turn.
    state.therapy.push({ role: "assistant", exchangeId, content: `Runtime error: ${error.message}`, at: new Date().toISOString(), error: true });
    saveState();
    renderTherapy();
  } finally {
    setBusy(button, false);
  }
});

// The runner trial's "New conversation": the next message starts a new conversation on the server, which lifts the crisis
// rules' "in this conversation" limits; the risk record and the protection gate carry over.
$("#runner-new-conversation").addEventListener("click", () => {
  if (!runnerTrial.on || runnerTrial.newConversation) return;
  runnerTrial.newConversation = true;
  state.therapy.push({ role: "notice", kind: "divider", content: "New conversation", at: new Date().toISOString() });
  renderTherapy();
  syncRunnerNewConversation();
  // With the kept plan on, the new conversation opens with "Pick up where we left off?" whenever an earlier one exists.
  if (runnerTrial.keptPlanOn && (runnerTrial.hasConversation || state.therapy.some((entry) => typeof entry?.exchangeId === "string"))) showRunnerResume(true);
});

// "Pick up where we left off?": the answer goes to the server with the next message.
for (const [selector, answer] of [["#runner-resume-yes", true], ["#runner-resume-fresh", false]]) {
  $(selector).addEventListener("click", () => {
    if (!runnerTrial.resumeShown) return;
    runnerTrial.resumeAnswer = answer;
    syncRunnerResume();
  });
}

// "Delete the kept plan" (design, section 9): after the plain confirmation, the server deletes the case's kept plan (its lines leave
// the record; the conversation that holds them stays, since only deleting the case removes it). The answer is the same whether or
// not a plan was kept.
$("#runner-delete-kept-plan").addEventListener("click", async () => {
  if (!runnerTrial.keptPlanOn || !confirm(KEPT_PLAN_DELETE_NOTE)) return;
  const button = $("#runner-delete-kept-plan");
  setBusy(button, true, "Deleting…");
  try {
    const response = await fetch("/v1/runner/kept-plan/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: state.caseId, confirmed: true })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}.`);
    setRunnerKeptPlanStatus(KEPT_PLAN_GONE_LINE);
  } catch (error) {
    alert(`The kept plan was not deleted: ${error.message}`);
  } finally {
    setBusy(button, false);
  }
});

// After "Delete this case" succeeded (design, section 6), nothing of the case stays in the page: its state forgets every field
// that is the case's (the transcript, the tracker and journal entries, the hypnosis sessions, the case views, the handoff and any
// field added later), so the backup export and the recovery ZIP hold none of it; what the page shows of it is emptied (the
// hypnosis session on screen, the supervisor panel's text), and so are the forms with text typed for it. The settings and the case
// id stay, so the next message starts an empty case.
function clearDeletedCase() {
  forgetDeletedCase(state, emptyPageState());
  state.therapy.push({ role: "notice", kind: "divider", content: "This case was deleted", at: new Date().toISOString() });
  speechPlayback.stop();
  currentPlan = null;
  selectedRouteText = "";
  for (const id of ["#hypnosis-pre-gate", "#gate-title", "#gate-intro", "#gate-note", "#hypnosis-route"]) $(id).textContent = "";
  $("#gate-actions").replaceChildren();
  for (const id of ["#hypnosis-result", "#hypnosis-gate", "#hypnosis-route"]) $(id).hidden = true;
  $("#therapy-message").value = "";
  for (const id of ["#hypnosis-form", "#tracker-form", "#journal-form"]) $(id)?.reset();
  supervisorPanel?.clear();
  runnerTrial.newConversation = false;
  syncRunnerNewConversation();
  // The deleted case's kept plan went with it: no question about an earlier conversation, and no line about a plan.
  runnerTrial.hasConversation = false;
  showRunnerResume(false);
  setRunnerKeptPlanStatus("");
  syncSpeechPlaybackControls();
  saveState();
  renderTherapy();
  renderCaseState();
  renderHandoffStatus();
}

// The runner trial's "Delete this case" (design, section 6): once the person types DELETE, the server removes this case from this
// computer (its conversations, risk record and handoffs, and the files that name it), and then the page forgets it too. The page
// keeps its case id, so the next message starts an empty case.
$("#runner-delete-case").addEventListener("click", async () => {
  if (!runnerTrial.on) return;
  const typed = prompt("This deletes this case from this computer: every conversation, its risk record and its handoffs. It can't be undone. Type DELETE to delete it.");
  if (typeof typed !== "string" || typed.trim() !== "DELETE") return;
  const button = $("#runner-delete-case");
  setBusy(button, true, "Deleting…");
  try {
    const response = await fetch("/v1/case/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: state.caseId, confirmation: "DELETE" })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}.`);
    clearDeletedCase();
    if (payload.handoffsKept) alert(`${payload.handoffsKept} handoff file(s) couldn't be confirmed as this case's and were kept.`);
  } catch (error) {
    alert(`The case was not deleted: ${error.message}`);
  } finally {
    setBusy(button, false);
  }
});

$("#clear-therapy").addEventListener("click", () => {
  state.therapy = [];
  state.caseSnapshot = null;
  state.interventionContract = null;
  state.priorProcessingTier = "";
  state.durableCaseState = null;
  state.caseStateView = null;
  state.lastStateDiff = null;
  saveState();
  renderTherapy();
  renderCaseState();
});

$("#hypnosis-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#hypnosis-compile");
  setBusy(button, true, "Compiling and reviewing…");
  $("#hypnosis-result").hidden = true;
  try {
    const target = $("#hypnosis-target").value.trim();
    const context = $("#hypnosis-context").value.trim();
    const result = await postJson("/v1/hypnosis/compile", {
      userMessage: `Create a structured awake hypnosis session for this target: ${target}`,
      recentTranscript: context,
      userFacts: ["The application must own consent, route selection, route isolation, and the waking return."],
      hypnosisRequest: {
        target,
        relationship: $("#hypnosis-relationship").value,
        language: "en",
        depth: $("#hypnosis-depth").value,
        sessionType: "awake",
        durationMinutes: Number($("#hypnosis-duration").value),
        protectorGateRequired: true,
        fullyAwakeAfterward: true,
        notes: ["Do not treat silence, persistence, stillness, or lack of objection as consent."]
      }
    });
    if (!result.releaseable || !result.playbackPlan) throw new Error("The compiler blocked this session rather than weakening the contract.");
    showPlan(result.playbackPlan);
  } catch (error) {
    $("#hypnosis-result").hidden = false;
    $("#hypnosis-pre-gate").textContent = `Runtime error: ${error.message}`;
    $("#hypnosis-gate").hidden = true;
  } finally {
    setBusy(button, false);
  }
});

$("#speak-session").addEventListener("click", () => speechPlayback.start(selectedRouteText));
$("#pause-speaking").addEventListener("click", () => speechPlayback.pause());
$("#resume-speaking").addEventListener("click", () => speechPlayback.resume());
$("#stop-speaking").addEventListener("click", () => speechPlayback.stop());
document.addEventListener("visibilitychange", () => {
  speechPlayback.handleVisibilityChange(document.visibilityState);
});
window.addEventListener("pagehide", () => speechPlayback.stop());

$("#export-diagnostic").addEventListener("click", (event) => exportDiagnosticZip(event.currentTarget));
$("#export-diagnostic-data").addEventListener("click", (event) => exportDiagnosticZip(event.currentTarget));

$("#export-data").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ format: "inner-signal-backup-v1", exportedAt: new Date().toISOString(), state }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `inner-signal-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

$("#import-data").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const parsed = JSON.parse(await file.text());
  if (parsed.format !== "inner-signal-backup-v1" || !parsed.state) throw new Error("Unrecognized backup format.");
  state.therapy = Array.isArray(parsed.state.therapy) ? parsed.state.therapy : [];
  state.hypnosisHistory = Array.isArray(parsed.state.hypnosisHistory) ? parsed.state.hypnosisHistory : [];
  state.settings = parsed.state.settings && typeof parsed.state.settings === "object" ? parsed.state.settings : {};
  state.caseSnapshot = parsed.state.caseSnapshot && typeof parsed.state.caseSnapshot === "object" ? parsed.state.caseSnapshot : null;
  state.interventionContract = parsed.state.interventionContract && typeof parsed.state.interventionContract === "object" ? parsed.state.interventionContract : null;
  state.priorProcessingTier = typeof parsed.state.priorProcessingTier === "string" ? parsed.state.priorProcessingTier : "";
  state.durableCaseState = parsed.state.durableCaseState && typeof parsed.state.durableCaseState === "object" ? parsed.state.durableCaseState : null;
  state.caseStateView = parsed.state.caseStateView && typeof parsed.state.caseStateView === "object" ? parsed.state.caseStateView : null;
  state.lastStateDiff = parsed.state.lastStateDiff && typeof parsed.state.lastStateDiff === "object" ? parsed.state.lastStateDiff : null;
  state.trackerEntries = Array.isArray(parsed.state.trackerEntries) ? parsed.state.trackerEntries : [];
  state.journalEntries = Array.isArray(parsed.state.journalEntries) ? parsed.state.journalEntries : [];
  saveState();
  renderTherapy();
  renderCaseState();
  renderDataSummary();
});

$("#erase-data").addEventListener("click", () => {
  if (!confirm("Erase Inner Signal settings and any legacy transcript or session data from this browser? Encrypted server-side case data is not deleted by this action.")) return;
  localStorage.removeItem(STORAGE_KEY);
  for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
  state.therapy = [];
  state.hypnosisHistory = [];
  state.settings = {};
  state.caseSnapshot = null;
  state.interventionContract = null;
  state.priorProcessingTier = "";
  state.durableCaseState = null;
  state.caseStateView = null;
  state.lastStateDiff = null;
  state.trackerEntries = [];
  state.journalEntries = [];
  state.lastHandoffId = null;
  state.handoffStatus = null;
  state.runnerShownThrough = null;
  state.legacyPrivateDataDetected = false;
  renderTherapy();
  renderCaseState();
  renderHandoffStatus();
  renderDataSummary();
});

for (const id of ["#open-current-state", "#show-current-state"]) $(id)?.addEventListener("click", () => {
  activateTab("case-state");
  renderCaseState("state");
});
for (const id of ["#open-state-diff", "#show-state-diff"]) $(id)?.addEventListener("click", () => {
  activateTab("case-state");
  renderCaseState("diff");
});

$("#create-handoff")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  setBusy(button, true, "Creating…");
  try {
    const result = await postJson("/v1/case/handoff", { caseId: state.caseId });
    state.lastHandoffId = result.handoff_id;
    state.handoffStatus = result;
    renderHandoffStatus();
  } catch (error) {
    state.lastHandoffId = null;
    state.handoffStatus = null;
    renderHandoffStatus();
    alert(`Could not create private handoff: ${error.message}`);
  } finally {
    setBusy(button, false);
  }
});

$("#export-private-handoff")?.addEventListener("click", () => {
  if (!state.lastHandoffId) return;
  const query = new URLSearchParams({ caseId: state.caseId, handoffId: state.lastHandoffId });
  downloadResponse(`/v1/case/handoff/export?${query}`, "inner-signal-private-handoff.vault.json").catch((error) => alert(`Could not export private handoff: ${error.message}`));
});

$("#tracker-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#tracker-save");
  const thc = $("#tracker-thc").value;
  const note = $("#tracker-note").value.trim();
  const entry = {
    schema_version: 1,
    id: `tracker-${crypto.randomUUID()}`,
    observed_at: new Date().toISOString(),
    sleep_duration_hours: trackerNumber("#tracker-sleep-hours"),
    sleep_quality: trackerNumber("#tracker-sleep-quality"),
    pain_intensity: trackerNumber("#tracker-pain"),
    anxiety: trackerNumber("#tracker-anxiety"),
    stability: trackerNumber("#tracker-stability"),
    unreality: trackerNumber("#tracker-unreality"),
    division: trackerNumber("#tracker-division"),
    functioning: trackerNumber("#tracker-functioning"),
    shaking_minutes: trackerNumber("#tracker-shaking-minutes"),
    thc_used: thc === "" ? null : thc === "yes",
    stressors_events: note ? [note] : []
  };
  state.trackerEntries.push(entry);
  setBusy(button, true, "Saving…");
  try {
    if (state.privateStorageMode === "encrypted") await postJson("/v1/case/tracker", { caseId: state.caseId, entry });
    event.currentTarget.reset();
    renderDataSummary();
    $("#case-storage-status").textContent = state.privateStorageMode === "encrypted"
      ? "Trajectory entry saved in encrypted private storage. Tracking remains descriptive, not causal."
      : "Trajectory entry saved for this session only. Tracking remains descriptive, not causal.";
  } catch (error) {
    state.trackerEntries = state.trackerEntries.filter((item) => item.id !== entry.id);
    alert(`Could not save trajectory entry: ${error.message}`);
  } finally {
    setBusy(button, false);
  }
});

$("#journal-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#journal-save");
  const entry = { id: `journal-${crypto.randomUUID()}`, observed_at: new Date().toISOString(), kind: $("#journal-kind").value, text: $("#journal-text").value.trim() };
  state.journalEntries.push(entry);
  setBusy(button, true, "Saving…");
  try {
    if (state.privateStorageMode === "encrypted") await postJson("/v1/case/journal", { caseId: state.caseId, entry });
    event.currentTarget.reset();
    $("#case-storage-status").textContent = state.privateStorageMode === "encrypted"
      ? "Private note saved in encrypted storage. Its contents are not displayed in the case-state view."
      : "Private note remains session-only and will be lost when this page closes.";
  } catch (error) {
    state.journalEntries = state.journalEntries.filter((item) => item.id !== entry.id);
    alert(`Could not save private note: ${error.message}`);
  } finally {
    setBusy(button, false);
  }
});

$("#guide-packet-import").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await postBinary("/v1/guides/import", file);
    await refreshGuidePacketStatus();
    await refreshDevelopmentStatus();
    activateTab("guides");
  } catch (error) {
    alert(`Guide packet import failed: ${error.message}`);
  } finally {
    event.target.value = "";
  }
});
$("#guide-refresh").addEventListener("click", () => refreshGuidePacketStatus().catch((error) => alert(error.message)));
$("#guide-packet-install").addEventListener("click", async () => {
  const candidateId = guidePacketStatus?.candidate?.packetId;
  if (!candidateId) return;
  if (!confirm("Install this fully approved guide packet and preserve the current packet for rollback?")) return;
  await postJson("/v1/guides/install", { candidateId });
  await refreshGuidePacketStatus();
  await checkHealth();
});
$("#guide-packet-rollback").addEventListener("click", async () => {
  if (!confirm("Roll back to the immediately previous validated guide packet?")) return;
  await postJson("/v1/guides/rollback", {});
  await refreshGuidePacketStatus();
  await checkHealth();
});
$("#guide-packet-export").addEventListener("click", () => downloadResponse("/v1/guides/export", "inner-signal-guide-packet-installed.zip").catch((error) => alert(error.message)));

$("#dev-approve").addEventListener("click", () => submitDevelopmentDecision("approve").catch((error) => alert(error.message)));
$("#dev-reject").addEventListener("click", () => submitDevelopmentDecision("reject").catch((error) => alert(error.message)));

renderTherapy();
renderDataSummary();
renderCaseState();
saveState();
syncSpeechPlaybackControls();
healthChecked = checkHealth();
refreshDevelopmentStatus();
refreshGuidePacketStatus().catch(() => {});
setInterval(refreshDevelopmentStatus, 5000);
