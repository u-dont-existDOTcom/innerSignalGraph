---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: somatic-altered-guide-sync-20260916
operation: add
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.ALTERED_ACTION_LOCK
title: Delay consequential action during intense certainty or pressure
kind: decision-node
tier: 2
priority: 98
authority: author-framework
graph_tags:
  - altered-state
  - action-lock
  - grandiosity
  - epistemic
source_refs:
  - ALT.ACTION_LOCK
  - ALT.EPISTEMICS
base_graph_sha256: 61db2ed53fe2c0eaa386328c1a52df3081f1c96c46771a327c431b16261a5396
base_projection_input_sha256: 2c8ca643504274023e49c647fbff143a6f02fe685ef935384c3c60c33b004fbb
---

# Delay consequential action during intense certainty or pressure

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "altered_state",
        "op": "eq",
        "value": "altered"
      },
      {
        "field": "altered_action_pressure",
        "op": "eq",
        "value": "present"
      }
    ]
  },
  "avoid": [
    "Do not encourage driving, redosing, public posting, confrontation, accusation, confession, major purchases or gifts, sexual boundary changes, relationship endings, travel, or attempts to prove a revelation while judgment is altered."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not say the revelation is false merely because action is being postponed; the claim remains open to sober review."
    ],
    "requiredNuance": [
      "Euphoric certainty can carry more behavioral risk than fear because the person may feel no need to ground."
    ]
  },
  "recommendations": [
    "Write consequential ideas down and postpone major or irreversible action until after sleep, food, and sober review with a grounded person.",
    "Treat visions, entities, apparent memories, cosmic conclusions, and mission-like certainty as experience-content before treating them as fact-content or commands.",
    "Keep non-harm and consent authoritative even when the experience feels blissful, sacred, urgent, or absolutely certain."
  ],
  "successSignals": [
    "The person preserves the insight for later review without converting urgency into an irreversible action."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
