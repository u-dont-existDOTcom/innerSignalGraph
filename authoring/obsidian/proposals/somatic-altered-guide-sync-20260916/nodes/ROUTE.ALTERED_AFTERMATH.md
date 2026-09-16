---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: somatic-altered-guide-sync-20260916
operation: add
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.ALTERED_AFTERMATH
title: Integrate altered-state aftermath from facts toward meaning and small life changes
kind: decision-node
tier: 3
priority: 96
authority: author-framework
graph_tags:
  - altered-state
  - integration
  - aftermath
  - sleep
  - reality-testing
source_refs:
  - ALT.AFTERMATH
  - ALT.EPISTEMICS
base_graph_sha256: 61db2ed53fe2c0eaa386328c1a52df3081f1c96c46771a327c431b16261a5396
base_projection_input_sha256: 2c8ca643504274023e49c647fbff143a6f02fe685ef935384c3c60c33b004fbb
---

# Integrate altered-state aftermath from facts toward meaning and small life changes

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
        "value": "aftermath"
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
    "Do not recommend another psychedelic, cannabis, ketamine, intense breathwork, extreme fasting, sleep deprivation, extreme meditation/stretching, or another ceremony as the reflexive fix for ongoing destabilization.",
    "Do not treat one night’s certainty as a diagnosis, recovered fact, or permanent metaphysical conclusion."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not call persistent or dangerous symptoms a normal integration process without appropriate assessment."
    ],
    "requiredNuance": [
      "The public bad-trips guide can provide fuller reading, but referral never replaces current safety, medical, or professional support when those are needed."
    ]
  },
  "recommendations": [
    "Use sleep, food, water, warmth, routine, sober support, and ordinary contact before another ceremony or destabilizing practice.",
    "Record facts first—what was taken or practiced, timing when known, setting, events, triggers, what helped, and what worsened the state—then consider emotional, relational, spiritual, or practical meaning.",
    "Separate lingering anxiety, sleep disruption, derealization/depersonalization, visual symptoms, shame/social disconnection, existential shock, trauma material, psychosis-like beliefs, and somatic hyperarousal because they can require different support.",
    "Translate useful insight into small behavioral changes rather than measuring integration by how cosmic the explanation sounds."
  ],
  "successSignals": [
    "Ordinary functioning and sleep recover, facts and interpretations remain distinguishable, and any retained insight produces proportionate behavior rather than escalating practice."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
