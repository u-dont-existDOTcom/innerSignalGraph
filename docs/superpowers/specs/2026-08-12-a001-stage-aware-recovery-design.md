# A001 stage-aware recovery design

Date: 2026-08-12
Target release: Inner Signal v0.14.3

## Observed failure

The v0.14.2 live run completed `case_extraction` with `claude-fable-5`, then began `case_audit` with `gpt-5.6-sol`, and terminated as `uncaught-error`. The source trace proves the control-flow chain:

1. The normal A001 pipeline failed and stored only a generic `primaryError`.
2. Any primary error was treated as a reason to rerun the complete formulation with Fable.
3. That rerun repeated the same OpenAI auditor that had already failed.
4. The second pipeline call was outside the A001 recovery `try/catch`, so its audit exception escaped to the package-level handler.

This means the visible failure was not a Fable failure. It was an auditor-stage failure that the coordinator misrouted and then failed to classify.

## Required behavior

- A provider or validation failure is attributed to its exact stage and role.
- A Codex audit failure never triggers a stronger Claude extraction by itself.
- A successful extraction is durably checkpointed before audit begins.
- A retry resumes the failed audit from the checkpoint and does not repeat Claude work.
- Only errors classified as retryable receive one bounded automatic retry.
- A deterministic audit failure stops as a named `A001-case-audit` blocker with its normalized cause and an automatic next action.
- No A001 stage exception may escape as `uncaught-error`.
- The terminal, status API, and privacy-safe recovery export contain the same normalized failure classification.
- Diagnostics exclude prompts, transcripts, model reasoning, credentials, raw therapy content, and raw provider output.
- Existing H001/A001 full checkpoints remain reusable, and production guide revision r5 plus staged guide packets remain unchanged.

## Approaches considered

### Catch the second exception only

This would improve the status text but would still repeat Fable work and would keep routing Codex failures to Claude escalation. It does not satisfy the no-wasted-calls or resume requirements.

### Stage-aware A001 controller (selected)

Introduce a small A001 validation controller that owns stage attribution, a privacy-safe formulation checkpoint, bounded audit retry, and terminal failure shaping. Existing formulation and therapy pipeline functions remain the execution units; the controller coordinates them without weakening acceptance gates.

### General background-job engine

Moving A001 into the development job system would offer broader durability, but it would duplicate the established benchmark/checkpoint contract and enlarge a targeted repair. It is deferred.

## Components and data flow

### Stage-attributed errors

Structured formulation calls wrap provider, parsing, and validation failures with:

- stage (`case_extraction` or `case_audit`),
- provider and exact model,
- normalized failure class,
- retryability,
- privacy-safe message/code/details.

Raw prompts and responses are not attached.

### A001 formulation checkpoint

After extraction succeeds, the controller atomically writes an A001 stage checkpoint under the existing autopilot state root. It contains the validated structured snapshot, exact extractor identity, guide/model fingerprint, completion time, and no transcript or raw response. A checkpoint is reused only when its fingerprint matches the current A001 case, guide, exact models, and pipeline revision.

The checkpoint is removed or superseded after a complete accepted A001 result is written. A stale or incompatible checkpoint is ignored safely.

### Audit recovery

The controller runs `gpt-5.6-sol` against the checkpointed snapshot. It retries once only for a classified transient transport/service failure or a correctable structured-result failure. Retry progress explicitly says that Claude extraction is being reused. Authentication, missing-model, CLI incompatibility, bad configuration, and unsupported-schema failures are deterministic and are not retried.

If audit still fails, A001 finishes with `BLOCKED`, stage `A001-case-audit`, and the normalized cause. It does not enter Fable escalation. Fable remains available only when completed reasoning or acceptance evidence shows a Claude-side reasoning/realization deficiency.

### Status and diagnostics

The final status summary names the failed role and model. `nextAction` states whether the next launch will retry from the saved extraction or whether a corrected runtime is required. The status payload and diagnostic export include the normalized stage-attempt ledger, never raw clinical content.

## Testing

Regression tests must prove:

1. An initial Codex audit failure does not call Fable.
2. A retryable audit failure retries only Codex and reuses one extraction.
3. A deterministic audit failure is not retried and becomes `A001-case-audit`, never `uncaught-error`.
4. A process restart resumes audit from a matching extraction checkpoint without another Claude call.
5. An incompatible checkpoint is ignored.
6. The diagnostic/status representation contains the exact normalized class while excluding transcript, prompt, raw output, and credentials.
7. Existing A001, H001, graph, guide-packet, server, clean-install, and dirty-upgrade gates remain green.

## Scope boundaries

This release does not change therapy policy, guide prose, graph routing, acceptance criteria, model assignments, or candidate installation state. It repairs orchestration, durability, and diagnostics only.
