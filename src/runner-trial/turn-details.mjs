import { isSubstantiveAuditFinding } from "../supervisor/private-candidate-lifecycle.mjs";

const list = (value) => Array.isArray(value) ? value : [];
const stored = (value) => value ?? null;
const without = (value, keys) => value == null ? null : Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const workerName = (calls, fallback) => ({ anthropic: "Claude", claude: "Claude", openai: "GPT", codex: "GPT" }[calls.at(-1)?.provider] ?? fallback);

// Read-only, owner-page projection. Never pass this to the word-free log or its writer. Receipts are copied field by field:
// session ids, paths, credentials and arbitrary provider diagnostics have no place in this view.
function callsFrom(receipts, legacyParts = []) {
  return list(receipts).map((receipt) => ({
    role: stored(receipt.role), provider: stored(receipt.provider), model: stored(receipt.model),
    attempt: stored(receipt.attempt), duration_ms: stored(receipt.duration_ms), effort: stored(receipt.effort),
    failure_code: stored(receipt.failed),
    rule_parts: list(receipt.rule_parts ?? legacyParts).map((part) => ({ name: stored(part.id), bytes: stored(part.bytes) }))
  }));
}

export function runnerTurnDetailsFromRecord(record, turnNumber) {
  if (!Number.isSafeInteger(turnNumber) || turnNumber < 1) return null;
  const turn = record?.runtime_turns?.[turnNumber - 1];
  if (!turn || !["DELIVERED", "UNANSWERED"].includes(turn.state)) return null;
  const steps = [];
  const add = (kind, label, at, content, workers = [], extra = {}) => {
    steps.push({ kind, label, at: stored(at), content: stored(content), workers, ...extra });
  };
  add("message", "What you wrote", turn.inbound?.received_at, { exact_text: stored(turn.inbound?.exact_text) });
  const readers = turn.runner_reading?.readers;
  add("reader", "Crisis reader", null, without(readers?.crisis, ["receipts"]), callsFrom(readers?.crisis?.receipts), { role: "R1", timing: "Completion time not stored; before the provisional reply if shown." });
  if (readers?.provisional_refused) add("provisional_refused", "Provisional reply refused", null, readers.provisional_refused);
  if (turn.provisional) add("provisional", "Provisional reply shown", turn.provisional.shown_at, turn.provisional, callsFrom(readers?.crisis?.receipts));
  // The remaining readers run concurrently. Their individual completion order is not recorded.
  // The view shows what is stored. Whether something was stored is never inferred from the turn's state, how it closed or its
  // stored configuration (the InnerSignal lane, after GPT's reviews 5 and 6). The one section left out is the box reader's
  // placeholder, known by its stored shape alone: when the writer isn't focused the runtime stores `{ boxes: [], receipts: [] }`
  // (runtime.mjs, runBoxPicker), so no receipts and every other field an empty array. A turn made with the whole writer and
  // retried after a restart with the focused one keeps its first arrangement while its box reader ran, and a failed box reader
  // stores `boxes: null`: both stay shown.
  const boxPlaceholder = (value) => value != null && typeof value === "object" && !Array.isArray(value)
    && Array.isArray(value.receipts) && value.receipts.length === 0 && Array.isArray(value.boxes)
    && Object.entries(without(value, ["receipts"])).every(([, item]) => Array.isArray(item) && item.length === 0);
  for (const [key, role, label] of [["boxes", "R2", "Rule box reader"], ["protection", "R3", "Protection reader"]]) {
    if (readers?.[key] == null || (key === "boxes" && boxPlaceholder(readers[key]))) continue;
    add("reader", label, null, without(readers[key], ["receipts"]), callsFrom(readers[key].receipts), { role, timing: "Individual completion time and order not stored." });
  }
  const otherReadings = without(readers, ["crisis", "boxes", "protection", "provisional_refused"]);
  if (otherReadings && Object.keys(otherReadings).length) add("reading", "Other stored readings", null, otherReadings);

  // Every stored checker reading appears exactly once: with the finished or failed check of its own draft that covers it, else
  // in a step of its own after the events, bound to its candidate's draft (the InnerSignal lane, after GPT's reviews 5 and 6).
  // A turn the reload closes as interrupted has no failure event, so its readings land there.
  const storedReadings = list(turn.runner_reading?.checker_levels);
  const shownReadings = new Set();
  const takeReadings = (belongs) => {
    const taken = storedReadings.filter((entry) => !shownReadings.has(entry) && belongs(entry));
    for (const entry of taken) shownReadings.add(entry);
    return taken;
  };
  const storedBy = (entry, at) => !at || !entry.recorded_at || entry.recorded_at <= at;
  // The same for this turn's drafts and their committed audits (GPT's review of the first fix): a committed audit appears with the
  // check whose sealed call produced it (the store binds the two by the call's context), else in a step of its own after the events.
  // The store can add a finding when it commits an audit (response evidence that changed, say) and fail it, so a committed audit is
  // shown whether or not a repair started.
  const turnCandidates = list(record.candidate_responses).filter((candidate) => candidate.metadata?.runtime_turn_id === turn.id);
  const draftOfCandidate = (candidate) => (Number.isSafeInteger(candidate?.repair_cycle) ? candidate.repair_cycle + 1 : null);
  const shownCandidates = new Set();
  const shownAudits = new Set();
  // A committed audit as stored, without the identifiers of the calls behind it. Where the check's own result is shown, only the
  // findings the commit added are repeated.
  const committedAudit = (audit, checkFindings) => {
    const known = checkFindings ? new Set(checkFindings.map((finding) => finding.id)) : null;
    return {
      verdict: stored(audit.verdict), sufficient_for_approval: stored(audit.sufficient_for_approval),
      unresolved_substantive_finding_ids: list(audit.unresolved_substantive_finding_ids),
      ...(known ? { findings_added_on_commit: list(audit.findings).filter((finding) => !known.has(finding.id)) } : { findings: list(audit.findings) }),
      ...(audit.response_evidence ? { response_evidence_review: stored(audit.response_evidence.review) } : {}),
      completed_at: stored(audit.completed_at), recorded_at: stored(audit.recorded_at)
    };
  };
  let draft = 0;
  let previousAudit = null;
  let currentCandidate = null;
  for (const event of list(turn.events)) {
    if (event.event_type === "STATE_TRANSITION" && event.to_state === "RECONSTRUCTING") {
      // The runtime rebuilds the prompt on every attempt; its assembled words are not retained. The blocking findings it
      // supplies come from the exact parent candidate's stored audit, which can differ from the raw invocation result.
      const parent = list(record.candidate_responses).find((candidate) => candidate.id === event.details?.parent_candidate_id);
      const audit = parent?.audit_history?.at(-1) ?? previousAudit;
      add("repair_request", "Repair asked", event.at, {
        findings: audit ? list(audit.findings).filter((finding) => finding.record_only !== true && isSubstantiveAuditFinding(finding)) : null,
        prompt: "not stored"
      }, [], { draft: draft + 1 });
    }
    if (event.event_type === "INVOCATION_COMPLETED") {
      const output = event.details?.output;
      if (["candidate", "repair"].includes(event.stage)) {
        draft += 1;
        const result = output?.result;
        const workers = callsFrom(list(result?.receipts).filter((receipt) => !String(receipt.role).startsWith("R")), event.stage === "candidate" ? result?.rules?.parts : []);
        currentCandidate = turnCandidates.find((candidate) => candidate.repair_cycle === draft - 1);
        if (currentCandidate) shownCandidates.add(currentCandidate);
        add("draft", `${workerName(workers, "Writer")}'s draft ${draft}`, event.at, {
          exact_text: stored(output?.exactText ?? currentCandidate?.exact_text),
          ...without(result, ["receipts", "rules", "compatibilityBinding", "mode", "processingTier", "routingReason"])
        }, workers, { draft });
      } else if (event.stage === "audit") {
        const value = output?.value;
        previousAudit = value;
        const workers = callsFrom(output?.providerReceipt?.receipts);
        const roles = [...new Set(workers.map((call) => call.role))];
        const findingsFor = (role) => list(value?.findings).filter((finding) => finding.checker === role || String(finding.id).startsWith(`${role}:`));
        for (const role of roles) {
          const ownCalls = workers.filter((call) => call.role === role);
          const readings = takeReadings((entry) => currentCandidate != null && entry.checker === role && entry.candidate_id === currentCandidate.id && storedBy(entry, event.at));
          add("checker", `${workerName(ownCalls, "Checker")}'s check of draft ${draft} (${role})`, event.at, {
            findings: findingsFor(role),
            ...(readings.length ? { readings } : {}),
            ...(["CW", "C1"].includes(role) ? { checker_level: stored(value?.checker_level) } : {}),
            ...(["CW", "C5"].includes(role) ? { repair_induced_checks: stored(value?.repair_induced_checks) } : {})
          }, ownCalls, { draft, missing: findingsFor(role).some((finding) => !["quote", "quoted_span", "quoted_spans"].some((key) => finding[key] != null)) ? ["Separate quoted spans not retained in a finding: not stored."] : [] });
        }
        const unbound = list(value?.findings).filter((finding) => !roles.some((role) => findingsFor(role).includes(finding)));
        const isProgram = (finding) => finding.checker === "program" || /^(?:P|program):/u.test(String(finding.id));
        if (unbound.some((finding) => !isProgram(finding))) add("findings", `Findings without a stored checker binding for draft ${draft}`, event.at, { findings: unbound.filter((finding) => !isProgram(finding)) }, [], { draft });
        add("program_checks", `Program's exact checks of draft ${draft}`, event.at, {
          ...without(value, ["findings"]),
          findings: unbound.filter(isProgram)
        }, [], { draft, timing: "Checker completion order not stored; these results belong to the same draft." });
        const contextId = event.details?.actual_context_id;
        for (const audit of list(currentCandidate?.audit_history)) {
          if (shownAudits.has(audit) || contextId == null || audit.auditor_context_id !== contextId) continue;
          shownAudits.add(audit);
          add("committed_check", `Stored result of the check of draft ${draft}`, audit.recorded_at ?? event.at, committedAudit(audit, list(value?.findings)), [], { draft });
        }
      }
    } else if (["INVOCATION_FAILED", "INVOCATION_ABANDONED"].includes(event.event_type)) {
      // A check that failed part-way still keeps the readings its finished checkers stored (a crisis level, say) before the
      // failure, bound to the draft being checked (Codex's review 5): show them instead of hiding them behind "not stored".
      const readings = event.stage === "audit"
        ? takeReadings((entry) => currentCandidate != null && entry.candidate_id === currentCandidate.id && storedBy(entry, event.at))
        : [];
      add("failure", `${event.stage} ${event.event_type === "INVOCATION_FAILED" ? "failed" : "interrupted"}`, event.at, {
        error_code: stored(event.details?.error_code), result: "not stored",
        ...(readings.length ? { readings } : {})
      }, callsFrom(event.details?.raw_private_evidence?.receipts), event.stage === "audit" && draft ? { draft } : {});
    }
  }
  // Drafts and committed audits no event showed, by draft.
  for (const candidate of turnCandidates) {
    const candidateDraft = draftOfCandidate(candidate);
    if (!shownCandidates.has(candidate)) {
      shownCandidates.add(candidate);
      add("stored_draft", candidateDraft ? `Stored draft ${candidateDraft}, with no stored record of its writer's call` : "Stored draft, with no stored record of its writer's call",
        stored(candidate.created_at), { exact_text: stored(candidate.exact_text) }, [], candidateDraft ? { draft: candidateDraft } : {});
    }
    for (const audit of list(candidate.audit_history)) {
      if (shownAudits.has(audit)) continue;
      shownAudits.add(audit);
      add("committed_check", candidateDraft ? `Stored result of a check of draft ${candidateDraft}, with no stored record of its call` : "Stored result of a check, with no stored record of its call",
        stored(audit.recorded_at), committedAudit(audit, null), [], candidateDraft ? { draft: candidateDraft } : {});
    }
  }
  // The readings no finished or failed check showed: an audit the process stopped in (GPT's review 6), a checker whose call left
  // no receipt, a draft this turn's record doesn't hold. One step per candidate, in stored order.
  const draftOf = (candidateId) => draftOfCandidate(turnCandidates.find((entry) => entry.id === candidateId));
  const unshown = new Map();
  for (const entry of storedReadings) {
    if (shownReadings.has(entry)) continue;
    const key = entry.candidate_id ?? null;
    if (!unshown.has(key)) unshown.set(key, []);
    unshown.get(key).push(entry);
  }
  for (const [candidateId, readings] of unshown) {
    const readingDraft = draftOf(candidateId);
    for (const entry of readings) shownReadings.add(entry);
    add("readings", readingDraft ? `Stored readings for draft ${readingDraft}, with no stored result of its check` : "Stored readings for a draft not in this turn's record",
      readings.map((entry) => entry.recorded_at).filter(Boolean).sort().at(-1) ?? null, { readings, result: "not stored" }, [], readingDraft ? { draft: readingDraft } : {});
  }
  if (turn.emergency_line_shown_at) {
    // Only the fact/reason are retained. Do not substitute today's constant for unrecorded historical words.
    const step = { kind: "emergency_line", label: "Highlighted emergency line", at: turn.emergency_line_shown_at, content: { reason_code: stored(turn.emergency_line_reason), exact_text: "not stored" }, workers: [] };
    const after = steps.findIndex((entry, index) => index > 0 && entry.at && entry.at > step.at);
    steps.splice(after < 0 ? steps.length : after, 0, step);
  }
  if (turn.delivery) add("delivery", "What you were shown", turn.delivery.delivered_at, turn.delivery);
  else add("closure", "How it closed", turn.closure?.closed_at, turn.closure);
  return {
    schema_version: 1, turn: turnNumber, runtime_turn_id: turn.id, state: turn.state,
    runner_config: stored(turn.runner_config),
    chronology_note: "Drafts, checks and repairs follow the stored event order. Individual reader and checker completion order is not stored. The emergency line is placed by its stored time; order within a tied timestamp is not stored. Failed worker attempts retain receipts, but their output text is not stored.",
    steps
  };
}
