---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.MEET_GUARD
title: Meet the protective response before pushing deeper
kind: decision-node
tier: 3
priority: 93
authority: author-framework
graph_tags:
  - protector
  - guard
  - avoidance
source_refs:
  - IC.START_WHATEVER
  - IC.GUARDS
  - IC.BOTTOM_UP_SEQUENCE
  - IC.ESCAPE_URGE
regression_refs:
  - G001
  - G002
  - G012
base_record_sha256: 5081f590139bf4cd47892199051f1003a1d2f9a36dd313c18f502fe3fb3fff63
base_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6
projection_input_sha256: ebc5fac6453fa4eeabca95b87100a5e351d19e91770f5db7e7a86eab3749b4cb
---

# Meet the protective response before pushing deeper

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "protective_response",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "urge_to_escape",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "dissociation",
        "op": "in",
        "value": [
          "mild",
          "high"
        ]
      }
    ]
  },
  "avoid": [
    "Do not classify the voice more confidently than the transcript supports or push past it."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE"
    ],
    "forbiddenOverclaims": [
      "Do not definitively label a cynical voice as a guard."
    ],
    "requiredNuance": [
      "The contempt may be child, protector, adult evaluator, or blend."
    ]
  },
  "recommendations": [
    "Treat cynicism, numbness, anger, scrolling, substances, planning, sleep, or dissociation as information about what the system expects.",
    "Ask what the part predicts will happen if it steps back; acknowledge before answering."
  ],
  "successSignals": [
    "The protective response can be heard without running the session or being exiled."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/sources/inner-child-guide/IC.START_WHATEVER]]

[[current/sources/inner-child-guide/IC.GUARDS]]

[[current/sources/inner-child-guide/IC.BOTTOM_UP_SEQUENCE]]

[[current/sources/inner-child-guide/IC.ESCAPE_URGE]]
