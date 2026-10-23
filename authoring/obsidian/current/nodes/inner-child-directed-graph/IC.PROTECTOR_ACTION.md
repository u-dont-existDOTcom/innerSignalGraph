---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.PROTECTOR_ACTION
title: Make the Protector visible in ordinary life
kind: decision-node
tier: 4
priority: 90
authority: author-framework
graph_tags:
  - protector
  - ordinary-life
  - credibility
source_refs:
  - IC.PROTECTOR_VISIBLE
  - IC.ADULT_APPRENTICE
  - AMEND.CROSS.LITERATURE_ACTION_REVIEW
  - AMEND.IC.WISDOM_CORE
  - AMEND.IC.NONPUNITIVE_REVIEW
  - AMEND.CROSS.PAIN_CRISIS_TREATMENT_VS_KNOWN_HARM
  - AMEND.IC.ADULT_PROTECTOR_VS_GUARD_20261022
regression_refs:
  - G003
  - G008
  - G011
  - G029
  - G030
  - G036
  - G050
  - G051
  - G057
  - G113
  - G114
  - G115
base_record_sha256: f3e3ce94e50aae9e0083e7b5129022921d5dd5938fb9c6d4196018e6b7918a7e
base_graph_sha256: 449607c3bf07856fcdbc3775270a57d4736decc29b97503ffbd7b5c23ca6e144
projection_input_sha256: c131b552a4f38cdb1c84621461291bb8a5887ff9601f6df2e62be86f65c8ad85
---

# Make the Protector visible in ordinary life

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
        "field": "inner_adult_access",
        "op": "in",
        "value": [
          "low",
          "partial"
        ]
      },
      {
        "field": "protective_response",
        "op": "eq",
        "value": "present"
      }
    ]
  },
  "avoid": [
    "Do not recommend a coping strategy known to worsen the person's condition merely because it briefly relieves distress.",
    "Do not choose an action so large that failure becomes new evidence of unreliability.",
    "Do not make review punitive, compulsive, or mandatory. Voluntary tracking or simple measurement is allowed when it genuinely supports learning rather than becoming self-surveillance."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": [
      "The Adult Protector is a chosen adult function, not a synonym for learned protective guards or the inherited critic; a warm limit may include both comfort and a firm no."
    ]
  },
  "recommendations": [
    "Choose one bounded action: a meal, sleep, a boundary, a phone put down, a task handled, an unsafe exchange ended, or help requested.",
    "Report the action without requiring the younger state to trust it yet.",
    "Where communication itself is the action, a private draft and caring editor may help preserve truth and the boundary; return to inward care afterward when useful. Do not postpone a necessary protective action to complete an exercise.",
    "After attempting improved care, protection, or guidance for the inner child, notice without harsh judgment what felt right and what you could do better next time."
  ],
  "successSignals": [
    "One small promise is kept.",
    "The action or its review provides truthful information about what supports protection and follow-through, including when a reasonable plan needs changing."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.PROTECTOR_VISIBLE]]

[[current/sources/inner-child-guide/IC.ADULT_APPRENTICE]]

[[current/governance/amendments/AMEND.CROSS.LITERATURE_ACTION_REVIEW]]

[[current/governance/amendments/AMEND.IC.WISDOM_CORE]]

[[current/governance/amendments/AMEND.IC.NONPUNITIVE_REVIEW]]

[[current/governance/amendments/AMEND.CROSS.PAIN_CRISIS_TREATMENT_VS_KNOWN_HARM]]

[[current/governance/amendments/AMEND.IC.ADULT_PROTECTOR_VS_GUARD_20261022]]
