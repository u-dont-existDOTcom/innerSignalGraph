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
regression_refs:
  - G002
  - G003
base_record_sha256: 18763dcc2839b80e777c89163237f384df333a778f911ff19f28ccda4128d641
base_graph_sha256: a2adb4c3f3d7727f1943c0805f713fa4a8b150353dcc5593b118500c53267342
projection_input_sha256: ce5fd7dec1e1fbcdcc7e24160f41a60bdf9bc20ff7746c255d6dfe0b19e2d52c
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
    "Do not force breath, chase intensity, or assume tension proves a hidden memory."
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
      "Relaxation may remove a bodily barrier but does not by itself repair credibility or resolve relational conflict."
    ]
  },
  "recommendations": [
    "Use non-forced longer exhales, gentle self-massage, or another low-dose somatic method to reduce holding around the solar plexus or abdomen.",
    "Treat softening as an opening for love or presence, not an order to enter memories."
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
