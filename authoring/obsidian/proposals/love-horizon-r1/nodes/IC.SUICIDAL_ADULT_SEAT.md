---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: love-horizon-r1
operation: add
graph_id: inner-child-directed-graph
node_id: IC.SUICIDAL_ADULT_SEAT
title: Bring a second adult or witness seat into the room
kind: decision-node
tier: 1
priority: 100
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
base_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6
base_projection_input_sha256: a7aeada0a9fa9fd791ae52f7e25dd7e6b7ea855bdfda56a37f438f07d7f6a3f5
---

# Bring a second adult or witness seat into the room

> [!warning] Editable proposal record. Building it never changes canonical graph files.

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
    "Do not use the adult position to lecture, shame, suppress, or outvote the suicidal state."
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
  "recommendations": [
    "First discriminate fusion: ask whether the wish to die feels like the whole self right now or whether any observing/protective position can sit beside it.",
    "Invite one second seat rather than a complete ideal parent: neutral witness, Nurturer, Protector, future self, trusted person, spiritual figure, written plan, or another bounded source of adult capacity.",
    "If no internal adult position is available, borrow one function only: keep the body safe, listen without retaliation, and postpone irreversible action while the suicidal state speaks.",
    "Once the person can hold the suicidal state and an observing/protective position at the same time, continue to the strict self/death/rebirth inquiry rather than remaining indefinitely in preparatory soothing."
  ],
  "successSignals": [
    "The person can distinguish the suicidal state from at least one observing or protective position, even if that adult capacity is weak, borrowed, or temporary."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Abstract self/death inquiry can be wasted or distorted when the person is completely fused with the suicidal state. This gate uses the existing witness and borrowed-adulthood architecture to establish only enough differentiation to investigate rather than act.

## Regression intent

G023 must route fused/low-adult suicidality here before self/death inquiry. G024 must prove that a person who already has a witness and partial/available adult capacity goes directly to self/death inquiry without a redundant ritual.
