---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.PRACTICE_TO_LIFE_TRANSFER
title: Carry a working inner adult into ordinary life
kind: decision-node
tier: 3
priority: 98
authority: owner-approved-extension
graph_tags:
  - inner-signal-continuity
  - practice-transfer
  - ordinary-life
  - adult-apprentice
source_refs:
  - AMEND.IC.PRACTICE_TO_LIFE_TRANSFER
  - IC.ADULT_APPRENTICE
  - IC.PROTECTOR_VISIBLE
  - AMEND.CROSS.LITERATURE_ACTION_REVIEW
  - AMEND.CROSS.OUTCOME_HORIZON_ATTRIBUTION
  - AMEND.CROSS.REPLY_FOCUS_AND_DELIVERY_20261025
  - AMEND.CROSS.EARLY_REGULATION_CONDITION_20261026
regression_refs:
  - G089
  - G090
  - G091
base_record_sha256: 68aa2934a57b9b44b71d85796b35e3cdad4cf617faf49fc5e3b3954a6f272a70
base_graph_sha256: 8a6c38e4ff7831f28b045efb4ab8c4badf7368329091209c990f488cf1f99460
projection_input_sha256: b6c328802fa429b0e6ad6830c39588882761a581e69be6a2605ebf82a2144b3b
---

# Carry a working inner adult into ordinary life

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "ic_real_world_transfer",
        "op": "eq",
        "value": "session_only"
      },
      {
        "field": "ic_status",
        "op": "in",
        "value": [
          "active",
          "stepped_down"
        ]
      },
      {
        "field": "current_intent",
        "op": "in",
        "value": [
          "gentle_practice",
          "deep_dialogue",
          "integration"
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
      }
    ]
  },
  "avoid": [
    "Do not call a good inner-child meditation durable integration when ordinary life has not changed accordingly.",
    "Do not require every inner-child practice to produce an outward assignment or reduce relational inner work to productivity.",
    "Do not turn transfer review into a performance score, compulsive tracking, or another reason for self-attack.",
    "Do not infer that relaxed shoulders mean all anxiety is gone, or that longer practice must always increase relief; real evidence may include mixed results and destabilization.",
    "Do not infer that a person made no effort simply because no method provided sufficient relief at the peak, or require exhaustive logs to make sense of mixed outcomes."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE"
    ],
    "forbiddenOverclaims": [
      "Do not claim that a successful meditation proves durable real-life change.",
      "Do not claim that weak carryover means the meditation was fake or that the whole reparenting method failed."
    ],
    "requiredNuance": [
      "In-session adult access and generalized ordinary-life capacity are different evidence states; a person can sound and feel genuinely caring in meditation while still lacking carryover.",
      "One successful real-world act is evidence of emerging transfer, not proof that the function is durable across contexts.",
      "Transfer work is triggered by a supported mismatch, not imposed as homework after every practice."
    ]
  },
  "recommendations": [
    "Name the adult function that was genuinely usable in the practice—Nurturer, Protector, Guide, or a narrower caring/protective/guiding move—and choose one five-percent ordinary-life action that expresses the same function.",
    "Keep the action small enough to fit present capacity and the actual need. A meal, rest, boundary, request for help, truthful but calibrated disclosure, task handled, self-test stopped, or another concrete act may fit; do not assign generic homework merely because a meditation occurred.",
    "Review what the action actually contributed and what should be kept or adjusted. The younger state does not have to trust the adult yet, and completion alone is not the success criterion.",
    "After carryover becomes observable, let later depth decisions depend on actual unresolved material and current gates rather than repeating an already-working meditation merely to produce more intensity.",
    "When a currently accessible practice has a small observed benefit, compare its personally effective technique, duration, continuation, delayed costs and carryover into ordinary life before changing it or demanding more intensity.",
    "Where planning becomes difficult during distress, help assemble a very small, low-cost, easy-to-retrieve list of already-tested stabilizing options instead of an elaborate schedule or compulsive tracking assignment.",
    "When a known practice sometimes calms early distress but fails once overwhelmed, compare the successful pre-peak contexts with the unsuccessful ones rather than asking again what worked at the worst peak."
  ],
  "successSignals": [
    "At least one caring, protective, or guiding action that matches the in-session function occurs outside the exercise and is initiated by the person.",
    "Repeated carryover can move from session-only to emerging or generalizing transfer without requiring immediate child trust or a perfect adult identity."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.PRACTICE_TO_LIFE_TRANSFER]]

[[current/sources/inner-child-guide/IC.ADULT_APPRENTICE]]

[[current/sources/inner-child-guide/IC.PROTECTOR_VISIBLE]]

[[current/governance/amendments/AMEND.CROSS.LITERATURE_ACTION_REVIEW]]

[[current/governance/amendments/AMEND.CROSS.OUTCOME_HORIZON_ATTRIBUTION]]

[[current/governance/amendments/AMEND.CROSS.REPLY_FOCUS_AND_DELIVERY_20261025]]

[[current/governance/amendments/AMEND.CROSS.EARLY_REGULATION_CONDITION_20261026]]
