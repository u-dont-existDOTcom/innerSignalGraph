---
authoring_contract: inner-signal-authoring-proposal-v1
entity_type: proposal
proposal_id: nonpunitive-review-20260926
status: reconciled
base_projection_input_sha256: 456d7539d0ac59e9a20a4c08179a8856ead6d3e863fb63b4915b9f98fd401e78
target_graph_ids:
  - inner-child-directed-graph
declared_regression_ids:
  - G001
  - G012
  - G039
  - G040
  - G041
owner_decision_required: true
contains_therapy_semantic_change: true
contains_documentation_overlay_change: false
---

# nonpunitive-review-20260926

## Intent

Compile owner decision OWNER.MAP.RESOLUTION.2026-08-29.D09 (review is critical; notice recognition, repair, missed and kept promises, and what should change next without turning review into a trial; no mandatory cadence) into the current map. The owner reaffirmed it on 2026-09-26 ("yes that is important"). After an attempt at improved care, protection, or guidance, the therapist helps the person review what felt right and what could be better next time, without harsh judgment, grading, or a verdict about worth; when an effort does not go as hoped, the person names what happened, repairs what can be repaired, and makes the next promise more credible.

The two user-facing lines and the backend constraints are the owner-revised exact wording from the 2026-08-29 D09 review (closed PR #14). They are appended to the current records of IC.ADULT_APPRENTICE and IC.CREDIBILITY_REPAIR, which PR #80 changed after that review; no existing entry is removed or reordered. IC.PROTECTOR_ACTION, the third owner-approved anchor of OVERLAY.IC.NONPUNITIVE_REVIEW, reuses the same approved review line and avoid constraint verbatim so review also reaches ordinary self-care attempts made without a helper.

## Non-goals

Do not change activation, tiers, priorities, default questions, defer/block effects, topology, case variables, or routing. Do not add a fixed morning/evening or other review cadence, mandatory tracking, or a scoring/grading scheme. Do not add the owner-rejected IC.CREDIBILITY_REPAIR success-signal wording from the 2026-08-29 draft. Do not change canonical guide prose, D10, other overlays, installation, or stable.

## Worst plausible failure

Review could become compulsory self-surveillance or an internal trial; it could minimize a serious lapse; it could demand commitments beyond present capacity; it could turn a lapse or repeated pattern into a verdict on intrinsic worth; or review prompts could crowd out the one-main-next-move rule by adding a second exercise to every self-care turn.

## Acceptance distinctions

G039 selects IC.ADULT_APPRENTICE and IC.PROTECTOR_ACTION with witness capacity present and carries the accountability-versus-punishment nuance. G040 keeps credibility repair primary with the adverse track-record distinctions intact and adds the missed-commitment nuance. G041 shows ordinary protector action without a helper or credibility conflict still carries the non-punitive review line while apprenticeship and credibility repair stay unselected. All canonical graph cases, including G001 and G012, must stay green and unchanged.
