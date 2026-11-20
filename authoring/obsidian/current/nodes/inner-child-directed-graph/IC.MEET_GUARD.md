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
  - AMEND.IC.ADULT_PROTECTOR_VS_GUARD_20261022
  - AMEND.IC.PROTECTIVE_NO_AGREEMENT_20261120
  - AMEND.IC.GENTLER_THAN_GUIDE_20261120
  - IC.LIVE_GUIDE_DECISIONS_20261120
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
base_record_sha256: 5391b311212cd58f0de857a84d00f665a8aae24a7cf01c4330b6f646557b2e8a
base_graph_sha256: c734f20b8421e0661f8fc1d7f1d5cd90b736965eb6bebcff5b521446d4e9f9a6
projection_input_sha256: 116afae8491e94aaf85669b0481f08e7e8f6a1c0cfff9c701a78a53b4e35f971
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
    "Do not equate listening to a protective alarm with obeying it. A protective part's no to going deeper, to an altered state or to sex is neither obeyed nor overridden automatically: hear the part out and look for an agreement every part can accept. An override fits only when the person already understands the no as an old, unhelpful pattern (the owner's example: a part that told him not to talk to strangers); it is not one size fits all. InnerSignal never pushes an override, including through prediction-testing: the person decides."
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
      "Do not claim that testing a protective prediction, or InnerSignal's own reading, authorizes overriding a protector's no to deeper or altered-state work, or hesitation about touch or sex; only the person can decide that a no is an old pattern to override."
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
    "Meet a critical inner voice with compassion, curiosity and understanding as well as firm limits. Where a protective purpose is plausible, do not assume it protects only the younger self: it may be guarding another vulnerable part, belonging, status, control or safety. Explore what it fears or is trying to accomplish when the person finds that useful, treating the answer as a hypothesis; it is not required before the person rejects the insult, sets a boundary or takes relief.",
    "A still-present protector may permit an agreed small step. Notice its current stance instead of requiring it to disappear, and recheck if permission is withdrawn. Presence alone does not prove continued blocking.",
    "For ordinary-life decisions, treat anxiety and other protective alarms as information about expected danger or overload rather than commands or truth detectors; hear what they are trying to protect, then compare the prediction with evidence, current capacity and later outcomes.",
    "When shame becomes shame about being ashamed, distinguish the initial experience from a secondary self-attack and investigate any useful protective aim without treating the first feeling as a malfunction.",
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

[[current/sources/inner-child-guide/IC.INHERITED_PARENT]]

[[current/governance/amendments/AMEND.CROSS.LITERATURE_TASK_PROGRESS]]

[[current/governance/amendments/AMEND.CROSS.PROTECTIVE_ALARM_CALIBRATION]]

[[current/governance/amendments/AMEND.IC.SHAME_APPRAISAL_REPARABILITY_20261029]]

[[current/governance/amendments/AMEND.IC.ADULT_PROTECTOR_VS_GUARD_20261022]]

[[current/governance/amendments/AMEND.IC.PROTECTIVE_NO_AGREEMENT_20261120]]

[[current/governance/amendments/AMEND.IC.GENTLER_THAN_GUIDE_20261120]]

[[current/sources/inner-child-guide/IC.LIVE_GUIDE_DECISIONS_20261120]]
