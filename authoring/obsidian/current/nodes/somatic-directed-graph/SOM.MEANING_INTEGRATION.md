---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.MEANING_INTEGRATION
title: Meaning-making after the body is less trapped in survival mode
kind: decision-node
tier: 7
priority: 58
authority: author-framework
graph_tags:
  - integration
  - meaning
  - CBT
source_refs:
  - SOM.PHASE5
  - SOM.INTEGRATION
  - SOM.JUDGE_HELP
  - SOM.SIBAM
regression_refs:
  - G010
base_record_sha256: f2ba3c47269444c5ea9d4860c14ecbc7f3c5a39c19faac80041ab5a64a39cbad
base_graph_sha256: 5353c44e3a61ef4c93660b66fcf57ad87b064c417c8413c45213f68306a6dd18
projection_input_sha256: 0f33cdd5b8ebe797fd36d659e95434f6cd6d99ba4eaffb8e3ddb0284aa2ad521
---

# Meaning-making after the body is less trapped in survival mode

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
        "value": "integration"
      },
      {
        "field": "guide_readiness",
        "op": "eq",
        "value": "present"
      }
    ],
    "none": [
      {
        "field": "activation",
        "op": "eq",
        "value": "high"
      },
      {
        "field": "orientation",
        "op": "eq",
        "value": "disoriented"
      }
    ]
  },
  "avoid": [
    "Do not try to think the body out of an active survival state.",
    "Do not challenge a therapist-created sentence as though it were a literal automatic thought when the person reports that the original experience was not verbal.",
    "Do not keep the person in sensation when analysis, evidence checking, boundary decisions, or practical action would add useful information."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": [
      "Nonverbal is not deeper or truer, and verbal analysis is not merely intellectualization; the useful route is the combination that increases accuracy, agency, and integration."
    ]
  },
  "recommendations": [
    "Revisit beliefs, identity, boundaries, relationships, and the meaning of what happened once enough regulation exists to think without simply overriding the body.",
    "Use language as an analytic tool even when the original experience was nonverbal: distinguish direct experience, later verbal translation, appraisal, evidence, alternatives, and present-day action.",
    "Cognitive integration may follow bottom-up work or occur concurrently when it helps; do not require a universal body-first sequence."
  ],
  "successSignals": [
    "Meaning-making improves life participation rather than becoming another processing project."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.PHASE5]]

[[current/sources/somatic-sequencing-guide/SOM.INTEGRATION]]

[[current/sources/somatic-sequencing-guide/SOM.JUDGE_HELP]]

[[current/sources/somatic-sequencing-guide/SOM.SIBAM]]
