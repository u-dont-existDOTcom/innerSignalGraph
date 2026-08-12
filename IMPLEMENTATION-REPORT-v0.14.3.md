# Inner Signal runtime v0.14.3 implementation report

Status: release gates passed on 2026-08-12 UTC.

## Incident finding

The observed Claude/Fable extraction completed successfully. The following Codex case audit failed. In v0.14.2, the primary audit exception lost its stage identity, the generic fallback needlessly repeated extraction with Fable, and the reused Codex auditor failed again outside the recovery boundary. That second exception became the package-level `uncaught-error`.

The exact low-level provider message remains in the local runtime state. No upload is required: v0.14.3 classifies and displays the safe local cause itself.

## Correction

- Provider, parser, and schema failures now retain safe stage, role, provider, model, classification, retryability, action code, exit status, and timestamp fields.
- Validated A001 extraction is atomically checkpointed before audit.
- A retryable audit failure retries Codex once without repeating Claude extraction.
- A matching restart resumes the audit from the extraction checkpoint; changed guide, case, pipeline, lane, or exact model identity invalidates it.
- A Codex audit failure can no longer route to Fable. Fable remains limited to Claude-side extraction/reasoning/realization recovery.
- The Fable pipeline is inside the same recovery boundary, so case-stage failures cannot escape as package-level errors.
- Codex authentication recovery uses a one-shot browser login, verifies status, and automatically resumes validation with a loop guard.
- Terminal JSON, local Markdown status, and diagnostic export expose only the normalized safe cause.
- Diagnostic export includes the safe audit-attempt ledger and latest safe failure, but excludes the clinical extraction checkpoint and raw provider material.

## Non-regression boundary

This patch changes no canonical guide prose, therapy graph, owner decision, hypnosis contract, candidate approval, or installed production policy.

- Production bundle remains `inner-child-somatic-pilot-2026-08-09-r5`.
- Original r01 ZIP remains byte-identical: `9395cf2382ce14647d7f14c97268c53094ba822486be72a104e0e24fb0295263`.
- Corrected r02 remains uninstalled and owner-gated: `1c2970fbbe6aa3e132e0bfdcb226b3dab5ee5dccda1fde2b554613f8dff7b023`.

## Verification evidence

- Baseline v0.14.2 suite: 178/178 tests passed before modification.
- v0.14.3 source suite: 192/192 tests passed, including 14 new recovery regressions.
- Guide-graph suite: 12/12 passed.
- Full `npm run verify`: passed.
- Preserved r01 affected regressions: 4/4 passed.
- Corrected r02 affected regressions: 5/5 passed with the owner gate closed.
- Mock A001, mock H001, web/runtime smoke, exact-model fake CLI, syntax, and package-hygiene gates: passed.
- Clean ZIP extraction: `npm test`, `npm run graph:test`, and `npm run verify` all passed.
- Two consecutive install-only upgrades over a seeded v0.14.2 runtime: passed.
- Sixteen seeded `.env`, autopilot, development, ledger, and data files stayed byte-identical after each upgrade.
- Old v0.14.2 failure evidence and resume state survived both upgrades.
- Two rollback copies were created; installed r5 policy and the existing user candidate decision remained unchanged.
- Archive integrity and path traversal checks passed; no environment, credential, key, log, or temporary file is bundled.

## Live-provider boundary

The release environment did not make subscription-backed Codex or Claude calls. The runtime probes the locally authenticated exact models before model work. The actual low-level cause on the affected machine will therefore be classified from its preserved local state when v0.14.3 runs.

The release ZIP's adjacent `.sha256` sidecar is authoritative for the final archive digest.
