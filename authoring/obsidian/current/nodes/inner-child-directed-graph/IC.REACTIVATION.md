---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.REACTIVATION
title: Re-enter inner-child work below the prior ceiling
kind: decision-node
tier: 3
priority: 99
authority: owner-approved-extension
graph_tags:
  - reactivation
  - reentry
  - continuity
  - consent
source_refs:
  - AMEND.IC.CONTINUITY_TITRATION
  - IC.BEFORE_DEEP
  - IC.SESSION_CLOSURE
regression_refs:
  - G066
  - G068
  - G069
  - G070
  - G079
  - G087
  - G088
base_record_sha256: 214ebf081e300b02b4ca61c1ef56f3ff09beb575f6020f6b2f6a0032a5a05856
base_graph_sha256: 4848af3f8e7938ad315a9a1b3e138768cd2d6a5d9c67530b520de13963130a83
projection_input_sha256: 354f6bae4ead288dbc25d78ee4550d529bfe6f19adf4b9ae8ff180b53acfd44f
---

# Re-enter inner-child work below the prior ceiling

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "ic_status",
        "op": "in",
        "value": [
          "stepped_down",
          "paused_tolerance",
          "paused_safety"
        ]
      },
      {
        "field": "ic_reactivation_ready",
        "op": "eq",
        "value": "yes"
      },
      {
        "field": "present_safety",
        "op": "eq",
        "value": "safe"
      },
      {
        "field": "orientation",
        "op": "eq",
        "value": "oriented"
      },
      {
        "field": "ability_to_stop",
        "op": "eq",
        "value": "yes"
      },
      {
        "field": "ability_to_return",
        "op": "eq",
        "value": "yes"
      }
    ],
    "none": [
      {
        "field": "ic_titration_needed",
        "op": "eq",
        "value": "yes"
      },
      {
        "field": "practice_challenge",
        "op": "eq",
        "value": "needs_check_in"
      }
    ]
  },
  "avoid": [
    "Do not reactivate inner-child framing after it has been declined.",
    "Do not jump from a safety or tolerance pause directly back to deep dialogue.",
    "Do not let reactivation tie or outrank a pending challenge check-in."
  ],
  "defaultQuestion": "Do you actually want to return to the inner-child work now, starting gentler than where it became too much?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE"
    ],
    "forbiddenOverclaims": [
      "Do not treat a cleared safety/tolerance trigger as proof that the previous depth is now appropriate."
    ],
    "requiredNuance": [
      "Re-entry requires the person's agreement and starts at or below the last tolerated level; deeper work earns its way back through new evidence."
    ]
  },
  "recommendations": [
    "Do not resume while a new titration need is active or a difficult inner-child episode still needs appraisal/recovery check-in; resolve that first.",
    "Confirm that the person wants to resume. Then re-enter at or below the last tolerated level rather than returning automatically to the earlier depth.",
    "Treat the first resumed contact as a calibration pass. Keep deep child dialogue deferred until the gentler level is again demonstrated as workable."
  ],
  "successSignals": [
    "The person resumes voluntarily at a gentler or previously tolerated level and can stop, return, recover, and function afterward."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.CONTINUITY_TITRATION]]

[[current/sources/inner-child-guide/IC.BEFORE_DEEP]]

[[current/sources/inner-child-guide/IC.SESSION_CLOSURE]]
