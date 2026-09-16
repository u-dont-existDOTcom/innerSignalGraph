---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: somatic-altered-guide-sync-20260916
operation: add
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.ALTERED_PREPARATION
title: Give planned altered-state work a beginning, support plan, and ending
kind: decision-node
tier: 3
priority: 97
authority: author-framework
graph_tags:
  - altered-state
  - preparation
  - consent
  - closure
source_refs:
  - ALT.PREPARATION
base_graph_sha256: 61db2ed53fe2c0eaa386328c1a52df3081f1c96c46771a327c431b16261a5396
base_projection_input_sha256: 2c8ca643504274023e49c647fbff143a6f02fe685ef935384c3c60c33b004fbb
---

# Give planned altered-state work a beginning, support plan, and ending

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "altered_phase",
        "op": "eq",
        "value": "planned"
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
      }
    ]
  },
  "avoid": [
    "Do not use ceremony planning once an acute crisis has started; return to acute triage instead.",
    "Do not make a sitter, playlist, spiritual frame, or expected insight into an authority the person cannot stop or change."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": []
  },
  "recommendations": [
    "Plan rest and timing, physical safety, environment, support, and what would require outside help before the session begins.",
    "Use intention without demanding a particular revelation, memory, emotional arc, or spiritual result; support stays low-directivity and consent-based.",
    "Plan closure, food and hydration when safe, sleep, and protected integration time rather than leaving the session psychologically open-ended."
  ],
  "successSignals": [
    "The session has clear safety, consent, stopping, closure, and integration boundaries before altered-state work begins."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
