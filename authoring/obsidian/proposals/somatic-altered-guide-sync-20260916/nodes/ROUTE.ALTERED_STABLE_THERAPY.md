---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: somatic-altered-guide-sync-20260916
operation: add
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
base_graph_sha256: 61db2ed53fe2c0eaa386328c1a52df3081f1c96c46771a327c431b16261a5396
base_projection_input_sha256: 2c8ca643504274023e49c647fbff143a6f02fe685ef935384c3c60c33b004fbb
---

# Continue substantive therapy when altered-state capacity remains coherent and safe

> [!warning] Editable proposal record. Building it never changes canonical graph files.

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

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
