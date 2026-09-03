# Worker → Brave Pro Review Protocol

## Status and provenance

This document is the canonical project-local review-and-transport contract. It is a project-local canonical composition of current universal authority and project-historical corroborating evidence, not a byte-for-byte recovery or restoration of a formerly tracked protocol.

The reusable supervision rules are pinned to `u-dont-existDOTcom/universal-dev-architecture` commit `83a3b7a2728d04fca94035fd59b8eb33f18bdf7b` and these sources:

- `LESSON-INDEX.md`
- `templates/CURRENT-CODEX-WORKER-SUPERVISION-BOOTSTRAP.md`
- `templates/CHAT-TO-CODEX-EXECUTION-DIRECTIVE.json`
- `patterns/chat-led-reasoning-codex-execution-separation.md`
- `patterns/codex-supervision-intelligence-routing-and-context-lifecycle.md`
- `patterns/codex-supervision-resource-routing-account-failover-and-browser-hygiene.md`
- `patterns/persistent-browser-automation-hygiene.md`
- `patterns/independent-evaluation-separation.md`
- `patterns/research-before-reinvention.md`
- `feedback/mission-control/SDF-20260902-GITHUB-FINAL-HEAD-CHECK-LIVENESS-001.json`

Project-specific prior practice is corroborated by the owner-authored PR #15 comment `5487680022` and owner-authored PR #15 comment `5494364061`. Those comments are historical provenance, not authority above current owner instructions, current project authority, or the pinned universal rules.

Remembered chat fragments, assistant recollections, private browser state, untracked handoff files, and invented historical filenames are not protocol sources.

## Authority boundary

This protocol governs review execution and transport only. Current owner instructions and project authority outrank it. It cannot grant implementation, architecture, product-policy, owner-decision, merge, release, publication, deployment, or stable-promotion authority.

The required logical flow is:

> owner/project authority → Extra High reasoning → versioned bounded directive → Codex execution → immutable receipt/evidence → Extra High exact-head review → Pro when required → Extra High reconciliation → next bounded directive | `OWNER_DECISION_REQUIRED` | bounded non-owner blocker

Extra High may inspect GitHub directly. It owns ordinary reasoning, repository review, evidence interpretation, and versioned directive composition.

Codex may execute, test, collect evidence, perform Git operations explicitly authorized by the current directive, create an authorized Draft PR, and transport an already-authored review packet. Codex may not invent strategy, architecture, owner policy, the substantive Pro question, supervisory verdicts, or new execution scope.

Pro is invoked only when current routing requires the higher-intelligence judgment. Pro review is not owner authority and cannot authorize merge or a later implementation slice. Codex or browser transport cannot substitute for required Extra High or Pro reasoning.

If a governance change materially changes this review architecture, it must pass the current universal Pro meta-review boundary before it is review-complete.

## Self-contained Pro evidence boundary

Pro must receive a self-contained packet. Pro must not be expected to retrieve GitHub or filesystem evidence.

Every review packet must bind to the following exact evidence:

- directive ID;
- repository;
- exact base commit/tree;
- exact candidate commit/tree;
- branch;
- exact changed paths;
- allowed and prohibited scope;
- complete relevant diff/content;
- deterministic test and audit evidence;
- hosted workflow run/job/check identities and conclusions;
- unresolved findings;
- provenance sources;
- bounded review question.

Raw evidence must remain distinguishable from Extra High interpretation. A generic badge, stale workflow, zero-job placeholder, or differently headed status is not valid exact-head CI proof. Required checks must correspond to substantive workflow runs, jobs, and checks on the exact reviewed head.

Head movement invalidates prior exact-head review evidence. Rebuild the packet, hosted evidence, and reviewer handoff against the new exact head before relying on them.

## Independent review

Where independence matters, give Pro only decision-essential authority and evidence for the initial pass. Avoid contaminating that pass with producer rationales or prior verdicts when they are not needed. Freeze findings before reconciliation, then reconcile them against authoritative context. Pro findings are evidence, not owner authority.

## Brave transport boundary

Brave is review transport/authentication state only, never authority.

Review transport must:

- use the appropriate dedicated authenticated task and account context;
- preserve distinct accounts and contexts as distinct namespaces;
- use established persistent-profile isolation when authentication persistence is necessary;
- prefer headless operation by default where compatible with the authenticated workflow;
- avoid unnecessary desktop-focus stealing;
- reuse an existing task-specific review chat only while its scope, authority epoch, and context remain valid;
- treat automation-opened tabs as leased resources and intentionally reuse or close them at the task boundary;
- Owner email addresses, passwords/credentials, cookies, authentication tokens, session identifiers, authentication files, private profile paths, and private chat URLs must remain out of Git and out of review packets/evidence;
- Private application content must remain out of public Git and public repository evidence;
- Minimum-necessary private application content may be included in a private review packet only when all of the following permit it: current owner authority, current project authority, applicable data classification, the selected authenticated account/context, and evaluator authorization;
- the receiving account/context must be verified before transmission;
- if decision-essential private context cannot permissibly be supplied, do not transmit it; do not silently omit it and claim the independent review is valid or complete; preserve the evidence gap; and return it to Extra High for routing under the existing authority/owner-decision boundary;
- use only bounded supported recovery after transport failure.

This conditional boundary is not a blanket permission to transmit private application content. It does not authorize therapy transcripts, credentials, browser secrets, private account mapping, or unrestricted private data.

Browser failure is a transport failure, not an owner-policy decision. If transport cannot be restored within the authorized recovery boundary, preserve the exact self-contained packet and return `BROWSER_TRANSPORT_BLOCKED`; do not substitute Codex or an unauthorized model as reviewer.

## Owner-decision gate

Return `OWNER_DECISION_REQUIRED` only for a genuine owner-controlled choice involving product policy, safety, privacy, an irreversible action, spending or access, or an equivalent reserved decision, or when the authorized reasoning lane determines that such a choice exists.

CI failures, ordinary bugs, browser failures, stale evidence, and deterministic source or integrity defects are non-owner blockers. They must not be converted into owner-policy questions.

## Review outcomes

- `ACCEPT`: verify that the reviewed commit/tree still matches the Draft PR and preserve the privacy-safe review receipt. Acceptance does not itself authorize merge or later work.
- `FIX_REQUIRED`: preserve the exact reviewed head and findings and return them to Extra High. Codex does not invent or execute a semantic repair without a new bounded directive.
- `OWNER_DECISION_REQUIRED`: preserve the exact decision finding and route one complete decision card to the owner.
- `BROWSER_TRANSPORT_BLOCKED`: preserve the immutable packet and stop transport attempts outside bounded supported recovery.

## DEV-R005 non-authority

`DEV-R005 S002 AUTHORIZED: false`.

This protocol:

- does not reopen PR #36 or extend its S001 implementation;
- does not alter D001–D004;
- does not alter `DEV-R005-EXEC-S001-v1`;
- preserves that `laterSlicesAuthorized` remains `false`;
- does not authorize DEV-R005 S002;
- does not authorize storage implementation;
- does not select or implement cryptography or persistence/database behavior;
- does not implement OS credential integration, fallback authentication, migration, recovery, deletion, import/export, network transport, account identity, inactivity defaults, retention, or plugin behavior;
- does not touch application behavior;
- does not touch therapy/hypnosis behavior;
- does not authorize `stable`, release, deployment, or publication changes.

The protocol creates no runtime or private-state migration and stores no private application or therapy-session content.
