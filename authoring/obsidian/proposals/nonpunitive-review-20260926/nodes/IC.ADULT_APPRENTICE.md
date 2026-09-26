---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: nonpunitive-review-20260926
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
  - AMEND.IC.EXTERNAL_GUIDE_SMART_MANIPULATION
  - AMEND.CROSS.LITERATURE_ACTION_REVIEW
  - AMEND.IC.EMOTIONAL_TASK_GUIDANCE
  - IC.BORROW_ADULT
  - IC.BORROW_ONE_FUNCTION
  - IC.SPIRITUAL_LOAN
  - AMEND.IC.NONPUNITIVE_REVIEW
base_record_sha256: 7ccd6c9b9d04802f83fbce29a100398e1a47185eaeab82e721309a8a988cd2e3
base_graph_sha256: 55369c75e95b5cc9fc32c807f7b47bef411acf3aedcbe895076fbb796d04a0c4
base_projection_input_sha256: 456d7539d0ac59e9a20a4c08179a8856ead6d3e863fb63b4915b9f98fd401e78
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
    "Do not create permanent practical or epistemic authority dependency.",
    "Do not make review punitive, compulsive, or mandatory. Voluntary tracking or simple measurement is allowed when it genuinely supports learning rather than becoming self-surveillance."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [],
    "requiredNuance": [
      "The helper hands back judgment as well as behavior; successful apprenticeship should make independent checking easier rather than making the helper harder to question.",
      "Receiving support is not the endpoint: the sequence is receive care, observe care, participate in care, initiate a small part, and internalize what proves usable.",
      "The adult function can become real through ordinary action before it feels like a stable identity.",
      "Review distinguishes accountability and learning from punishment or judgments about worth. Accountability may still include consequences, firmer boundaries, and an honest assessment of present capacity."
    ]
  },
  "recommendations": [
    "Name what the helper did, choose five percent to do personally, and test one action in ordinary life.",
    "Gradually hand the role and the judgment behind it back to the person so they become more able to check, disagree, revise, and act without the helper.",
    "Name what capacity the person exercised, what help remained useful, and what the real-world attempt taught them; independence does not require refusing appropriate support. Care includes interest and delight, not duty alone, and should support exploration outside the exercise.",
    "Carry the borrowed function into one ordinary-life act that the person initiates, then review what it actually contributed rather than treating completion alone as success.",
    "Keep outside support available when useful while returning authorship, judgment, disagreement, and revision to the person.",
    "After attempting improved care, protection, or guidance for the inner child, notice without harsh judgment what felt right and what you could do better next time."
  ],
  "successSignals": [
    "One protective or nurturing act occurs without the helper present, and the person can evaluate the helper without needing the helper’s permission.",
    "The person can initiate a small caring/protective act and evaluate whether it helped without handing the helper permanent authority.",
    "The review yields clearer understanding and either one bounded repair or adjustment, or a clear conclusion that no change is needed, without materially escalating self-attack."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

Owner decision D09 (approved 2026-08-29; reaffirmed 2026-09-26: "yes that is important") makes review after an attempt at improved care, protection, or guidance part of apprenticeship. The additions are the owner-revised exact wording from the D09 review: one user-facing recommendation, one avoid constraint, one success signal, and one required nuance. Existing #80 apprenticeship content is preserved unchanged; the new entries are appended.

## Regression intent

G039 selects this node with witness capacity present and asserts the accountability-versus-punishment nuance. Canonical G001/G012 must remain green.
