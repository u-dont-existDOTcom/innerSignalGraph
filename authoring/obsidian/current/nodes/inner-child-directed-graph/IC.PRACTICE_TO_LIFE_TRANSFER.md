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
regression_refs:
  - G089
  - G090
  - G091
base_record_sha256: cb7f26f11608d00eb62283de8ca3409c7a3e93be7b06b7ce23d4ea17a249c132
base_graph_sha256: 59e9031700393f6690fe52b1dcb84bd5cf49747665172ae1d7a12a79b285a1e0
projection_input_sha256: e36e91942351df953f6c5630631ef9cd60322cea36c01d7956e3179848e5c9e9
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
    "Do not turn transfer review into a performance score, compulsive tracking, or another reason for self-attack."
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
    "After carryover becomes observable, let later depth decisions depend on actual unresolved material and current gates rather than repeating an already-working meditation merely to produce more intensity."
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
