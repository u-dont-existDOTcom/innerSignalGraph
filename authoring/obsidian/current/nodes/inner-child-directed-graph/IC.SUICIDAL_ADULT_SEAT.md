---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.SUICIDAL_ADULT_SEAT
title: Bring a second adult or witness seat into the room
kind: decision-node
tier: 1
priority: 99
authority: author-framework
graph_tags:
  - suicide-prevention
  - borrowed-adulthood
  - witness
  - differentiation
  - safety
source_refs:
  - AMEND.IC.SUICIDAL_ADULT_SEAT
  - AMEND.IC.SUICIDAL_SELF_DEATH_INQUIRY
  - IC.NEUTRAL_WITNESS
  - IC.BORROW_ONE_FUNCTION
  - AMEND.CROSS.PAIN_CRISIS_TREATMENT_VS_KNOWN_HARM
  - AMEND.CROSS.CARE_TRAUMA_DISCLOSURE_AND_TRUST
regression_refs:
  - G094
  - G095
  - G098
  - G100
  - G102
  - G103
  - G107
  - G108
base_record_sha256: 1437969437237264d7d066dccaf82c45b19c266b42589372f3c0c2f4ae04d9f1
base_graph_sha256: 2dbd3b3481a9dfef47b6259ade2306e453b40983020854f05beff9378fc6946f
projection_input_sha256: ec4a7909c2fb0e5bdc4aa78ebedf02685d9b97bd54a9f494331f7d3d0048166d
---

# Bring a second adult or witness seat into the room

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "suicidal_state",
        "op": "in",
        "value": [
          "ideation",
          "intent",
          "imminent"
        ]
      }
    ],
    "any": [
      {
        "field": "identity_blur",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "inner_adult_access",
        "op": "in",
        "value": [
          "low",
          "unknown"
        ]
      },
      {
        "field": "witness_capacity",
        "op": "in",
        "value": [
          "absent",
          "unknown"
        ]
      }
    ],
    "none": [
      {
        "field": "present_safety",
        "op": "eq",
        "value": "unsafe"
      },
      {
        "field": "orientation",
        "op": "eq",
        "value": "disoriented"
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
        "field": "altered_state",
        "op": "eq",
        "value": "altered"
      }
    ]
  },
  "avoid": [
    "Do not announce that the suicidal voice is the inner child or impose a parts model the person has not endorsed.",
    "Do not make the borrowed adult into a new external authority over memories, medicine, relationships, or spiritual conclusions.",
    "Do not use the adult position to lecture, shame, suppress, or outvote the suicidal state.",
    "Do not infer a suicide plan, enduring desire to die, substance dependence, or unavailable prior care from pain-triggered ideation alone. Remain responsive to new intent, inability to stay safe, and other supported acute danger.",
    "Do not recommend suicidal disclosure as a tactic for analgesia or assume previous psychiatric hospitalization was harmless; do not recommend falsely denying current intent, a plan, imminent danger or inability to remain safe."
  ],
  "defaultQuestion": "Before we decide anything, can we invite any part of you that can observe, protect the body, or simply postpone the decision to sit beside the part that wants to die—even if we have to borrow that adult position from someone you trust?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.SUICIDAL_SELF_DEATH_INQUIRY",
      "IC.EXISTENTIAL_NOURISHMENT",
      "IC.LOVE_HORIZON_EXPLORATION"
    ],
    "forbiddenOverclaims": [
      "Do not claim a complete inner adult already exists merely because the person can momentarily observe the suicidal state.",
      "Do not claim every suicidal state is a child-state."
    ],
    "requiredNuance": [
      "The prerequisite is a minimally reflective second position, not a fully healed or spiritually advanced self.",
      "A neutral witness, partial inner adult, or borrowed adult function can be enough to begin; adult identity may form after protective behavior.",
      "The adult position first protects the body and listens. It does not need to convince the suicidal state that life is good before the self/death inquiry can begin."
    ]
  },
  "questionPolicy": {
    "purpose": "discriminate",
    "unresolvedFields": []
  },
  "recommendations": [
    "First discriminate fusion: ask whether the wish to die feels like the whole self right now or whether any observing/protective position can sit beside it.",
    "Invite one second seat rather than a complete ideal parent: neutral witness, Nurturer, Protector, future self, trusted person, spiritual figure, written plan, or another bounded source of adult capacity.",
    "If no internal adult position is available, borrow one function only: keep the body safe, listen without retaliation, and postpone irreversible action while the suicidal state speaks.",
    "Once the person can hold the suicidal state and an observing/protective position at the same time, continue to the strict self/death/rebirth inquiry rather than remaining indefinitely in preparatory soothing.",
    "When thoughts of death are reported as episodic reactions to severe physical pain without expressed intent, preserve that context and prioritize a workable medical pain-crisis plan and real-world protection over repetitive psychiatric intake scripts.",
    "When suicidal thoughts are episodic and arise during extreme physical pain without current intent, prioritize trusted voluntary support and medical pain-care access, respecting prior coercive psychiatric harm, instead of requiring routine psychiatric disclosure or philosophical death inquiry."
  ],
  "successSignals": [
    "The person can distinguish the suicidal state from at least one observing or protective position, even if that adult capacity is weak, borrowed, or temporary."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.SUICIDAL_ADULT_SEAT]]

[[current/governance/amendments/AMEND.IC.SUICIDAL_SELF_DEATH_INQUIRY]]

[[current/sources/inner-child-guide/IC.NEUTRAL_WITNESS]]

[[current/sources/inner-child-guide/IC.BORROW_ONE_FUNCTION]]

[[current/governance/amendments/AMEND.CROSS.PAIN_CRISIS_TREATMENT_VS_KNOWN_HARM]]

[[current/governance/amendments/AMEND.CROSS.CARE_TRAUMA_DISCLOSURE_AND_TRUST]]
