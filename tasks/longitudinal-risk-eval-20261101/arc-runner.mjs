import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { openScriptedRiskRuntime, BLOCKING_FINDING } from "../../tests/fixtures/scripted-risk-runtime.mjs";
import { CASE_STATE_LIMITS, createEmptyCaseState, mergeRuntimeSnapshotIntoCaseState } from "../../src/case-state/longitudinal-state.mjs";
import { classifyTherapyTier } from "../../src/orchestrator/run-tiered-pipeline.mjs";
import { privateRuntimeAuditPrompt } from "../../src/prompts/private-runtime-audit.mjs";
import { assessContinuationSafety } from "../../src/storage/private-case-continuity.mjs";
import { buildPrivateCandidateAuditInput } from "../../src/supervisor/private-candidate-audit.mjs";
import { isDeliverableDiscriminatorQuestion } from "../../src/supervisor/private-runtime-turn-lifecycle.mjs";
import { expandArm, loadCorpus, loadJson, readingFor, routeFamily, seededReplies, sha256, standInReply, SEEDS_URL, validateSeeds } from "./corpus.mjs";

// Runs each arc turn by turn through the real private runtime (encrypted store, controller, model runtime, audit loop) with scripted
// stand-ins, and records what happened on every turn. Nothing here is a model. The stand-ins return the corpus's reading, a neutral reply
// and findings chosen here; every route, tier, packet and delivery below is the production code's own.
const t0 = () => performance.now();
const cleanup = () => {
  const fns = [];
  return { after(fn) { fns.push(fn); }, async dispose() { for (const fn of fns.splice(0).reverse()) await fn(); } };
};
export const turnNumber = (id) => Number(/^risk-(\d+)-/u.exec(id ?? "")?.[1] ?? Number.NaN);

// The audit packet exactly as the runtime seals it. The runtime's own function is not exported, so this repeats it, and every capture
// is checked against the prompt the runtime actually sent: if the two ever differ the run stops instead of recording a packet nobody saw.
function sealReplica(input) {
  return Object.freeze({
    schema_version: 1,
    role: "AUTHORIZED_PRIVATE_CANDIDATE_AUDIT",
    candidate_binding: Object.freeze({ id: input.candidate_id, version: input.candidate_version, status: input.candidate_status, parent_candidate_id: input.candidate_parent_candidate_id }),
    candidate_response: input.candidate_response,
    constitution_ref: input.constitution_ref,
    case_state: input.case_state,
    last_state_diff: input.last_state_diff,
    recent_verbatim: input.recent_verbatim,
    targeted_older_evidence: input.targeted_older_evidence,
    current_episode: input.current_episode,
    trajectory_digest: input.trajectory_digest ?? null,
    binding_rule: input.binding_rule,
    reconstruction_audit_required: input.reconstruction_audit_required,
    repair_induced_error_checks: input.repair_induced_error_checks,
    instructions: input.instructions,
    disclosure_manifest: Object.freeze({
      exact_candidate_included: true,
      authorized_case_context_included: true,
      producer_hidden_reasoning_included: false,
      producer_trace_included: false,
      repair_rationale_history_included: false,
      prior_verdicts_included: false,
      tools_available: false,
      filesystem_available: false,
      trajectory_digest_included: input.trajectory_digest != null,
      trajectory_digest_computed_in_code_without_model: true,
      self_directed_risk_record_included: input.trajectory_digest?.self_directed_risk != null
    })
  });
}

async function captureSealedPacket(runtime, prompt) {
  const inPrompt = JSON.parse(prompt.user.split("\n").slice(1).join("\n"));
  const access = {
    async loadCaseContext(caseId, _authContext, options) {
      const context = await runtime.store.loadCaseContext(caseId, options);
      return { ...context, continuation_safety: assessContinuationSafety(context) };
    }
  };
  const input = await buildPrivateCandidateAuditInput({ caseAccessService: access, caseId: runtime.caseId, candidateId: inPrompt.candidate_binding.id });
  const sealed = sealReplica(input);
  const rebuilt = privateRuntimeAuditPrompt(sealed);
  if (rebuilt.system !== prompt.system || rebuilt.user !== prompt.user) throw new Error("The rebuilt audit packet differs from the prompt the runtime sent; the capture would not be what the auditor saw.");
  return sealed;
}

function summarizePacket(sealed, prompt) {
  const windowIds = sealed.recent_verbatim.turns.map((turn) => turn.id);
  const packetJson = JSON.stringify(sealed);
  return {
    sha256: sha256(packetJson),
    packet_chars: packetJson.length,
    prompt_system_sha256: sha256(prompt.system),
    prompt_user_sha256: sha256(prompt.user),
    prompt_user_chars: prompt.user.length,
    prompt_system_chars: prompt.system.length,
    candidate_id: sealed.candidate_binding.id,
    window_ids: windowIds,
    window_user_turns: windowIds.filter((id) => id.endsWith("-user")).map(turnNumber),
    window_truncated_for_bound: sealed.recent_verbatim.truncated_for_bound === true,
    older: sealed.targeted_older_evidence.map((item) => ({ turn: turnNumber(item.turn_id), turn_id: item.turn_id, reasons: item.reasons ?? [] })),
    episode: { id: sealed.current_episode?.id ?? null, route: sealed.current_episode?.route ?? null, started_turn_id: sealed.current_episode?.started_turn_id ?? null },
    manifest: sealed.disclosure_manifest,
    digest: sealed.trajectory_digest
  };
}

// The scripted audit findings of the four probes, each run on a copy of the case made just before the turn.
const ROLE_BELIEF_FINDING = Object.freeze({ id: "probe-role-belief", code: "HARMFUL_BELIEF_ENDORSEMENT", severity: "substantive", summary: "Seeded role or belief finding." });
export const PROBES = Object.freeze([
  { id: "record_only", findings: ({ auditNumber }) => (auditNumber === 1 ? [{ id: "probe-record-only", code: "SELF_DIRECTED_RISK_UNDERREACTION", severity: "high", summary: "Seeded record-only finding." }] : []) },
  { id: "block_once", findings: ({ auditNumber }) => (auditNumber === 1 ? [BLOCKING_FINDING] : []) },
  { id: "block_persistent", findings: () => [BLOCKING_FINDING] },
  { id: "role_belief", findings: () => [ROLE_BELIEF_FINDING] }
]);

async function runProbe(runtime, number, probe, setting) {
  const forkT = cleanup();
  const fork = await runtime.fork(forkT, { auditFindings: probe.findings, onAuditPacket: () => {}, onPrompt: () => {}, ownerFallback: setting === "on" });
  let outcome;
  try {
    const result = await fork.run(number);
    outcome = { delivered: true, delivery_kind: result.deliveryKind, error_code: null };
  } catch (error) {
    outcome = { delivered: false, delivery_kind: null, error_code: error.code ?? error.name ?? "ERROR", error_stage: error.details?.stage ?? null, message: String(error.message).slice(0, 200) };
  }
  const record = await fork.load();
  const episode = record.case_state.current_episode;
  const turnRecord = record.runtime_turns.at(-1);
  const current = record.candidate_responses.find((candidate) => candidate.id === turnRecord?.current_candidate_id);
  const candidates = current ? record.candidate_responses.filter((candidate) => candidate.root_candidate_id === current.root_candidate_id) : [];
  const audits = candidates.flatMap((candidate) => candidate.audit_history);
  const question = typeof episode?.next_question === "string" ? episode.next_question.trim() : "";
  const row = {
    probe: probe.id,
    turn: number,
    setting,
    ...outcome,
    route: episode?.active_step ?? episode?.route ?? null,
    stored_question_present: question.length > 0,
    stored_question_deliverable: question.length > 0 && isDeliverableDiscriminatorQuestion(question),
    audits: audits.length,
    repairs: Math.max(0, ...candidates.map((candidate) => candidate.repair_cycle)),
    final_candidate_status: candidates.at(-1)?.status ?? null,
    last_findings: (audits.at(-1)?.findings ?? []).map(({ code, severity, reported_severity: reported, record_only: recordOnly }) => ({ code, severity, reported_severity: reported ?? null, record_only: recordOnly === true })),
    runtime_turn_state: record.runtime_turns.at(-1)?.state ?? null
  };
  await forkT.dispose();
  return row;
}

// For a decision turn with seeded replies: the turn run again on a copy of the case made just before it, with each seeded reply as the
// production candidate. Compared afterwards with the packet the main line built, this shows that writing a seeded reply into the sealed
// packet's candidate_response gives the packet the runtime would have built for that candidate (stage 1 relies on it).
async function produceSeedPackets(runtime, number, replies) {
  const produced = [];
  for (const [seed, text] of Object.entries(replies)) {
    const forkT = cleanup();
    let packet = null;
    const fork = await runtime.fork(forkT, { reply: () => text, onAuditPacket: () => {}, onPrompt: async ({ stage, input }) => { if (stage === "private_candidate_audit" && !packet) packet = await captureSealedPacket(fork, input); } });
    try {
      await fork.run(number);
      produced.push({ seed, packet });
    } catch (error) {
      produced.push({ seed, error: String(error.message).slice(0, 200) });
    }
    await forkT.dispose();
  }
  return produced;
}

function compareSeedPackets(main, produced, number) {
  return produced.map(({ seed, packet, error }) => {
    if (error || !packet) return { seed, turn: number, equal: false, error: error ?? "no packet" };
    const substituted = { ...JSON.parse(JSON.stringify(main)), candidate_response: packet.candidate_response };
    const differing = Object.keys(substituted).filter((key) => JSON.stringify(substituted[key]) !== JSON.stringify(packet[key]));
    return { seed, turn: number, equal: differing.length === 0, differing_keys: differing, produced_candidate_chars: packet.candidate_response.length };
  });
}

export async function runArm({ corpus, seeds, arcId, armId, setting, probes = true, packetDir = null, onProgress = () => {} }) {
  const arc = corpus.arcs.find((candidate) => candidate.id === arcId);
  const arm = arc.arms.find((candidate) => candidate.id === armId);
  const turns = expandArm(corpus, arc, arm);
  const seedTurns = new Map((seeds?.turns ?? []).filter((entry) => entry.arc === arcId && entry.arm === armId).map((entry) => [entry.turn, entry]));
  const savePackets = new Set([...(arm.probe_turns ?? []), ...seedTurns.keys()]);
  const t = cleanup();
  const audits = [];
  let captureError = null;
  let runtime = null;
  runtime = await openScriptedRiskRuntime(t, {
    caseId: `synthetic-eval-${arcId}-${armId}`.toLowerCase().replaceAll("_", "-"),
    readings: turns.map((turn) => readingFor(corpus, turn.reading)),
    itemsPerTurn: arm.items_per_turn,
    maximumTurns: turns.length,
    messages: turns.map((turn) => turn.text),
    reply: ({ number }) => standInReply(corpus, number),
    clock: true,
    ownerFallback: setting === "on",
    onPrompt: async ({ stage, input }) => {
      if (stage === "case_extraction") audits.length = 0;
      if (stage === "private_candidate_audit") {
        try {
          audits.push({ sealed: await captureSealedPacket(runtime, input), prompt: { system: input.system, user: input.user } });
        } catch (error) {
          captureError = error.message;
          throw error;
        }
      }
    }
  });

  const rows = [];
  const probeRows = [];
  const seedRows = [];
  let stoppedAt = null;
  for (const turn of turns) {
    const number = turn.number;
    const started = t0();
    if (probes && (arm.probe_turns ?? []).includes(number)) {
      for (const probe of PROBES) probeRows.push({ arc: arcId, arm: armId, ...(await runProbe(runtime, number, probe, setting)) });
    }
    const seed = seedTurns.get(number);
    const seedPackets = seed && probes && setting === "off" ? await produceSeedPackets(runtime, number, seededReplies(seeds, seed)) : null;
    let outcome;
    try {
      const result = await runtime.run(number);
      outcome = { result };
    } catch (error) {
      outcome = { error };
    }
    const first = audits[0] ?? null;
    if (first && seedPackets) seedRows.push(...compareSeedPackets(first.sealed, seedPackets, number).map((row) => ({ arc: arcId, arm: armId, ...row })));
    if (first && packetDir && savePackets.has(number)) {
      await fs.mkdir(packetDir, { recursive: true });
      await fs.writeFile(path.join(packetDir, `${arcId}-${armId}-t${number}.json`), `${JSON.stringify({ arc: arcId, arm: armId, turn: number, system_sha256: sha256(first.prompt.system), user_sha256: sha256(first.prompt.user), packet: first.sealed }, null, 1)}\n`);
    }
    const row = { arc: arcId, arm: armId, setting, turn: number, text_chars: turn.text.length, reading: turn.reading, label: turn.label.name, dependent: turn.dependent === true };
    if (outcome.error) {
      Object.assign(row, { delivery_kind: null, error_code: outcome.error.code ?? outcome.error.name ?? "ERROR", error_message: String(outcome.error.message).slice(0, 300), capture_error: captureError, audit_count: audits.length });
      stoppedAt = number;
    } else {
      const { result } = outcome;
      const meta = result.runtimeMetadata;
      const snapshot = meta.caseFormulation;
      const record = await runtime.load();
      const withoutState = { ...snapshot, variables: { ...snapshot.variables, suicidal_state: "absent", suicidal_ideation_context: "unknown" } };
      const route = meta.interventionContract?.primaryJob?.id ?? null;
      Object.assign(row, {
        extraction: { suicidal_state: snapshot.variables.suicidal_state, suicidal_ideation_context: snapshot.variables.suicidal_ideation_context ?? null },
        route,
        route_family: routeFamily(route),
        tier: meta.processingTier,
        tier_reason: meta.routingReason,
        tier_auto: classifyTherapyTier(snapshot, "auto").tier,
        tier_auto_state_absent: classifyTherapyTier(withoutState, "auto").tier,
        audit_count: audits.length,
        packet: first ? summarizePacket(first.sealed, first.prompt) : null,
        delivery_kind: result.deliveryKind,
        error_code: null,
        items: {
          case_items: record.case_state.items.length,
          intervention_history: record.case_state.intervention_history.length,
          episode_source_item_ids: record.case_state.current_episode?.source_item_ids?.length ?? 0,
          transcript_entries: record.raw_transcript.length
        }
      });
    }
    row.ms = Math.round(t0() - started);
    rows.push(row);
    onProgress(row);
    if (stoppedAt != null) break;
  }
  await t.dispose();
  return { arc: arcId, arm: armId, setting, planned_turns: turns.length, stopped_at: stoppedAt, rows, probes: probeRows, seed_equivalence: seedRows };
}

// Turn 60 of a conversation on one route at six items a turn: the first 59 turns are built with the real merge and stored as one block
// (running them through the encrypted store one by one takes minutes), then the 60th runs the whole audit loop. Also the known limit: the
// case-level item cap of 500, reached at turn 84 of six items a turn, which this change leaves as it is.
const at = (number) => new Date(Date.UTC(2026, 10, 1, 0, 0, number)).toISOString();
const sixItems = (number) => ({
  variables: { suicidal_state: "absent" },
  direct_observations: Array.from({ length: 4 }, (_unused, index) => ({ id: `O${index + 1}`, statement: `Synthetic observation ${index + 1}.`, evidence: `Synthetic message ${number}.` })),
  hypotheses: Array.from({ length: 2 }, (_unused, index) => ({ id: `H${index + 1}`, claim: `Synthetic hypothesis ${index + 1}.`, evidence: "Synthetic placeholder evidence.", confidence: "low", alternatives: ["Synthetic alternative."] }))
});
const mergeSix = (state, number) => mergeRuntimeSnapshotIntoCaseState(state, sixItems(number), { turnId: `t${number}-user`, recordedAt: at(number), interventionContract: { primaryJob: { id: "IC.CREDIBILITY_REPAIR", title: "Synthetic route" }, nextQuestion: "", selectedNodes: [], variables: {} } });

export async function runCaps({ setting }) {
  const out = { setting, item_limit: CASE_STATE_LIMITS.items, episode_list_limit: CASE_STATE_LIMITS.episode_list };
  const states = [];
  let current = createEmptyCaseState({ caseId: "synthetic-eval-caps" });
  for (let number = 1; number <= 59; number += 1) { current = mergeSix(current, number); states.push(current); }
  const t = cleanup();
  const runtime = await openScriptedRiskRuntime(t, { itemsPerTurn: 6, maximumTurns: 10, clock: true, ownerFallback: setting === "on", caseId: "synthetic-eval-caps" });
  const entries = states.flatMap((state, index) => {
    const number = index + 1;
    return [
      { id: `t${number}-user`, exchange_id: `x${number}`, role: "user", text: `Synthetic message ${number}.`, at: at(number), episode_id: state.current_episode.id },
      { id: `t${number}-assistant`, exchange_id: `x${number}`, role: "assistant", text: `Synthetic reply ${number}.`, at: at(number), episode_id: state.current_episode.id }
    ];
  });
  await runtime.store.commitTurn(runtime.caseId, { transcript_entries: entries, case_state: states.at(-1), state_diff: null });
  try {
    const result = await runtime.run(60);
    const record = await runtime.load();
    const episode = record.case_state.current_episode;
    out.turn_60 = { delivery_kind: result.deliveryKind, episode_source_item_ids: episode.source_item_ids.length, same_episode: episode.id === states[0].current_episode.id, case_items: record.case_state.items.length, transcript_entries: record.raw_transcript.length, error_code: null };
  } catch (error) {
    out.turn_60 = { delivery_kind: null, error_code: error.code ?? error.name ?? "ERROR", message: String(error.message).slice(0, 200) };
  }
  await t.dispose();
  let through83 = states.at(-1);
  for (let number = 60; number <= 83; number += 1) through83 = mergeSix(through83, number);
  out.item_cap = { items_through_83: through83.items.length };
  try { mergeSix(through83, 84); out.item_cap.turn_84 = { threw: false }; } catch (error) { out.item_cap.turn_84 = { threw: true, message: String(error.message).slice(0, 120) }; }
  return out;
}

// One whole pass (every arc and arm, the caps and the immediate-protection checks) under one setting, written to `outDir/<setting>/`.
export async function runPass({ setting, outDir, arcs = null, only = null, probes = true, log = () => {} }) {
  const corpus = await loadCorpus();
  const seeds = validateSeeds(await loadJson(SEEDS_URL), corpus);
  const dir = path.join(outDir, setting);
  await fs.mkdir(dir, { recursive: true });
  const summary = { setting, started_at: new Date().toISOString(), arms: [], caps: null };
  const jobs = corpus.arcs.filter((arc) => !arcs || arcs.includes(arc.id)).flatMap((arc) => arc.arms.filter((arm) => !only || only.includes(`${arc.id}/${arm.id}`)).map((arm) => ({ arc, arm })));
  for (const { arc, arm } of jobs) {
    const started = t0();
    const result = await runArm({ corpus, seeds, arcId: arc.id, armId: arm.id, setting, probes, packetDir: setting === "off" ? path.join(outDir, "decision-packets") : null });
    await fs.writeFile(path.join(dir, `${arc.id}-${arm.id}.json`), `${JSON.stringify(result, null, 1)}\n`);
    summary.arms.push({ arc: arc.id, arm: arm.id, turns: result.rows.length, planned_turns: result.planned_turns, stopped_at: result.stopped_at, seconds: Math.round((t0() - started) / 100) / 10 });
    log(`${setting} ${arc.id}/${arm.id}: ${result.rows.length}/${result.planned_turns} turns in ${Math.round((t0() - started) / 1000)} s${result.stopped_at ? `, stopped at ${result.stopped_at}` : ""}`);
  }
  if (!arcs && !only) {
    summary.caps = await runCaps({ setting });
    await fs.writeFile(path.join(dir, "caps.json"), `${JSON.stringify(summary.caps, null, 1)}\n`);
    log(`${setting} caps done`);
  }
  summary.finished_at = new Date().toISOString();
  await fs.writeFile(path.join(dir, "pass.json"), `${JSON.stringify(summary, null, 1)}\n`);
  return summary;
}
