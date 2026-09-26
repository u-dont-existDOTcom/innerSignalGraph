# InnerSignal care channels, supervision and learning governance

Date: 2026-09-26
Status: PROPOSED DESIGN built on owner requirements stated 2026-09-26 and the owner's answers to the first draft's questions (also 2026-09-26). Nothing here is implemented. It grants no runtime, therapy-policy, installation, deployment or release authority. Therapy content changes stay owner-gated.

## Owner requirements (2026-09-26)

These are the owner's decisions. Owner wording is quoted where it sets a rule.

1. **Channels.** Clients use InnerSignal free in their own Claude or ChatGPT. Paying clients use a web app that calls model APIs, for privacy, extra features and a better interface.
2. **Supervised mode.** A therapist supervises a session. Each response goes to the therapist for approval first and reaches the client only once approved.
3. **Escalation when unsure.** The model automatically submits to a supervisor whenever it "is not sure about the direction it's going in or what to do, so unsupervised mode is never fully unsupervised."
4. **Lesson ladder.**
   - A user who isn't a therapist can teach the app what isn't working for them.
   - The app submits lessons to a supervisor therapist, who may or may not be the owner.
   - The supervisor can modify, approve or reject them.
   - The owner has the final say and can approve directly.
5. **Per-user learning.** "Some limited learning that is per user … not requiring approval from therapist, but it must be scoped well."
6. **Practice changes stay under review.**
   - A supervisor's approved lesson applies to that supervisor's own clients right away.
   - It "should still be on queue for owner/team review otherwise individual supervisors can drift away from the purpose of Inner Signal."
   - Clients get a button to submit their supervisor's changes for owner review and for a community vote.
   - "We should have community input in general built in at all sensible levels."
7. **Owner team decides by blocking consensus.** "One person can approve if the others don't block, but if one blocks there should be reconciliation."
8. **Free users store locally.**
9. **Database and admin page can come later,** "as long as it wouldn't require resetting passwords or too much work or inconvenience later."

### Owner answers to the first draft (2026-09-26)

10. **Free-channel supervision is best-effort:** "best effort is the best we can do so that's what they get."
11. **Who supervises.** Free users' escalations go to "whichever supervisor is signed up for the free user pool and available." "Paid users can choose their supervisor."
12. **Block window:** 72 hours "for now."
13. **Emergency pause:** yes.
14. **Supervisor unavailable.** The client can choose a backup supervisor or unsupervised mode, "but there needs to be a way they can then get re-supervised to make sure everything is on the right path."
15. **Retention:** 30 days for escalated excerpts.

The 2026-08-31 owner product-privacy decision remains in force. It is archived with the Commons work on branch `design/opt-in-community-learning-20260830` (`tasks/opt-in-community-mvp-20260830/OWNER-PRODUCT-PRIVACY-DECISION-20260831-003.json`):
- It rests on the owner's premise that consumer ChatGPT accounts can't opt out of provider monitoring, and makes the API path the paid privacy option.
- Users get a warning when what they submit could identify them.
- The agreement is explained at sign-up.

## Roles

- **Client:** the person in therapy.
- **Supervisor:** a therapist who reviews escalations, approves supervised responses, and approves lessons for their own practice.
- **Owner:** Joel today, possibly a team later. Final authority over the global map and every safety rule.
- **Community:** verified InnerSignal users and therapists. Community input is advisory.
- **The model** drafts responses and lesson candidates. It is never an approver.

## Channels

| | Free: own Claude or ChatGPT | Paid: InnerSignal web app |
|---|---|---|
| Who runs the model | the client's own account | InnerSignal, through model APIs |
| Where the conversation lives | the client's account with that provider | InnerSignal's server, encrypted as private cases are today |
| InnerSignal server storage | none by default; only consented escalation packages and consented spot-check samples, deleted after review (see "Retention") | the private case |
| Supervision before sending | not possible: the host sends the reply straight to the client | possible (supervised mode) |
| Supervision after sending | escalations and spot checks | escalations and spot checks |

### Local storage for free users

The free channel talks to InnerSignal's hosted connector, and the server keeps no case data for free users. Continuity has two options, plus a portable file for backup:

1. **The InnerSignal local app on the client's own computer.** It already keeps an encrypted case on the device. Serving that case to desktop Claude as a local connector is new work. This is truly local, and it's the recommended option where the client has a computer.
2. **The host's own memory or project features.** This needs no install, but the data then sits with the provider under the client's account. Per the 2026-08-31 decision, that isn't private from the provider, and the sign-up agreement must say so.
3. **A portable encrypted case file,** for backup or moving to another device. It doesn't give continuity by itself. A host can't read an encrypted handoff envelope (`src/storage/private-case-store.mjs` exports only that), and opening one needs case-scoped authorization and key material. The file is opened by the local app (option 1), which decrypts it on the device and passes the host only the context it is authorized to see.

**Tradeoff:** server-enforced scope rules for personal learning (below) need option 1, or paid server storage. With option 2 only, the rules are instructions to the model rather than enforced checks.

### Paid privacy claims

Before InnerSignal advertises privacy for the API path, re-verify the current API data terms of each model provider. The facts recorded on 2026-08-31 are dated.

## Supervised mode (web app)

The private runtime already works this way:
- it drafts a candidate response;
- it audits the draft;
- it delivers only an explicitly approved, exact-version candidate (`src/supervisor/private-candidate-lifecycle.mjs`, `private-candidate-audit.mjs`).

Supervised mode puts the therapist at that approval step, with a queue. For each audited draft the therapist can:
- **Approve.** The exact audited version is delivered.
- **Edit.** The edited text becomes a new immutable candidate version. It follows the existing rule: approval is version-specific, and a changed candidate stays closed until that exact version passes a fresh independent audit (`POST_RECONSTRUCTION_AUDIT_RULE`). The therapist then approves that exact version. An edit is never delivered on the strength of the earlier draft's audit.
- **Reject.** Nothing is delivered. The therapist gives guidance and the runtime drafts again.

**Every outgoing message waits, including the discriminating question.** When repeated repairs still fail audit, today's controller writes a discriminating question and delivers it directly, without the candidate approval step (`DISCRIMINATING_QUESTION_REQUIRED` in `src/supervisor/private-therapy-turn-controller.mjs`). In supervised mode that question goes to the therapist's queue too. It follows the same approve, edit and reject rules as a draft, and nothing reaches the client without approval. The imminent-danger crisis path below is the only exception.

The crisis path and client expectations:
- **Only imminent danger bypasses the queue.** Imminent danger means what the runtime already treats as needing immediate protection:
  - `immediateProtectionNeeded` (`src/case-formulation/turn-task.mjs`): for example an unsafe present, disorientation, being unable to stop or come back from an exercise, or an explicitly stated imminent suicidal state;
  - for violence risk, the threat pathway's `IMMINENT_OPERATIONAL_DANGER` (`src/case-formulation/threat-pathway.mjs`): concrete near-term danger with intent, capability or preparation, and opportunity established.

  At that level the immediate reply comes from an owner-approved, pre-audited response set that follows the runtime's own routing: the graph's safety-orientation route, or the threat pathway's guidance (seek immediate human help; take the least disruptive effective step). The supervisor gets an urgent alert.
- **Lower risk levels never bypass.** Ideation, intent or escalating risk goes to the front of the supervisor queue. Meanwhile the runtime keeps engaging as its graph routes it, with no canned emergency instructions. For suicidal material that routing is owner decision D1 (2026-09-26, `tasks/focus-discipline-20260926/OWNER-DECISIONS.json`).
- **Other risk types need an imminent-danger trigger first.** Where nothing in the runtime marks imminent danger for a risk type (for example non-suicidal self-harm), defining that comes before any bypass exists for it.
- **Asynchronous by design.** Clients are told up front that replies come after review, like messaging a therapist, not live chat.
- **Edits are lessons.** The difference between the audited draft and the approved version becomes a lesson candidate automatically, subject to the client's consent.

**When the supervisor is unavailable.** If a supervised session's supervisor stays unavailable past the promised window, the client chooses one of two options:
- **A backup supervisor,** picked from the supervisors who are available. Choosing one is the client's consent for that supervisor to see the queued replies and the session.
- **Continuing unsupervised.** Replies go out without approval, as in an unsupervised web session. Escalation and spot checks still apply.

**Re-supervision.** When a supervisor is available again (the client's own, or the backup they chose), the session returns to supervised mode. That supervisor then reviews, in order, every reply sent during the unsupervised stretch:
- Corrections and guidance reach the client at their next session.
- Edits become lesson candidates, like other edits.
- The client can decline this review. Then nothing from the stretch is shared, and supervision resumes from that point.

## Escalation: never fully unsupervised

A model's own sense that it is unsure misses the cases where it is confidently wrong, so escalation has three sources. Sources 2 and 3 need InnerSignal to see the turn:
- **In the web app,** InnerSignal runs the model and sees every turn, so all three sources apply to every turn.
- **In the free channel,** the host sends replies itself. InnerSignal sees only what the host model passes through connector tools. See "Free-channel limits" below.

1. **The model's own flag.** A connector tool, `request_supervision`, carries the model's question, its proposed direction and the minimal excerpt.
2. **Events the server detects.** These need no self-report:
   - the protective-compatibility (child-contact) gate reaching HOLD or BLOCKED;
   - the candidate audit disagreeing with the draft;
   - risk signals the runtime already acts on: the immediate-protection check, the threat pathway's levels, and an explicitly stated suicidal state. Escalation only alerts a supervisor. It adds no crisis copy and forces no model tier, which owner decision D1 (2026-09-26) rules out for suicidal state;
   - altered-state capacity concerns;
   - requests for child-contact exercises;
   - repeated signals from the client that it isn't helping;
   - situations with no applicable map node.
3. **Random spot checks** of sessions that were never escalated, at a rate the owner sets. These catch confident mistakes.

**Who reviews.**
- A free user's escalations and spot checks go to the free-user pool. Whichever supervisor has signed up for the pool and is available takes the next one.
- A paid user's go to the supervisor they chose, or to the pool if they haven't chosen one. "When the supervisor is unavailable" (under supervised mode) covers backups.

**Free-channel limits.**
- The protocol requires the host model to call a per-turn `check_turn` tool before each reply, passing the client's message and the draft reply.
- The server runs the detectors that work without the full case and answers proceed, proceed cautiously, or escalate.
- It stores nothing unless the turn becomes an escalation, or a spot-check sample the client consented to at sign-up. Per-turn processing still sends each turn off the device, so sign-up must disclose it. A client who declines gets only the model's self-report (source 1).
- The host model can skip the call, and the server can't see turns that never reach it. It can measure call rates for signed-in clients, but supervision in the free channel stays best-effort. The owner accepted that on 2026-09-26.
- **"Never fully unsupervised" is guaranteed only in the web app.** That limit belongs in the free tier's sign-up agreement.

**Retention.**
- Escalation packages and spot-check samples are kept only until a supervisor reviews them. After that they are deleted within 30 days (owner decision 2026-09-26), unless the legal review requires otherwise.
- Clients can see and delete their own at any time. Deleting one that is still pending cancels its review.
- Anything that becomes a lesson survives only in its generalized, screened form.

**While an escalation waits:**
- **Web app, supervised session:** the reply stays queued until the supervisor approves it. Only the imminent-danger crisis path is sent without approval. The client sees that a therapist is reviewing. If the supervisor stays unavailable past the promised window, the client chooses a backup or continuing unsupervised (see "When the supervisor is unavailable").
- **Web app, unsupervised session:** hold the reply if a supervisor is available within the promised window. Otherwise send a cautious reply and queue the review.
- **Free channel:** send a cautious reply now. The supervisor's guidance reaches the client at their next session, through `get_supervisor_guidance`. That return path needs a free InnerSignal account.
- **What "cautious" means:** slow down, stay with the present, start no new deep exercise, and tell the client a therapist will look.

**Consent.**
- At sign-up, clients agree that a supervisor may read escalated excerpts. The model can also ask in the moment ("can I check this part with a therapist?").
- An escalation package contains only the excerpt, the question and the proposed direction, never the whole history.
- **A "no" in the moment wins over sign-up consent.** Nothing is shared. The model continues cautiously and offers help resources. The escalation is recorded on the client's side as declined, and no content leaves.
- **Emergency exception: default none.** Whether anything may ever be shared without consent, even at imminent danger (as defined under "Supervised mode"), is an explicit owner policy decision. Until the owner makes one, nothing is shared without consent. Legal or reporting duties differ by jurisdiction, and none is assumed.

**Capacity.** The triage order is safety, then uncertainty, then spot checks. The free tier promises no response time.

**Calibration.** Supervisors mark each escalation as needed or unneeded, and mark spot checks that should have escalated. Triggers are tuned from those counts, reported as separate measures.

## Learning scopes

There are three scopes, plus a safety floor that none of them can lower.

### Personal: automatic, no therapist approval

This builds on the archived personalization boundary (`learning-system/PERSONALIZATION-BOUNDARY.md` on the archive branch).

- **Allowed:**
  - presentation, process and framing preferences (length, tone, directness, pace, the client's own words for parts);
  - which existing techniques help or hurt this client;
  - the inner-speech answer;
  - topics to approach slowly;
  - outcome cautions ("that exercise left me dissociated").
- **Never allowed:**
  - a diagnosis;
  - a global therapy rule;
  - a causal conclusion from a single outcome;
  - a diagnosis of a third party;
  - an instruction to always agree;
  - an instruction to ignore safety or evidence;
  - validation of recovered-memory certainty;
  - anything that lowers a safety rule.

  Requests like these become lesson candidates for a supervisor. Preference memory must never become a way to make the app agreeable.
- **Only more careful.** Outcome cautions can remove or soften options for this client. They can never add riskier ones.
- **Confirmed.** The app asks before remembering anything ("should I remember that?").
- **Visible.** The client can see and delete every learned item. In supervised mode the supervisor sees them too.
- **Structured.** Items are stored as fixed fields that the server validates, never as free-text rules. They live where the client's data lives: local for free users, the server for paid users.

### Practice: supervisor-approved

- **A practice lesson is a structured overlay, never free-text instructions.** The only allowed fields are:
  - preference weights among techniques already in the map (prefer, avoid, order);
  - which existing map nodes to try first;
  - style defaults (length, tone, pacing);
  - practice terminology;
  - check-in cadence.

  An overlay can't add techniques, change a node's content, or touch any safety-floor domain (crisis handling, child contact, altered states, referral, epistemic handling). An admission validator rejects any overlay with an unknown field or a floor-domain effect before it activates.
- **Gates run after composition.** The runtime composes the global map, the practice overlay and the personal profile. Then the unmodifiable safety gates, and the final candidate audit, run on the composed result. Neither an overlay nor personal learning can route around them.
- A lesson the supervisor approves applies to that supervisor's own clients immediately, and enters the owner queue at the same moment. A supervisor's own clients are the ones who chose them. Clients served through the free-user pool get no practice overlay, only the global map.
- Clients see a short changelog of practice changes that affect them. Each entry has a **Submit for owner review and community vote** button.
- If an owner blocks or rejects a practice change, it is paused at once and that practice reverts to the global map (see "Owner team: blocking consensus"). This is how supervisors stay tied to InnerSignal's purpose.
- **Every overlay version has an identity.** Each version gets an immutable ID, version number and content hash, and every version that was ever active is kept. Sessions and handoffs record the overlay identity next to the global protocol identity (see "Global"), so after an overlay is edited, paused or rejected it's still clear which rules produced each response.

### Global: owner team

- These are changes to the map and rules for everyone.
- Each activation is a new protocol version with its own content hash.
- The server already reports the current version and hash (`/health`, `get_therapy_protocol_manifest`), but nothing records them yet: sessions record only a guide version, and handoffs only constitution, runtime and audit versions. Recording the protocol version and hash in every session and handoff is part of phase 1. From phase 3 on, the practice overlay's identity is recorded with it. Together with the personal profile's version (phase 1), these identify the effective rules behind each response.
- Every activated version is kept, so any one can be restored. That's part of phase 3.
- Removing an active global change is itself a new global version, decided like any approval. When it can't wait, the emergency pause withholds the affected exercise or route at once.

### Safety floor: owner team only

- The floor covers:
  - crisis handling;
  - the protective-compatibility gate;
  - altered-state safety;
  - referral rules;
  - epistemic rules (for example, never validating recovered-memory certainty).
- Neither personal learning nor a practice approval can change it.
- **Every floor change waits the full block window.** Nothing activates early. "Stricter" can't be defined mechanically, and a stricter-looking change can still harm (wider escalation or disclosure, needless referral, therapy switched off). A rollback after a block wouldn't undo that exposure.
- **The emergency pause is not a floor change** (owner decision 2026-09-26; defined under "Owner team: blocking consensus"). It only withholds a specific exercise, route or practice change. It can never switch off a safety gate, the crisis path, escalation or referral.

### Order of precedence when rules conflict

This extends the archived resolver. It governs what a response says and does. It never governs disclosure: whether anything is shared with a supervisor follows only the consent rules under "Escalation", and a current "no" to sharing is absolute unless the owner adopts the emergency exception.

1. the safety and epistemic floor;
2. the client's explicit current instruction or refusal. The floor can hold back an exercise or add safety information; it never forces an intervention the client has declined;
3. current case evidence;
4. personal outcome cautions (only more careful);
5. method: the global map as adjusted by the practice overlay;
6. personal presentation, process and framing preferences;
7. defaults.

After composition, the safety gates and the final candidate audit run on the result. Nothing in steps 2–7 can skip them.

## The lesson ladder

1. **Feedback.** A client says what isn't working, or a draft edit or escalation answer produces a signal.
2. **Candidate.** The app drafts a generalized lesson and shows it to the client first.
   - Per the 2026-08-31 decision, free contribution is on by default, with free refusal for each candidate.
   - Raw therapy chat is never a contribution.
   - Evidence snippets are screened and stripped of identifying details.
3. **Supervisor review.** The supervisor approves, rejects or modifies the candidate.
   - An approval activates it for the supervisor's own practice and queues it for the owner.
   - A modified candidate is a new candidate. It is screened again and shown to the client again, with the same right to refuse, before the supervisor can approve it.
4. **Owner team review** under blocking consensus (next section). The owners either approve or reject:
   - An approval confirms the practice change. The owners can also adopt it for everyone as a new global version.
   - A rejection removes the practice change.
5. **Community input** runs alongside steps 3 and 4 wherever it makes sense (see below).

Any change to a lesson's text or evidence after the client's preview works like a supervisor's modification, including an owner's amendment during reconciliation. It goes back through screening and the client's preview before anyone can approve it. The owner may approve a candidate directly at any step after the client's preview. Every lesson records:
- its scope;
- its generalized text and reason;
- its evidence references;
- each approver and blocker, with reasons;
- the protocol version it produced.

## Owner team: blocking consensus

The owner's rule: one owner can decide if the others don't block, and a block leads to reconciliation. So stopping something takes one owner, at once. Starting or restarting something waits the window.

- **Approval.** Any owner may approve. An approval opens a 72-hour block window (owner decision 2026-09-26, "for now"; the team can change it later).
- **Block.** Any owner may block within the window, with a written reason. A block stops activation. Blocking the confirmation of a practice change that is already active also pauses it at once.
- **Rejection.** Any owner may reject, with a written reason. A rejection is decided like an approval: it opens the block window and takes effect if no other owner blocks it.
  - A rejected practice change is paused at once (that practice reverts to the global map) while the rejection's window runs.
  - If another owner blocks the rejection, reconciliation follows and the change stays paused meanwhile.
- **Reconciliation.**
  - The owners on each side, and any other owners, discuss in the lesson's thread.
  - It ends in one of three ways:
    - the disputed proposal is amended (an amended lesson goes back through the client's preview and restarts the window);
    - the owner who made the proposal withdraws it;
    - the block is lifted.
  - There is no majority override. An unresolved block keeps the status quo: nothing new activates, and a paused practice change stays paused, because the global map is the status quo.
  - Everything is logged.
- **Emergency pause** (owner decision 2026-09-26).
  - Any owner may pause a specific exercise, route or practice change at once, with a written reason. The whole team is told.
  - A pause only withholds. It can't add or change content, and it can never switch off a safety gate, the crisis path, escalation or referral. The runtime uses the map's other options in its place.
  - Lifting a pause is decided like an approval: any owner may approve the lift, and it takes effect after the block window unless another owner blocks it.
- **Single owner.** With one owner, approvals, rejections and lifts take effect at once.
- **Safety-floor changes** always wait the full window (see "Safety floor" above).

## Community input

- **Who.** Verified InnerSignal users and therapists, one account and one vote each. Tallies are shown by role (clients, therapists) and never merged into one number.
- **Where it makes sense:**
  - global lesson proposals (vote and comment);
  - practice changes submitted by clients (vote);
  - new map versions (a public changelog, with comments during the block window);
  - product features and roadmap (vote).
- **Where it doesn't:**
  - individual cases;
  - escalation contents;
  - crisis decisions;
  - personal learning;
  - the safety floor (comments only; owners decide).
- **Weight.** Votes are advisory. When a proposal draws strong support or opposition (the threshold is set by the team), owners must publish a short response.
- **Privacy.** Only generalized, screened lesson text is shown, never raw therapy chat.
- **Starting point.** The Commons design on the archive branch already covers moderation, safety holds, consent receipts and withdrawal. Rebuild it on the web-app stack when community work starts.

## Accounts, roles and the admin page (later)

- **Now.**
  - Keycloak holds accounts and passwords.
  - The server's settings hold each account's case access list and case keys.
  - Onboarding a client is a manual settings change plus a brief restart of the private server.
- **Later.**
  - PostgreSQL, per the 2026-09-19 stack decision, holds roles, case access, practice membership, lesson queues and votes.
  - An admin page manages them.
- **No password resets.**
  - Keycloak stays the only sign-in system.
  - Access is keyed by Keycloak account IDs, which never change, so the access list copies over as-is.
  - Case keys move unchanged, with no re-encryption.
- **Caution.** The stack spec mentions evaluating Supabase for authentication. Moving sign-in to a different system later could force password resets, depending on whether it can import Keycloak's stored passwords. This design therefore keeps Keycloak for sign-in and uses PostgreSQL only for application data. Changing that is an owner decision.

## Proposed phases

Each phase ships as its own PR:
- a Codex review;
- a cross-family check of its central design conclusions;
- owner approval before merge and deploy.

1. **Escalation for the free channel.**
   - the protocol version and hash, and the personal profile's version, recorded in every session and handoff;
   - `check_turn`, `request_supervision` and `get_supervisor_guidance` on the connector;
   - a minimal supervisor queue, with the free-user pool;
   - the spot-check sampler;
   - personal-learning fields, with a validation API usable by the local app.
2. **Supervised mode in the web app:** the therapist queue on the candidate lifecycle, the crisis path, backup supervisors and re-supervision.
3. **The lesson ladder:** practice overlays with their identity recorded in sessions and handoffs, the owner queue, blocking consensus (with rejection and the emergency pause), and keeping every activated protocol and overlay version for rollback and audit.
4. **Community input.**
5. **Database and admin page,** when manual onboarding becomes a burden.

## Open questions for the owner

The owner answered the first draft's questions on free-channel supervision, who supervises, the block window, emergency holds, supervisor unavailability and retention (see "Owner answers to the first draft"). These remain:

- Should anything ever be shared without consent at imminent danger? The default is no.
- An imminent-danger trigger for non-suicidal self-harm and any other risk type that has none yet.
- The spot-check rate and the community-response threshold.
- A legal review of consent, data handling and therapist licensing in the countries clients live in. This must happen before the paid launch; it is not researched here.
- How free users on phones get local storage, since there is no mobile local app yet.
