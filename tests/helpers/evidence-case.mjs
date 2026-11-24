import { createEmptyCaseState } from "../../src/case-state/longitudinal-state.mjs";
import { sha256Text } from "../../src/supervisor/response-evidence-contract.mjs";

// An invented case with one of each thing a response-evidence snapshot can be made from: a conversation (what the person said, a reply the app
// sent, one the owner reports, one nothing vouches for, and a message not answered yet) and what is written in a case besides it (unsent drafts
// and their versions, exports, reports of every kind with their references, a withdrawn one, a supervisor's inputs). Only what is written
// besides it holds the words of WRITTEN_WORDS, as any of it may hold a journal's.
export const WRITTEN_WORDS = Object.freeze(["silver lantern", "silver-lantern"]);
export const EVIDENCE_NOW = "2026-11-23T12:00:00.000Z";
const CASE = "synthetic-evidence";
const at = (minute) => `2026-11-23T10:${String(minute).padStart(2, "0")}:00.000Z`;

const REPORT = { owner: { origin: "owner_action", actor_resolution: "owner_verified" }, agent: { origin: "agent_relayed", actor_resolution: "unresolved" } };
const provenance = (by, reference = null, quote = null) => ({ ...REPORT[by], source_ref: reference, quote });

export function evidenceCase() {
  const turn = (id, role, text, exchange, minute) => ({ id, role, text, at: at(minute), exchange_id: exchange, episode_id: null });
  const record = {
    case_id: CASE, case_state: createEmptyCaseState({ caseId: CASE }), transcript_amendments: [], source_artifacts: [], journal_corpora: [],
    raw_transcript: [
      turn("turn:first", "user", "I can't ask for help.", "exchange:first", 1), turn("turn:sent", "assistant", "What makes asking hard?", "exchange:first", 2),
      turn("turn:second", "user", "It always did.", "exchange:second", 3), turn("turn:reported", "assistant", "Since when?", "exchange:second", 4),
      turn("turn:third", "user", "Since school.", "exchange:third", 5), turn("turn:loose", "assistant", "And before that?", "exchange:third", 6)
    ],
    runtime_turns: [{ id: "runtime:one", user_turn_id: "inbound", inbound: { exact_text: "Current words.", received_at: at(30) } }],
    candidate_responses: [], communication_events: [], supervisor_artifacts: []
  };
  record.case_state.items = [{ source: { turn_id: "turn:first" } }];
  const candidate = (id, extra = {}) => {
    const version = record.candidate_responses.length + 1;
    record.candidate_responses.push({ id, version, root_candidate_id: id, parent_candidate_id: null, producer_context_id: `context:${id}`, status: "superseded", exact_text: `The draft ${id}: a silver lantern.`, created_at: at(6 + version), metadata: {}, audit_history: [], ...extra });
  };
  candidate("sent", { status: "sent", exact_text: "What makes asking hard?", metadata: { sent_with_audit_id: "audit:sent", sent_turn_id: "turn:sent", sent_in_reply_to_turn_id: "turn:first" } });
  candidate("stopped");
  candidate("repaired", { root_candidate_id: "stopped", parent_candidate_id: "stopped" });
  for (const id of ["exported", "owner-reported", "agent-reported", "ambiguous", "withdrawn"]) candidate(id);
  candidate("marked-sent", { status: "sent", metadata: { sent_status_only: true } });
  candidate("reviewed");
  candidate("reviewed-again", { root_candidate_id: "reviewed", parent_candidate_id: "reviewed" });
  const subject = (id) => {
    const { version, exact_text } = record.candidate_responses.find((entry) => entry.id === id);
    return { kind: "candidate", candidate_id: id, candidate_version: version, text_sha256: sha256Text(exact_text) };
  };
  const reference = (id) => ({ candidate_id: id, candidate_version: subject(id).candidate_version });
  const event = (id, kind, audience, about, by) => record.communication_events.push({ schema_version: 1, id, kind, recorded_at: at(20 + record.communication_events.length), audience, subject: about,
    ...(kind === "reported_sent" ? { sent_at: null, sent_at_status: "unavailable" } : {}), provenance: by });
  event("event:exported", "exported", "client", subject("exported"), provenance("owner", "silver-lantern-export"));
  event("event:companion", "exported", "supervisor", { kind: "companion", companion_of: reference("exported"), artifact_sha256: sha256Text("companion") }, provenance("agent", "silver-lantern-companion"));
  event("event:owner", "reported_sent", "client", subject("owner-reported"), provenance("owner", "silver-lantern-owner"));
  event("event:agent", "reported_sent", "client", subject("agent-reported"), provenance("agent", "silver-lantern-agent"));
  event("event:ambiguous", "reported_sent", "client", { kind: "unresolved", reason: "ambiguous", candidate_refs: [reference("ambiguous")] }, provenance("agent", "silver-lantern-ambiguous", "The one with the silver lantern."));
  event("event:pair", "reported_sent", "client", { kind: "transcript_turn", assistant_turn_id: "turn:reported", in_reply_to_turn_id: "turn:second", text_sha256: sha256Text("Since when?") }, provenance("owner", "silver-lantern-pair"));
  event("event:withdrawn", "reported_sent", "client", subject("withdrawn"), provenance("agent", "silver-lantern-withdrawn"));
  record.communication_events.push({ schema_version: 1, id: "event:retraction", kind: "retraction", recorded_at: at(29), retracts_event_id: "event:withdrawn", reason: "It wasn't sent.", provenance: provenance("owner") });
  for (const [id, input_type] of [["input:message", "client_message"], ["input:revision", "supervisor_revision"]]) {
    record.supervisor_artifacts.push({ schema_version: 1, id, kind: "input", input_type, text: `The ${input_type}: a silver lantern.`, recorded_at: at(15), supplied_by: { channel: "owner_ui", actor_resolution: "owner_verified" } });
  }
  return record;
}

/** The input that freezes the unanswered message's evidence in that case. */
export const evidenceInput = (extra = {}) => ({ snapshotId: "snapshot:one", owner: { kind: "runtime_turn", runtime_turn_id: "runtime:one" },
  inbound: { turn_id: "inbound", exact_text_sha256: sha256Text("Current words."), audience: "client", source_kind: "exact_client_turn" }, ...extra });

/** What an earlier build froze in a case, or this one before the case had read its journal: the builder goes by the stored snapshots alone. */
export const asIfNoJournalWasRead = (record) => ({ ...record, response_evidence_snapshots: [] });
