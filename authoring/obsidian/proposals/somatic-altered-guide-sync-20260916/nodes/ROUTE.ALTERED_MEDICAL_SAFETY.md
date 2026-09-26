---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: somatic-altered-guide-sync-20260916
operation: add
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.ALTERED_MEDICAL_SAFETY
title: Treat medical danger or impaired capacity as a real-world safety problem
kind: decision-node
tier: 1
priority: 100
authority: author-framework
graph_tags:
  - altered-state
  - medical-safety
  - capacity
  - triage
source_refs:
  - ALT.TRIAGE
  - ALT.NO_RESCUE_IMPORT
base_graph_sha256: 61db2ed53fe2c0eaa386328c1a52df3081f1c96c46771a327c431b16261a5396
base_projection_input_sha256: 2c8ca643504274023e49c647fbff143a6f02fe685ef935384c3c60c33b004fbb
---

# Treat medical danger or impaired capacity as a real-world safety problem

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
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
    "Do not tell the person to breathe through, spiritually process, or continue therapy through signs of possible medical failure.",
    "Do not prescribe experimental rescue substances, supplement doses, or home antidotes from the public guide as emergency treatment.",
    "Do not dismiss a neurological or bodily complaint merely because the person is intoxicated or frightened."
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
      "Do not claim that the absence of reported red flags proves medical stability."
    ],
    "requiredNuance": [
      "Text chat cannot directly observe neurological or physiological signs; inability to establish stability is not the same as a reassuring screen."
    ]
  },
  "recommendations": [
    "Move from interpretation to urgent real-world assessment and the least disruptive effective outside help when medical danger, severe impairment, or inability to establish basic stability is reported.",
    "Use ordinary first-aid and emergency/poison-support boundaries appropriate to the situation; missing nonverbal information in text chat remains unknown rather than reassuring.",
    "Keep the author guide’s experimental remedies and field hierarchy separate from executable emergency instructions."
  ],
  "successSignals": [
    "Immediate danger is reduced or transferred to appropriate human/medical support before interpretive work resumes."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
