---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: somatic-altered-guide-sync-20260916
operation: replace
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
base_graph_sha256: 6b31d4e5d0e6dc2ab838aae714fe59c2c1c2ab21607409c9b1a25b2d5769dd2d
base_projection_input_sha256: 2c8ca643504274023e49c647fbff143a6f02fe685ef935384c3c60c33b004fbb
base_record_sha256: c4d28d1685a405c1293aa34e0d62198c6855a73e9ed2756cea2dd30d1e986341
---

# Meaning-making after the body is less trapped in survival mode

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

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
