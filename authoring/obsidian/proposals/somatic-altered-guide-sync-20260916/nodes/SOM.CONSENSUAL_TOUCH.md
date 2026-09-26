---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: somatic-altered-guide-sync-20260916
operation: add
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
base_graph_sha256: 6b31d4e5d0e6dc2ab838aae714fe59c2c1c2ab21607409c9b1a25b2d5769dd2d
base_projection_input_sha256: 2c8ca643504274023e49c647fbff143a6f02fe685ef935384c3c60c33b004fbb
---

# Use touch or massage only as a wanted, revisable support

> [!warning] Editable proposal record. Building it never changes canonical graph files.

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

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
