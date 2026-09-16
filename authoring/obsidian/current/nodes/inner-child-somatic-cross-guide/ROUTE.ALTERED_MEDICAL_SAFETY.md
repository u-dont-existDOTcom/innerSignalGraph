---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
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
regression_refs: []
base_record_sha256: 7844caea433336af24dceb7dac9cc9f546b22d65f3ebeec65e15e512aeace25e
base_graph_sha256: 527e801bcc54ee21aaf4b9ec5f4839a2183ef661a837e39a99b57a8b1c77a702
projection_input_sha256: 0f33cdd5b8ebe797fd36d659e95434f6cd6d99ba4eaffb8e3ddb0284aa2ad521
---

# Treat medical danger or impaired capacity as a real-world safety problem

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

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

## Source navigation

[[current/sources/altered-states-map-source/ALT.TRIAGE]]

[[current/sources/altered-states-map-source/ALT.NO_RESCUE_IMPORT]]
