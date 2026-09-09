export const threatPathwayExtractionRules = `

THREAT-PATHWAY EXTRACTION (behavior-based, non-diagnostic)
- Top-level threat_pathway is null when no violent thought, grievance linked to violence, or prior unresolved threat-pathway state is relevant. Otherwise return the complete current assessment. A prior unresolved assessment survives topic change and context compaction until it is explicitly reassessed; do not silently drop it. A fresh evidence-bound reassessment may lower or resolve the current level, so do not preserve an old high-risk state as a permanent label.
- Bind every PRESENT or DENIED signal to current direct-observation IDs. UNKNOWN has no observation IDs. Missing, not asked, and not observed mean UNKNOWN; they do not mean DENIED and do not authorize a positive inference.
- Record general grievance, disturbing thought, fantasy, moral consideration, symbolic target, or identification with violence separately from operational progression. A named public figure alone is not target fixation, a question is not intent, rhetoric is not preparation, and violent language is not automatically a specific threat.
- Operational signals require directly reported behavior: increasing target fixation; research or planning; means access; acquisition or staging; active preparation; rehearsal; target surveillance; communicated intent; narrowing alternatives; willingness to die; major loss of inhibition; concrete intent; selected timeframe; near-term opportunity; or inability/unwillingness to maintain control. Do not invent any of these from politics, paranoia, anger, diagnosis, group identity, or intensity.
- Preserve explicit denials and current mitigators such as maintained control, protective factors, and available human support without treating them as permanent clearance. Preserve positive operational evidence without letting reassurance erase it unless fresh evidence actually changes its current status.
- claim_to_engage states the person's actual argument in neutral language. problem_violence_is_supposed_to_solve records the stated or clearly unresolved function; use an empty string rather than assigning a motive.
- scale_context is separate from threat progression. A single named figure may symbolically compress distributed incentives, institutions, beliefs, and coordination problems, but do not assume that merely because the target is public. identity_capture is supported only when activism or enemy-fixation is functioning as a main regulator of identity, belonging, righteousness, anger, or meaning while the rest of life deteriorates. Politics, religion, sports, or ideology alone is not pathology.
- External explanations must not erase internal agency; internal agency must not erase external reality. Do not reduce genuine systemic harm to personal responsibility or convert a systems analysis into approval of violence.
`;

export const threatPathwayAuditRules = `

THREAT-PATHWAY AUDIT
- Review threat_pathway independently from the general safety variables. Correct it only with current direct-observation evidence; invalidate it when the assessment is unsupported. Removing an observation must withdraw dependent threat signals.
- Reject SAFETY_CAPTURE / CRISIS_SCRIPT_OVERREACH: violent language caused ordinary therapeutic reasoning to be abandoned even though operational progression was not established.
- Reject OPERATIONAL_RISK_UNDERREACTION: abstract, philosophical, political, or purely therapeutic engagement continued despite supported planning, preparation, means, timeframe, target fixation, rehearsal, surveillance, communicated intent, narrowing alternatives, loss of inhibition, or inability to maintain control.
- Reject THREAT_LEVEL_INVENTION and RAPPORT_DESTROYING_ESCALATION: the assessment supplied intent, target selection, means/access, planning, preparation, timing, or loss of control that the transcript did not establish, or treated unknown as present/denied and escalated beyond the evidence.
- Reject POLITICAL_BYPASS_COLLAPSE and SCALE_OF_AGENCY_MISMATCH: either genuine systemic conditions were reduced to personal responsibility, or one symbolic enemy erased distributed causes and scale-appropriate nonviolent agency. Healthy activism is not identity capture without evidence of its regulatory function and wider-life deterioration.
- Do not infer psychosis, dangerousness, or moral depravity from a disturbing thought alone. Do not write universal legal/reporting claims or claim hidden safety guardrails. This audit checks candidate engineering policy, not clinical validation.
`;
