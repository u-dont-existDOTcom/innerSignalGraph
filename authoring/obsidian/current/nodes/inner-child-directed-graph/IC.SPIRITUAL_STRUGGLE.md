---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.SPIRITUAL_STRUGGLE
title: Work with spiritual struggle or sacred loss
kind: decision-node
tier: 3
priority: 100
authority: owner-approved-extension
graph_tags:
  - spiritual-struggle
  - sacred-loss
  - choice
source_refs:
  - AMEND.IC.SPIRITUAL_STRUGGLE
regression_refs:
  - G034
  - G035
base_record_sha256: df62359ad1ed82554fbd6ef9c8b0bcdfa920becb876ec2e0e411aca54af90d93
base_graph_sha256: 8c8a59965c4ee3ffc9fd9dc835e9589808638bd346510a3b4d2c44ba31f3f968
projection_input_sha256: ffe83d54068ac1f15fc624fee5bc33d28e07d074b318546b1801871d58fb0d38
---

# Work with spiritual struggle or sacred loss

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "spiritual_struggle",
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
    "Do not infer divine condemnation or certify an external spiritual cause.",
    "Do not automatically reduce spiritual struggle to a parent projection, bypass, or inability to love.",
    "Do not treat continued devotion, uncertainty, or declining an exercise as pathology."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "No guarantee of metaphysical truth, protection or clinical efficacy follows from this route."
    ],
    "requiredNuance": [
      "A valued spiritual source may help in one respect and hurt in another; spiritual struggle and unavailable support are different."
    ]
  },
  "recommendations": [
    "Find out what turning toward this spiritual source currently evokes and what has been lost or violated. Support the user’s wish to preserve, mourn, reconsider or change that relationship without requiring stronger belief or abandonment of the tradition.",
    "Do not prescribe more borrowing from a source that is itself distressing without examining the mismatch. Discussing spiritual distress is not consent to prayer or imagery."
  ],
  "successSignals": [
    "The concern is heard in its own terms and the person can choose a fitting next step without surrendering practical safety or judgment."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.SPIRITUAL_STRUGGLE]]
