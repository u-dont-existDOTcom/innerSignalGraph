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
  for (const [key, role, label] of [["boxes", "R2", "Rule box reader"], ["protection", "R3", "Protection reader"]]) {
    add("reader", label, null, without(readers?.[key], ["receipts"]), callsFrom(readers?.[key]?.receipts), { role, timing: "Individual completion time and order not stored." });
  }
  const otherReadings = without(readers, ["crisis", "boxes", "protection", "provisional_refused"]);
  if (otherReadings && Object.keys(otherReadings).length) add("reading", "Other stored readings", null, otherReadings);

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
        currentCandidate = list(record.candidate_responses).find((candidate) => candidate.metadata?.runtime_turn_id === turn.id && candidate.repair_cycle === draft - 1);
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
          const readings = list(turn.runner_reading?.checker_levels).filter((entry) => entry.checker === role && entry.candidate_id === currentCandidate?.id && entry.recorded_at <= event.at);
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
      }
    } else if (["INVOCATION_FAILED", "INVOCATION_ABANDONED"].includes(event.event_type)) {
      add("failure", `${event.stage} ${event.event_type === "INVOCATION_FAILED" ? "failed" : "interrupted"}`, event.at, {
        error_code: stored(event.details?.error_code), result: "not stored"
      }, callsFrom(event.details?.raw_private_evidence?.receipts));
    }
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
