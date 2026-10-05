---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.BYPASS_AUDIT
title: Audit bliss and state shifts for trauma bypass
kind: decision-node
tier: 4
priority: 85
authority: author-framework
graph_tags:
  - bypass
  - bliss
  - integration
source_refs:
  - SOM.JUDGE_HELP
  - AMEND.SOM.ADVANCED_RELEASE_BYPASS
regression_refs:
  - G006
  - G007
  - G009
base_record_sha256: da375ab9cca81301abfb3c1e1209842d2f21eb894ba1b3a2a4e8fb0a11354609
base_graph_sha256: e498876bf5106a5742a4b66be29c7a78a766034320bf3c5a402704aeedf6bd71
projection_input_sha256: 61a6f2bc0a4901a995b341b8e10f0a2d918b76e60ce795da05c2e83e93b98ec8
---

# Audit bliss and state shifts for trauma bypass

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "bypass_risk",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "advanced_release_interest",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "altered_state",
        "op": "eq",
        "value": "altered"
      }
    ]
  },
  "avoid": [
    "Do not treat bliss, intensity, or temporary relief as proof that trauma was processed."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Judge the practice by later sleep, relationships, functioning, boundaries, willingness to meet pain, and whether it replaces practical or relational work."
  ],
  "successSignals": [
    "The practice supports rather than replaces contact with the actual issue."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.JUDGE_HELP]]

[[current/governance/amendments/AMEND.SOM.ADVANCED_RELEASE_BYPASS]]
