---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.GO_INWARD
title: Go inward only for material that is actually there
kind: decision-node
tier: 3
priority: 97
authority: owner-approved-extension
graph_tags:
  - three-way-routing
  - inward-processing
  - inner-child
  - somatic
source_refs:
  - AMEND.CROSS.THREE_WAY_THERAPY_ROUTING
  - AMEND.SOM.EARLY_INNER_CHILD_PARALLEL
  - AMEND.SOM.PREP_MODALITIES
  - AMEND.SOM.EMDR_AFTER_REPARENTING_CONDITIONAL
  - AMEND.SOM.ADVANCED_RELEASE_PARALLEL
regression_refs: []
base_record_sha256: 91f958acf7cf9b573098598cbbdb3183a7a3d30fc51fa9e458b731c82639f547
base_graph_sha256: 007ae86467ce97299bbe223bd97c1035f8ffb26354d456ceedc8d6e789154ec2
projection_input_sha256: c5c4aed6b8851992ca36c580a60360aeef78931bfaf972429487e3d3143f8084
---

# Go inward only for material that is actually there

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "unresolved_inner_material",
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
        "field": "suicidal_state",
        "op": "in",
        "value": [
          "ideation",
          "intent",
          "imminent"
        ]
      },
      {
        "field": "inward_attention_effect",
        "op": "eq",
        "value": "worsens"
      }
    ]
  },
  "avoid": [
    "Do not use a generic instruction to 'go deeper' when the person cannot name what is unresolved or when repeated inward attention is making them worse.",
    "Do not force a rigid somatic ladder or assume the most intense modality is the most therapeutic."
  ],
  "defaultQuestion": "What exactly seems unfinished or avoided here, and what changes when you contact it rather than merely think about it?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not infer recovered memories, hidden trauma, or a coherent inner child from symptoms alone."
    ],
    "requiredNuance": [
      "The somatic map remains flexible: gentle regulation, EFT, shaking or movement, resource work, deeper Brainspotting, EMDR, and optional advanced release are branches selected by function, target, capacity, and response rather than a mandatory phase order."
    ]
  },
  "recommendations": [
    "Contact only material that is actually present rather than assuming that distress always hides another layer of trauma.",
    "Route relational, part-level, credibility, trust, or developmental conflict toward the relevant Nurturer, Protector, Guide, guard, or inner-child function; route bodily activation or freeze toward low-dose somatic regulation, EFT, movement or shaking, and titrated body work according to response.",
    "For a stable discrete memory target, EMDR can be considered without forcing a long preparatory ladder; for diffuse or developmental body-held material, resource-oriented or deeper Brainspotting and developmental EMDR remain conditional on capacity.",
    "Advanced release remains optional and parallel; a dramatic state change does not establish readiness for deep processing."
  ],
  "successSignals": [
    "Contact with inner material produces new emotional information, greater integration, a changed relationship to a part or memory, or more behavioral freedom rather than only more description.",
    "Somatic work increases regulation, range, or integration without prolonged destabilization."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.CROSS.THREE_WAY_THERAPY_ROUTING]]

[[current/governance/amendments/AMEND.SOM.EARLY_INNER_CHILD_PARALLEL]]

[[current/governance/amendments/AMEND.SOM.PREP_MODALITIES]]

[[current/governance/amendments/AMEND.SOM.EMDR_AFTER_REPARENTING_CONDITIONAL]]

[[current/governance/amendments/AMEND.SOM.ADVANCED_RELEASE_PARALLEL]]
