---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: somatic-directed-graph
node_id: SOM.ADVANCED_RELEASE_OPTIONAL
title: Optional advanced release for a stable, informed person
kind: decision-node
tier: 5
priority: 64
authority: author-framework
graph_tags:
  - advanced-release
  - optional
  - provenance
source_refs:
  - SOM.ADVANCED_RELEASE_SOURCE
  - VAGAL.SAFETY.P5
  - AMEND.SOM.ADVANCED_RELEASE_PARALLEL
  - AMEND.EVIDENCE.PROVENANCE
regression_refs:
  - G006
  - G007
base_record_sha256: cdf2d671e8e5672cd396102867d321516e9b93b3a2a3a722cebca64db6b2efb8
base_graph_sha256: f7acff85e9d11d38c1fd47830f4fad4998cc1fb1580f641223a6d92538e30140
projection_input_sha256: c5c4aed6b8851992ca36c580a60360aeef78931bfaf972429487e3d3143f8084
---

# Optional advanced release for a stable, informed person

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "advanced_release_interest",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "stable_for_advanced_release",
        "op": "eq",
        "value": "yes"
      }
    ],
    "none": [
      {
        "field": "advanced_release_physical_risk",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "panic_instability",
        "op": "eq",
        "value": "present"
      }
    ]
  },
  "avoid": [
    "Do not chase loss of consciousness, use while standing once lightheaded, combine with substances, or interpret bliss as trauma resolution."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Treat Sky Hypnosis and Vagal Blitz as optional advanced state-shift practices that may occur early, not as prerequisites or proof of readiness.",
    "Use the least intense version that produces a useful shift; preserve stopping, orientation, and ordinary recovery.",
    "Present physiological explanations and efficacy claims as author experience or provisional mechanism, not settled fact."
  ],
  "successSignals": [
    "The practice increases later capacity and functioning without compulsion or bypass."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/somatic-sequencing-guide/SOM.ADVANCED_RELEASE_SOURCE]]

[[current/sources/vagal-blitz-source/VAGAL.SAFETY.P5]]

[[current/governance/amendments/AMEND.SOM.ADVANCED_RELEASE_PARALLEL]]

[[current/governance/amendments/AMEND.EVIDENCE.PROVENANCE]]
