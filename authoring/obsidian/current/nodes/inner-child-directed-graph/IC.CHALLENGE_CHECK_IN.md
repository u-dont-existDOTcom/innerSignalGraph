---
authoring_contract: inner-signal-authoring-node-current-v1
entity_type: graph-node
projection_mode: current
generated: true
graph_id: inner-child-directed-graph
node_id: IC.CHALLENGE_CHECK_IN
title: Check how difficult material landed before choosing depth
kind: decision-node
tier: 3
priority: 99
authority: owner-approved-extension
graph_tags:
  - challenge
  - check-in
  - recovery
  - dreams
source_refs:
  - AMEND.IC.SCAFFOLDED_CHALLENGE
  - IC.SESSION_CLOSURE
regression_refs:
  - G066
  - G069
  - G070
  - G074
  - G088
base_record_sha256: 514fad7c3d0c8ec88e3f9f63a8434857c94b0ec73f221b1c6d2377b77d3db8be
base_graph_sha256: 2dbd3b3481a9dfef47b6259ade2306e453b40983020854f05beff9378fc6946f
projection_input_sha256: 03877676575df786d8b0bffbf65e1533a458131560c4f5e43a5536fd5e850bbe
---

# Check how difficult material landed before choosing depth

> [!warning] Generated current-state projection — do not edit. Create a proposal from this node.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "practice_challenge",
        "op": "eq",
        "value": "needs_check_in"
      },
      {
        "field": "practice_challenge_domain",
        "op": "eq",
        "value": "inner_child"
      }
    ],
    "none": [
      {
        "field": "ic_status",
        "op": "eq",
        "value": "declined"
      }
    ]
  },
  "avoid": [
    "Do not infer workable challenge from intact in-session capacity alone.",
    "Do not infer harm from a difficult dream or emotion alone."
  ],
  "defaultQuestion": "How did that experience land for you—and since then, have you recovered normally enough that you actually want to go back toward it?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [
      "IC.DEEP_CHILD_DIALOGUE"
    ],
    "forbiddenOverclaims": [
      "Do not claim that a difficult dream proves either therapeutic progress or historical truth."
    ],
    "requiredNuance": [
      "When difficult material has appeared but appraisal or recovery is unknown, ask first and defer deeper work."
    ]
  },
  "recommendations": [
    "Before deciding whether to deepen or step down, ask how the difficult material landed, whether the person wants to return to it, and how sleep, recovery, and ordinary functioning have been since.",
    "Assume neither harm nor growth while appraisal, willingness, or delayed recovery remains unknown."
  ],
  "successSignals": [
    "The next depth decision is based on the person's appraisal, willingness, and recovery rather than pleasantness or intensity alone."
  ]
}
```
<!-- inner-signal:payload:end -->

## Source navigation

[[current/governance/amendments/AMEND.IC.SCAFFOLDED_CHALLENGE]]

[[current/sources/inner-child-guide/IC.SESSION_CLOSURE]]
