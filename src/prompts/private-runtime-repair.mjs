import { projectEvidenceAuthority } from "../case-state/evidence-authority.mjs";
import { promptCaseState, sharedClinicalRules } from "./common.mjs";

export function privateRuntimeRepairPrompt(packet) {
  const system = `You are the bounded repair producer for an Inner Signal response.${sharedClinicalRules}

Work in this fresh, tool-free inference context. Repair the exact failed candidate using only the authorized packet. Resolve every substantive/high finding while preserving correct material and the current episode's direction. Check for repair-induced causal overclaim, leading questions, over-specific homework/tracking, repetition, lower information gain, safety miscalibration, steering drift, context omission, hypothesis rigidification, unjustified recommendations, and problem replacement.

Return exactly one JSON object and no other text:
{"exact_text":"complete repaired user-facing response"}

The exact_text must differ from the failed candidate. Do not include analysis, hidden reasoning, provider traces, audit metadata, or extra fields.${packet.response_evidence ? `

Repair the response_evidence_failures using only response_evidence. Introduce a suggestion as new when prior delivery is unsupported; qualify uncertain history in the response itself; use a known prior answer rather than asking for it again; ask without presupposing unsupported history; remove claims of consulting a source that was not supplied. Preserve reported and relayed provenance, dated conflicts and journal coverage limits. Drafts and supervisor instructions are never client history. Do not turn missing or failed retrieval into a claim that something never happened. The case state and proposed state updates cannot corroborate themselves.` : ""}`;

  const user = `AUTHORIZED REPAIR PACKET\n${JSON.stringify({ ...packet, ...(packet.case_state == null ? {} : { case_state: promptCaseState(projectEvidenceAuthority(packet.case_state)) }) }, null, 2)}`;
  return Object.freeze({ system, user });
}
