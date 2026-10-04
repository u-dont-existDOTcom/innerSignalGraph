---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.CONTINUITY_TITRATION
title: Preserve the inner relationship while reducing depth
kind: decision-node
tier: 4
priority: 99
authority: owner-approved-extension
graph_tags:
  - inner-signal-continuity
  - titration
  - reparenting
  - reactivation
source_refs:
  - AMEND.IC.CONTINUITY_TITRATION
  - IC.BEFORE_DEEP
  - IC.THREE_FUNCTIONS
  - IC.SESSION_CLOSURE
regression_refs:
  - G014
  - G025
  - G031
  - G032
  - G035
  - G063
base_record_sha256: 39d2155c134f7508a67ad2838d2f57766bb85744b6296bd20a7d9b4c63141d97
base_graph_sha256: e9856521bef7b4cdc99119361292128385607971644ed075fd48d520522cfc3d
projection_input_sha256: 04d7283ac4e6fe1785a7c608486553be179beb204d2ff4ff66b8917c40f8b8af
---

# Preserve the inner relationship while reducing depth

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "deep_work_readiness",
        "op": "eq",
        "value": "no"
      },
      {
        "field": "inward_attention_effect",
        "op": "eq",
        "value": "worsens"
      },
      {
        "field": "ability_to_stop",
        "op": "eq",
        "value": "no"
      },
      {
        "field": "ability_to_return",
        "op": "eq",
        "value": "no"
      },
      {
        "field": "orientation",
        "op": "eq",
        "value": "disoriented"
      },
      {
        "field": "practice_challenge",
        "op": "eq",
        "value": "overwhelming"
      }
    ]
  },
  "avoid": [
    "Do not convert a temporary safety or pacing decision into a permanent conclusion that inner-child work is contraindicated.",
    "Do not force child-facing imagery, dialogue, or symbolism during acute danger, disorientation, inability to stop, or after the person declines it."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE"
    ],
    "forbiddenOverclaims": [
      "Do not claim that needing less depth means the person has failed reparenting or that InnerSignal should be permanently abandoned."
    ],
    "requiredNuance": [
      "Inner-child reparenting is a continuing relationship whose depth and representation can change. The user may always decline inner-child framing.",
      "A pause is scope-limited and revisitable; reactivation conditions must be observable enough to use rather than a vague instruction to return when fully healed."
    ]
  },
  "recommendations": [
    "Reduce depth before abandoning the relationship: step from immersive dialogue toward present-focused Nurturer/Protector/Guide contact, witnessing, borrowed care, indirect or symbolic contact, or an ordinary adult action on the younger self's behalf.",
    "When practical safety, human support, or an external task temporarily becomes primary, connect it back to the adult function it genuinely serves instead of treating outward action as the end of InnerSignal.",
    "Use a full pause only when the person declines the modality or even minimal inner contact is currently worsening safety, orientation, stopping/return capacity, or ordinary functioning.",
    "Whenever a full pause is needed, name a concrete reactivation condition and return first at the gentlest workable level rather than jumping back to the prior depth."
  ],
  "successSignals": [
    "The person retains a believable relationship of care, protection, or guidance with the younger self at a depth they can currently hold, or has a clear condition for re-entering it after a necessary pause.",
    "Reduced depth improves choice and functioning without redefining avoidance of all difficult material as safety."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.CONTINUITY_TITRATION]]

[[current/sources/inner-child-guide/IC.BEFORE_DEEP]]

[[current/sources/inner-child-guide/IC.THREE_FUNCTIONS]]

[[current/sources/inner-child-guide/IC.SESSION_CLOSURE]]
