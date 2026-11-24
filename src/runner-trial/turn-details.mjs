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

// The view shows what is stored for a turn, each stored thing once, bound by the identities the store binds it with. Hiding or
// mis-binding by inference recurred four times (GPT's reviews 5 and 6, and two reviews of their fixes), so nothing is placed by
// position or count where an identity is stored, and nothing is left out because of the turn's state, how it closed or its
// stored configuration:
// - a draft is bound to its writer's sealed call by the call's context (the draft's producer_context_id is the completion's
//   details.actual_context_id, as the store checks it), or, in a record without contexts, by being the one draft of that stage
//   with exactly the call's words; its number is its own repair cycle's;
// - a committed audit is placed at the transition that committed it (the store's transition names the audit and its draft), or,
//   with none stored, with the one check call whose auditor's context it carries; its check call is the last audit completion
//   with that context before the commit. It is shown as committed, with every finding (the commit can add findings, change a
//   finding's severity and fail the audit);
// - a checker reading is bound to its draft by its candidate id;
// - a draft's stored words are the draft; the call's words, where they differ, are shown beside them.
// Only a call that left no stored result naming its draft (a failed, abandoned or unended call, a check with no committed audit)
// is placed by position, with the draft the last bound call was about. A draft is shown before anything bound to it; whatever no
// call shows (a draft, a committed audit, a reading) gets a step of its own after the events, with its draft. A call started and
// never ended is shown as such. The box reader's section is left out only for the runtime's exact placeholder.
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
  // The remaining readers run concurrently. Their individual completion order is not recorded. When the writer isn't focused the
  // runtime stores the box reader's placeholder, exactly `{ boxes: [], receipts: [] }` (runtime.mjs, runBoxPicker): that alone
  // gets no section. Anything else is shown, a failed box reader's `boxes: null` and a real result after a restart from the whole
  // writer to the focused one included.
  const boxPlaceholder = (value) => value != null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === "boxes,receipts"
    && Array.isArray(value.boxes) && value.boxes.length === 0 && Array.isArray(value.receipts) && value.receipts.length === 0;
  for (const [key, role, label] of [["boxes", "R2", "Rule box reader"], ["protection", "R3", "Protection reader"]]) {
    if (readers?.[key] == null || (key === "boxes" && boxPlaceholder(readers[key]))) continue;
    add("reader", label, null, without(readers[key], ["receipts"]), callsFrom(readers[key].receipts), { role, timing: "Individual completion time and order not stored." });
  }
  const otherReadings = without(readers, ["crisis", "boxes", "protection", "provisional_refused"]);
  if (otherReadings && Object.keys(otherReadings).length) add("reading", "Other stored readings", null, otherReadings);

  const candidates = list(record.candidate_responses).filter((candidate) => candidate.metadata?.runtime_turn_id === turn.id);
  const candidateById = (id) => (id == null ? null : candidates.find((candidate) => candidate.id === id) ?? null);
  const draftOf = (candidate) => (Number.isSafeInteger(candidate?.repair_cycle) ? candidate.repair_cycle + 1 : null);
  const draftName = (number) => (number ? `draft ${number}` : "a draft not in this turn's record");
  const draftExtra = (number) => (number ? { draft: number } : {});
  const storedReadings = list(turn.runner_reading?.checker_levels);
  const shown = new Set();
  const takeReadings = (belongs) => {
    const taken = storedReadings.filter((entry) => !shown.has(entry) && belongs(entry));
    for (const entry of taken) shown.add(entry);
    return taken;
  };
  const storedBy = (entry, at) => !at || !entry.recorded_at || entry.recorded_at <= at;
  const events = list(turn.events);
  const ended = new Set(events.filter((event) => ["INVOCATION_COMPLETED", "INVOCATION_FAILED", "INVOCATION_ABANDONED"].includes(event.event_type)).map((event) => event.context_id).filter(Boolean));
  // The index of the transition that committed each audit, by its draft and the audit's id (an id is unique within a draft only).
  const commitKey = (candidateId, auditId) => `${candidateId ?? ""}\0${auditId}`;
  const commits = new Map();
  events.forEach((event, index) => { if (event.event_type === "STATE_TRANSITION" && event.details?.audit_id != null) commits.set(commitKey(event.details.candidate_id, event.details.audit_id), index); });
  const committedAt = (entry) => commits.get(commitKey(entry.candidate.id, entry.audit.id));
  const committedAudits = candidates.flatMap((candidate) => list(candidate.audit_history).map((audit) => ({ candidate, audit })));
  // Which check call a committed audit came from (its event's index), or -1 when that can't be known.
  const checkOf = (entry) => {
    const { audit } = entry;
    if (audit.auditor_context_id == null) return -1;
    const matching = [];
    events.forEach((event, index) => { if (event.event_type === "INVOCATION_COMPLETED" && event.stage === "audit" && event.details?.actual_context_id === audit.auditor_context_id) matching.push(index); });
    const commit = committedAt(entry);
    if (commit !== undefined) { const before = matching.filter((index) => index < commit); return before.at(-1) ?? -1; }
    return matching.length === 1 ? matching[0] : -1;
  };
  const checks = new Map(committedAudits.map((entry) => [entry, checkOf(entry)]));
  const commitStep = ({ candidate, audit }) => {
    shown.add(audit);
    const number = draftOf(candidate);
    add("committed_check", `Stored result of the check of ${draftName(number)}`, audit.recorded_at ?? null, committedContent(audit), [], draftExtra(number));
  };
  const writerOf = (event) => {
    const contextId = event.details?.actual_context_id;
    const stageFits = (candidate) => (event.stage === "repair") === (candidate.parent_candidate_id != null);
    if (contextId != null) {
      const bound = candidates.filter((candidate) => candidate.producer_context_id === contextId && stageFits(candidate));
      if (bound.length === 1) return bound[0];
    }
    const text = event.details?.output?.exactText;
    const sameText = candidates.filter((candidate) => typeof text === "string" && candidate.exact_text === text
      && stageFits(candidate) && (contextId == null || candidate.producer_context_id == null));
    return sameText.length === 1 ? sameText[0] : null;
  };
  // A committed audit as stored, without the identifiers of the calls behind it, every finding included.
  const committedContent = (audit) => ({
    verdict: stored(audit.verdict), sufficient_for_approval: stored(audit.sufficient_for_approval),
    unresolved_substantive_finding_ids: list(audit.unresolved_substantive_finding_ids), findings: list(audit.findings),
    ...(audit.response_evidence ? { response_evidence_review: stored(audit.response_evidence.review) } : {}),
    completed_at: stored(audit.completed_at), recorded_at: stored(audit.recorded_at)
  });
  const storedDraft = (candidate) => {
    if (!candidate || shown.has(candidate)) return;
    shown.add(candidate);
    const number = draftOf(candidate);
    add("stored_draft", `Stored ${draftName(number)}, with no stored record of its writer's call`, stored(candidate.created_at), { exact_text: stored(candidate.exact_text) }, [], draftExtra(number));
  };

  // What this turn did with a kept plan, as stored, and the plan it saved, its lines and its own deletion record. One turn can delete
  // an older plan and save a new one, so the turn's deletion says nothing of the plan it saved. A plan saved in an interrupted turn
  // is shown without the writer's call that names it.
  if (turn.kept_plan_deleted_at != null) add("kept_plan", "Kept plan deleted in this turn", turn.kept_plan_deleted_at, { deleted_at: turn.kept_plan_deleted_at });
  const plan = list(record.runner_kept_plans).find((entry) => entry.runtime_turn_id === turn.id);
  if (plan || turn.kept_plan_kept_at != null) {
    add("kept_plan", "Kept plan saved in this turn", plan?.kept_at ?? turn.kept_plan_kept_at, { saved_at: stored(plan?.kept_at ?? turn.kept_plan_kept_at),
      ...(plan ? { lines: list(plan.lines), deleted_at: stored(plan.deleted_at), deletion_reason: stored(plan.deletion_reason) } : {}) });
  }
  if (turn.discriminator) add("discriminator", "Question asked instead of a reply", turn.discriminator.created_at, { exact_text: stored(turn.discriminator.exact_text), kind: stored(turn.discriminator.kind) });
  let previousAudit = null;
  let current = null;
  for (const [eventIndex, event] of events.entries()) {
    if (event.event_type === "STATE_TRANSITION" && event.details?.audit_id != null) {
      const entry = committedAudits.find(({ candidate, audit }) => audit.id === event.details.audit_id && candidate.id === event.details.candidate_id);
      const candidate = entry?.candidate ?? candidateById(event.details.candidate_id);
      if (candidate) { storedDraft(candidate); current = candidate; }
      if (entry && !shown.has(entry.audit)) commitStep(entry);
    }
    if (event.event_type === "INVOCATION_STARTED" && event.context_id != null && !ended.has(event.context_id)) {
      // A call the process stopped in (the reload closes the turn without ending it): only its start is stored.
      const number = event.stage === "audit" ? draftOf(current) : null;
      add("started", `${event.stage} call started and not ended`, event.at, { attempt: stored(event.attempt), result: "not stored" }, [], draftExtra(number));
    }
    if (event.event_type === "STATE_TRANSITION" && event.to_state === "RECONSTRUCTING") {
      // The runtime rebuilds the prompt on every attempt; its assembled words are not retained. The blocking findings it
      // supplies come from the exact parent candidate's stored audit, which can differ from the raw invocation result.
      const parent = candidateById(event.details?.parent_candidate_id);
      const audit = parent?.audit_history?.at(-1) ?? previousAudit;
      const base = parent ?? current;
      add("repair_request", "Repair asked", event.at, {
        findings: audit ? list(audit.findings).filter((finding) => finding.record_only !== true && isSubstantiveAuditFinding(finding)) : null,
        prompt: "not stored"
      }, [], draftExtra(draftOf(base) ? draftOf(base) + 1 : null));
    }
    if (event.event_type === "INVOCATION_COMPLETED") {
      const output = event.details?.output;
      if (["candidate", "repair"].includes(event.stage)) {
        const result = output?.result;
        const workers = callsFrom(list(result?.receipts).filter((receipt) => !String(receipt.role).startsWith("R")), event.stage === "candidate" ? result?.rules?.parts : []);
        const candidate = writerOf(event);
        const again = candidate != null && shown.has(candidate);
        if (candidate) { shown.add(candidate); current = candidate; }
        const number = draftOf(candidate);
        const callWords = output?.exactText;
        const draftWords = candidate?.exact_text ?? null;
        if (again) {
          add("call", `Another stored call of ${workerName(workers, "Writer")} for ${draftName(number)}`, event.at, { exact_text: stored(callWords), ...without(result, ["receipts", "rules", "compatibilityBinding", "mode", "processingTier", "routingReason"]) }, workers, draftExtra(number));
          continue;
        }
        add("draft", candidate ? `${workerName(workers, "Writer")}'s draft ${number}` : `${workerName(workers, "Writer")}'s words, bound to no stored draft`, event.at, {
          exact_text: stored(draftWords ?? callWords),
          ...(draftWords != null && callWords != null && draftWords !== callWords ? { call_exact_text: callWords } : {}),
          ...without(result, ["receipts", "rules", "compatibilityBinding", "mode", "processingTier", "routingReason"])
        }, workers, draftExtra(number));
      } else if (event.stage === "audit") {
        const value = output?.value ?? output?.result;
        previousAudit = value;
        const boundHere = committedAudits.filter((entry) => !shown.has(entry.audit) && checks.get(entry) === eventIndex);
        const candidate = boundHere[0]?.candidate ?? current;
        if (boundHere.length) { storedDraft(candidate); current = candidate; }
        const number = draftOf(candidate);
        const workers = callsFrom(output?.providerReceipt?.receipts);
        const roles = [...new Set(workers.map((call) => call.role))];
        const findingsFor = (role) => list(value?.findings).filter((finding) => finding.checker === role || String(finding.id).startsWith(`${role}:`));
        for (const role of roles) {
          const ownCalls = workers.filter((call) => call.role === role);
          const readings = takeReadings((entry) => candidate != null && entry.checker === role && entry.candidate_id === candidate.id && storedBy(entry, event.at));
          add("checker", `${workerName(ownCalls, "Checker")}'s check of ${draftName(number)} (${role})`, event.at, {
            findings: findingsFor(role),
            ...(readings.length ? { readings } : {}),
            ...(["CW", "C1"].includes(role) ? { checker_level: stored(value?.checker_level) } : {}),
            ...(["CW", "C5"].includes(role) ? { repair_induced_checks: stored(value?.repair_induced_checks) } : {})
          }, ownCalls, { ...draftExtra(number), missing: findingsFor(role).some((finding) => !["quote", "quoted_span", "quoted_spans"].some((key) => finding[key] != null)) ? ["Separate quoted spans not retained in a finding: not stored."] : [] });
        }
        const unbound = list(value?.findings).filter((finding) => !roles.some((role) => findingsFor(role).includes(finding)));
        const isProgram = (finding) => finding.checker === "program" || /^(?:P|program):/u.test(String(finding.id));
        if (unbound.some((finding) => !isProgram(finding))) add("findings", `Findings without a stored checker binding for ${draftName(number)}`, event.at, { findings: unbound.filter((finding) => !isProgram(finding)) }, [], draftExtra(number));
        add("program_checks", `Program's exact checks of ${draftName(number)}`, event.at, {
          ...without(value, ["findings"]),
          findings: unbound.filter(isProgram)
        }, [], { ...draftExtra(number), timing: "Checker completion order not stored; these results belong to the same draft." });
        // A commit with no stored transition follows its check here; one with a transition is shown at that transition.
        for (const entry of boundHere) if (committedAt(entry) === undefined) commitStep(entry);
      } else {
        // Any other stored call: its result as stored, words and all (this view is the owner's).
        add("call", `${event.stage} completed`, event.at, { ...(output?.exactText == null ? {} : { exact_text: output.exactText }), result: without(output?.value ?? output?.result ?? null, ["receipts", "rules", "compatibilityBinding"]) },
          callsFrom(output?.providerReceipt?.receipts ?? output?.result?.receipts));
      }
    } else if (["INVOCATION_FAILED", "INVOCATION_ABANDONED"].includes(event.event_type)) {
      // A call that failed or was abandoned stored no result naming its draft, so it is placed with the draft the last bound call
      // was about. A check that failed part-way still keeps the readings its finished checkers stored before the failure
      // (Codex's review 5): show them instead of hiding them behind "not stored".
      const readings = event.stage === "audit" ? takeReadings((entry) => current != null && entry.candidate_id === current.id && storedBy(entry, event.at)) : [];
      const number = draftOf(current);
      add("failure", `${event.stage} ${event.event_type === "INVOCATION_FAILED" ? "failed" : "interrupted"}`, event.at, {
        error_code: stored(event.details?.error_code), result: "not stored",
        ...(readings.length ? { readings } : {})
      }, callsFrom(event.details?.raw_private_evidence?.receipts), event.stage === "audit" ? draftExtra(number) : {});
    }
  }
  // Whatever no call showed, by draft: a draft stored with no record of its writer's call, a committed audit whose check left no
  // stored record of its call, readings no finished or failed check showed (an audit the process stopped in, GPT's review 6).
  for (const candidate of candidates) {
    storedDraft(candidate);
    const number = draftOf(candidate);
    for (const audit of list(candidate.audit_history)) {
      if (shown.has(audit)) continue;
      shown.add(audit);
      add("committed_check", `Stored result of a check of ${draftName(number)}, with no stored record of its call`, stored(audit.recorded_at), committedContent(audit), [], draftExtra(number));
    }
  }
  const unshown = new Map();
  for (const entry of storedReadings) {
    if (shown.has(entry)) continue;
    const key = entry.candidate_id ?? null;
    if (!unshown.has(key)) unshown.set(key, []);
    unshown.get(key).push(entry);
  }
  for (const [candidateId, readings] of unshown) {
    const number = draftOf(candidateById(candidateId));
    for (const entry of readings) shown.add(entry);
    add("readings", `Stored readings for ${draftName(number)}, with no stored result of its check`,
      readings.map((entry) => entry.recorded_at).filter(Boolean).sort().at(-1) ?? null, { readings, result: "not stored" }, [], draftExtra(number));
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
    chronology_note: "Drafts, checks and repairs follow the stored event order. Individual reader and checker completion order is not stored. The emergency line is placed by its stored time; order within a tied timestamp is not stored. Failed worker attempts retain receipts, but their output text is not stored. A draft, a committed check or a reading no stored call shows follows the events.",
    steps
  };
}
