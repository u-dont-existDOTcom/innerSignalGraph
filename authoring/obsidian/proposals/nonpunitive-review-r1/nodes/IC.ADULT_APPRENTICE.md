---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: nonpunitive-review-r1
operation: replace
graph_id: inner-child-directed-graph
node_id: IC.ADULT_APPRENTICE
title: Move from receiving care to doing five percent
kind: decision-node
tier: 4
priority: 86
authority: author-framework
graph_tags:
  - adult-apprentice
  - five-percent
  - relationship
source_refs:
  - IC.ADULT_APPRENTICE
  - IC.RELATIONSHIP
  - AMEND.IC.NONPUNITIVE_REVIEW
base_record_sha256: 4d9a03f5d84e4c1b5513ae0388739069f893801344a16925bbbf9cb6a5124cfa
base_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6
base_projection_input_sha256: e4e31e4dded7f0ec1f824717e405289f76163ca88db84795b2b1ceda149c7378
---

# Move from receiving care to doing five percent

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "all": [
      {
        "field": "inner_adult_access",
        "op": "in",
        "value": [
          "low",
          "partial"
        ]
      },
      {
        "field": "support_available",
        "op": "eq",
        "value": "present"
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
    "Do not create permanent authority dependency.",
    "Do not make review punitive, compulsive, or mandatory. Voluntary tracking or simple measurement is allowed when it genuinely supports learning rather than becoming self-surveillance."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": [
      "Review distinguishes accountability and learning from punishment or judgments about worth. Accountability may still include consequences, firmer boundaries, and an honest assessment of present capacity."
    ]
  },
  "recommendations": [
    "Name what the helper did, choose five percent to do personally, and test one action in ordinary life.",
    "Gradually hand the role back to the user.",
    "After attempting improved care, protection, or guidance for the inner child, notice without harsh judgment what felt right and what you could do better next time."
  ],
  "successSignals": [
    "One protective or nurturing act occurs without the helper present.",
    "The review yields clearer understanding and either one bounded repair or adjustment, or a clear conclusion that no change is needed, without materially escalating self-attack."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

D09 makes review critical without authorizing a new route or ritual. This node already owns learning from supported action and is therefore the narrowest place to add proportionate review after attempting improved care, protection, or guidance. Review is not required after every attempt, may conclude that nothing needs changing, and must not turn noticing into compulsory journaling, tracking, measurement, or self-surveillance. Voluntary tracking remains available when it genuinely supports learning.

## Regression intent

G013 must select this node, preserve witness capacity, carry the exact user-facing recommendation plus the backend accountability, capacity, non-compulsion, and no-change-needed distinctions, and avoid activating unrelated routes.
