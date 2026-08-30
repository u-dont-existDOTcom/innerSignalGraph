# InnerSignal Opt-In Community Learning Architecture

**Status:** Product/design proposal only. No runtime, therapy-policy, consent, research, or release authority is granted by this document.  
**Date:** 2026-08-30  
**Target:** InnerSignal community, product-learning system, and governed bridge into the existing deterministic therapy-lesson workflow.  
**Provisional names:** **InnerSignal Commons** (community), **Field Notes** (structured experience reports), **Learning Foundry** (review pipeline), and **Community Learning Cards** (inspectable outputs).

## 1. Owner intent

Create an opt-in InnerSignal community where people can talk with one another about:

- what is and is not working in InnerSignal;
- therapy and inner-child work;
- meditation and somatic practices;
- self-hypnosis;
- sleep;
- relationships, habits, and related self-development practices.

InnerSignal should learn from the community, but community anecdotes, popularity, and AI summaries must never silently become therapy authority or executable runtime behavior.

The system must treat **what did nothing, what worked only in a narrow context, what produced delayed downsides, and what made things worse** as first-class learning—not merely collect success stories.

## 2. Independent conception snapshot

This snapshot was preserved before the existing-work scan so that established models could supplement rather than erase the original product insight.

### Problem

Ordinary online conversation is socially useful but epistemically messy. A therapy-adjacent product also cannot treat raw disclosures as generic training data, confuse consensus with efficacy, or expose private session material merely because someone joined a community.

### Candidate mechanism

Separate four layers:

1. **Conversation Commons** — pseudonymous peer conversation and support.
2. **Field Notes** — optional structured experience reports created by the participant.
3. **Learning Foundry** — consent-aware extraction, clustering, contradiction mapping, contributor verification, human review, and experiments.
4. **Runtime Proposal Gate** — only reviewed, provenance-preserving proposals can enter the existing Guide Packet / owner-decision / deterministic-regression workflow.

### Core constraints

- Private InnerSignal conversations remain private by default.
- Sharing is an explicit action, never a consequence of using InnerSignal.
- Consent is granular by purpose and revocable where technically and legally possible.
- Raw community content is never executable authority.
- AI may summarize and organize, but cannot approve therapy policy.
- Minority experiences and adverse reports cannot be averaged away.
- The community must receive visible value and visible accountability rather than merely being “mined.”
- Product improvement and generalizable research are different lanes.
- Every adopted lesson remains traceable, challengeable, versioned, testable, and reversible.

### Candidate insight

The valuable invention is not another forum. It is a **provenance-preserving, contradiction-aware, consent-recomputable bridge from lived experience to governed product lessons**, composed with InnerSignal’s deterministic runtime and owner gate.

## 3. Bounded existing-work scan

### Already substantially solved

| Established family | What is reusable | Decision |
|---|---|---|
| Mature community platforms, especially self-hosted Discourse | Accounts, SSO, private groups/categories, asynchronous threads, chat if later needed, moderation, export, APIs, themes/plugins, and operational maturity | **Reuse** for the conversational substrate rather than building a forum |
| Online peer-support safety literature | Psychological safety, anonymity/pseudonymity, sensitive moderation, user control over exposure, clear boundaries, escalation protocols, and moderator support | **Adapt as launch requirements** |
| Learning health-system models | Continuous collection-to-learning loops, patient engagement, governance, data quality, accountability, and feedback into practice | **Adapt** to a non-clinical product-learning context |
| Patient-powered networks and structured experience platforms | Participant-controlled sharing, structured symptom/practice/outcome capture, aggregation, and participant governance | **Adapt** without treating self-report aggregation as clinical proof |
| Patient-focused outcome guidance | Precise constructs, time windows, meaningful change, storage, analysis, and transparent interpretation | **Adapt selectively** for Field Notes |
| Polis-style deliberation | Opinion-group discovery, representative statements, cross-group consensus, and explicit disagreement maps | **Adapt the algorithms/interface principles**, not the default public-data posture |
| N-of-1 reporting guidance | Within-person repetition, prespecified outcomes, periods, carryover, harms, and transparent reporting | **Adapt for optional community experiments**, never casual conversation |
| InnerSignal’s current therapy-lesson and Guide Packet gates | Versioned lessons, active versus candidate states, substantive owner decisions, deterministic verification, install/rollback boundaries | **Reuse as the only route to runtime authority** |

### Partially solved

- Platforms can collect experience reports, but they often collapse different contexts into a single “what works” ranking.
- Forums can support people, but their social signals are poor evidence signals.
- AI can cluster and summarize reports, but generated summaries can launder ambiguity, omit minority harms, or make a pattern sound more settled than it is.
- Consent systems generally track permission to store/share data, but often do not let contributors see exactly which derived lesson used their contribution.
- Learning systems can continuously improve, but therapy-adjacent behavior requires a much stronger boundary between observation, product hypothesis, framework change, and active guidance.

### Incompatible defaults

- Public indexing of therapy-adjacent disclosures.
- Engagement-maximizing feeds, follower counts, streaks, popularity leaderboards, and controversy amplification.
- A single upvote/like signal used both for emotional support and evidentiary weight.
- Opaque model fine-tuning on raw community text.
- Bundled “use the community and agree to product research” consent.
- Hosted consensus tools whose data terms or public-data defaults conflict with InnerSignal consent.
- Direct import of community prose into prompts, graphs, or therapy lessons.
- Treating verified professional status as proof that a community claim is correct.

### Genuinely unresolved product remainder

Build and test the InnerSignal-specific bridge:

```text
consented contribution
→ de-identification and classification
→ contributor-verified structured extraction
→ duplicate/context clustering
→ counterexample and adverse-signal search
→ contradiction-aware Community Learning Card
→ human/product/safety review
→ optional bounded experiment or external-evidence check
→ owner-gated runtime proposal
→ deterministic tests, rollout, monitoring, and rollback
```

### Architecture choice

**Compose** a mature community substrate with a purpose-built Learning Foundry. Do not build a social network and do not use opaque online learning. Use inspectable knowledge objects and the existing InnerSignal authority boundaries.

## 4. Product model

## 4.1 Private InnerSignal

The current private app remains the primary place for actual therapy, journaling, hypnosis, and sensitive reflection.

After a session, InnerSignal may offer:

> Keep this private  
> Discuss the general question with the community  
> Turn selected details into a Field Note

The default is **Keep this private**. There is no prechecked sharing box.

Community content must not appear during an active therapy formulation, hypnotic induction, deep self-hypnosis, or waking-return sequence. It belongs in a separate Community tab or a deliberate post-session action. Peer stories must never be used to infer childhood events, internal roles, diagnoses, or memories for another person.

## 4.2 InnerSignal Commons

An invitation-only, pseudonymous, asynchronous community at launch.

Recommended top-level spaces:

- **Using InnerSignal** — friction, bugs, prompt quality, feature ideas.
- **Inner-child and parts work**
- **Meditation and awareness practices**
- **Somatic practices**
- **Self-hypnosis**
- **Sleep**
- **Relationships and everyday experiments**
- **Community governance and product learning**

Use tags for goals and contexts rather than diagnosis-first silos. Example tags: falling asleep, waking at night, emotional regulation, procrastination, grief, concentration, difficult aftereffects, beginner, experienced practitioner.

Each post selects a desired response contract:

- Listen / witness only
- Similar experiences welcome
- Questions welcome
- Practical ideas welcome
- Challenge my interpretation
- Help me make a Field Note

This makes consent to the *kind of social response* visible, not merely consent to publication.

### Launch defaults

- Adults 18+.
- No public web indexing.
- No direct messages during the pilot.
- No unmoderated live rooms.
- No follower counts, public influence scores, or “top healer” status.
- No algorithm optimized for time-on-site.
- Chronological/followed-topic views plus a bounded “needs a response” view.
- Staff and AI-generated seed content visibly labeled.
- Professional credentials, if verified later, are descriptive and never boost ranking.

## 4.3 Field Notes

A Field Note is an optional structured report, not a claim that a method works.

Suggested schema:

```yaml
field_note_id:
author_pseudonym_id:
created_at:
practice_or_feature:
goal:
what_i_tried:
session_or_exposure_context:
prior_experience:
immediate_effect:
later_same_day:
next_morning:
following_2_to_3_days:
longer_follow_up:
downsides_or_unwanted_effects:
what_else_changed:
would_i_repeat:
causal_confidence_self_rating:
response_contract:
consent_scopes:
redaction_version:
source_post_refs:
```

The delayed time windows are important because a pleasant session and a helpful dose are not the same thing.

Fields can be omitted. The system should prefer missing data over coerced disclosure. Sensitive contextual variables are collected only when they are plausibly useful, shown to the contributor, and protected by minimum-cell rules before aggregation.

### Two distinct reaction systems

**Social support reactions**:

- I relate
- Thank you for sharing
- This helped me feel less alone

**Evidence follow-ups**:

- Similar result for me
- Different result for me
- No noticeable effect
- Made things worse
- Context seemed important
- I cannot tell because other things changed

A social “like” must never count as replication.

## 4.4 Community Learning Cards

A Learning Card is the public/participant-facing unit of collective knowledge.

Every card should answer:

- What is the bounded observation?
- What practice, product behavior, or context does it concern?
- How many independent contributors supplied eligible reports?
- How many reported benefit, no change, mixed effects, or worsening?
- Were effects immediate, delayed, or sustained?
- What contexts appear to differ?
- What potential confounders were reported?
- What adverse reports or minority patterns exist?
- What external evidence was checked, if any?
- What is still unknown?
- What is the card’s status?
- Which consented source notes support each clause?
- When will the card be reviewed again?

Example status vocabulary:

- `SINGLE_STORY`
- `REPEATED_PERSONAL_PATTERN`
- `COMMUNITY_PATTERN_CANDIDATE`
- `CONTESTED_PATTERN`
- `SAFETY_SIGNAL`
- `BOUNDED_EXPERIMENT_FINDING`
- `EXTERNAL_EVIDENCE_ALIGNED`
- `PRODUCT_PROPOSAL`
- `THERAPY_POLICY_CANDIDATE_AWAITING_OWNER`
- `ACTIVE_RUNTIME`
- `REJECTED_FOR_RUNTIME`
- `RETIRED_OR_SUPERSEDED`

Do not turn these into a single “truth score.” Display an evidence profile instead:

- independent contributor count;
- diversity/coverage of contexts;
- within-person repetition;
- temporal specificity;
- outcome specificity;
- negative and adverse-case coverage;
- confounding burden;
- missing-data burden;
- external-evidence relationship;
- moderation/integrity concerns;
- freshness.

“Community consensus” means agreement among the observed participants, not efficacy, universality, or medical evidence.

## 4.5 Learning Foundry

The Learning Foundry is a review system, not a model-training pipeline.

### Intake

Only contributions with the relevant consent grant enter the Foundry. Conversation-only posts are excluded from lesson extraction, even if technically visible to moderators.

Before sharing, the contributor receives:

- a redaction preview;
- warnings about names, locations, clinicians, employers, and third parties;
- a plain-language explanation of each permitted use;
- a preview of the structured fields AI inferred;
- the ability to edit or reject every inference.

### Extraction

AI may:

- propose a de-identified summary;
- extract time windows, context, outcome, downsides, and confounders;
- detect likely duplicates;
- suggest tags;
- flag a possible safety issue for human review;
- identify claims that need external evidence;
- find reports that contradict a candidate pattern.

AI may not:

- diagnose;
- decide whether a person’s causal interpretation is true;
- silently change the contributor’s meaning;
- manufacture missing context;
- infer trauma, abuse, memories, or internal parts;
- publish a lesson without provenance;
- approve a runtime change.

The contributor sees the extraction and can choose:

- Accurate
- Mostly accurate; edit
- This changes what I meant
- Do not use this contribution for learning

### Synthesis

The Foundry groups reports by both apparent similarity and relevant contextual differences. It actively searches for:

- nonresponse;
- delayed worsening;
- conflicting time horizons;
- selection and survivor bias;
- repeated reports from the same person or household;
- coordinated promotion;
- co-interventions and major life changes;
- context cells too small to report safely.

Each generated sentence in a Learning Card keeps exact source links for reviewers. Participant-facing cards may link to public/pseudonymous Field Notes only when the author separately allowed that; otherwise the card cites an internal contribution receipt without exposing the note.

### Human review

Review routes depend on lesson class:

1. **Product friction / bugs** — ordinary product triage.
2. **Conversation quality / personalization** — controlled prompt or UX proposal with regression tests.
3. **Practice experience** — Community Learning Card; not runtime guidance.
4. **Therapy/framework change** — evidence review, owner decision, Guide Packet, graph/prompt tests.
5. **Safety signal** — immediate containment and specialist review; urgency does not equal truth.
6. **Generalizable research** — separate protocol, consent, ethics determination, and analysis plan.

## 4.6 Runtime proposal gate

Community learning should enter Git as a proposal artifact, never by editing active prompts directly.

Proposed repository shape:

```text
community-learning/
  schemas/
    field-note.schema.json
    consent-grant.schema.json
    learning-card.schema.json
  proposals/
    <card-id>.yaml
  reviews/
    <card-id>/
      extraction-review.json
      contradiction-review.json
      safety-review.json
      external-evidence-review.json
  experiments/
    <protocol-id>/
  exports/
    <signed-bundle-id>.json
```

A community proposal may eventually create a Guide Packet decision or a `THERAPY-LESSONS` candidate entry, but only after the existing substantive policy gate. It must never write `active-runtime` itself.

Every proposal includes:

- immutable source/contribution hashes;
- current consent receipts;
- redaction history;
- exact generated-claim-to-source mapping;
- counterexamples and adverse reports;
- reviewer identities/roles;
- owner decision;
- affected graph nodes/prompts/tests;
- rollout and rollback plan;
- expiry/re-review date.

### No opaque fine-tuning

Do not fine-tune InnerSignal on raw community posts. The first implementation should use structured retrieval from approved, versioned Learning Cards. This preserves provenance, makes withdrawal/recomputation feasible, supports deterministic tests, and avoids silently absorbing community bias into model weights.

## 5. Consent and participant rights

Consent must be purpose-specific. Recommended independent grants:

1. Join and post in the community.
2. Let other members see this specific post.
3. Let InnerSignal AI process this contribution for redaction/tagging.
4. Include this contribution in de-identified community aggregates.
5. Use this contribution for product improvement.
6. Contact me about a specific optional experiment.
7. Use data in a defined research protocol.
8. Share a defined dataset with named external researchers.

Declining 4–8 must not block ordinary community participation.

Each participant receives a **Contribution Receipt** showing:

- what was shared;
- what consent version applied;
- where the contribution currently appears;
- which Learning Cards cite it;
- whether it influenced a product proposal or released change;
- how to withdraw or challenge the representation.

### Withdrawal design

Derived cards should be recomputable from their current eligible sources. On withdrawal:

- future processing stops for the withdrawn purpose;
- the source is removed from recomputable internal aggregates;
- affected cards are recalculated or marked stale;
- already public replies/quotes are handled under a clearly disclosed community policy;
- completed research/publications and lawful retention exceptions are disclosed before consent rather than hidden later.

The pilot should avoid public/open-data release entirely.

## 6. Community governance

Recommended governance bodies:

- **Community Stewards** — welcoming, de-escalation, ordinary moderation.
- **Safety Moderators** — high-risk content and escalation.
- **Learning Reviewers** — accuracy, provenance, contradiction coverage.
- **Participant Council** — consent language, policy changes, appeals, and priorities.
- **Owner/Product Gate** — product and therapy-framework authority.
- **Independent research/ethics review**, when a project crosses into research.

Members can:

- challenge a Learning Card;
- say a summary misrepresents them;
- request a context split;
- flag missing harms;
- appeal moderation;
- inspect the change log from community signal to product decision.

A quarterly **You taught InnerSignal / InnerSignal did not adopt** report should show:

- lessons incorporated;
- lessons still contested;
- lessons rejected and why;
- safety changes;
- unresolved minority reports;
- experiments launched or stopped.

This is essential reciprocity. The community should experience itself as a partner, not a free data source.

## 7. Moderation and safety

### Community norm

> Speak from experience. Say what happened, under what conditions, and what you are uncertain about. Do not tell another member what diagnosis they have or what they must do.

### High-risk boundaries

At minimum, moderate and route:

- imminent self-harm or harm to others;
- abuse/exploitation and threats;
- dangerous medical or medication instructions;
- coercive hypnosis, nonconsensual influence, or instructions to bypass another person’s agency;
- practices likely to create physical risk;
- recovered-memory certainty or leading claims about another person’s past;
- doxxing and third-party therapy disclosures;
- predatory solicitation and unlicensed treatment marketing;
- coordinated commercial promotion.

Experience reports about high-risk topics may be retained in a restricted safety-review lane when lawful and consented, but should not become crowdsourced instructions.

### User-controlled exposure

Support:

- content notes;
- topic muting;
- “hide this thread for now”;
- pause-community mode;
- digest frequency controls;
- no surprise crisis or trauma content in notifications;
- easy exit from live/support interactions.

### Moderator protection

Moderators need:

- clear role boundaries;
- escalation playbooks;
- rotation and maximum exposure limits;
- debriefing and supervision;
- access to specialist consultation;
- tools that show uncertainty rather than demanding instant clinical judgment.

AI triage can prioritize review but must not be the sole crisis or safety decision maker.

## 8. Optional community experiments

Do not call casual self-reports experiments.

A bounded experiment begins only when there is:

- a specific question;
- an eligible population;
- a defined practice;
- prespecified outcomes and time windows;
- adverse-event capture;
- a stopping rule;
- a data and consent plan;
- a clear determination of product improvement versus human-subjects research;
- appropriate ethics review where applicable.

Useful formats:

- repeated within-person observations;
- randomized prompt or UX variants for non-therapy product questions;
- opt-in N-of-1 comparisons;
- small cohort feasibility tests.

Never randomize high-risk therapy instructions simply because community anecdotes conflict.

## 9. Technical composition

### Recommended pilot stack

```text
InnerSignal account / consent service
        │ pseudonymous SSO
        ▼
Self-hosted Discourse (Commons)
        │ webhooks / bounded API
        ▼
Community Learning Service (first-party Node/TypeScript + PostgreSQL)
        ├─ identity-separated consent ledger
        ├─ immutable contribution/event ledger
        ├─ redaction and participant verification
        ├─ structured Field Notes
        ├─ candidate clustering and contradiction maps
        ├─ moderation/reviewer workbench
        └─ signed proposal export
                 ▼
innerSignalGraph task branch / PR
        ▼
Guide Packet + owner decision + deterministic gates
        ▼
stable release only after approval
```

### Separation requirements

- Community identity mapping lives in a restricted identity vault.
- Public/pseudonymous profile IDs are random and rotatable.
- Community content is not copied into the local private therapy store.
- Private app transcripts are not sent to the Commons service.
- Model providers receive only the minimum bounded content allowed by the contributor’s consent and the provider contract.
- Raw text, structured reports, derived cards, moderation events, and consent events have separate retention policies.
- Every derived object records model/version, prompt/template hash, timestamp, and exact source set.
- Minimum group sizes and suppression prevent tiny contextual cells from re-identifying members.
- Security, breach response, export, deletion, and disaster recovery are launch gates rather than later polish.

### Why Discourse plus a separate service

Discourse is good at people talking, moderation, identity integration, permissions, and durable threads. It should not become the authoritative scientific/therapy evidence store.

The separate Learning Service is good at granular consent, provenance, structured outcomes, recomputation, contradiction maps, review states, and signed exports. Keeping these functions separate reduces customization risk and prevents a forum database from silently becoming a therapy model.

## 10. Anti-patterns to prohibit

- “By posting, you agree that we may use anything forever to improve AI.”
- Auto-sharing a private session excerpt.
- Counting likes as evidence.
- Showing only positive experiences.
- “87% effective” without denominators, time windows, missingness, and selection caveats.
- Recommending a practice because similar users liked a post.
- Letting one prolific member count as many independent confirmations.
- Hiding minority adverse reports under a consensus summary.
- Using a professional badge to settle a disputed empirical claim.
- AI rewriting a report into stronger causal language.
- Changing a therapy prompt directly from a community trend.
- Allowing community content into an active hypnosis sequence.
- Rewarding dramatic breakthroughs more than careful null reports.
- Publishing searchable personal health narratives by default.
- Calling product analytics “research” only after deciding to publish it.

## 11. Metrics that align with the purpose

### Community value

- percentage of new posts receiving a response matching the author’s response contract;
- member-reported feeling understood, usefulness, and psychological safety;
- proportion of active members who can find dissenting or adverse experiences;
- unresolved conflict and moderation-appeal outcomes;
- moderator load and wellbeing;
- participation diversity without exposing sensitive demographic cells.

### Learning quality

- proportion of eligible Field Notes with clear time windows;
- proportion containing null, mixed, or adverse outcomes;
- proportion of cards with explicit counterexamples and confounders;
- contributor verification and correction rates;
- stale-card and recomputation rates;
- time from candidate signal to reviewed disposition;
- percentage of clauses with complete provenance.

### Product governance

- proposals accepted, rejected, and still contested;
- regressions added per adopted lesson;
- rollback and post-release adverse-signal rates;
- consent-withdrawal completion;
- privacy/safety incidents;
- percentage of product changes with a visible community feedback receipt.

Do **not** optimize primary success around daily active use, scrolling time, post volume, or emotional intensity.

## 12. Pilot contract

### Phase 0 — design and adversarial rehearsal

- Draft consent receipts, community rules, moderator playbooks, and Learning Card examples.
- Threat-model re-identification, coercion, commercial promotion, crisis content, and advice leakage.
- Run synthetic reports through the entire Foundry.
- Test whether reviewers can reconstruct every card clause from source evidence.
- Test withdrawal and recomputation before real contributions exist.

### Phase 1 — invitation-only Commons

Recommended: 30–75 adults, asynchronous text, five or six rooms, no DMs, no public indexing.

- Community conversation and app feedback.
- Field Notes optional.
- AI redaction/extraction only after explicit selection.
- No automated community-based runtime advice.
- Weekly moderation/safety review.
- Publish the first “what we heard / what remains uncertain” report.

### Phase 2 — Learning Cards

- Release participant-visible candidate cards.
- Add contributor verification and challenge flows.
- Add contradiction and adverse-report views.
- Permit product/UX proposals.
- Keep therapy-framework proposals owner-gated and non-active.

### Phase 3 — bounded experiments

- Add protocolized opt-in experiments only after the product-versus-research boundary and ethics process are operational.
- Use experiment results to refine cards, not bypass owner/runtime gates.

### Pilot stop conditions

Pause or narrow the pilot for:

- unresolved privacy or breach-control failure;
- moderator overload;
- inability to prevent community material from leaking into private runtime behavior;
- repeated misrepresentation by extraction/synthesis;
- advice-induced safety incidents;
- consent withdrawal that cannot be honored as represented;
- evidence that vulnerable participants feel pressured to contribute data to belong.

## 13. Initial product decisions recommended now

| Decision | Recommendation |
|---|---|
| Community name | InnerSignal Commons |
| Structured contribution name | Field Note |
| Learning pipeline name | Learning Foundry |
| Launch audience | Invitation-only, 18+ |
| Public indexing | Off |
| Direct messages | Off during pilot |
| Live chat/voice | Defer |
| Social platform | Self-hosted Discourse |
| Structured learning store | Separate first-party service |
| Training on raw posts | Prohibited by default |
| Community summaries in therapy flow | Separate tab / deliberate request only |
| Product improvement consent | Separate from ordinary participation |
| Research consent | Separate protocol later |
| Lesson activation | Existing owner-gated Guide Packet and deterministic tests |
| Primary epistemic rule | Preserve context, contradiction, null results, and harms |
| Primary success metric | Useful, safe peer exchange plus traceable learning—not engagement |

## 14. First build slice

The first implementation slice should produce no therapy behavior change.

Deliver:

1. versioned consent-grant and Field Note schemas;
2. three example Learning Cards, including one contested pattern and one adverse signal;
3. contribution receipt and withdrawal/recomputation model;
4. moderator and safety escalation contract;
5. a synthetic end-to-end proposal export into a non-authoritative task branch;
6. deterministic checks proving no proposal can write `active-runtime` or enter `stable`;
7. a clickable private-sharing flow from post-session reflection to redacted Field Note preview;
8. a pilot readiness review covering privacy, safety, community governance, and research boundaries.

## 15. Reference baseline

- National Academy of Medicine, Learning Health System series: https://nam.edu/our-work/programs/leadership-consortium/learning-health-system-series/
- JMIR Mental Health, *Understanding the Impacts of Online Mental Health Peer Support Forums: Realist Synthesis* (2024): https://doi.org/10.2196/55750
- JMIR Mental Health, *Understanding Safety in Online Mental Health Forums: Realist Evaluation* (2025): https://doi.org/10.2196/75320
- JMIR Mental Health, *Understanding the Needs of Moderators in Online Mental Health Forums* (2025): https://doi.org/10.2196/58891
- Open Humans / participant-controlled data projects: https://www.openhumans.org/
- PatientsLikeMe research network: https://www.patientslikeme.com/
- StuffThatWorks structured community reports: https://www.stuffthatworks.health/
- PCORI Patient-Powered Research Networks: https://www.pcori.org/
- FDA Patient-Focused Drug Development guidance series: https://www.fda.gov/drugs/development-approval-process-drugs/fda-patient-focused-drug-development-guidance-series-enhancing-incorporation-patients-voice-medical
- HHS OHRP Quality Improvement Activities FAQs: https://www.hhs.gov/ohrp/regulations-and-policy/guidance/faq/quality-improvement-activities/index.html
- Computational Democracy Project / Polis: https://compdemocracy.org/
- CONSORT extension for N-of-1 trials (CENT): https://www.equator-network.org/reporting-guidelines/consort-cent/
- FTC Health Breach Notification Rule: https://www.ftc.gov/legal-library/browse/rules/health-breach-notification-rule
- European Commission data-processing and consent guidance: https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data_en
- Discourse official platform and documentation: https://www.discourse.org/ and https://meta.discourse.org/c/documentation/10
