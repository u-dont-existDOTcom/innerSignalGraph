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
