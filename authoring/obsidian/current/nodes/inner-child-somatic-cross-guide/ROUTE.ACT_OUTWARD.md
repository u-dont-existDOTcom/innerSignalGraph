---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.ACT_OUTWARD
title: Act on the concrete problem
kind: decision-node
tier: 3
priority: 99
authority: owner-approved-extension
graph_tags:
  - three-way-routing
  - outward-action
  - protector
  - guide
source_refs:
  - AMEND.CROSS.THREE_WAY_THERAPY_ROUTING
  - AMEND.CROSS.LITERATURE_ACTION_REVIEW
regression_refs:
  - G013
  - G014
  - G033
base_record_sha256: 90524ce906f30738dd6a9a128b9c4cc2f3a8a55b0323ba439bc58cfc0145f2b6
base_graph_sha256: 9ca2615aba6172792631bfbc33d8610dcd20e2a16ceed756be839ba7878fba40
projection_input_sha256: 3b334606ff10f36690771c46f59b87e7b90a407aca49d339e05f9e0b8c5117f7
---

# Act on the concrete problem

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "actionable_problem",
        "op": "eq",
        "value": "present"
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
        "field": "suicidal_state",
        "op": "in",
        "value": [
          "ideation",
          "intent",
          "imminent"
        ]
      }
    ]
  },
  "avoid": [
    "Do not wait for complete emotional certainty before taking a reversible necessary action.",
    "Do not use action as a way to deny clearly unresolved inner material that continues to drive the problem.",
    "Do not treat noncompletion as lack of motivation or a protective part before examining practical barriers; do not treat task completion or immediate mood improvement as the sole evidence of benefit."
  ],
  "defaultQuestion": "What is the next observable action that could actually change this situation?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not reduce every emotional problem to productivity or behavioral execution."
    ],
    "requiredNuance": [
      "A concrete problem and unresolved inner material can coexist; outward action goes first when the environment can actually be changed, while inward work may remain a parallel or later job."
    ]
  },
  "questionPolicy": {
    "purpose": "discriminate",
    "unresolvedFields": []
  },
  "recommendations": [
    "Extract one concrete problem that can be changed and choose the next observable decision or action.",
    "When useful problem-solving is surrounded by rumination, act on the actionable piece and stop rerunning the remainder until genuinely new information arrives.",
    "Use Protector functions for boundaries and safety, and Guide or Leader functions for sequencing and practical follow-through, without requiring deeper introspection merely because action is emotionally charged.",
    "When an action is agreed, make its cue, feasible size, resource needs and personally useful purpose concrete. When an attempt has already happened, review the actual sequence and consequences instead of assigning the same action again."
  ],
  "successSignals": [
    "A decision, boundary, request, repair, plan, or other observable action changes the real situation.",
    "Thinking becomes shorter and more specific because it terminates in action or a defined wait for new information."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.CROSS.THREE_WAY_THERAPY_ROUTING]]

[[current/governance/amendments/AMEND.CROSS.LITERATURE_ACTION_REVIEW]]
