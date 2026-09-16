---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.CONSENSUAL_TOUCH
title: Use touch or massage only as a wanted, revisable support
kind: decision-node
tier: 5
priority: 77
authority: author-framework
graph_tags:
  - touch
  - massage
  - consent
  - self-touch
source_refs:
  - SOM.TOUCH
regression_refs: []
base_record_sha256: 55925ed93944a342858e3863af8b9b691e2323101accdcbf5ebe518a88d18edf
base_graph_sha256: 5f2387789deec1cc04e6d7ff0f1a66b455472b1dccdf6cb3cb5afc0707ba47fc
projection_input_sha256: d807775fcdfe2d3cd1ab0a040505f4c1e14aba98e39945a00dffa26a60306034
---

# Use touch or massage only as a wanted, revisable support

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "touch_interest",
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
      }
    ]
  },
  "avoid": [
    "Do not treat touch aversion, freezing, pulling away, uncertainty, or a changed mind as resistance to push through.",
    "Do not sexualize therapeutic touch or make the helper’s need for closeness part of the intervention."
  ],
  "defaultQuestion": "Would touch help here, and if so would you prefer self-touch, consensual outside touch, or a no-touch option?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not claim that where tension is felt proves where trauma is stored or what caused it."
    ],
    "requiredNuance": [
      "No-touch support is a complete valid option; self-touch and outside touch are not assumed equivalent."
    ]
  },
  "questionPolicy": {
    "purpose": "discriminate",
    "unresolvedFields": [
      "touch_interest"
    ]
  },
  "recommendations": [
    "Start with the least intrusive form the person actually wants: self-massage, consensual nonsexual touch from a trusted person or practitioner, or a non-touch alternative.",
    "Keep pressure, location, duration, distance, clothing, and stopping under the person’s control; re-check consent when the response changes.",
    "Judge the intervention by orientation, agency, comfort in the body, and later functioning rather than by intensity or emotional release."
  ],
  "successSignals": [
    "The person retains choice and finishes at least as oriented and self-possessed as they began."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.TOUCH]]
