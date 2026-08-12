const STORAGE_KEY = "inner-signal-runtime-v0100";
const LEGACY_STORAGE_KEYS = ["inner-signal-runtime-v093", "inner-signal-runtime-v092", "inner-signal-runtime-v091", "inner-signal-runtime-v090", "inner-signal-runtime-v080", "inner-signal-runtime-v070", "inner-signal-runtime-v060"];
const state = loadState();
let currentPlan = null;
let selectedRouteText = "";
let guidePacketStatus = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function loadState() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        raw = localStorage.getItem(legacyKey);
        if (raw) break;
      }
    }
    const parsed = JSON.parse(raw || "{}");
    const loaded = {
      therapy: Array.isArray(parsed.therapy) ? parsed.therapy : [],
      hypnosisHistory: Array.isArray(parsed.hypnosisHistory) ? parsed.hypnosisHistory : [],
      settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {},
      caseSnapshot: parsed.caseSnapshot && typeof parsed.caseSnapshot === "object" ? parsed.caseSnapshot : null,
      interventionContract: parsed.interventionContract && typeof parsed.interventionContract === "object" ? parsed.interventionContract : null,
      priorProcessingTier: typeof parsed.priorProcessingTier === "string" ? parsed.priorProcessingTier : ""
    };
    if (raw && !localStorage.getItem(STORAGE_KEY)) localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
    return loaded;
  } catch {
    return { therapy: [], hypnosisHistory: [], settings: {}, caseSnapshot: null, interventionContract: null, priorProcessingTier: "" };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    const block = document.createElement("div");
    block.className = `message ${entry.role === "user" ? "user" : "assistant"}`;
    const role = document.createElement("span");
    role.className = "role";
    role.textContent = entry.role === "user" ? "You" : "Inner Signal";
    const body = document.createElement("div");
    body.textContent = entry.content;
    block.append(role, body);
    if (entry.role === "assistant") {
      appendPlanTrace(block, entry.plan);
      if (entry.processingTier) {
        const tier = document.createElement("span");
        tier.className = "processing-tier";
        const timing = Number.isFinite(entry.processingMs) ? ` · ${(entry.processingMs / 1000).toFixed(1)}s` : "";
        tier.textContent = `Reasoning: ${entry.processingTier}${entry.routingReason ? ` · ${entry.routingReason}` : ""}${timing}`;
        block.append(tier);
      }
      appendFeedbackControls(block, entry);
    }
    root.append(block);
  }
  root.scrollTop = root.scrollHeight;
}

function recentTranscript() {
  return state.therapy.slice(-10).map((item) => `${item.role.toUpperCase()}: ${item.content}`).join("\n\n");
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
async function refreshDevelopmentStatus() {
  const summary = $("#dev-automation-summary");
  const decisionBox = $("#dev-human-decision");
  const panel = $("#dev-automation");
  try {
    const status = await getJson("/v1/dev/status");
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

function showPlan(plan) {
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
  $("#speak-session").disabled = true;
  $("#stop-speaking").disabled = true;
}

function selectRoute(routeId) {
  selectedRouteText = renderHypnosisRoute(currentPlan, routeId);
  $("#hypnosis-route").textContent = selectedRouteText;
  $("#hypnosis-route").hidden = false;
  $("#hypnosis-gate").hidden = true;
  $("#speak-session").disabled = !("speechSynthesis" in window);
  $("#stop-speaking").disabled = !("speechSynthesis" in window);
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
  $("#data-summary").textContent = JSON.stringify({
    therapyMessages: state.therapy.length,
    hypnosisSessions: state.hypnosisHistory.length,
    storedBytesApprox: new Blob([JSON.stringify(state)]).size
  }, null, 2);
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
  } catch (error) {
    badge.className = "status error";
    badge.textContent = error.message;
  }
}

for (const button of $$(".tab")) button.addEventListener("click", () => activateTab(button.dataset.tab));

$("#therapy-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#therapy-message").value.trim();
  if (!message) return;
  const button = $("#therapy-send");
  const priorTranscript = recentTranscript();
  state.therapy.push({ role: "user", content: message, at: new Date().toISOString() });
  saveState();
  renderTherapy();
  $("#therapy-message").value = "";
  setBusy(button, true, "Reasoning…");
  try {
    const result = await postJson("/v1/therapy/respond", {
      userMessage: message,
      recentTranscript: priorTranscript,
      userFacts: [],
      processingMode: $("#therapy-processing-mode")?.value || "auto",
      priorCaseSnapshot: state.caseSnapshot,
      priorInterventionContract: state.interventionContract,
      priorProcessingTier: state.priorProcessingTier
    });
    const answer = text(result.answer) || text(result.decision_summary) || "The runtime returned no answer text.";
    state.caseSnapshot = result.caseFormulation && typeof result.caseFormulation === "object" ? result.caseFormulation : state.caseSnapshot;
    state.interventionContract = result.interventionContract && typeof result.interventionContract === "object" ? result.interventionContract : state.interventionContract;
    state.priorProcessingTier = result.processingTier || result.mode || state.priorProcessingTier || "";
    state.therapy.push({
      role: "assistant",
      content: answer,
      at: new Date().toISOString(),
      ledgerId: result.decisionLedgerId,
      graphBundleVersion: result.graphBundleVersion,
      plan: compactPlan(result.interventionContract, result.responseContract),
      processingTier: result.processingTier || result.mode || "unknown",
      routingReason: result.routingReason || "",
      processingMs: Number(result.processingMs) || null,
      responseContract: result.responseContract || null
    });
    saveState();
    renderTherapy();
  } catch (error) {
    state.therapy.push({ role: "assistant", content: `Runtime error: ${error.message}`, at: new Date().toISOString(), error: true });
    saveState();
    renderTherapy();
  } finally {
    setBusy(button, false);
  }
});

$("#clear-therapy").addEventListener("click", () => {
  state.therapy = [];
  state.caseSnapshot = null;
  state.interventionContract = null;
  state.priorProcessingTier = "";
  saveState();
  renderTherapy();
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

$("#speak-session").addEventListener("click", () => {
  if (!selectedRouteText || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(selectedRouteText);
  utterance.rate = 0.88;
  speechSynthesis.speak(utterance);
});
$("#stop-speaking").addEventListener("click", () => window.speechSynthesis?.cancel());

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
  saveState();
  renderTherapy();
});

$("#erase-data").addEventListener("click", () => {
  if (!confirm("Erase the local Inner Signal transcript, sessions, and settings from this browser?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state.therapy = [];
  state.hypnosisHistory = [];
  state.settings = {};
  state.caseSnapshot = null;
  state.interventionContract = null;
  state.priorProcessingTier = "";
  renderTherapy();
  renderDataSummary();
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
checkHealth();
refreshDevelopmentStatus();
refreshGuidePacketStatus().catch(() => {});
setInterval(refreshDevelopmentStatus, 5000);
