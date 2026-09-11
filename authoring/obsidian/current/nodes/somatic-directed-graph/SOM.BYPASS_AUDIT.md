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
base_graph_sha256: 6b31d4e5d0e6dc2ab838aae714fe59c2c1c2ab21607409c9b1a25b2d5769dd2d
projection_input_sha256: 57beb002b0750fd8df8adc9b5edc7d957f9398b619607a883ab9b76c7cf11778
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
