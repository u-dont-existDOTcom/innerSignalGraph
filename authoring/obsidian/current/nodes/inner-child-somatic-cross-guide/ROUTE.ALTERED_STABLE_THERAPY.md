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
  - AMEND.CROSS.STATE_DEPENDENT_TRANSFER
regression_refs: []
base_record_sha256: e98d1a5107e7ec1f7bcca2fa64260001e89418ba9b7bac10f6e3af13d3d13936
base_graph_sha256: 32fe4c146863ea66e757304b8b840c4eb219d5d2fdc51ce7c1b1896bb6771455
projection_input_sha256: 61a6f2bc0a4901a995b341b8e10f0a2d918b76e60ce795da05c2e83e93b98ec8
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
      "Altered state is a routing variable, not by itself evidence of incapacity. Coherence in text is still not a medical exam; explicit physical stability remains a separate requirement.",
      "Experiential credibility and external factual certainty are different. Epistemic caution should protect consequential claims without needlessly nullifying a live private therapeutic experience."
    ]
  },
  "recommendations": [
    "Do not terminate or flatten therapy merely because the person discloses an altered state; continue responsive therapeutic work at the depth their current orientation, stopping capacity, and agency support.",
    "Keep altered-state insights, memories, symbols, intuitions, and metaphysical conclusions provisional where external truth matters; use ordinary evidence after the state when consequences depend on them.",
    "Reduce depth immediately if orientation, stopping capacity, physical stability, reality testing, or ordinary agency begins to deteriorate.",
    "When something becomes newly emotionally real or credible—such as the younger self, innocence, grief, care, protection, or meaning—stay with the live therapeutic task and preserve the exact change for later sober transfer rather than repeatedly interrupting private processing with factual caveats."
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

[[current/governance/amendments/AMEND.CROSS.STATE_DEPENDENT_TRANSFER]]
