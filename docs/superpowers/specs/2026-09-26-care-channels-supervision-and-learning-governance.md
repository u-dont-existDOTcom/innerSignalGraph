# InnerSignal care channels, supervision and learning governance

Date: 2026-09-26
Status: PROPOSED DESIGN built on owner requirements stated 2026-09-26. Nothing here is implemented. It grants no runtime, therapy-policy, installation, deployment or release authority. Therapy content changes stay owner-gated.

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
| InnerSignal server storage | none by default; only consented escalation packages | the private case |
| Supervision before sending | not possible: the host sends the reply straight to the client | possible (supervised mode) |
| Supervision after sending | escalations and spot checks | escalations and spot checks |

### Local storage for free users

The free channel talks to InnerSignal's hosted connector, and the server keeps no case data for free users. Continuity has three options:

1. **The InnerSignal local app on the client's own computer.** It already keeps an encrypted case on the device. Serving that case to desktop Claude as a local connector is new work. This is truly local, and it's the recommended option where the client has a computer.
2. **The host's own memory or project features.** This needs no install, but the data then sits with the provider under the client's account. Per the 2026-08-31 decision, that isn't private from the provider, and the sign-up agreement must say so.
3. **A portable encrypted case file** the client keeps and attaches when they want continuity.

**Tradeoff:** server-enforced scope rules for personal learning (below) need option 1, or paid server storage. With option 2 only, the rules are instructions to the model rather than enforced checks.

### Paid privacy claims

Before InnerSignal advertises privacy for the API path, re-verify the current API data terms of each model provider. The facts recorded on 2026-08-31 are dated.

## Supervised mode (web app)

The private runtime already works this way:
- it drafts a candidate response;
- it audits the draft;
- it delivers only an explicitly approved, exact-version candidate (`src/supervisor/private-candidate-lifecycle.mjs`, `private-candidate-audit.mjs`).

Supervised mode puts the therapist at that approval step, with a queue where the therapist can approve, edit or reject each draft.

- **Crisis path.** A message showing risk never waits in the queue. The client immediately gets a safety response and help resources, and the supervisor gets an urgent alert.
- **Asynchronous by design.** Clients are told up front that replies come after review, like messaging a therapist, not live chat.
- **Edits are lessons.** The difference between a draft and the approved reply becomes a lesson candidate automatically, subject to the client's consent.

## Escalation: never fully unsupervised

A model's own sense that it is unsure misses the cases where it is confidently wrong, so escalation has three sources.

1. **The model's own flag.** A connector tool, `request_supervision`, carries the model's question, its proposed direction and the minimal excerpt.
2. **Events the server detects.** These need no self-report:
   - the protective-compatibility (child-contact) gate reaching HOLD or BLOCKED;
   - the candidate audit disagreeing with the draft;
   - risk indicators;
   - altered-state capacity concerns;
   - requests for child-contact exercises;
   - repeated signals from the client that it isn't helping;
   - situations with no applicable map node.
3. **Random spot checks** of sessions that were never escalated, at a rate the owner sets. These catch confident mistakes.

**While an escalation waits:**
- **Web app:** hold the reply if a supervisor is available within the promised window. Otherwise send a cautious reply and queue the review.
- **Free channel:** send a cautious reply now. The supervisor's guidance reaches the client at their next session, through `get_supervisor_guidance`. That return path needs a free InnerSignal account.
- **What "cautious" means:** slow down, stay with the present, start no new deep exercise, and tell the client a therapist will look.

**Consent.** At sign-up, clients agree that a supervisor may read escalated excerpts. The model can also ask in the moment ("can I check this part with a therapist?"). An escalation package contains only the excerpt, the question and the proposed direction, never the whole history.

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

- A lesson the supervisor approves applies to that supervisor's own clients immediately, and enters the owner queue at the same moment.
- Clients see a short changelog of practice changes that affect them. Each entry has a **Submit for owner review and community vote** button.
- If an owner blocks a practice change, it is paused and that practice reverts to the global map until reconciliation ends. This is how supervisors stay tied to InnerSignal's purpose.

### Global: owner team

- These are changes to the map and rules for everyone.
- Each activation is a new protocol version. The server already reports a version and hash, so every session and handoff shows which version it used, and any version can be rolled back.

### Safety floor: owner team only

- The floor covers:
  - crisis handling;
  - the protective-compatibility gate;
  - altered-state safety;
  - referral rules;
  - epistemic rules (for example, never validating recovered-memory certainty).
- Neither personal learning nor a practice approval can change it.
- **Tightening vs loosening.** A change that makes the floor stricter may go live on one owner's approval while the block window runs. A block then reverts it. A change that makes the floor less strict never goes live before its window ends.

### Order of precedence when rules conflict

This extends the archived resolver.

1. the safety and epistemic floor;
2. the client's explicit current instruction or refusal (the app never overrides a "no");
3. current case evidence;
4. personal outcome cautions (only more careful);
5. method: the global map as adjusted by the practice overlay;
6. personal presentation, process and framing preferences;
7. defaults.

## The lesson ladder

1. **Feedback.** A client says what isn't working, or a draft edit or escalation answer produces a signal.
2. **Candidate.** The app drafts a generalized lesson and shows it to the client first.
   - Per the 2026-08-31 decision, free contribution is on by default, with free refusal for each candidate.
   - Raw therapy chat is never a contribution.
   - Evidence snippets are screened and stripped of identifying details.
3. **Supervisor review.** The supervisor modifies, approves or rejects the candidate. An approval activates it for the supervisor's own practice and queues it for the owner.
4. **Owner team review** under blocking consensus (next section). The outcome is a new global version, or a rejection. A rejection also removes the practice change.
5. **Community input** runs alongside steps 3 and 4 wherever it makes sense (see below).

The owner may approve a candidate directly at any step. Every lesson records:
- its scope;
- its generalized text and reason;
- its evidence references;
- each approver and blocker, with reasons;
- the protocol version it produced.

## Owner team: blocking consensus

- **Approval.** Any owner may approve. An approval opens a block window, which the team sets (proposed default: 72 hours).
- **Block.** Any owner may block within the window, with a written reason. A block stops activation.
- **Reconciliation.**
  - The approver, the blocker and any other owners discuss in the lesson's thread.
  - It ends in one of three ways: the lesson is amended (which restarts the window), withdrawn, or the blocker lifts the block.
  - There is no majority override. An unresolved block keeps the status quo.
  - Everything is logged.
- **Single owner.** With one owner, an approval activates at once.
- **Safety changes** follow the tightening and loosening rules above.

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
   - `request_supervision` and `get_supervisor_guidance` on the connector;
   - a minimal supervisor queue;
   - the spot-check sampler;
   - personal-learning fields, with a validation API usable by the local app.
2. **Supervised mode in the web app:** the therapist queue on the candidate lifecycle, plus the crisis path.
3. **The lesson ladder:** practice overlays, the owner queue, and blocking consensus.
4. **Community input.**
5. **Database and admin page,** when manual onboarding becomes a burden.

## Open questions for the owner

- Who supervises free users' escalations, and with what capacity?
- The block window length, the spot-check rate, and the community-response threshold.
- A legal review of consent, data handling and therapist licensing in the countries clients live in. This must happen before the paid launch; it is not researched here.
- How free users on phones get local storage, since there is no mobile local app yet.
