---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: protective-compatibility-20260918
operation: add
graph_id: inner-child-somatic-cross-guide
node_id: ROUTE.HELP_SEEKING
title: Establish the help the person wants and a safe shared goal
kind: decision-node
tier: 3
priority: 100
authority: author-framework
graph_tags:
  - protective-compatibility
  - present-focused-adult
source_refs:
  - AMEND.CROSS.HELP_SEEKING_IDENTITY_INQUIRY
  - AMEND.CROSS.HUMAN_CARE_NONCOLLUSION
base_graph_sha256: 527e801bcc54ee21aaf4b9ec5f4839a2183ef661a837e39a99b57a8b1c77a702
base_projection_input_sha256: c395cbc9b5c7256d6de8dfcb67f0addf5299011e03d983481822fc37bef56799
---

# Establish the help the person wants and a safe shared goal

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
        "value": "help_seeking"
      }
    ]
  },
  "avoid": [
    "Do not introduce or address an imagined younger self, proxy child, internal guardian or a childhood scene.",
    "Do not teach intimidation, exploitation, harmful empathy use, or avoidance of accountability.",
    "Do not infer protective capacity, clinical improvement or eligibility from correct words, praise or a promise."
  ],
  "defaultQuestion": "What are you hoping for from this conversation—what hurts, or what would you like to be different?",
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
    "Listen for the person's desired help, cost, uncertainty, prevention goal or wish to be heard.",
    "Do not require a confession of suffering, moral conversion or an empathic performance; distinguish a safe goal from a request to exploit others."
  ],
  "successSignals": [
    "A safe desired outcome is identified, or lack of goal overlap is acknowledged without invented motivation."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Explain why the change is needed, what behavior it should alter, and the worst plausible failure. This prose is review evidence, not executable graph content.

## Regression intent

List the existing or proposed regression cases that should distinguish the old and new behavior.
