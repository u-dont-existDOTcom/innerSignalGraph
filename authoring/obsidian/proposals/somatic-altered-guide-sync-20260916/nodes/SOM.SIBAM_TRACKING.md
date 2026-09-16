---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: somatic-altered-guide-sync-20260916
operation: add
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
base_graph_sha256: 6b31d4e5d0e6dc2ab838aae714fe59c2c1c2ab21607409c9b1a25b2d5769dd2d
base_projection_input_sha256: 2c8ca643504274023e49c647fbff143a6f02fe685ef935384c3c60c33b004fbb
---

# Track sensation, image, behavior, affect, and meaning without privileging one channel

> [!warning] Editable proposal record. Building it never changes canonical graph files.

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

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
