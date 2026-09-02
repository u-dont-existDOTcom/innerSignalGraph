---
authoring_contract: inner-signal-authoring-node-proposal-v1
entity_type: graph-node-proposal
proposal_id: intuition-calibration-r1
operation: add
graph_id: inner-child-directed-graph
node_id: IC.INTUITION_TRUST_CALIBRATION
title: Make intuition and analysis correct each other before trust transfers
kind: decision-node
tier: 2
priority: 100
authority: author-framework
graph_tags:
  - intuition
  - epistemic-trust
  - external-guide
  - protector
  - differentiation
source_refs:
  - AMEND.IC.INTUITION_ANALYTIC_INTEGRATION
  - AMEND.IC.EXTERNAL_GUIDE_SMART_MANIPULATION
  - IC.GUIDE_LATER
  - IC.DIFFERENTIATION
base_graph_sha256: e2532806378ef613edac19a9eacbe57653b21a4061a2b9f393bb54d1fa30ff2d
base_projection_input_sha256: 0a2eab73975fed08839da48a4c3cbf02cc547fbed3b33b618b5a6afcdef832f3
---

# Make intuition and analysis correct each other before trust transfers

> [!warning] Editable proposal record. Building it never changes canonical graph files.

## Structured graph payload

<!-- inner-signal:payload:start -->
```json
{
  "activation": {
    "any": [
      {
        "field": "intuition_evidence_alignment",
        "op": "in",
        "value": ["mixed", "contradictory"]
      },
      {
        "field": "epistemic_mode_balance",
        "op": "in",
        "value": ["intuitive_overrides_analytic", "analytic_overrides_intuitive", "oscillating"]
      },
      {
        "field": "external_authority_pull",
        "op": "in",
        "value": ["elevated", "strong"]
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
    "Do not teach that intuition, mystical cognition, humor, spontaneity, compassion, attraction, or spiritual gifts are inherently untrustworthy.",
    "Do not make analytical cognition the sole authority or treat every contradiction, confession, or influence cue as proof that another person is malicious or manipulative.",
    "Do not literalize the intuitive/analytic distinction as a simplistic left-brain/right-brain anatomy claim.",
    "Do not recommend automatic cutoff merely because trust is unresolved; slow consequential transfers while evidence is being calibrated."
  ],
  "defaultQuestion": "What exactly is your intuition telling you, what evidence supports or contradicts that conclusion, and what evidence would actually lower your trust?",
  "effects": {
    "blockNodes": [],
    "deferNodes": [],
    "forbiddenOverclaims": [
      "Do not say a strong intuitive click proves trustworthiness or that a suspicious feeling proves danger.",
      "Do not say admitting dishonesty, danger, manipulation, addiction, or another flaw makes the current risk disappear merely because the admission sounds self-aware.",
      "Do not generalize one true teaching, healing result, beautiful voice, spiritual gift, confession, or accurate intuitive hit into global authority."
    ],
    "requiredNuance": [
      "Intuitive, gestalt, affective, mystical, and subconscious cognition can surface real pattern information that analysis has not consciously assembled; analytical, propositional cognition checks contradiction, track record, scope, and falsifiability. Neither receives unilateral control in a high-stakes trust decision.",
      "Separate the raw signal from the proposition inferred from it: feeling seen, safe, fascinated, compassionate, attracted, spiritually opened, amused, or deeply resonant is real data without by itself proving 'therefore this person is trustworthy.'",
      "Open confession can be genuine self-awareness and simultaneous evidence that the confessed problem currently exists. 'I am working on it' is not the same as a repaired track record.",
      "Humor and half-jokes may legitimately relieve pressure and expand perspective; when a joke also carries a consequential factual claim, request, permission, boundary move, or authority transfer, test that content as if it had been said plainly.",
      "Trust is domain-specific and corrigible: what matters is whether track record, contradictions, boundaries, response to disagreement or no, and new evidence can still update the conclusion."
    ]
  },
  "recommendations": [
    "Name the felt/intuitive signal without arguing it away, then state separately the factual or trust conclusion being drawn from it.",
    "Inventory direct observations, relevant track record, contradictions, domain-specific competence, and what happens when the person is disagreed with, refused, delayed, or denied special status.",
    "Notice influence hooks without diagnosing the other person: praise or specialness, mirroring, pity for a wounded healer, rescue or miracle hopes, attraction, belonging, fear, spiritual charisma, hypnotic or mystical ease, confession, and humor can all change how evidence is weighted.",
    "Ask whether compassion is preserving the facts or erasing them. A wounded person can deserve compassion while still being unsafe or unreliable in a particular domain.",
    "Use prediction → observation → update: state what trustworthy and untrustworthy behavior would each predict, watch what actually happens, and let the result change trust rather than protecting the original intuition.",
    "When intuition and evidence seriously conflict, do not increase high-leverage authority while the conflict is unresolved. Keep money, medical decisions, sexual consent, isolation, legal control, altered-state dependence, and exclusive spiritual authority especially answerable to ordinary evidence."
  ],
  "successSignals": [
    "The person can preserve useful intuitive information and analytical checking at the same time, distinguish resonance from proof, and allow new evidence to raise or lower domain-specific trust."
  ]
}
```
<!-- inner-signal:payload:end -->

## Proposal rationale

The existing map limits explicit authority transfer but does not directly model the more subtle state in which externally shaped trust is experienced as the user’s own intuition. This node protects both cognitive resources: it prevents intuitive charisma from erasing contradictions and prevents analytical hypervigilance from suppressing useful gestalt information.

## Regression intent

G027, G028, G031, and G032 exercise evidence-overriding authority patterns. G029 proves aligned intuition is not pathologized. G030 proves the calibration is symmetrical when analysis suppresses relevant intuitive information.
