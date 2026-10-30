// The owner's panel for controlled supervisor drafts. Exact client text leaves InnerSignal only through the server's export, so the
// copy action below takes its text from the export response and from nowhere else: not from a field on this page, not from an
// earlier listing. Nothing here sends a message to anyone, and nothing here is written to browser storage.
//
// The logic is kept free of the page so it can be exercised directly; `initSupervisorPanel` is the only part that touches the
// document, and it builds every element with textContent so no server text is ever parsed as markup.

export const SUPERVISOR_ENDPOINTS = Object.freeze({
  prepare: "/v1/case/supervisor/prepare",
  submit: "/v1/case/supervisor/submit",
  export: "/v1/case/supervisor/export",
  report: "/v1/case/supervisor/report-sent"
});

const REASON_TEXT = Object.freeze({
  newer_client_message: "The client has written again since this draft.",
  transcript_changed: "The conversation changed after this draft was written.",
  transcript_corrected: "A correction was recorded to the conversation after this draft was written.",
  protective_compatibility_changed: "The safety state for this case changed after this draft was written.",
  delivery_state_changed: "What the client has been sent changed after this draft was written.",
  owner_input_added: "You added new information after this draft was written.",
  superseded_by_newer_draft: "A newer draft replaced this one.",
  already_committed_to_transcript: "This text is already part of the conversation record.",
  not_the_current_candidate: "This is no longer the current draft.",
  draft_basis_missing: "This draft does not record what it was written against.",
  audit_failed: "The independent review found problems with this text.",
  audit_not_passed: "The independent review has not passed this text.",
  audit_does_not_bind_these_bytes: "The review does not cover these exact words.",
  approval_pending: "The review passed but the approval has not been recorded yet.",
  not_approved_for_delivery: "This text is not approved for delivery."
});

export const reasonText = (reason) => REASON_TEXT[reason] ?? "This draft cannot be used right now.";

// One call to the supervisor routes. A refusal keeps the server's fixed reason words so the page can say what happened.
export async function callSupervisor(fetchImpl, kind, body) {
  const endpoint = SUPERVISOR_ENDPOINTS[kind];
  if (!endpoint) throw new Error("Unknown supervisor action.");
  const response = await fetchImpl(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof payload.error === "string" && payload.error ? payload.error : `Request failed with status ${response.status}.`);
    error.status = response.status;
    error.code = typeof payload.code === "string" ? payload.code : null;
    error.reasons = Array.isArray(payload.reasons) ? payload.reasons.filter((reason) => typeof reason === "string") : [];
    throw error;
  }
  return payload;
}

// The copy action. It asks the server for the exact approved text and puts that, and only that, on the clipboard. When the browser
// refuses clipboard access the text is handed back so the page can show it for a manual copy; it is not retyped or reformatted.
export async function copyApprovedText({ call, clipboard, caseId, artifactId }) {
  const exported = await call("export", { caseId, artifactId });
  if (typeof exported?.client_text !== "string" || !exported.client_text) throw new Error("The server returned no approved text.");
  let copied = false;
  try {
    await clipboard.writeText(exported.client_text);
    copied = true;
  } catch {
    copied = false;
  }
  return { copied, exported };
}

// What the owner needs to know about one draft, in plain words, from the server's own fields.
export function describeArtifact(artifact) {
  const reasons = [...(artifact.stale_reasons ?? []), ...(artifact.not_approved_reasons ?? [])].map(reasonText);
  let tone;
  let label;
  if (artifact.exportable) {
    tone = "ready";
    label = "Approved and current. You can copy it.";
  } else if (artifact.status === "superseded") {
    tone = "replaced";
    label = "Replaced by a newer draft.";
  } else if (artifact.status === "sent") {
    tone = "replaced";
    label = "Already part of the conversation record.";
  } else if (artifact.approved && !artifact.fresh) {
    tone = "stale";
    label = "Approved earlier, but the case has moved on. It cannot be copied.";
  } else if (artifact.status === "audit_failed") {
    tone = "blocked";
    label = "Not approved. The review found problems and the repair limit was reached.";
  } else if (["pending_audit", "reconstructed_pending_audit", "audited"].includes(artifact.status)) {
    tone = "pending";
    label = "The independent review has not finished.";
  } else {
    tone = "stale";
    label = "Not available to copy.";
  }
  const writer = artifact.source === "external_draft"
    ? "Written outside InnerSignal; who wrote it is not attested."
    : (artifact.source === "backend_repair" && artifact.root_source === "external_draft"
      ? "Repaired by InnerSignal from a draft written outside it."
      : "Written by InnerSignal.");
  const delivery = [];
  if (artifact.delivery?.exported) delivery.push("Copied out of InnerSignal. That is not the same as sent.");
  if (artifact.delivery?.reported_sent) {
    delivery.push(artifact.delivery.reported_sent.actor_resolution === "owner_verified"
      ? "You reported sending it."
      : "Someone reported it as sent through an agent; that report is not confirmed as yours.");
  }
  return { tone, label, writer, reasons: [...new Set(reasons)], delivery, hasCompanion: Boolean(artifact.companion) };
}

const element = (doc, tag, className, text) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export function initSupervisorPanel({
  document: doc = globalThis.document,
  getCaseId,
  fetchImpl = (...args) => globalThis.fetch(...args),
  clipboard = globalThis.navigator?.clipboard,
  newKey = () => globalThis.crypto.randomUUID()
} = {}) {
  const $ = (id) => doc.getElementById(id);
  const panel = $("supervisor");
  if (!panel || typeof getCaseId !== "function") return null;
  const call = (kind, body) => callSupervisor(fetchImpl, kind, body);
  // One idempotency key per attempt, kept across a failed network try so a retry cannot record the same thing twice, and dropped
  // once the server has answered or the owner has changed what they are sending.
  const keys = { input: null, draft: null, write: null };
  const keyFor = (slot) => (keys[slot] ??= newKey());
  const clearKey = (slot) => { keys[slot] = null; };
  const reportKeys = new Map();
  // What the last copy of each draft showed, so a refresh of the list does not take away a companion the owner is reading.
  const outputs = new Map();
  let basisSha256 = null;
  const status = (message, tone = "info") => {
    const node = $("supervisor-status");
    node.textContent = message;
    node.dataset.tone = tone;
  };
  const failure = (error) => {
    const reasons = (error.reasons ?? []).map(reasonText);
    status(reasons.length ? `${error.message} ${reasons.join(" ")}` : error.message, "error");
  };
  const busy = (button, on) => { if (button) button.disabled = on; };

  function renderSnapshot(snapshot) {
    basisSha256 = snapshot.basis?.sha256 ?? null;
    $("supervisor-client-message").textContent = snapshot.latest_client_turn?.text ?? "The case has no client message yet.";
    const inputs = $("supervisor-inputs");
    inputs.replaceChildren();
    for (const input of snapshot.owner_supplied_inputs ?? []) {
      const item = element(doc, "li", "supervisor-input");
      const who = input.supplied_by?.actor_resolution === "owner_verified" ? "from you" : "relayed by an agent";
      item.append(element(doc, "strong", "", input.input_type === "client_message" ? `Message you relayed (${who})` : `Your instruction (${who})`), element(doc, "pre", "supervisor-text", input.text));
      inputs.append(item);
    }
    if (!inputs.childElementCount) inputs.append(element(doc, "li", "small", "Nothing relayed yet."));
    const list = $("supervisor-artifacts");
    list.replaceChildren();
    const artifacts = [...(snapshot.artifacts ?? [])].reverse();
    for (const artifact of artifacts) list.append(renderArtifact(artifact));
    if (!artifacts.length) list.append(element(doc, "li", "small", "No drafts yet."));
  }

  function renderArtifact(artifact) {
    const view = describeArtifact(artifact);
    const item = element(doc, "li", `supervisor-artifact tone-${view.tone}`);
    item.dataset.artifactId = artifact.artifact_id;
    item.append(element(doc, "strong", "", view.label), element(doc, "span", "small", view.writer));
    for (const line of [...view.reasons, ...view.delivery]) item.append(element(doc, "span", "small", line));
    if (view.hasCompanion) item.append(element(doc, "span", "small", `An ${artifact.companion.language} companion is stored for you only. It is not reviewed for meaning and is never sent.`));
    const actions = element(doc, "div", "actions wrap");
    const copy = element(doc, "button", "", "Copy approved text");
    copy.type = "button";
    copy.disabled = !artifact.exportable;
    const output = element(doc, "div", "supervisor-output");
    const shown = outputs.get(artifact.artifact_id);
    output.hidden = !shown;
    if (shown) {
      output.append(element(doc, "p", "small", shown.copied
        ? "Copied the exact approved text. It has not been sent; report it below once you have sent it."
        : "Your browser blocked automatic copying. Select and copy this exact text:"));
      if (shown.manual != null) {
        const manual = element(doc, "textarea", "supervisor-text", shown.manual);
        manual.readOnly = true;
        manual.rows = 6;
        output.append(manual);
      }
      if (shown.companion) {
        output.append(element(doc, "strong", "", `For you only (${shown.companion.language}), not reviewed for meaning, never to be sent`), element(doc, "pre", "supervisor-text", shown.companion.text));
      }
    }
    copy.addEventListener("click", async () => {
      busy(copy, true);
      try {
        const { copied, exported } = await copyApprovedText({ call, clipboard, caseId: getCaseId(), artifactId: artifact.artifact_id });
        outputs.set(artifact.artifact_id, {
          copied,
          manual: copied ? null : exported.client_text,
          companion: exported.companion ? { language: exported.companion.language, text: exported.companion.text } : null
        });
        status("Released from InnerSignal. That is not the same as sent.", "info");
        await refresh({ quiet: true });
      } catch (error) {
        failure(error);
        await refresh({ quiet: true }).catch(() => {});
      } finally {
        busy(copy, false);
      }
    });
    actions.append(copy);
    if (artifact.delivery?.exported && !artifact.delivery?.reported_sent) {
      const sentAt = element(doc, "input", "supervisor-sent-at");
      sentAt.type = "datetime-local";
      sentAt.setAttribute("aria-label", "When you sent it (optional)");
      const sent = element(doc, "button", "secondary", "I sent this");
      sent.type = "button";
      sent.addEventListener("click", async () => {
        if (!globalThis.confirm?.("Record that you sent this exact text to the client? InnerSignal cannot see whether it was sent.")) return;
        busy(sent, true);
        try {
          if (!reportKeys.has(artifact.artifact_id)) reportKeys.set(artifact.artifact_id, newKey());
          const when = sentAt.value ? new Date(sentAt.value) : null;
          await call("report", {
            caseId: getCaseId(),
            artifactId: artifact.artifact_id,
            sentAt: when && !Number.isNaN(when.valueOf()) ? when.toISOString() : null,
            idempotencyKey: reportKeys.get(artifact.artifact_id)
          });
          reportKeys.delete(artifact.artifact_id);
          status("Recorded as your own report. The time is left unknown unless you entered it.", "info");
          await refresh({ quiet: true });
        } catch (error) {
          failure(error);
        } finally {
          busy(sent, false);
        }
      });
      actions.append(sentAt, sent);
    }
    item.append(actions, output);
    return item;
  }

  async function refresh({ quiet = false } = {}) {
    if (!quiet) status("Loading the case…", "info");
    try {
      renderSnapshot(await call("prepare", { caseId: getCaseId() }));
      if (!quiet) status("Up to date.", "info");
    } catch (error) {
      failure(error);
      throw error;
    }
  }

  $("supervisor-refresh").addEventListener("click", () => refresh().catch(() => {}));
  doc.querySelector('[data-tab="supervisor"]')?.addEventListener("click", () => refresh().catch(() => {}));

  $("supervisor-input-form").addEventListener("input", () => clearKey("input"));
  $("supervisor-input-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("supervisor-input-save");
    const textValue = $("supervisor-input-text").value;
    if (!textValue.trim()) return;
    busy(button, true);
    try {
      renderSnapshot(await call("prepare", { caseId: getCaseId(), inputs: [{ type: $("supervisor-input-type").value, text: textValue, idempotencyKey: keyFor("input") }] }));
      clearKey("input");
      $("supervisor-input-text").value = "";
      status("Recorded. Earlier drafts no longer cover this new information, so they cannot be copied.", "info");
    } catch (error) {
      if (error.status && error.status < 500) clearKey("input");
      failure(error);
    } finally {
      busy(button, false);
    }
  });

  async function submit(source, slot) {
    const button = source === "external_draft" ? $("supervisor-submit-draft") : $("supervisor-write-draft");
    const body = { caseId: getCaseId(), source, basisSha256, idempotencyKey: keyFor(slot) };
    if (source === "external_draft") {
      const draftText = $("supervisor-draft-text").value;
      if (!draftText.trim()) { status("Enter the draft text to review.", "error"); return; }
      body.text = draftText;
      const companionText = $("supervisor-companion-text").value;
      if (companionText.trim()) body.companion = { language: $("supervisor-companion-language").value.trim() || "en", text: companionText };
    }
    busy(button, true);
    status("Reviewing. This can take a minute.", "info");
    try {
      const result = await call("submit", body);
      clearKey(slot);
      status(result.notice, result.status === "approved" ? "info" : "error");
      await refresh({ quiet: true });
    } catch (error) {
      if (error.status && error.status < 500) clearKey(slot);
      failure(error);
      await refresh({ quiet: true }).catch(() => {});
    } finally {
      busy(button, false);
    }
  }
  $("supervisor-draft-form").addEventListener("input", () => clearKey("draft"));
  $("supervisor-draft-form").addEventListener("submit", (event) => { event.preventDefault(); submit("external_draft", "draft"); });
  $("supervisor-write-draft").addEventListener("click", () => submit("backend_produced", "write"));

  return Object.freeze({ refresh });
}
