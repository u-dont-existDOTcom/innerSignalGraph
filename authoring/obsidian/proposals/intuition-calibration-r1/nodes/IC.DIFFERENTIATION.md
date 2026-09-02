---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: intuition-calibration-r1
operation: replace
graph_id: inner-child-directed-graph
node_id: IC.DIFFERENTIATION
title: Untangle belonging from self-betrayal
kind: decision-node
tier: 6
priority: 65
authority: author-framework
graph_tags:
  - differentiation
  - belonging
  - identity
source_refs:
  - IC.DIFFERENTIATION
base_record_sha256: 3787bf0c21cfe4a805a6b5e53821396576cdb3b6e34eb45d0774151806cca797
base_graph_sha256: e2532806378ef613edac19a9eacbe57653b21a4061a2b9f393bb54d1fa30ff2d
base_projection_input_sha256: 0f787fed212f0e7bf6a0201fd36f1c6f0b3f1189425f42a1db02e96ca90501a8
---

# Untangle belonging from self-betrayal

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "belonging_pressure",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "identity_blur",
        "op": "eq",
        "value": "present"
      }
    ]
  },
  "avoid": [
    "Do not equate differentiation with isolation or automatic permanent cutoff."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Notice where other people’s emotions and group expectations replace personal knowing.",
    "Practice selective belonging, disagreement, and leaving when staying requires disappearance."
  ],
  "successSignals": [
    "The person remains recognizably themselves across settings."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
