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
  - AMEND.CROSS.PRACTICAL_FOCUS_SEQUENCING
regression_refs:
  - G092
  - G093
base_record_sha256: f7d0e06615193b82a423958adc64bb7b1bf13e3aa53ee8c6c94ee783b3f2bd02
base_graph_sha256: afbebefa2779fe9833dd7a974735316169e62d1ea9a769126199f53e9a9a96e5
projection_input_sha256: 42a366bf501a3e110c367dacca83a75f4384ae8d7025813f3d1d11791b525913
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
    "Do not interpret waiting on a real external prerequisite as avoidance, lack of motivation, dependence, resistance, or therapeutic failure.",
    "Do not let one blocked lane monopolize the reply when a separate higher-leverage current priority is actionable."
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
      "Defined waiting is temporary and conditional: a change in the blocker or new grounded information can reopen outward action without requiring the person to re-explain the entire problem.",
      "Defined waiting applies to the selected practical focus, not globally to every problem mentioned in the turn; a blocked sibling lane and an actionable focus can coexist."
    ]
  },
  "recommendations": [
    "Preserve the known constraint chain, including steps already completed, and state the external event, permission, resource, or timing condition that would reopen action.",
    "Do not generate substitute actions merely to avoid waiting. Offer an alternative only when it is genuinely independent of the blocker and supported by the transcript or grounded external information.",
    "Before making defined waiting the practical route, check whether another independent current priority has a supported action. If it does, park this blocked lane and route available effort to that feasible priority.",
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

[[current/governance/amendments/AMEND.CROSS.PRACTICAL_FOCUS_SEQUENCING]]
