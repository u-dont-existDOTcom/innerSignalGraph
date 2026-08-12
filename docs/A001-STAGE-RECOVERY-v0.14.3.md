# Inner Signal v0.14.3 — A001 Stage-Aware Recovery

## Failure corrected

The v0.14.2 live run showed this sequence:

```text
case_extraction: completed — claude-fable-5
case_audit: started — gpt-5.6-sol
BLOCKED: uncaught-error
```

The normal A001 pipeline had already caught a Codex auditor failure. Its fallback treated every missing result as a Claude reasoning problem, reran extraction with Fable, reused the same failing Codex auditor, and left that second pipeline call outside the recovery boundary. The package-level catch then hid the stage-specific cause.

## Corrected contract

- Model calls fail with an allowlisted stage, role, provider, exact model, normalized class, retryability, action code, exit status, and timestamp.
- Raw prompts, transcripts, model output, stdout/stderr, and credentials are not copied into that safe failure object.
- A001 writes the validated extraction atomically before audit.
- Retryable audit failures retry Codex once and reuse the extraction.
- A matching restart resumes the audit; a changed guide, pipeline revision, lane, or exact extractor model invalidates the checkpoint.
- `case_audit` failure is terminal for the OpenAI role and cannot select Fable.
- Fable remains available for a completed result that fails the reasoning or realization acceptance contract.
- Every Fable pipeline exception is caught before the package boundary.
- Codex authentication expiry invokes one official browser login, verifies `codex login status`, and resumes automatically.
- Terminal output and local status show the normalized failure directly.
- Recovery export includes only the safe A001 attempt ledger, never the clinical extraction checkpoint.

## Compatibility boundary

The repair does not modify guide prose, graph routing, therapy sequencing, hypnosis contracts, owner decisions, or installed policy. Production remains `inner-child-somatic-pilot-2026-08-09-r5`. The preserved r01 candidate and corrected uninstalled r02 candidate remain unchanged.

The Fable extraction completed during the failed v0.14.2 run cannot be reused because that version did not persist it. v0.14.3 may repeat it on the first validation. Once v0.14.3 completes an extraction, later audit retries and restarts reuse it.
