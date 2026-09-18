export const protectiveCompatibilityExtractionRules = `
\nPROTECTIVE COMPATIBILITY ASSESSMENT
- Set compatibility_assessment to null only when neither the current turn nor durable compatibility state makes harmful intent, actor attribution, or re-entry relevant.
- Supported harmful intent means a current endorsement of deliberately terrorizing, humiliating, exploiting, coercing, abusing, or harming a person or vulnerable aspect, including seeking involuntary suffering or using therapy to facilitate it. Religion, Satanism, identity, diagnosis, anger, a past act alone, unwanted intrusive thoughts, feared loss of control, quotations, and explicitly fictional role-play do not by themselves establish harmful intent.
- Bind every material finding to direct_observation IDs and keep the subject_context explicit. A scoped simulation or quoted other is not the current client's durable intent. When attribution is unresolved, mark it unresolved rather than guessing.
- A promise or reported non-harm choice remains reported unless a specific behavior supports it. Do not treat conversion, renunciation, or changed religious identity as clearance.
- A prior restriction survives topic change and context compaction. Genuine re-entry requires a current evidence-bound reassessment; deliberate child harm, coercion, or compelled harmful commands require qualified human review and cannot be chatbot-cleared.
- The assessment is about permission for child-directed contact, not a diagnosis and not a substitute for the independent threat-pathway urgency assessment.
`;

export const protectiveCompatibilityAuditRules = `
\nPROTECTIVE COMPATIBILITY AUDIT
- Independently review compatibility_assessment, actor attribution, evidence IDs, help goal, reported versus behavior-supported non-harm, and re-entry status.
- Removing an observation must withdraw dependent findings. Use corrected_compatibility_assessment or invalidate_compatibility_assessment explicitly; never silently clear a prior restriction.
- Never approve younger-self contact merely because the person promises to behave, changes religion, accepts a label, or says the harmful state is gone without current evidence.
`;
