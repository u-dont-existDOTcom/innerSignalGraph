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
base_record_sha256: 4456956b9eff10aa79ea6ed98f739e47dd3da48a9960d193ce3f9770c0e5119b
base_graph_sha256: 9330ed7fd7270f9419b45347fa95652332eeb8d4d59a473fc9d623a66e45cc2a
projection_input_sha256: 8851becb30c4bd6b8aaffac6a7f0d4aa4bec0332ed1d4fc91b7146fdff438765
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
      "Do not claim that anxiety or another protective alarm proves the feared conclusion is true."
    ],
    "requiredNuance": [
      "The contempt may be child, protector, adult evaluator, or blend.",
      "Protective intent and predictive accuracy are separate: an alarm can be understandable and still be mistaken, outdated, or overprotective.",
      "Consent, immediate safety and possible medical red flags outrank an experiment with the alarm; use a cheap reversible precaution first and interpret afterward."
    ]
  },
  "recommendations": [
    "Treat cynicism, numbness, anger, scrolling, substances, planning, sleep, or dissociation as information about what the system expects.",
    "Ask what the part predicts will happen if it steps back; acknowledge before answering.",
    "A still-present protector may permit an agreed small step. Notice its current stance instead of requiring it to disappear, and recheck if permission is withdrawn. Presence alone does not prove continued blocking.",
    "For ordinary-life decisions, treat anxiety and other protective alarms as information about expected danger or overload rather than commands or truth detectors; hear what they are trying to protect, then compare the prediction with evidence, current capacity and later outcomes."
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
