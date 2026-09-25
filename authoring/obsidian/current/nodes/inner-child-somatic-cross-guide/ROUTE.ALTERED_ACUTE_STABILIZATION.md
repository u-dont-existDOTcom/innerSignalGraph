---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.ALTERED_ACUTE_STABILIZATION
title: Simplify the acute altered state before adding interpretation
kind: decision-node
tier: 2
priority: 99
authority: author-framework
graph_tags:
  - altered-state
  - grounding
  - acute
  - human-anchor
  - sleep
source_refs:
  - ALT.GROUNDING
  - ALT.PANIC_LOOP
  - ALT.TOUCH
regression_refs: []
base_record_sha256: 41ef01592f786e3897a4f85fea1e5cec2bcded04183686ce185d1465602205bd
base_graph_sha256: 527e801bcc54ee21aaf4b9ec5f4839a2183ef661a837e39a99b57a8b1c77a702
projection_input_sha256: c9e563fdad998e15db8d98d0bbd7edc76cda90f0145459cc620ef5fcb869df78
---

# Simplify the acute altered state before adding interpretation

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "altered_state",
        "op": "eq",
        "value": "altered"
      }
    ],
    "any": [
      {
        "field": "activation",
        "op": "eq",
        "value": "high"
      },
      {
        "field": "panic_instability",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "altered_capacity",
        "op": "eq",
        "value": "limited"
      },
      {
        "field": "support_available",
        "op": "eq",
        "value": "absent"
      },
      {
        "field": "sleep_deprivation",
        "op": "eq",
        "value": "present"
      }
    ],
    "none": [
      {
        "field": "altered_medical_status",
        "op": "eq",
        "value": "concerning"
      },
      {
        "field": "altered_capacity",
        "op": "eq",
        "value": "impaired"
      }
    ]
  },
  "avoid": [
    "Do not force stillness, movement, touch, music, breathing exercises, prayer, imagery, or interpretation as the one correct response.",
    "Do not turn acute stabilization into a metaphysical debate or a demand for insight."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [
      "ROUTE.GO_INWARD",
      "ROUTE.ALTERED_STABLE_THERAPY"
    ],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE",
      "SOM.DEEP_BRAINSPOTTING",
      "SOM.EMDR_DISCRETE",
      "SOM.EMDR_DEVELOPMENTAL"
    ],
    "forbiddenOverclaims": [
      "Do not claim that a grounding response proves the experience was only anxiety or only psychological."
    ],
    "requiredNuance": [
      "Body → room → human → time → meaning is an acute support order, not a universal theory that body experience always precedes thought."
    ]
  },
  "recommendations": [
    "Reduce unwanted light, sound, crowding, temperature discomfort, unsafe company, and uninvited touch before trying to explain the experience.",
    "Test stillness versus contained gentle movement by whether it makes the person safer and clearer rather than more activated or impulsive; a small ordinary task can share attention with emotion when immobile introspection becomes a trap.",
    "Use one calm human anchor when possible, re-establish place and time, protect sleep, and let meaning wait until the nervous system has somewhere to stand."
  ],
  "successSignals": [
    "The person becomes more oriented, less impulsive, more able to choose, and more able to engage with ordinary reality."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/altered-states-map-source/ALT.GROUNDING]]

[[current/sources/altered-states-map-source/ALT.PANIC_LOOP]]

[[current/sources/altered-states-map-source/ALT.TOUCH]]
