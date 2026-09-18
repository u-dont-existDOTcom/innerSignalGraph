---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: protective-compatibility-20260918
operation: add
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.HUMAN_CARE_BRIDGE
title: Support appropriate real human care
kind: decision-node
tier: 2
priority: 85
authority: author-framework
graph_tags:
  - protective-compatibility
  - present-focused-adult
source_refs:
  - AMEND.CROSS.HUMAN_CARE_NONCOLLUSION
  - AMEND.CROSS.COMPATIBILITY_EVIDENCE_REENTRY
base_graph_sha256: 527e801bcc54ee21aaf4b9ec5f4839a2183ef661a837e39a99b57a8b1c77a702
base_projection_input_sha256: c395cbc9b5c7256d6de8dfcb67f0addf5299011e03d983481822fc37bef56799
---

# Support appropriate real human care

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "compatibility_route",
        "op": "eq",
        "value": "human_support"
      }
    ]
  },
  "avoid": [
    "Do not introduce or address an imagined younger self, proxy child, internal guardian or a childhood scene.",
    "Do not teach intimidation, exploitation, harmful empathy use, or avoidance of accountability.",
    "Do not infer protective capacity, clinical improvement or eligibility from correct words, praise or a promise."
  ],
  "defaultQuestion": "Would being heard by a real person be more useful than another exercise right now?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not call this a proven treatment for psychopathy or a validated assessment of dangerousness.",
      "Do not interpret engagement, reported restraint, conversion or an agreement as permission to resume child contact."
    ],
    "requiredNuance": [
      "Keep this work in the present adult perspective; no direct or indirect child-contact invitation while the shared restriction applies.",
      "A religious identity is not evidence of harmful intention. Respect the actual source context and existing independent threat assessment.",
      "The next useful job is selected from evidence and agreement, not from traversing every node in a diagram."
    ]
  },
  "recommendations": [
    "Recognize when being heard by an appropriate real person is more useful than another exercise.",
    "Offer help considering a qualified professional or suitable trusted adult without using targets as support, promising outcomes, or sending private information without consent."
  ],
  "successSignals": [
    "A suitable human-support preference or barrier is identified; no actual contact or successful referral is claimed without evidence."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
