---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.MEET_GUARD
title: Hear the protective response without automatically obeying it
kind: decision-node
tier: 3
priority: 93
authority: author-framework
graph_tags:
  - protector
  - guard
  - avoidance
source_refs:
  - IC.START_WHATEVER
  - IC.GUARDS
  - IC.BOTTOM_UP_SEQUENCE
  - IC.ESCAPE_URGE
  - AMEND.CROSS.LITERATURE_TASK_PROGRESS
  - AMEND.CROSS.PROTECTIVE_ALARM_CALIBRATION
  - AMEND.IC.ADULT_PROTECTOR_VS_GUARD_20261022
regression_refs:
  - G001
  - G002
  - G012
  - G029
  - G030
  - G051
  - G052
  - G057
  - G059
  - G069
  - G113
  - G114
  - G115
  - G139
base_record_sha256: 6c861fc4400646c4cfcd5feccc8b6a7663f77d99541fe5d1a78fea2e699fecdd
base_graph_sha256: 449607c3bf07856fcdbc3775270a57d4736decc29b97503ffbd7b5c23ca6e144
projection_input_sha256: c131b552a4f38cdb1c84621461291bb8a5887ff9601f6df2e62be86f65c8ad85
---

# Hear the protective response without automatically obeying it

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "protective_response",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "urge_to_escape",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "dissociation",
        "op": "in",
        "value": [
          "mild",
          "high"
        ]
      }
    ]
  },
  "avoid": [
    "Do not classify the voice more confidently than the transcript supports or push past it.",
    "Do not equate listening to a protective alarm with obeying it, and do not use prediction-testing to push past a protector's no to deeper processing or altered-state work, or past hesitation about touch or sex."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE"
    ],
    "deferralUnless": [
      {
        "field": "guard_engagement",
        "op": "eq",
        "value": "willing_to_allow"
      }
    ],
    "forbiddenOverclaims": [
      "Do not definitively label a cynical voice as a guard.",
      "Do not claim that anxiety or another protective alarm proves the feared conclusion is true.",
      "Do not claim that testing a protective prediction authorizes overriding a protector's no to deeper or altered-state work, or hesitation about touch or sex."
    ],
    "requiredNuance": [
      "The contempt may be child, protector, adult evaluator, or blend.",
      "Protective intent and predictive accuracy are separate: an alarm can be understandable and still be mistaken, outdated, or overprotective.",
      "Consent, immediate safety and possible medical red flags outrank an experiment with the alarm; use a cheap reversible precaution first and interpret afterward.",
      "Ordinary wishes, habits and critical thoughts are not automatically a guard, a hidden trauma or a separate inner person; test function and context before assigning a role."
    ]
  },
  "recommendations": [
    "Treat cynicism, numbness, anger, scrolling, substances, planning, sleep, or dissociation as information about what the system expects.",
    "Ask what the part predicts will happen if it steps back; acknowledge before answering.",
    "A still-present protector may permit an agreed small step. Notice its current stance instead of requiring it to disappear, and recheck if permission is withdrawn. Presence alone does not prove continued blocking.",
    "For ordinary-life decisions, treat anxiety and other protective alarms as information about expected danger or overload rather than commands or truth detectors; hear what they are trying to protect, then compare the prediction with evidence, current capacity and later outcomes.",
    "Distinguish a learned defensive guard from the chosen Adult Protector role; a guard may carry a useful warning or an obsolete coping tactic, whereas the Adult Protector is the present adult's capacity to protect and respond."
  ],
  "successSignals": [
    "The protective response can be heard without running the session or being exiled."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.START_WHATEVER]]

[[current/sources/inner-child-guide/IC.GUARDS]]

[[current/sources/inner-child-guide/IC.BOTTOM_UP_SEQUENCE]]

[[current/sources/inner-child-guide/IC.ESCAPE_URGE]]

[[current/governance/amendments/AMEND.CROSS.LITERATURE_TASK_PROGRESS]]

[[current/governance/amendments/AMEND.CROSS.PROTECTIVE_ALARM_CALIBRATION]]

[[current/governance/amendments/AMEND.IC.ADULT_PROTECTOR_VS_GUARD_20261022]]
