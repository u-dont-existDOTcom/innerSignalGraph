---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.MEDICAL_RED_FLAG
title: Handle an urgent medical red flag before therapy interpretation
kind: route-node
tier: 1
priority: 100
authority: owner-approved-extension
graph_tags:
  - medical
  - urgent
  - safety
  - red-flag
source_refs:
  - AMEND.CROSS.FOCUS_PRIORITY_BASELINE
regression_refs:
  - G069
  - G079
base_record_sha256: 2d8590ad736c20083e0fc4ffc0054e2fff3e3b8ee1e7a440b6434d9062e18e1d
base_graph_sha256: f1bea04c4bb68ab1421a367d01dcc78009bcd00e338e401deba09c8a9319550b
projection_input_sha256: fc8dd37105e6ec367a7b6cbf4b2b0913c7cbafb96e7325e6d695811e3512330a
---

# Handle an urgent medical red flag before therapy interpretation

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "medical_urgency",
        "op": "eq",
        "value": "urgent"
      }
    ]
  },
  "avoid": [
    "Do not park a clearly urgent medical or neurological red flag because the person mentioned it as an aside.",
    "Do not diagnose the cause from chat, and do not turn an urgent medical turn into inner-child continuity messaging."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE",
      "IC.REACTIVATION",
      "IC.SCAFFOLDED_CHALLENGE"
    ],
    "forbiddenOverclaims": [
      "Do not diagnose a medical or neurological condition from a red-flag symptom alone."
    ],
    "requiredNuance": [
      "Hard safety and urgent medical red flags are exempt from ordinary focus parking; they take priority only to the degree needed for immediate protection or urgent assessment."
    ]
  },
  "recommendations": [
    "Give direct, proportionate guidance for urgent medical assessment or emergency help before continuing therapeutic interpretation.",
    "Do not delay an urgent red flag with baseline-history questions. Once immediate safety is handled, return to the person's therapeutic focus when appropriate."
  ],
  "successSignals": [
    "The response prioritizes immediate medical safety without unnecessary diagnostic speculation and leaves therapy work for after the urgent issue is addressed."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.CROSS.FOCUS_PRIORITY_BASELINE]]
