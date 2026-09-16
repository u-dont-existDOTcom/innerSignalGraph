---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
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
regression_refs: []
base_record_sha256: 8dac161105fa038af3b7278cceb00fc5e100f1df62c7381d203ed933a96d9ec7
base_graph_sha256: 5353c44e3a61ef4c93660b66fcf57ad87b064c417c8413c45213f68306a6dd18
projection_input_sha256: 0f33cdd5b8ebe797fd36d659e95434f6cd6d99ba4eaffb8e3ddb0284aa2ad521
---

# Use aquatic bodywork as an optional emotionally opening bridge with explicit aftercare

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

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

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.AQUATIC]]
