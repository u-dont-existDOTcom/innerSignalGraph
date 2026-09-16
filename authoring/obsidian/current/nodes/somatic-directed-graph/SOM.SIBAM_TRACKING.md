---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.SIBAM_TRACKING
title: Track sensation, image, behavior, affect, and meaning without privileging one channel
kind: decision-node
tier: 4
priority: 79
authority: author-framework
graph_tags:
  - SIBAM
  - multimodal-experience
  - meaning
  - epistemic
source_refs:
  - SOM.SIBAM
  - SOM.INTEGRATION
regression_refs:
  - G027
base_record_sha256: 3276fcad13ef3f0c9984a36dccfa5da18dd4d5546d0bed446d18223c5fd6a647
base_graph_sha256: 5353c44e3a61ef4c93660b66fcf57ad87b064c417c8413c45213f68306a6dd18
projection_input_sha256: 0f33cdd5b8ebe797fd36d659e95434f6cd6d99ba4eaffb8e3ddb0284aa2ad521
---

# Track sensation, image, behavior, affect, and meaning without privileging one channel

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "current_intent",
        "op": "eq",
        "value": "gentle_practice"
      },
      {
        "field": "target_type",
        "op": "in",
        "value": [
          "developmental",
          "diffuse"
        ]
      },
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
      }
    ]
  },
  "avoid": [
    "Do not infer a hidden memory, diagnosis, or external fact from a bodily response, image, gesture, or felt gestalt.",
    "Do not invent an automatic sentence when the person reports that no words were present."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not claim that nonverbal, somatic, earlier, intuitive, or intense material is inherently more authentic than language or analysis."
    ],
    "requiredNuance": [
      "SIBAM is an attention map, not a claim that sensation precedes words or has greater truth value."
    ]
  },
  "recommendations": [
    "Use the SIBAM channels—sensation, image, behavior/action tendency, affect, and meaning—as an attention map when one channel is absent, disconnected, or monopolizing the experience.",
    "Keep directly noticed phenomenology separate from the appraisal built from it; actual inner words, later verbal translation, imagery, bodily sensation, emotion, and action tendency may overlap without being interchangeable.",
    "Bring language, evidence analysis, and present-day action back in whenever they improve clarity or agency rather than assuming bottom-up material is automatically deeper or truer."
  ],
  "successSignals": [
    "Previously disconnected channels become more distinguishable and usable without forcing one representation to dominate.",
    "The person can examine meaning and evidence while remaining in contact with embodied experience."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.SIBAM]]

[[current/sources/somatic-sequencing-guide/SOM.INTEGRATION]]
