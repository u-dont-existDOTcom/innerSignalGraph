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
base_graph_sha256: 5f2387789deec1cc04e6d7ff0f1a66b455472b1dccdf6cb3cb5afc0707ba47fc
projection_input_sha256: d807775fcdfe2d3cd1ab0a040505f4c1e14aba98e39945a00dffa26a60306034
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
