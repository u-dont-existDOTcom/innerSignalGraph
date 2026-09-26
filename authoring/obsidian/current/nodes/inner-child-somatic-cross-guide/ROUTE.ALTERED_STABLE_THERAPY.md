---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.ALTERED_STABLE_THERAPY
title: Continue substantive therapy when altered-state capacity remains coherent and safe
kind: decision-node
tier: 4
priority: 99
authority: author-framework
graph_tags:
  - altered-state
  - capacity-led
  - substantive-therapy
  - epistemic
source_refs:
  - ALT.CAPACITY
  - ALT.EPISTEMICS
  - IC.ALTERED_STATES
regression_refs: []
base_record_sha256: 0e87c4e77127b12c7c64b75cbf0009a3bda1720d10d7a634166981b46bfd2031
base_graph_sha256: 527e801bcc54ee21aaf4b9ec5f4839a2183ef661a837e39a99b57a8b1c77a702
projection_input_sha256: 456d7539d0ac59e9a20a4c08179a8856ead6d3e863fb63b4915b9f98fd401e78
---

# Continue substantive therapy when altered-state capacity remains coherent and safe

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
      },
      {
        "field": "altered_capacity",
        "op": "eq",
        "value": "coherent"
      },
      {
        "field": "altered_medical_status",
        "op": "eq",
        "value": "stable"
      },
      {
        "field": "present_safety",
        "op": "eq",
        "value": "safe"
      },
      {
        "field": "orientation",
        "op": "eq",
        "value": "oriented"
      },
      {
        "field": "ability_to_stop",
        "op": "eq",
        "value": "yes"
      }
    ],
    "none": [
      {
        "field": "dissociation",
        "op": "eq",
        "value": "high"
      }
    ]
  },
  "avoid": [
    "Do not automatically substitute generic grounding for the user’s actual therapeutic question when capacity is demonstrably intact.",
    "Do not use altered intensity as proof that a memory is historical, an ontology is true, or healing is complete."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not equate articulate writing with full medical stability or intact judgment in every domain."
    ],
    "requiredNuance": [
      "Altered state is a routing variable, not by itself evidence of incapacity. Coherence in text is still not a medical exam; explicit physical stability remains a separate requirement."
    ]
  },
  "recommendations": [
    "Do not terminate or flatten therapy merely because the person discloses an altered state; continue responsive therapeutic work at the depth their current orientation, stopping capacity, and agency support.",
    "Keep altered-state insights, memories, symbols, intuitions, and metaphysical conclusions provisional where external truth matters; use ordinary evidence after the state when consequences depend on them.",
    "Reduce depth immediately if orientation, stopping capacity, physical stability, reality testing, or ordinary agency begins to deteriorate."
  ],
  "successSignals": [
    "The person can engage meaningfully, retain choice, stop voluntarily, and return toward ordinary functioning without escalating intensity to keep therapy working."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/altered-states-map-source/ALT.CAPACITY]]

[[current/sources/altered-states-map-source/ALT.EPISTEMICS]]

[[current/sources/inner-child-guide/IC.ALTERED_STATES]]
