---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.DEFINED_WAIT
title: Hold a real problem at a defined external blocker
kind: decision-node
tier: 3
priority: 100
authority: owner-approved-extension
graph_tags:
  - three-way-routing
  - outward-action
  - blocked-waiting
  - constraint-chain
  - guide
source_refs:
  - AMEND.CROSS.BLOCKED_ACTION_WAIT
regression_refs:
  - G092
base_record_sha256: ff0c505da85982bdba654d6018865479ee53274b6fafa3ac60978e89dc67111a
base_graph_sha256: 32fe4c146863ea66e757304b8b840c4eb219d5d2fdc51ce7c1b1896bb6771455
projection_input_sha256: 61a6f2bc0a4901a995b341b8e10f0a2d918b76e60ce795da05c2e83e93b98ec8
---

# Hold a real problem at a defined external blocker

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
      },
      {
        "field": "practical_action_state",
        "op": "eq",
        "value": "blocked_waiting"
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
    "Do not invent an undocumented exception, alternate address, payment path, pickup option, transport route, institutional policy, or other workaround that silently contradicts an established constraint.",
    "Do not re-ask the already established blocker chain merely because the model has lost track of it; ask only when new information could change the route.",
    "Do not interpret waiting on a real external prerequisite as avoidance, lack of motivation, dependence, resistance, or therapeutic failure."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not claim a workaround exists when the available evidence does not establish one.",
      "Do not claim that waiting on a known external prerequisite proves passivity, avoidance, lack of motivation, or failed self-leadership."
    ],
    "requiredNuance": [
      "A problem can be concrete and important while currently lacking an executable next step; problem reality and present actionability are separate variables.",
      "A genuinely independent supported action can coexist with a blocked lane. blocked_waiting applies to the live practical route only when all relevant next steps for that route are currently blocked.",
      "Defined waiting is temporary and conditional: a change in the blocker or new grounded information can reopen outward action without requiring the person to re-explain the entire problem."
    ]
  },
  "recommendations": [
    "Preserve the known constraint chain, including steps already completed, and state the external event, permission, resource, or timing condition that would reopen action.",
    "Do not generate substitute actions merely to avoid waiting. Offer an alternative only when it is genuinely independent of the blocker and supported by the transcript or grounded external information.",
    "Treat a defined wait as an active planning state: keep the reopening condition visible, then redirect available effort toward another useful current priority instead of repeatedly solving the same blocked step.",
    "When the reopening condition changes or a genuinely independent feasible step becomes available, update practical_action_state to action_available and return to ordinary outward action."
  ],
  "successSignals": [
    "The concrete problem remains represented accurately while no impossible or contradicted action is assigned.",
    "The blocker and reopening condition are clear enough that attention can move to another feasible task until something materially changes."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.CROSS.BLOCKED_ACTION_WAIT]]
