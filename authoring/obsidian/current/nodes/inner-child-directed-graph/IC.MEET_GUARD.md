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
  - IC.INHERITED_PARENT
  - AMEND.CROSS.LITERATURE_TASK_PROGRESS
  - AMEND.CROSS.PROTECTIVE_ALARM_CALIBRATION
  - AMEND.IC.SHAME_APPRAISAL_REPARABILITY_20261029
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
base_record_sha256: 41f617ddb17763e385c269bea41556b6a792502aa166ef78a11e90f1caba3362
base_graph_sha256: e5f728eda7192aeef14be8ffa682074c2107b709baa8063dd90231f41bf51dec
projection_input_sha256: d084c191c14ed705aaf8e78c45615844ff3ae4fc0b381e9f9163c1aa67374e29
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
    "Do not assume an inner critic is a guard: it is one when it works as a self-critical strategy trying to prevent a feared outcome, but a critical voice may also, or instead, replay something learned from a parent or point to a real problem in a cruel way.",
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
      "Consent, immediate safety and possible medical red flags outrank an experiment with the alarm; use a cheap reversible precaution first and interpret afterward."
    ]
  },
  "recommendations": [
    "Treat cynicism, numbness, anger, scrolling, substances, planning, sleep, or dissociation as information about what the system expects.",
    "Ask what the part predicts will happen if it steps back; acknowledge before answering.",
    "Meet a critical inner voice with compassion, curiosity and understanding as well as firm limits. Where a protective purpose is plausible, do not assume it protects only the younger self: it may be guarding another vulnerable part, belonging, status, control or safety. Explore what it fears or is trying to accomplish when the person finds that useful, treating the answer as a hypothesis; it is not required before the person rejects the insult, sets a boundary or takes relief.",
    "A still-present protector may permit an agreed small step. Notice its current stance instead of requiring it to disappear, and recheck if permission is withdrawn. Presence alone does not prove continued blocking.",
    "For ordinary-life decisions, treat anxiety and other protective alarms as information about expected danger or overload rather than commands or truth detectors; hear what they are trying to protect, then compare the prediction with evidence, current capacity and later outcomes.",
    "When shame becomes shame about being ashamed, distinguish the initial experience from a secondary self-attack and investigate any useful protective aim without treating the first feeling as a malfunction."
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

[[current/sources/inner-child-guide/IC.INHERITED_PARENT]]

[[current/governance/amendments/AMEND.CROSS.LITERATURE_TASK_PROGRESS]]

[[current/governance/amendments/AMEND.CROSS.PROTECTIVE_ALARM_CALIBRATION]]

[[current/governance/amendments/AMEND.IC.SHAME_APPRAISAL_REPARABILITY_20261029]]
