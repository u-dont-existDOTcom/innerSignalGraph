const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let model = null;
let csrfToken = "";
let currentView = "commons";
let communityPaused = localStorage.getItem("innersignal-commons-paused") === "true";

const ROOM_LABELS = new Map();
const RESPONSE_LABELS = {
  "listen-only": "Listen or witness only",
  "similar-experiences": "Similar experiences welcome",
  "questions-welcome": "Questions welcome",
  "practical-ideas": "Practical ideas welcome",
  "challenge-interpretation": "Challenge my interpretation",
  "help-field-note": "Help me make a Field Note"
};
const REPLY_LABELS = {
  witness: "Witness / support",
  "similar-experience": "Similar experience",
  question: "Question",
  "practical-idea": "Practical idea",
  challenge: "Challenge"
};
const SOCIAL_LABELS = { relate: "I relate", thanks: "Thank you", "less-alone": "Less alone" };
const EVIDENCE_LABELS = {
  "similar-result": "Similar result",
  "different-result": "Different result",
  "no-noticeable-effect": "No effect",
  "made-things-worse": "Made worse",
  "context-important": "Context mattered",
  confounded: "Cannot tell"
};

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function setBusy(button, busy, busyLabel = "Working…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyLabel;
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
  }
  button.disabled = busy;
}

async function requestJson(url, { method = "GET", body, csrf = false } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (csrf) headers["x-innersignal-csrf"] = csrfToken;
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed with status ${response.status}.`);
    error.code = payload.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function downloadRequest(url, { method = "GET", body, csrf = false, fallbackName = "innersignal-export.json" } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (csrf) headers["x-innersignal-csrf"] = csrfToken;
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Download failed with status ${response.status}.`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const urlObject = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = urlObject;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(urlObject);
}

function showLogin(error = "") {
  $("#login-panel").hidden = false;
  $("#recovery-panel").hidden = true;
  $("#community-app").hidden = true;
  const errorNode = $("#login-error");
  errorNode.textContent = error;
  errorNode.hidden = !error;
}

function showCommunity() {
  $("#login-panel").hidden = true;
  $("#recovery-panel").hidden = true;
  $("#community-app").hidden = false;
}

function activateView(view) {
  currentView = view;
  for (const tab of $$(".tab")) tab.classList.toggle("active", tab.dataset.view === view);
  for (const section of $$(".view")) section.hidden = section.id !== `view-${view}`;
}

function labelRoom(value) {
  return ROOM_LABELS.get(value) || value;
}

function element(tag, className = "", content = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== "") node.textContent = content;
  return node;
}

function appendLabeledText(parent, label, value, className = "") {
  if (!text(value)) return;
  const row = element("p", className);
  const strong = element("strong", "", `${label}: `);
  row.append(strong, document.createTextNode(value));
  parent.append(row);
}

function renderRoomOptions() {
  const filter = $("#room-filter");
  const postRoom = $("#post-room");
  const existingFilter = filter.value;
  filter.replaceChildren(element("option", "", "All rooms"));
  filter.firstChild.value = "all";
  postRoom.replaceChildren();
  ROOM_LABELS.clear();
  for (const [value, label] of model.rooms) {
    ROOM_LABELS.set(value, label);
    const filterOption = element("option", "", label);
    filterOption.value = value;
    filter.append(filterOption);
    const postOption = element("option", "", label);
    postOption.value = value;
    postRoom.append(postOption);
  }
  filter.value = ROOM_LABELS.has(existingFilter) ? existingFilter : "all";
}

function reactionButton(post, channel, value, label, count) {
  const button = element("button", "reaction", `${label}${count ? ` · ${count}` : ""}`);
  button.type = "button";
  button.addEventListener("click", async () => {
    setBusy(button, true, "Saving…");
    try {
      await requestJson(`/v1/posts/${post.postId}/reactions`, { method: "POST", body: { channel, value }, csrf: true });
      await refreshBootstrap();
    } catch (error) {
      alert(error.message);
      setBusy(button, false);
    }
  });
  return button;
}

function createReplyForm(post) {
  const form = element("form", "reply-form");
  const select = element("select");
  for (const type of post.allowedReplyTypes) {
    const option = element("option", "", REPLY_LABELS[type] || type);
    option.value = type;
    select.append(option);
  }
  const input = element("textarea");
  input.rows = 2;
  input.maxLength = 5000;
  input.required = true;
  input.placeholder = "Reply within the author's requested response contract.";
  const submit = element("button", "secondary", "Reply");
  submit.type = "submit";
  form.append(select, input, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(submit, true, "Sending…");
    try {
      await requestJson(`/v1/posts/${post.postId}/replies`, {
        method: "POST",
        csrf: true,
        body: { replyType: select.value, body: input.value }
      });
      await refreshBootstrap();
    } catch (error) {
      alert(error.message);
      setBusy(submit, false);
    }
  });
  return form;
}

function openFieldNoteFromPost(post) {
  $("#field-source-post-id").value = post.postId;
  $("#field-practice").value = post.title;
  $("#field-goal").value = "Understand whether this was helpful and under what conditions.";
  $("#field-what-tried").value = post.body;
  $("#field-context").value = `Originally discussed in ${labelRoom(post.room)}.`;
  $("#field-result").textContent = "This Field Note is linked to your post. Review and edit every field before saving.";
  activateView("field-note");
  $("#field-practice").focus();
}

function renderPost(post) {
  const article = element("article", "post-card");
  const meta = element("div", "post-meta");
  meta.append(
    element("span", "room-chip", labelRoom(post.room)),
    element("span", "", post.pseudonym),
    element("time", "", new Date(post.createdAt).toLocaleString())
  );
  const heading = element("h3", "", post.title);
  const contract = element("p", "response-contract", `Requested responses: ${RESPONSE_LABELS[post.responseContract] || post.responseContract}`);
  const body = element("p", "post-body", post.body);
  article.append(meta, heading, contract);
  if (post.contentNote) article.append(element("p", "content-note", `Content note: ${post.contentNote}`));
  article.append(body);
  if (post.moderation?.status === "held-for-human-review") {
    article.append(element("p", "held-note", `Visible only to you until human review. Flags: ${post.moderation.flags.join(", ")}.`));
  }

  const reactions = element("div", "reaction-groups");
  const social = element("div", "reaction-row");
  social.append(element("strong", "reaction-heading", "Support"));
  for (const [value, label] of Object.entries(SOCIAL_LABELS)) {
    social.append(reactionButton(post, "social", value, label, post.reactions.social[value] || 0));
  }
  const evidence = element("div", "reaction-row evidence-row");
  evidence.append(element("strong", "reaction-heading", "Experience follow-up"));
  for (const [value, label] of Object.entries(EVIDENCE_LABELS)) {
    evidence.append(reactionButton(post, "evidence", value, label, post.reactions.evidence[value] || 0));
  }
  reactions.append(social, evidence);
  article.append(reactions);

  const replies = element("div", "replies");
  for (const reply of post.replies) {
    const replyNode = element("div", "reply");
    replyNode.append(
      element("strong", "", `${reply.pseudonym} · ${REPLY_LABELS[reply.replyType] || reply.replyType}`),
      element("span", "reply-time", new Date(reply.createdAt).toLocaleString()),
      element("p", "", reply.body)
    );
    if (reply.moderation?.status === "held-for-human-review") replyNode.append(element("p", "held-note", "This reply is held for human review."));
    replies.append(replyNode);
  }
  article.append(replies, createReplyForm(post));

  const actions = element("div", "actions wrap post-actions");
  const fieldButton = element("button", "secondary", "Turn my post into a Field Note");
  fieldButton.type = "button";
  fieldButton.addEventListener("click", () => {
    if (!post.own) {
      alert("Only the author can turn this post into their Field Note.");
      return;
    }
    openFieldNoteFromPost(post);
  });
  const reportButton = element("button", "secondary", "Report");
  reportButton.type = "button";
  reportButton.addEventListener("click", () => {
    $("#report-post-id").value = post.postId;
    $("#report-detail").value = "";
    $("#report-dialog").showModal();
  });
  actions.append(fieldButton, reportButton);
  article.append(actions);
  return article;
}

function renderPosts() {
  const root = $("#posts-list");
  const paused = $("#paused-message");
  paused.hidden = !communityPaused;
  root.hidden = communityPaused;
  root.replaceChildren();
  if (communityPaused) return;
  const room = $("#room-filter").value;
  const posts = model.posts.filter((post) => room === "all" || post.room === room);
  if (!posts.length) {
    root.append(element("p", "empty", "No posts in this view yet."));
    return;
  }
  for (const post of posts) root.append(renderPost(post));
}

function outcomeSummary(counts) {
  return Object.entries(counts || {}).filter(([, count]) => count).map(([name, count]) => `${name} ${count}`).join(" · ") || "No classified outcomes";
}

function listSection(title, values, className = "") {
  const section = element("div", className);
  section.append(element("h4", "", title));
  const list = element("ul");
  for (const value of values || []) list.append(element("li", "", value));
  if (!list.children.length) list.append(element("li", "muted", "None reported."));
  section.append(list);
  return section;
}

function renderCard(card) {
  const article = element("article", "learning-card");
  const meta = element("div", "card-meta");
  meta.append(
    element("span", `status-chip status-${String(card.status).toLowerCase().replaceAll("_", "-")}`, card.status),
    element("span", "", `${card.independentContributorCount} independent contributor${card.independentContributorCount === 1 ? "" : "s"}`),
    element("span", "", `Runtime authority: ${card.runtimeAuthority}`)
  );
  article.append(meta, element("h3", "", card.practiceOrFeature), element("p", "card-observation", card.observation));
  article.append(element("p", "outcome-summary", outcomeSummary(card.outcomeCounts)));

  const grid = element("div", "card-grid");
  grid.append(
    listSection("Contexts represented", card.contexts),
    listSection("Potential confounders", card.confounders),
    listSection("Adverse and minority signals", card.adverseSignals, "adverse-list"),
    listSection("What remains unknown", card.unknowns)
  );
  article.append(grid);

  const profile = element("details", "evidence-profile");
  profile.append(element("summary", "", "Evidence profile and timing coverage"));
  const pre = element("pre", "", JSON.stringify({ evidenceProfile: card.evidenceProfile, timeCoverage: card.timeCoverage, externalEvidence: card.externalEvidence }, null, 2));
  profile.append(pre);
  article.append(profile);

  const exportButton = element("button", "secondary", "Export non-activating proposal");
  exportButton.type = "button";
  const eligible = card.sourceKind === "synthetic" || card.productProposalEligible;
  exportButton.disabled = !eligible;
  if (!eligible) exportButton.title = "Requires at least three independent contributors whose Field Notes explicitly allow product improvement.";
  exportButton.addEventListener("click", async () => {
    setBusy(exportButton, true, "Building proposal…");
    try {
      await downloadRequest("/v1/proposals/export", {
        method: "POST",
        body: { cardId: card.cardId },
        csrf: true,
        fallbackName: `innersignal-community-proposal-${card.cardId}.json`
      });
    } catch (error) {
      alert(error.message);
    } finally {
      setBusy(exportButton, false);
    }
  });
  article.append(exportButton);
  return article;
}

function renderCards() {
  const root = $("#cards-list");
  root.replaceChildren();
  if (!model.learningCards.length) {
    root.append(element("p", "empty", "No Learning Cards yet."));
    return;
  }
  for (const card of model.learningCards) root.append(renderCard(card));
}

function receiptForNote(note) {
  return model.myReceipts.find((receipt) => receipt.contributionId === note.fieldNoteId);
}

function renderContributions() {
  const notesRoot = $("#my-notes");
  const receiptsRoot = $("#my-receipts");
  notesRoot.replaceChildren();
  receiptsRoot.replaceChildren();

  if (!model.myFieldNotes.length) notesRoot.append(element("p", "empty", "No Field Notes yet."));
  for (const note of model.myFieldNotes) {
    const card = element("article", "contribution-card");
    card.append(element("h4", "", note.practiceOrFeature));
    appendLabeledText(card, "Goal", note.goal);
    appendLabeledText(card, "Overall result", note.overallOutcome);
    appendLabeledText(card, "Learning status", note.learningStatus);
    appendLabeledText(card, "Created", new Date(note.createdAt).toLocaleString());
    const receipt = receiptForNote(note);
    appendLabeledText(card, "Active scopes", receipt?.activeScopes?.join(", ") || "None; private draft");
    if (receipt?.activeScopes?.length) {
      const withdraw = element("button", "secondary", "Withdraw all active downstream permissions");
      withdraw.type = "button";
      withdraw.addEventListener("click", async () => {
        if (!confirm("Withdraw all currently active downstream permissions for this Field Note? The note remains in your private contribution area.")) return;
        setBusy(withdraw, true, "Withdrawing…");
        try {
          await requestJson(`/v1/field-notes/${note.fieldNoteId}/withdraw`, {
            method: "POST",
            csrf: true,
            body: { scopes: receipt.activeScopes, reason: "Participant withdrew through the contribution dashboard." }
          });
          await refreshBootstrap();
        } catch (error) {
          alert(error.message);
          setBusy(withdraw, false);
        }
      });
      card.append(withdraw);
    }
    notesRoot.append(card);
  }

  if (!model.myReceipts.length) receiptsRoot.append(element("p", "empty", "No contribution receipts yet."));
  for (const receipt of model.myReceipts) {
    const card = element("article", "receipt-card");
    card.append(element("h4", "", `Receipt ${receipt.receiptId.slice(0, 8)}`));
    appendLabeledText(card, "Consent version", receipt.consentTextVersion);
    appendLabeledText(card, "Active scopes", receipt.activeScopes.join(", ") || "None");
    appendLabeledText(card, "Withdrawn scopes", receipt.withdrawnScopes.join(", ") || "None");
    appendLabeledText(card, "Learning Cards", receipt.usageRefs.cardIds.join(", ") || "None");
    appendLabeledText(card, "Proposal exports", receipt.usageRefs.proposalIds.join(", ") || "None");
    receiptsRoot.append(card);
  }
}

function renderStats() {
  $("#member-name").textContent = model.participant.pseudonym;
  $("#community-stats").textContent = `${model.stats.participants} participants · ${model.stats.publishedPosts} published posts · ${model.stats.eligibleFieldNotes} learning-eligible Field Notes`;
  $("#pause-community").textContent = communityPaused ? "Resume community content" : "Pause community content";
}

function renderAll() {
  renderRoomOptions();
  renderStats();
  renderPosts();
  renderCards();
  renderContributions();
  if (model.mainAppUrl) $("#main-app-link").href = model.mainAppUrl;
  showCommunity();
  activateView(currentView);
}

async function refreshBootstrap() {
  const payload = await requestJson("/v1/bootstrap");
  model = payload;
  csrfToken = payload.session.csrfToken;
  renderAll();
}

function redacted(value) {
  return String(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email redacted]")
    .replace(/https?:\/\/\S+/gi, "[link redacted]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[phone redacted]");
}

function fieldNoteDraft() {
  return {
    sourcePostId: $("#field-source-post-id").value,
    practiceOrFeature: $("#field-practice").value,
    goal: $("#field-goal").value,
    whatTried: $("#field-what-tried").value,
    context: $("#field-context").value,
    priorExperience: $("#field-prior").value,
    outcomes: {
      immediate: $("#field-immediate").value,
      laterSameDay: $("#field-same-day").value,
      nextMorning: $("#field-next-morning").value,
      followingTwoToThreeDays: $("#field-following-days").value,
      longerFollowUp: $("#field-longer").value
    },
    overallOutcome: $("#field-outcome").value,
    downsides: $("#field-downsides").value,
    confounders: $("#field-confounders").value,
    wouldRepeat: $("#field-repeat").value,
    causalConfidence: Number($("#field-confidence").value),
    consentScopes: $$("input[name=\"consent-scope\"]:checked").map((input) => input.value)
  };
}

function resetFieldNoteForm() {
  $("#field-note-form").reset();
  $("#field-source-post-id").value = "";
  $("#field-confidence").value = "50";
  $("#confidence-output").value = "50";
  $("#redaction-preview").textContent = "No preview generated.";
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#login-submit");
  setBusy(button, true, "Entering…");
  try {
    const response = await requestJson("/v1/session", {
      method: "POST",
      body: {
        pseudonym: $("#login-pseudonym").value,
        inviteCode: $("#login-invite").value,
        recoveryCode: $("#login-recovery").value,
        adultConfirmed: $("#login-adult").checked,
        communityAgreementAccepted: $("#login-agreement").checked
      }
    });
    if (response.mainAppUrl) $("#main-app-link").href = response.mainAppUrl;
    if (response.recoveryCode) {
      $("#recovery-code").textContent = response.recoveryCode;
      $("#login-panel").hidden = true;
      $("#recovery-panel").hidden = false;
    } else {
      await refreshBootstrap();
    }
  } catch (error) {
    showLogin(error.message);
  } finally {
    setBusy(button, false);
  }
});

$("#copy-recovery").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#recovery-code").textContent);
  $("#copy-recovery").textContent = "Copied";
});
$("#recovery-saved").addEventListener("click", () => refreshBootstrap().catch((error) => showLogin(error.message)));

for (const tab of $$(".tab")) tab.addEventListener("click", () => activateView(tab.dataset.view));
$("#room-filter").addEventListener("change", renderPosts);

$("#post-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#post-submit");
  setBusy(button, true, "Publishing…");
  try {
    const response = await requestJson("/v1/posts", {
      method: "POST",
      csrf: true,
      body: {
        room: $("#post-room").value,
        responseContract: $("#post-response-contract").value,
        contentNote: $("#post-content-note").value,
        title: $("#post-title").value,
        body: $("#post-body").value
      }
    });
    $("#post-form").reset();
    $("#post-result").textContent = response.post.moderation?.status === "held-for-human-review"
      ? "Saved and held for human review. It is visible only to you for now."
      : "Published. This remains conversation-only unless you deliberately create a Field Note.";
    await refreshBootstrap();
    activateView("commons");
  } catch (error) {
    $("#post-result").textContent = error.message;
  } finally {
    setBusy(button, false);
  }
});

$("#field-confidence").addEventListener("input", () => { $("#confidence-output").value = $("#field-confidence").value; });
$("#preview-redaction").addEventListener("click", () => {
  const draft = fieldNoteDraft();
  $("#redaction-preview").textContent = redacted(JSON.stringify({
    practiceOrFeature: draft.practiceOrFeature,
    goal: draft.goal,
    whatTried: draft.whatTried,
    context: draft.context,
    outcomes: draft.outcomes,
    downsides: draft.downsides,
    confounders: draft.confounders
  }, null, 2));
});

$("#field-note-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#field-submit");
  setBusy(button, true, "Saving…");
  try {
    const response = await requestJson("/v1/field-notes", { method: "POST", body: fieldNoteDraft(), csrf: true });
    $("#field-result").textContent = `Saved with receipt ${response.receipt.receiptId}. Learning status: ${response.fieldNote.learningStatus}.`;
    resetFieldNoteForm();
    await refreshBootstrap();
    activateView("contributions");
  } catch (error) {
    $("#field-result").textContent = error.message;
  } finally {
    setBusy(button, false);
  }
});

$("#pause-community").addEventListener("click", () => {
  communityPaused = !communityPaused;
  localStorage.setItem("innersignal-commons-paused", String(communityPaused));
  renderStats();
  renderPosts();
});

$("#logout").addEventListener("click", async () => {
  try { await requestJson("/v1/session", { method: "DELETE", csrf: true }); } catch {}
  model = null;
  csrfToken = "";
  showLogin();
});

$("#export-my-data").addEventListener("click", () => downloadRequest("/v1/me/export", { fallbackName: "innersignal-community-data.json" }).catch((error) => alert(error.message)));
$("#delete-my-data").addEventListener("click", async () => {
  const confirmation = prompt("This removes your Commons posts, replies, reactions, Field Notes, receipts, reports, and active sessions. Type DELETE to continue.");
  if (confirmation !== "DELETE") return;
  const button = $("#delete-my-data");
  setBusy(button, true, "Deleting…");
  try {
    await requestJson("/v1/me", { method: "DELETE", csrf: true, body: { confirmation } });
    model = null;
    csrfToken = "";
    showLogin("Your Commons account and current stored contributions were deleted.");
  } catch (error) {
    alert(error.message);
    setBusy(button, false);
  }
});

$("#report-cancel").addEventListener("click", () => $("#report-dialog").close());
$("#report-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#report-submit");
  setBusy(button, true, "Submitting…");
  try {
    await requestJson(`/v1/posts/${$("#report-post-id").value}/report`, {
      method: "POST",
      csrf: true,
      body: { category: $("#report-category").value, detail: $("#report-detail").value }
    });
    $("#report-dialog").close();
    alert("Report submitted for human review.");
  } catch (error) {
    alert(error.message);
  } finally {
    setBusy(button, false);
  }
});

async function initialize() {
  try {
    const health = await requestJson("/health");
    $("#service-status").className = "status ok";
    $("#service-status").textContent = `${health.version} · learning cannot activate runtime`;
  } catch (error) {
    $("#service-status").className = "status error";
    $("#service-status").textContent = error.message;
  }
  try {
    await refreshBootstrap();
  } catch (error) {
    if (error.status === 401) showLogin();
    else showLogin(error.message);
  }
}

initialize();
