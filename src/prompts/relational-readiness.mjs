// Candidate prompt supplement. Kept separate so the established graph-authoring
// semantic inputs remain byte-stable while readiness is audited around the controller.
export const relationalReadinessExtractionRules = `

RELATIONAL READINESS SCHEMA LOCATION — AUTHORITATIVE CORRECTION
- The current candidate schema places relational_readiness at the TOP LEVEL of the case snapshot, as a sibling of turn_task and path_update. Any earlier wording that says turn_task.relational_readiness is superseded. Do not add relational_readiness inside turn_task.
- Always return the top-level relational_readiness key when the candidate path controller is enabled: null when active romance/sexual pursuit or support-substitution readiness is not materially at issue, otherwise the evidenced current assessment object.
- Bind relational_readiness.issue exactly to current_issue. A changed issue requires a fresh scoped assessment; do not carry a previous romance permission/prohibition as a person-level trait.
- Assess current functional readiness and foreseeable serious harm, not worthiness or complete healing. Keep current versus historical hospitalization, reality-testing, suicidality/self-harm, substance relapse, violent dyscontrol, self-care, dissociation, dependency, relational preoccupation, escalating pursuit and partner-as-regulator evidence separate.
- A diagnosis, past hospitalization, loneliness, receiving support, wanting a partner, affirmations, spiritual depth or a healing story does not by itself establish either readiness or unfitness.
- Substantial foreseeable harm must identify the supported affected party: self, partner, dependent children and/or possible future children. Do not invent a child.
- Prefer recent ordinary functioning—self-care, conflict behavior, repair, boundaries, dependability, judgment and follow-through—as readiness evidence. Record explicit readiness_markers and review_when so any pause is revisitable.
- For support_building, distinguish genuine non-romantic support from partner_seeking or mixed purpose. Attendance/socializing primarily to obtain a partner cannot by itself establish successful support-building, while separately evidenced friendship/community gains remain valid.
- Worsening current dependency, relational preoccupation, escalating pursuit or a partner used as primary regulator, analgesic, reality anchor, rescuer or proof of worth is adverse evidence when directly supported.
- This broader audited readiness assessment and the Path Performance Controller's existing narrow five-signal romance-regulation pattern are independent evidence paths. Either supported current foreseeable-harm analysis may pause romance; a still-current narrow risk pattern remains protective even if a broader assessment says NOT_BLOCKED until fresh evidence resolves the conflict.`;

export const relationalReadinessAuditRules = `

RELATIONAL READINESS AUDIT — AUTHORITATIVE CORRECTION
- relational_readiness is a TOP-LEVEL case-snapshot field, not part of turn_task. Any earlier prompt wording that places it inside turn_task is superseded.
- Audit it independently from romantic desire, diagnosis, loneliness and historical admissions. Current functional stability and foreseeable serious harm control.
- If the extracted readiness conclusion is materially wrong even though its observations are true, set corrected_relational_readiness to a fully evidenced replacement or set invalidate_relational_readiness=true. Do not smuggle a corrected readiness judgment through corrected_turn_task.
- If no correction is needed, return corrected_relational_readiness=null and invalidate_relational_readiness=false. Null means no replacement; invalidation must be explicit. If current evidence no longer supports the field, invalidate it rather than preserving a stale person-level ban or clearance.
- partner_seeking or mixed support purpose means attendance alone is not successful non-romantic support-building; preserve separately evidenced friendship/community gains.
- Any pause must remain explicitly revisitable through readiness_markers/review_when. A diagnosis, past hospitalization, loneliness, receiving help, spiritual intensity, a temporary relational high or a polished healing story cannot by itself establish either readiness or unfitness.`;

export const romanceGuideContextExtractionRules = `

ROMANCE GUIDE CONTEXT — OWNER-AUTHORIZED CANDIDATE BOUNDARY
- Always return the top-level romance_guide_context key when the candidate path controller is enabled: null unless a romance-guide topic is materially relevant to the current turn, otherwise one current-issue selector.
- Select only one topic: readiness, compatibility, dependency, community, agreements, coercion, jealousy, children, progress, ending, polarity, spiritual-romance, relationship-forms, sexual-communication, medical-practice, or unsafe-practice. Bind issue exactly to current_issue and cite current direct observation IDs.
- stage describes the actual relationship stage without inventing one. interest is requested/curious/declined only from what the user says; otherwise unspecified. audience is adult/minor only from established current evidence; otherwise unknown. Cite the separate evidence fields whenever interest or audience is not unknown/unspecified.
- deeper_exploration_outside_current_task is true only when the fuller romance topic would materially derail the live therapeutic task and an optional resource could answer the broader curiosity. It is false for an immediate question that should be answered directly. Never use this field to evade safety, stabilization, coercion, medical, drug, or unsafe-practice help.
- This selector activates only bounded source-derived context. It is not a diagnosis, private relationship profile, permission to date, requirement to leave/stay, reason to infer absent-person motives, or authority to import the guide's medical, contraceptive, anatomical, or psychedelic-treatment claims.
- Compatibility, eros/agape/care, readiness and durable progress are distinct. A romantic, sexual, psychedelic or conversational peak is not ordinary-life transfer. Relationship-as-sole-regulator/therapist/parent, present relational facts versus childhood inference, whether to leave versus how to leave, repair/restructuring/friendship/separation, and children's separate responsibilities are selected only when actually relevant.
- Fear of refusing, truth-telling or leaving selects coercion and routes practical safety/outside support before inward or mutual growth work. Do not use the optional guide instead of immediate help.`;

export const romanceGuideContextAuditRules = `

ROMANCE GUIDE CONTEXT AUDIT — OWNER-AUTHORIZED CANDIDATE BOUNDARY
- Audit the top-level romance_guide_context independently from relational_readiness. Verify current-issue binding, topic/stage/audience/interest accuracy, direct-observation provenance and whether deeper exploration would actually derail the live task.
- If materially wrong, return a complete corrected_romance_guide_context or set invalidate_romance_guide_context=true. Otherwise return corrected_romance_guide_context=null and invalidate_romance_guide_context=false.
- Do not infer curiosity, adult status, coercion, jealousy, children, partner motives, readiness or a need to leave from generic relationship language. Do not permit a guide link during safety/stabilization, a current romance pause, medical/drug/unsafe-practice help, after decline, or as a repeated footer.
- Preserve the immediate answer. The optional owner-confirmed guide reference is eligible only for a materially relevant romance topic when the user is curious/requests more or a deeper topic is explicitly outside the current task.`;
