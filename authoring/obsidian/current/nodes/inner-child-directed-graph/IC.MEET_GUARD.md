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
  - AMEND.CROSS.LITERATURE_TASK_PROGRESS
regression_refs:
  - G001
  - G002
  - G012
  - G029
  - G030
base_record_sha256: 3cd5ff6f433b3ce1c22c2e5c35c94b5cb1e8595096dc9082d58e2a31eb6e622f
base_graph_sha256: a82fe28e2917f3c301b588e770ee0e367ee56286abd94ed9cf4b37a34459fb08
projection_input_sha256: 1f98e966e76da6e426ced6cfc6e014ba9b97033cb71512468963415ca21e4169
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
    "deferralUnless": [
      {
        "field": "guard_engagement",
        "op": "eq",
        "value": "willing_to_allow"
      }
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
    "Ask what the part predicts will happen if it steps back; acknowledge before answering.",
    "A still-present protector may permit an agreed small step. Notice its current stance instead of requiring it to disappear, and recheck if permission is withdrawn. Presence alone does not prove continued blocking."
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

[[current/governance/amendments/AMEND.CROSS.LITERATURE_TASK_PROGRESS]]
