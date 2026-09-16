---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: somatic-altered-guide-sync-20260916
operation: add
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
base_graph_sha256: 61db2ed53fe2c0eaa386328c1a52df3081f1c96c46771a327c431b16261a5396
base_projection_input_sha256: 2c8ca643504274023e49c647fbff143a6f02fe685ef935384c3c60c33b004fbb
---

# Simplify the acute altered state before adding interpretation

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

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
