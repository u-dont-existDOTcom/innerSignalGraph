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
    "Do not turn review into prosecution, grading, a trial, or a mandatory morning/evening ritual."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": [
      "Review distinguishes accountability and learning from punishment or a verdict on intrinsic worth."
    ]
  },
  "recommendations": [
    "Name what the helper did, choose five percent to do personally, and test one action in ordinary life.",
    "Gradually hand the role back to the user.",
    "After an ordinary-life attempt, review what was recognized, what was repaired, which promises were kept or missed, and one thing to change next."
  ],
  "successSignals": [
    "One protective or nurturing act occurs without the helper present.",
    "The review yields one specific repair or next adjustment without escalating self-attack."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

D09 makes review critical without authorizing a new route or ritual. This node already owns learning from supported action and is therefore the narrowest place to add a post-attempt review that notices both kept and missed promises and ends in one adjustment. The main risk is turning accountability into punishment or a verdict on worth.

## Regression intent

G013 must select this node, preserve witness capacity, carry the new accountability-versus-punishment nuance, and retain kept promises, repair, and one next adjustment without activating unrelated routes.
