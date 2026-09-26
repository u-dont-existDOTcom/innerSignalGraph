---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
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
regression_refs:
  - G001
  - G012
base_record_sha256: d4df4b74f39f7cc1abfbef90666db0614c24aee056c0ee5433fcb0fe79db089f
base_graph_sha256: 779b3f5d7b6098cdfa10243aa5d32caac60d988fa8394a0e35917a1ee289c369
projection_input_sha256: f92fac6d9a09658ed5bdf982583a7f102b5005e9145db5db141020e10a873b87
---

# Repair credibility through non-defensive follow-through

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

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

## Source navigation

[[current/sources/inner-child-guide/IC.PROTECTOR_VISIBLE]]

[[current/sources/inner-child-guide/IC.VOW]]

[[current/sources/inner-child-guide/IC.BOTTOM_UP_SEQUENCE]]

[[current/sources/inner-child-guide/IC.BORROW_LOVE]]

[[current/sources/inner-child-guide/IC.BORROW_ONE_FUNCTION]]

[[current/governance/amendments/AMEND.IC.NONPUNITIVE_REVIEW]]
