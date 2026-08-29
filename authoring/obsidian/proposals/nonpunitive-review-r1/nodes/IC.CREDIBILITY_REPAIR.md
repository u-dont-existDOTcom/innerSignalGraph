---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: nonpunitive-review-r1
operation: replace
graph_id: inner-child-directed-graph
node_id: IC.CREDIBILITY_REPAIR
title: Repair credibility through non-defensive follow-through
kind: decision-node
tier: 3
priority: 96
authority: author-framework
graph_tags:
  - credibility
  - protector
  - repair
source_refs:
  - IC.PROTECTOR_VISIBLE
  - IC.VOW
  - IC.BOTTOM_UP_SEQUENCE
  - AMEND.IC.NONPUNITIVE_REVIEW
base_record_sha256: feff1a99edf74330f480df74c64d641813452d7eddb299e6b8e3c4a32a86ff23
base_graph_sha256: 4cffe0bcadbf49cc3e27dc5274221f51ec252a0226e944b4f5541dda47c6d1d6
base_projection_input_sha256: e4e31e4dded7f0ec1f824717e405289f76163ca88db84795b2b1ceda149c7378
---

# Repair credibility through non-defensive follow-through

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "credibility_conflict",
        "op": "eq",
        "value": "present"
      },
      {
        "field": "self_directed_love",
        "op": "eq",
        "value": "unsafe"
      }
    ]
  },
  "avoid": [
    "Do not substitute a grand vow for evidence or retaliate when the younger state is unimpressed.",
    "Do not use review to stage an internal trial or turn one lapse into a final verdict about worth or future capacity."
  ],
  "defaultQuestion": "",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not say the child is rejecting love when it may be rejecting an unsafe or unproven source.",
      "Do not describe the problem as simply lacking a track record when the user has already supplied adverse evidence about how things went."
    ],
    "requiredNuance": [
      "Action is essential but not the sole repair; accurate responsibility and non-defensive listening also matter.",
      "Relaxation may reduce nervous-system charge, but it does not by itself repair a credibility conflict or change a contradictory track record.",
      "The sarcastic question can be both contempt and a legitimate literal request for evidence; answer it concretely rather than arguing with it.",
      "A pre-existing adverse track record is different from having no track record yet.",
      "Missed promises are evidence to address through acknowledgement, repair, and changed behavior; kept promises and successful repairs are evidence too."
    ]
  },
  "recommendations": [
    "Hear the angry side's exact accusation before trying to resolve the conflict: what does it believe the younger version should have done, at what age, and with what available capacity?",
    "Treat skeptical or contemptuous questions as data and, when appropriate, literal requests for evidence.",
    "Distinguish no track record from an adverse track record. If the younger state is already pointing to how adult life turned out, credibility repair means building counterevidence against an existing negative assessment rather than acting as though evidence starts at zero.",
    "Make one ordinary protective act visible and do not demand gratitude, trust, or emotional change.",
    "Repair after internal attacks; make one protective act visible, demand no immediate trust, and keep showing up consistently.",
    "When a promise was missed, name it, repair what can be repaired, and make the next promise more credible rather than demanding acquittal or issuing a global verdict."
  ],
  "successSignals": [
    "Promises and actions begin to align; an adverse track record starts accumulating credible counterevidence without demanding immediate trust.",
    "Review tracks kept promises and completed repairs as evidence alongside lapses."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

D09 belongs here because this node already owns promises, counterevidence, repair, and repeated follow-through. The candidate adds balanced review of lapses, kept promises, and completed repairs without asking for acquittal or converting one miss into a verdict about worth or future capacity.

## Regression intent

Proposal-local replacements for G001 and G012 must preserve every existing credibility, age, speaker, adverse-record, and witness assertion while requiring acknowledgement, repair, changed behavior, and kept-promise/successful-repair evidence.
