# Longitudinal therapy reasoning integration — 2026-09-08

Status: owner-authorized candidate refinement on stacked task branch from current draft PR #46. Synthetic/public artifacts only; no live model run, clinical validation, merge, deployment, installation, or stable promotion.

## Authority and starting point

Repository `u-dont-existDOTcom/innerSignalGraph`, source PR #46 branch `companion/foundations-2026-09-05`. Fresh source head before this task: `fd70a9bb2cb3fee85e3864f16974fb6be272a728`. Isolated task branch: `therapy/longitudinal-audit-lessons-20260908`.

Direct owner correction: complex therapy must preserve longitudinal goals, treat client appraisal as phenomenological evidence rather than global authority, switch probe modality before abandoning a target, avoid re-asking known information, and discriminate increased differentiation/integration from alienation/expulsion without forcing ontology or diagnosis. The audit harness must test these failures, and current development experiments must avoid provider/API spend.

## Existing behavior preserved rather than duplicated

Already present before this task:

- Path Performance Controller tracks prospective movement, adverse response, repeated low-information work, process switching, and preserves mixed benefit/harm.
- `turn-task.mjs` explicitly says not to ask information already provided and preserves current issue/task state.
- realization suppresses generic safety boilerplate when no deterministic trigger exists.
- representation delivery already distinguishes vividness/intensity from actual information or function and preserves symbolic ontology uncertainty.
- delivery-system assessment separates method benefit from provider/business/supervision trust.
- the audit-architecture harness already compares A-D, optional E, no-audit, patch versus reconstruction, good-control no-op behavior, blinding, and deterministic scoring.

No duplicate controller, graph branch, memory store, or clinical scoring system is added.

## New implementation

### Runtime/prompt invariants

`src/prompts/common.mjs` adds one reusable longitudinal rule set. It separates phenomenological authority from causal/importance authority; separates salience, importance, and centrality; preserves the established target; switches failed probes before abandoning targets; distinguishes differentiation from alienation/expulsion; treats weak examples as clarification signals; checks history before asking questions; tests client-generated hypotheses; and preserves explicit self-support targets without turning self-love into a universal cause.

`src/prompts/case-audit.mjs` receives the same invariant and explicit adversarial checks so extraction/path proposals can be corrected before deterministic routing. `src/prompts/realize.mjs` receives the invariant through the existing `sharedClinicalRules` composition.

`tests/longitudinal-therapy-reasoning.test.mjs` checks these shared runtime contracts and guards against private/case-specific leakage.

### Audit harness

The existing synthetic fixture is extended without real-client data. The case now contains an explicit long-term self-support target, a nonverbal critic-like experience, a client-generated tentative shame-protection hypothesis, already-known unchanged sleep, a client appraisal that a divided event is one among many, and a deliberately weak example for an earlier high-stakes phrase.

New seeded failure classes:

- `CLIENT_APPRAISAL_OVERDEFERENCE`
- `LONGITUDINAL_TARGET_LOSS`
- `PROBE_FAILURE_TARGET_ABANDONMENT`
- `INADEQUATE_EXAMPLE_OVERUPDATE`
- `HISTORY_OBLIVIOUS_REQUESTIONING`
- `CLIENT_HYPOTHESIS_MISHANDLING`
- `SALIENCE_CENTRALITY_COLLAPSE`
- `INTEGRATION_FRAGMENTATION_BINARY`

The rubric, reference target, good controls, and flawed drafts are updated. `LONGITUDINAL-AUDIT-SUPPLEMENT.json` applies these generic checks to the existing A-E architecture stages without changing topology or leaking seeded truth.

`longitudinal-lessons.test.mjs` checks corpus coverage, stable target IDs, good controls, prompt-stage coverage, owner decisions, and synthetic privacy.

### Current experiment decisions

`OWNER-DECISIONS-20260908.json` supersedes the earlier unresolved paid-provider live-run questions for current development:

- no paid/API provider calls;
- orchestrate authenticated ChatGPT tabs/conversations via Codex/Mission Control;
- GPT-5.6 Sol Extra High for candidate/audit stages;
- deterministic scoring plus two fresh blinded Extra High grading passes as the primary evaluation;
- Pro optional only as a dissenting information-gain/wrong-path/missed-alternative critic, with Pro-only findings adjudicated by fresh Extra High without source disclosure;
- behavioral target is a reference rubric, not uniquely correct ground truth;
- four-case maximally discriminating smoke including a good-response control before full corpus;
- separate small Extra High versus visible selector label `Latest` smoke, with no backend-identity inference;
- no automatic runtime adoption; freeze outputs/scores/findings and require owner/human review;
- penalize false-positive critique, safety inflation, repetition, unjustified length, needless good-response rewrites, and repair-induced errors.

## Privacy boundary

All public fixture language is synthetic and paraphrased. No real client name, identifying location, contact detail, exact personal fee/income, source conversation ID, verbatim transcript, or private-derived hash is intentionally stored. The task-level tests also guard several representative private identifiers/amount patterns.

## Verification boundary

Focused runtime and harness tests plus the complete package gate must pass on the final task head. Current PR #46 may advance concurrently; before any integration into its source branch, re-fetch the remote head and require a normal fast-forward/reconciliation. Existing unrelated current-head failures must remain visible and cannot be waived by this task.

The exact final task commit and hosted check identities belong in the task PR/closeout receipt rather than this self-referential file.
