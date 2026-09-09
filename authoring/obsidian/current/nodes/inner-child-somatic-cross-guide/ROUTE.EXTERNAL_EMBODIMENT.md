---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.EXTERNAL_EMBODIMENT
title: Shift from inward monitoring to external embodiment
kind: decision-node
tier: 3
priority: 98
authority: owner-approved-extension
graph_tags:
  - three-way-routing
  - external-orientation
  - embodiment
  - derealization
source_refs:
  - AMEND.CROSS.THREE_WAY_THERAPY_ROUTING
  - SOM.MAP_NOT_LADDER
  - SOM.SE
  - AMEND.CROSS.LITERATURE_TASK_PROGRESS
regression_refs:
  - G032
base_record_sha256: 7bfec7046e592060c89d6493621deb16c87b13c542afe3a7594b6200bafcd9f1
base_graph_sha256: beb05b08a340cf9bd62efacaab7619a3dd4f6adf6bedabb4927cfe4e3a329560
projection_input_sha256: a8e29c1684b1ac74a0869570a8e57a4a164a02c35beee1e47d269d06eaaf68de
---

# Shift from inward monitoring to external embodiment

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "inward_attention_effect",
        "op": "eq",
        "value": "worsens"
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
        "field": "actionable_problem",
        "op": "eq",
        "value": "present"
      }
    ]
  },
  "avoid": [
    "Do not repeatedly body-scan to test whether the external activity is working.",
    "Do not infer that all somatic therapy is contraindicated merely because introspective attention is destabilizing right now."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE",
      "SOM.DEEP_BRAINSPOTTING",
      "SOM.EMDR_DISCRETE",
      "SOM.EMDR_DEVELOPMENTAL"
    ],
    "forbiddenOverclaims": [
      "Do not claim that external activity proves the symptoms are psychological or that exercise is sufficient treatment for every cause of derealization or panic."
    ],
    "requiredNuance": [
      "Interoceptive attention and embodied activity are different attentional operations; difficulty with one does not imply inability to benefit from the other."
    ]
  },
  "recommendations": [
    "Prefer eyes-open orientation and ordinary embodied activity that requires contact with the environment: walking, gym, sport, swimming, cycling, chores, social contact, or another tolerable activity.",
    "Treat this as embodiment without symptom-scanning: attention can be in movement, coordination, effort, surroundings, and ordinary life rather than repeatedly checking the internal state.",
    "If inward attention later becomes tolerable or clearly useful, reassess rather than permanently banning somatic or contemplative work."
  ],
  "successSignals": [
    "Derealization, panic, or hypermonitoring is no longer being amplified by repeated inward checking.",
    "The person spends more time engaged in ordinary embodied life and can flex attention inward or outward with more choice."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.CROSS.THREE_WAY_THERAPY_ROUTING]]

[[current/sources/somatic-sequencing-guide/SOM.MAP_NOT_LADDER]]

[[current/sources/somatic-sequencing-guide/SOM.SE]]

[[current/governance/amendments/AMEND.CROSS.LITERATURE_TASK_PROGRESS]]
