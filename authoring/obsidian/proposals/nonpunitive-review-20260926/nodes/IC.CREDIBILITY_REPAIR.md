---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: nonpunitive-review-20260926
operation: replace
graph_id: inner-child-directed-graph
node_id: IC.CREDIBILITY_REPAIR
title: Repair credibility through non-defensive follow-through
kind: decision-node
tier: 3
priority: 96
authority: author-framework
graph_tags:
  - credibility
  - protector
  - repair
source_refs:
  - IC.PROTECTOR_VISIBLE
  - IC.VOW
  - IC.BOTTOM_UP_SEQUENCE
  - IC.BORROW_LOVE
  - IC.BORROW_ONE_FUNCTION
  - AMEND.IC.NONPUNITIVE_REVIEW
base_record_sha256: c6faeb0333f1ce459c8bf7656db91a49a85626b9f6734002c18f575b8380eabe
base_graph_sha256: 55369c75e95b5cc9fc32c807f7b47bef411acf3aedcbe895076fbb796d04a0c4
base_projection_input_sha256: 456d7539d0ac59e9a20a4c08179a8856ead6d3e863fb63b4915b9f98fd401e78
---

# Repair credibility through non-defensive follow-through

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "credibility_conflict",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "self_directed_love",
        "op": "eq",
        "value": "unsafe"
      }
    ]
  },
  "avoid": [
    "Do not substitute a grand vow for evidence or retaliate when the younger state is unimpressed.",
    "Do not call a temporary ceasefire or simple non-retaliation completed nurture, and do not demand trust as payment for it.",
    "Do not turn a lapse or repeated pattern into a verdict about intrinsic worth. Review may still conclude that a particular commitment currently exceeds capacity or requires stronger limits, support, or a different plan."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not say the child is rejecting love when it may be rejecting an unsafe or unproven source.",
      "Do not describe the problem as simply lacking a track record when the user has already supplied adverse evidence about how things went."
    ],
    "requiredNuance": [
      "Action is essential but not the sole repair; accurate responsibility and non-defensive listening also matter.",
      "Relaxation may reduce nervous-system charge, but it does not by itself repair a credibility conflict or change a contradictory track record.",
      "The sarcastic question can be both contempt and a legitimate literal request for evidence; answer it concretely rather than arguing with it.",
      "A pre-existing adverse track record is different from having no track record yet.",
      "Non-cruelty and non-retaliation are necessary evidence of safety but are not substitutes for positive warmth, protection, competent care, or repair.",
      "Trust can update from both relational evidence and ordinary-life protection; love or goodwill need not wait for trust to become favorable.",
      "A missed commitment matters, but it is not the whole credibility picture. Consider what was actually agreed, present capacity and circumstances, acknowledgement and repair, and kept commitments—without using positive evidence to cancel or minimize a serious lapse."
    ]
  },
  "recommendations": [
    "Hear the angry side's exact accusation before trying to resolve the conflict: what does it believe the younger version should have done, at what age, and with what available capacity?",
    "Treat skeptical or contemptuous questions as data and, when appropriate, literal requests for evidence.",
    "Distinguish no track record from an adverse track record. If the younger state is already pointing to how adult life turned out, credibility repair means building counterevidence against an existing negative assessment rather than acting as though evidence starts at zero.",
    "Make one ordinary protective act visible and do not demand gratitude, trust, or emotional change.",
    "Repair after internal attacks; make one protective act visible, demand no immediate trust, and keep showing up consistently.",
    "If positive nurture is the missing function, borrow or build that function rather than asking the younger state to open merely because hostility stopped.",
    "Pair accurate responsibility and non-defensive listening with one positive trustworthy action; keep the complaint and the response separate enough to learn from both.",
    "When an effort at improvement doesn’t go as hoped, name what happened, repair what can be repaired, and make the next promise more credible."
  ],
  "successSignals": [
    "Promises and actions begin to align; an adverse track record starts accumulating credible counterevidence without demanding immediate trust."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Owner decision D09 applied to credibility repair: when an effort does not go as hoped, name it, repair what can be repaired, and make the next promise more credible, without converting a lapse into a verdict about worth. The owner-revised exact wording is appended; the owner-rejected success-signal addition from the 2026-08-29 draft is deliberately absent.

## Regression intent

G040 keeps credibility repair primary and asserts the missed-commitment nuance. Canonical G001/G012 must remain green.
