---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: intuition-calibration-r1
operation: replace
graph_id: inner-child-directed-graph
node_id: IC.BORROW_ONE_FUNCTION
title: Borrow one bounded adult function
kind: decision-node
tier: 3
priority: 94
authority: author-framework
graph_tags:
  - borrowed-adulthood
  - nurturer
  - protector
  - guide
  - adult-side-borrowing
source_refs:
  - IC.BORROW_ONE_FUNCTION
  - IC.ADULT_APPRENTICE
  - AMEND.IC.EXTERNAL_GUIDE_SMART_MANIPULATION
base_record_sha256: 11f21fa8d4679e259279acbf9a15ffb60035cacb540b19a8f539985730b106a2
base_graph_sha256: e2532806378ef613edac19a9eacbe57653b21a4061a2b9f393bb54d1fa30ff2d
base_projection_input_sha256: 0a2eab73975fed08839da48a4c3cbf02cc547fbed3b33b618b5a6afcdef832f3
---

# Borrow one bounded adult function

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "inner_adult_access",
        "op": "in",
        "value": ["low", "partial", "unknown"]
      },
      {
        "field": "parent_imagery",
        "op": "in",
        "value": ["critical", "frightening", "blank"]
      },
      {
        "field": "self_directed_love",
        "op": "in",
        "value": ["unsafe", "inaccessible"]
      }
    ],
    "none": [
      {"field": "present_safety", "op": "eq", "value": "unsafe"},
      {"field": "orientation", "op": "eq", "value": "disoriented"}
    ]
  },
  "avoid": [
    "Do not demand an ideal parent image or let the helper become authority over memories, medicine, relationships, spiritual conclusions, or future.",
    "Do not generalize one admirable function, true teaching, healing result, or spiritual gift into global trustworthiness."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": ["IC.DEEP_CHILD_DIALOGUE"],
    "forbiddenOverclaims": [
      "Do not claim the inner adult has already been built."
    ],
    "requiredNuance": [
      "Adult identity may form after behavior.",
      "Borrowed adulthood can support the part attempting the adult role, not only the younger state.",
      "Borrow only in the domain and dose the source’s track record has earned; competence or warmth in one domain does not silently transfer authority to another."
    ]
  },
  "recommendations": [
    "Borrow one narrow function—warmth, protection, or direction—from a safe person, figure, plan, value, or ordinary action.",
    "Keep it bounded, observable, returnable, and limited to the domain in which the source has actually shown useful competence or care.",
    "When the part attempting the adult role becomes resentful, defensive, or retaliatory, borrow one non-retaliatory adult response for that side too—for example, how a decent adult would hear contempt without arguing its own goodness."
  ],
  "successSignals": [
    "The person can perform one adult function without pretending the whole role or the source’s wider authority is available."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Borrowed adulthood already limits explicit authority transfer. This amendment makes the limit domain-specific so a helpful or gifted source cannot silently become a global Guide.

## Regression intent

G027, G028, and G032 exercise cases where an external source has genuine gifts or partial self-awareness while trust remains evidence-dependent.
