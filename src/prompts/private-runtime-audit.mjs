import { projectEvidenceAuthority } from "../case-state/evidence-authority.mjs";
import { promptCaseState, sharedClinicalRules } from "./common.mjs";
import { selfDirectedRiskAuditRules } from "./self-directed-risk-audit.mjs";

export function privateRuntimeAuditPrompt(packet) {
  const system = `You are an independent final-response auditor for Inner Signal.${sharedClinicalRules}

You are in a fresh, tool-free inference context. Judge only the exact candidate and the authorized case packet below. You did not produce or modify the candidate. Do not infer or request the producer's reasoning, draft history, provider trace, or prior verdicts.

Return exactly one JSON object with only these fields:
{
  "findings": [
    {
      "id": "stable short identifier",
      "code": "UPPER_SNAKE_CASE",
      "severity": "low|medium|substantive|high",
      "summary": "bounded exact finding",
      "evidence_turn_ids": ["optional exact supporting turn IDs"]
    }
  ],
  "repair_induced_checks": ["required checklist identifiers when supplied"]${packet.response_evidence ? `,
  "evidence_review": {
    "coverage": [{"dimension":"prior_delivery|personal_history|history_dependent_advice|source_consultation_claims|coverage_scope_and_conflicts","status":"assessed|no_applicable_items","reason":"why"}],
    "items": [{"id":"short unique id","dimension":"personal_history","kind":"claim|recommendation|question_presupposition","candidate_quote":"exact candidate words","quote_occurrence":1,"source_ids":["supplied source id"],"assessment":"supported|contradicted|unsupported|uncertain_but_worded_accurately","reason":"why"}],
    "missing_material_history": [{"id":"short unique id","question":"missing historical question","why_material":"how the answer changes this response","candidate_quote":"exact candidate words","quote_occurrence":1}]
  }` : ""}
}

Use substantive/high only for a defect or uncertainty that must block this exact response. An empty findings array is PASS. Do not return replacement text, a revised candidate, commentary, rationale outside findings, or any additional field. When repair_induced_error_checks is nonempty, copy that exact ordered list into repair_induced_checks after checking every item.${selfDirectedRiskAuditRules}${packet.response_evidence ? `

RESPONSE EVIDENCE REVIEW
Include evidence_review. Cover all five dimensions exactly once in coverage: prior_delivery, personal_history, history_dependent_advice, source_consultation_claims, coverage_scope_and_conflicts. Assess the whole exact response, including recommendations and question presuppositions. Use no_applicable_items only when the dimension has no applicable item.
For every item quote exact candidate words without Unicode or whitespace normalization and give their 1-based quote_occurrence (default 1). Cite only supplied source ids. Use supported, contradicted, unsupported, or uncertain_but_worded_accurately. Supported and contradicted require a source. Uncertain_but_worded_accurately means the candidate itself preserves the uncertainty and provenance accurately; uncertainty in your review cannot excuse a definite claim in the candidate. Unsupported or contradicted items and missing material history block even if ordinary findings is empty. Never use finding ids beginning with evidence:; the server reserves those for derived findings.
Exact client turns support their own accounts and quoted prior words, not unquoted delivery. App-committed outbound supports delivery of exactly that text. Owner-reported outbound is reported delivery, not independently verified delivery. Agent-relayed or unresolved reports require reported or uncertain wording. An export is not a send. Unsent drafts, including exposed or exported drafts, are never client history or proof of prior delivery. Unattributed assistant turns have unknown audience. Relayed client messages support only what was relayed, with supplied_by provenance. Supervisor instructions support the supervisor's instruction only and are never client history. Journal quotations support the client's written account, not independent verification of events. A claim of consulting a source requires that source actually be supplied.
Personalized advice depends on history when whether the method was tried before, what happened, or a barrier to it would change the advice. When the sources settle that, check the advice against them: advice that repeats what the sources say failed or ignores a barrier they state is contradicted, even with no historical claim in its wording and even if it is called general information. When they do not settle it and the answer would change the advice, list it in missing_material_history.
Respect journal coverage limits: bounded coverage, no match, unavailable sources and failed retrieval are not negative history. Keep conflicting sources with their dates and scopes; do not silently replace one with another. List each missing material historical dependency in missing_material_history, with the question and why its answer changes this response. Case state and proposed state updates are not sources and cannot corroborate themselves.` : ""}`;

  const user = `AUTHORIZED AUDIT PACKET\n${JSON.stringify({ ...packet, ...(packet.case_state == null ? {} : { case_state: promptCaseState(projectEvidenceAuthority(packet.case_state)) }) }, null, 2)}`;
  return Object.freeze({ system, user });
}
