# Proposed minimal edits — ordinary wants, Inner Brat, and illness attribution

**Date:** 2026-10-19
**Status:** PROPOSED ONLY. **No graph, map, runtime rule, guide, or queue has been edited or approved.**
**Owner request:** After the primary-reading correction on Capacchione's Inner Brat and medical claims, propose the smallest additions to the InnerSignal therapy map and public guide.

## Current source baseline, directly checked

- Lucia Capacchione (1991 original), *Recovery of Your Inner Child*, Ch.4 pp. ~108–111 (“The Inner Brat” / “Healing from the Inner Brat”). Main distinction: acknowledge even childish or selfish wants, but don't give the impulse control over behavior or others. Her suggested causal links between suppressed anger and medical disease are **unproven**, and readers who say she literally claims “all illness is psychosomatic” overstate her words. Primary book is uploaded in the chat, not distributed here.
- Runtime served InnerSignal protocol **v0.2.1**, SHA `1da3ddf06a27aa8409fe953f21e8d9053d943bf383c04d5c561e2e93bb067a27`. It already distinguishes urges from intent/identity, bodily signals from interpreted explanations, reparenting from an exercise, protective behavior from outside services, and current harmful intent from merely unwanted thoughts.
- InnerSignal canonical graph source is **`guide-graphs/candidates/*.graph.json`** and owner amendments are `guides/owner-amendments.json`, version `owner-amendments-2026-10-17-r14`. Existing useful routes include `IC.GUIDE_LATER`, `IC.MEET_GUARD`, `IC.PROTECTOR_ACTION`, `AMEND.CROSS.EXPERIENCE_INTERPRETATION_CHOICE`, and `AMEND.CROSS.FOCUS_PRIORITY_BASELINE`. `docs/INNER-CHILD-THERAPY-MAP.md` is **generated only**; **do not edit the diagram directly**.
- Current separate reader-facing humanization assembly: `u-dont-existDOTcom/joel-articles/articles/inner-child-therapy/HUMANIZED-ARTICLE-SO-FAR.md`, blob `3b45f2cbd80d50a92f45ad583ac94c944a0c76d1` (updated since Pass 15), protected by that repo's authorial acceptance workflow. The current Guide section *already* distinguishes nurturing from spoiling, a wish from harmful texting/sulking, proper bedtime, ordinary impulses from their enactment, and child/adult authority. The somatic section includes stress-response practices and some medical safety references; it does **not** explicitly say illness is not evidence of suppressed feeling. No rewrite of existing examples needed.

## Minimal map / protocol proposal (two qualifications, zero new nodes)

**M1 — Target existing `IC.GUIDE_LATER` / `IC.MEET_GUARD`, with `AMEND.CROSS.EXPERIENCE_INTERPRETATION_CHOICE` as the shared source-level clarification. Proposed addition:**

> Not every strong want, selfish impulse or childish demand is a protective part, unmet childhood need or clue to hidden trauma; sometimes it is an ordinary desire, habit or impatience. Acknowledge the experience without shaming or automatically obeying it. Distinguish justified anger at real mistreatment, harmless wanting, and actions that override others' legitimate needs or consent. The Guide chooses responsible behavior without inventing an additional inner person or causal history. An unwanted impulse alone does not establish endorsed harmful intent; keep the existing protective-compatibility gate unchanged.

**M2 — Target existing `AMEND.CROSS.EXPERIENCE_INTERPRETATION_CHOICE` and the extant medical red-flag route; no new diagnostic node. Proposed addition:**

> A bodily sensation, pain or illness cannot by itself establish its medical cause, suppressed emotion, hidden childhood event or an inner child's attempted communication. Emotional self-care may accompany medical care; do not substitute a psychodynamic interpretation for medically appropriate assessment or action. Preserve existing urgent red-flag handling and previously established health/access constraints.

**No new “IC.INNER_BRAT”, “selfish child” or “psychosomatic cause” node.** Neither clarification changes the definition of reparenting: real-world protection/limits the person takes for the younger self can remain reparenting, while outside medical services independently retain their proper roles.

## Minimal guide text proposal (two optional short insertions, no new headings)

**G1 — Placement:** *The Inner Guide Comes Later*, directly **after** the existing paragraph that says sweets/screens and escaping every hard thing can look like caring, **before** the paragraph about forced adulthood. Exact proposed insertion:

> Sometimes “I want it NOW!” is just that: a want. No hidden protector or old trauma required. You can hear it without shame and still say no, especially if getting your way would hurt you or somebody else.

**G2 — Placement:** *Your Body Might Need Some Love First*, **after** the first paragraph about non-forced exhales and gentle self-massage, **before** the longer list of other somatic approaches. Exact proposed insertion:

> A symptom can't tell you what caused it, though. Stress can affect the body, but pain or illness isn't proof that you've suppressed a feeling or neglected your little one. If something needs medical attention, get it; emotional care can happen alongside that.

**Why only these:** the Guide already teaches limits, real protection, acknowledging anger, and accountable behavior; repeating the Inner Brat model as a separate heading would create false complexity. Medical uncertainty is a narrow gap reinforced by close reading and negative reader feedback, not a claim that the current guide endorses psychosomatic diagnosis. Both insertions are proposals; the author/humanizer may choose a smoother local wording or decide an existing passage already covers enough.

## Approval and implementation boundary

This file is **research/proposal only**. To activate M1/M2 in InnerSignal, use the existing **hash-bound Guide Packet / owner-decision** lifecycle, update only the applicable original amendment/graph source and relevant regression(s), then add the corresponding public-guide meaning to `authoring/PENDING-PUBLIC-GUIDE-CHANGES.md` in the same **approved** change. Only the separate guide-author/humanizer should edit the working assembly using its owner locks, dedup, and preservation/humanization checks. Do not silently port public prose into runtime prompts; the generated map is not authority.

**Minimal regression examples:** (1) ordinary demanding wish without inferred protector; (2) justified protest against mistreatment without “Brat” diagnosis; (3) unwanted impulse without endorsed harm; (4) physical symptom gets appropriate medical attention without inferred emotional cause; (5) ordinary-life boundaries and real external protection remain reparenting in a welcomed child frame.
