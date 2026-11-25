---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.SOLAR_PLEXUS_RELAXATION
title: Relax solar-plexus or abdominal holding before dialogue
kind: decision-node
tier: 3
priority: 90
authority: author-framework
graph_tags:
  - regulation
  - solar-plexus
  - love-access
source_refs:
  - IC.REGULATION_BEFORE_DIALOGUE
  - IC.HEART_SOLAR_LOOP
  - AMEND.SOM.PREP_MODALITIES
  - AMEND.IC.NEWER_GUIDE_PARTS_20261120
  - AMEND.CROSS.SYMPTOM_CAUSAL_HUMILITY_20261019
regression_refs:
  - G002
  - G003
  - G094
  - G097
  - G098
  - G099
  - G101
  - G103
  - G105
  - G106
  - G138
  - G20261019C
base_record_sha256: 328c337fa713dd24707ca397b1c43064e7d9c440e21023d0e99a11ecd71a0e33
base_graph_sha256: 96be7acfe46a74efc119891c7df805bdbbe635157b08561b5dc6962adb89fd4e
projection_input_sha256: ca228b45125d951ffbb19c36c86387dff748e7cc6f6abc8f32f214cae2844b06
---

# Relax solar-plexus or abdominal holding before dialogue

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "solar_plexus_tension",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "activation",
        "op": "eq",
        "value": "high"
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
    "Do not force breath, chase intensity, or assume tension proves a hidden memory.",
    "Do not interpret pain, illness or body tension as proof of suppressed emotion, childhood trauma, or an inner child's communication; do not displace indicated medical care."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE"
    ],
    "forbiddenOverclaims": [
      "Do not claim that energy has definitively moved or trauma has been released."
    ],
    "requiredNuance": [
      "Relaxation may remove a bodily barrier but does not by itself repair credibility or resolve relational conflict.",
      "Emotional regulation and medical care may proceed together; the symptom is real, but its origin is not established by its emotional associations alone."
    ]
  },
  "recommendations": [
    "Use non-forced longer exhales, gentle self-massage, or another low-dose somatic method to reduce holding around the solar plexus or abdomen.",
    "Treat softening as an opening for love or presence, not an order to enter memories.",
    "Breathing can stay continuous and unforced: no holding or straining."
  ],
  "successSignals": [
    "The body softens without air hunger, flooding, or loss of orientation."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.REGULATION_BEFORE_DIALOGUE]]

[[current/sources/inner-child-guide/IC.HEART_SOLAR_LOOP]]

[[current/governance/amendments/AMEND.SOM.PREP_MODALITIES]]

[[current/governance/amendments/AMEND.IC.NEWER_GUIDE_PARTS_20261120]]

[[current/governance/amendments/AMEND.CROSS.SYMPTOM_CAUSAL_HUMILITY_20261019]]
