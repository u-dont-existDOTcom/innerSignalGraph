---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.EXISTENTIAL_NOURISHMENT
title: Match the work to existential hunger without making spirituality mandatory
kind: decision-node
tier: 2
priority: 98
authority: author-framework
graph_tags:
  - existential
  - love
  - meaning
  - curiosity
  - safety
source_refs:
  - AMEND.IC.EXISTENTIAL_LOVE_ROUTING
  - AMEND.IC.WELLBEING_HORIZON
regression_refs: []
base_record_sha256: 8b3d9a709cfbf6aa1dd9ac841ce1378d449b4460db7b60f6199d823578abf6d8
base_graph_sha256: e2532806378ef613edac19a9eacbe57653b21a4061a2b9f393bb54d1fa30ff2d
projection_input_sha256: 4b5bea805e0b1d4aee6cc9121081d2b08ca6fa6bf019444d2cd96ac39680268f
---

# Match the work to existential hunger without making spirituality mandatory

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "existential_sufficiency",
        "op": "in",
        "value": [
          "insufficient",
          "profoundly_insufficient"
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
    "Do not tell a satisfied, non-curious person that they are spiritually deficient or must seek a profound experience.",
    "Do not romanticize suicidal crisis, despair, an NDE, psychedelics, conversion, or extraordinary states as a route to transformation."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not say a small practical act should be sufficient for profound existential hopelessness.",
      "Do not say a suicidal crisis is spiritually useful or necessary."
    ],
    "requiredNuance": [
      "Immediate safety action and existential nourishment solve different problems; do not confuse preserving life today with answering why life feels worth living.",
      "Curiosity can open a route without proving that a spiritual conclusion is true or required."
    ]
  },
  "recommendations": [
    "Distinguish whether the person is simply working on a wound within a basically sufficient life, is hungry and curious for a deeper horizon, or experiences ordinary life as radically insufficient.",
    "When the person says they hate themselves yet voluntarily seeks help, believe the self-hating part and also ask what the help-seeking part hoped might happen; do not name that motive love for them.",
    "When hopelessness is profound, keep immediate safety and human contact first while also taking the why-live question seriously; a small protective action can preserve the person without pretending to answer the existential question."
  ],
  "successSignals": [
    "The intervention matches the scale of the person’s hunger while preserving safety and choice about spiritual exploration."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.EXISTENTIAL_LOVE_ROUTING]]

[[current/governance/amendments/AMEND.IC.WELLBEING_HORIZON]]
