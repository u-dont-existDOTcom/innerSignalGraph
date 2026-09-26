---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: somatic-altered-guide-sync-20260916
operation: add
graph_id: somatic-directed-graph
node_id: SOM.AQUATIC_BODYWORK
title: Use aquatic bodywork as an optional emotionally opening bridge with explicit aftercare
kind: decision-node
tier: 5
priority: 76
authority: author-framework
graph_tags:
  - aquatic-bodywork
  - water-therapy
  - consent
  - aftercare
source_refs:
  - SOM.AQUATIC
base_graph_sha256: 6b31d4e5d0e6dc2ab838aae714fe59c2c1c2ab21607409c9b1a25b2d5769dd2d
base_projection_input_sha256: 2c8ca643504274023e49c647fbff143a6f02fe685ef935384c3c60c33b004fbb
---

# Use aquatic bodywork as an optional emotionally opening bridge with explicit aftercare

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "aquatic_bodywork_interest",
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
      },
      {
        "field": "dissociation",
        "op": "eq",
        "value": "high"
      }
    ]
  },
  "avoid": [
    "Do not drop somebody into an intense water session cold, treat crying or regression-like feelings as proof of therapeutic success, or infer womb/childhood facts from the experience."
  ],
  "defaultQuestion": "If the session opens much more emotion than expected, what stopping, grounding, aftercare, and follow-up support will be available?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not call emotional opening, crying, felt regression, or unusual bodily experience evidence of recovered history or completed trauma processing."
    ],
    "requiredNuance": [
      "A provider should be able to answer what happens if the client leaves the session much more emotionally open than they entered."
    ]
  },
  "questionPolicy": {
    "purpose": "safety",
    "unresolvedFields": []
  },
  "recommendations": [
    "Before a water session, establish the person’s goal, comfort with water and touch, stopping signals, physical safety, and who can help if the session opens more emotion than expected.",
    "Keep touch and movement continuously consensual; warmth, buoyancy, supported movement, stretching, and holding may feel unusually young or vulnerable without proving literal regression or memory.",
    "Plan a deliberate return to ordinary body and present time afterward, with grounding, rest, gentle movement or massage if wanted, food or hydration when appropriate, and follow-up support for material that remains open."
  ],
  "successSignals": [
    "The person can enter and leave the experience with consent, orientation, and adequate support for what remains afterward."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
