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

// Why a turn closed without a reply, in plain words, shown outside the reply.
function runnerClosingReason(closing) {
  return closing && typeof closing.reason_code === "string" && Object.hasOwn(CLOSING_REASONS, closing.reason_code) ? CLOSING_REASONS[closing.reason_code] : "";
}

function runnerProgressText(step, startedAt, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${RUNNER_PROGRESS_LABEL} ${typeof step === "string" && step ? `${step} · ` : ""}${seconds} s`;
}
// runner-trial-page:end

const runnerTrial = { on: false, newConversation: false };
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
  if (!on) runnerTrial.newConversation = false;
  syncRunnerNewConversation();
}

// When the page loads with the trial on (design, section 8): the server closes any turn of this case that a restart left
// unfinished (and delivers one that was already approved), then sends back the turns that finished after the last one this page
// showed, such as a reply that came while the page was closed. While a turn of the case is still running on the server, it waits.
async function reconcileRunnerCase() {
  const progress = $("#runner-progress");
  progress.hidden = false;
  progress.textContent = RUNNER_RECONCILE_LABEL;
  try {
    const response = await fetch("/v1/runner/reconcile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: state.caseId, afterExchangeId: state.runnerShownThrough })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload?.turns)) return;
    for (const turn of payload.turns) {
      state.therapy.push(...runnerReplayEntries(turn));
      if (typeof turn?.exchangeId === "string") state.runnerShownThrough = turn.exchangeId;
    }
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
  const progress = $("#runner-progress");
  const startedAt = Date.now();
  let step = "";
  const showProgress = () => { progress.textContent = runnerProgressText(step, startedAt); };
  progress.hidden = false;
  showProgress();
  const timer = setInterval(showProgress, 1000);
  const added = [];
  let finished = false;
  return {
    newConversation,
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
    // is added here, as the stream would have added it.
    finish(result = null) {
      if (finished) return;
      finished = true;
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

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      therapy: [],
      hypnosisHistory: [],
      settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {},
      caseId: typeof parsed.caseId === "string" ? parsed.caseId : `case-${crypto.randomUUID()}`,
      // The runner trial: the exchange of the last turn this page showed, so a reload gets back only what finished after it.
      runnerShownThrough: typeof parsed.runnerShownThrough === "string" ? parsed.runnerShownThrough : null,
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
      legacyPrivateDataDetected: LEGACY_STORAGE_KEYS.some((key) => localStorage.getItem(key))
    };
  } catch {
    return { therapy: [], hypnosisHistory: [], settings: {}, caseId: `case-${crypto.randomUUID()}`, runnerShownThrough: null, caseSnapshot: null, interventionContract: null, priorProcessingTier: "", durableCaseState: null, caseStateView: null, lastStateDiff: null, trackerEntries: [], journalEntries: [], lastHandoffId: null, handoffStatus: null, privateStorageMode: "unknown", legacyPrivateDataDetected: false };
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
    badge.textContent = `${health.models.anthropic} + ${health.models.openai} · ${health.therapy.graphBundleVersion}`;
    applyRunnerTrial(health.runnerTrial === "on");
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
initSupervisorPanel({ getCaseId: () => state.caseId });

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
      ...(runnerTurn?.newConversation ? { newConversation: true } : {})
    };
    const result = runnerTurn ? await postRunnerTurn(request, runnerTurn) : await postJson("/v1/therapy/respond", request);
    runnerTurn?.finish(result);
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
    if (runnerTurn) state.runnerShownThrough = exchangeId;
    saveState();
    renderTherapy();
    renderCaseState("diff");
  } catch (error) {
    runnerTurn?.finish();
    state.therapy.push({ role: "assistant", content: `Runtime error: ${error.message}`, at: new Date().toISOString(), error: true });
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
});

// The runner trial's "Delete this case" (design, section 6): once the person types DELETE, the server removes this case from this
// computer (its conversations, risk record and handoffs, and the files that name it). The page keeps its case id, so the next
// message starts an empty case.
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
    state.therapy = [{ role: "notice", kind: "divider", content: "This case was deleted", at: new Date().toISOString() }];
    state.caseSnapshot = null;
    state.interventionContract = null;
    state.priorProcessingTier = "";
    state.durableCaseState = null;
    state.caseStateView = null;
    state.lastStateDiff = null;
    state.lastHandoffId = null;
    state.handoffStatus = null;
    state.runnerShownThrough = null;
    saveState();
    renderTherapy();
    renderCaseState();
    renderHandoffStatus();
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
