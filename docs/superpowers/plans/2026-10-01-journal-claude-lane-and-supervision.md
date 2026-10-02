# Journal import: the Claude lane, supervisor review, and retiring routine review

Date: 2026-10-01. Author: Claude (Opus), for implementation by Codex. Status: sections 1 and 2 implemented for the hardest tier on 2026-10-02; supervisor tier, section 3, and section 4 deferred by the owner. Built on the Codex exec lane (`2026-10-01-journal-codex-lane.md`). Classification: public design; no private data.

## Owner decisions

- 2026-09-28: steps that fail all standard attempts get one hardest attempt from Claude Opus, at most 20 a day; past that the run pauses until the next UTC day.
- 2026-10-01: the supervisor review uses Claude Opus at max effort.
- 2026-10-01: the goal is to improve the import so that routine supervisor review isn't needed. The review is a measurement that drives fixes, not a permanent stage.

## What a Claude Code run can prove (probed 2026-10-01, Claude Code 2.1.286)

- `claude -p ... --output-format json` reports `is_error`, `subtype`, `num_turns`, a `session_id`, and `modelUsage` keyed by the model that actually answered. That is response-reported model evidence, stronger than the Codex lane's request-pinned evidence. Effort is still request-pinned (`--effort`).
- With `--no-session-persistence`, `--strict-mcp-config`, `--tools ""` and only the two journal tools allowed, a run against a synthetic two-tool server fetched the packet and submitted the answer. A sentinel string in the packet appeared nowhere under `~/.claude` or in `~/.claude.json` afterwards.

## Rules

As in the Codex lane plan: no journal text, packets or answers in Git, logs or PR text; synthetic tests with sentinels; unchanged job IDs and operation keys for existing work; the listed gates pass; a state entry and a `docs/INDEX.md` line with its SHA-256 binding.

## 1. The Claude lane — implemented for hardest work

Generalize the worker to `--agent codex|claude` (keep `journal:work:codex` as the Codex default).

- **Where it runs.** Claude Code is signed in on the owner's laptop; the exchange is on the import host. With `--remote <ssh host> --remote-checkout <path> --remote-config <path>`, every exchange action runs on the host over SSH (`-o BatchMode=yes -o ClearAllForwardings=yes`):
  - the dispatch listing;
  - the stdio work server, as the MCP server's command (`ssh ... node <checkout>/src/cli/journal-work-mcp.mjs ... --stage-dir <host dir>`);
  - promotion, through a new content-free subcommand on the host: `npm run journal:work -- promote --work-id <id> --stage-dir <dir> --execution-json <json> --subject <name>`.
  The secret never leaves the host.
- **The run.** In a new empty temporary directory, without a shell, environment limited to `PATH`, `HOME` and `LANG`:

  ```text
  claude -p "<instruction>" --model <record.model> --effort <record.effort> --output-format json
    --mcp-config <0600 file> --strict-mcp-config --tools ""
    --allowedTools mcp__journal__get_journal_work_packet mcp__journal__submit_journal_work_result
    --permission-mode dontAsk --no-session-persistence
  ```

  Dispatch labels for this lane: model `claude-opus-5-5`, effort `max`. The Claude Code model argument is `opus`; map the label explicitly and refuse any other.
- **Admission.** Exit 0; `is_error` false and `subtype` `success`; a `session_id`; `modelUsage` contains the record's model and no other model with output tokens; a staged answer exists. Keep only those fields and the token counts; never keep `result`.
- **Evidence.** `execution: { profile_evidence: "claude_code_model_usage_reported", effective_model_profile: <the model key from modelUsage>, effective_effort: record.effort, request_context_id: "claude-session:" + session_id }`, subject `local:claude-hardest`. The exchange port accepts this evidence kind for the `hardest` tier on the Codex route. Supervisor admission is deferred.
- **Usage limits.** As the Codex lane, parsing only a reset time. The usage log adds `total_cost_usd`, labelled everywhere as a cost equivalent that a subscription doesn't charge.

The implemented worker is `npm run journal:work:claude -- --remote <ssh host> --remote-checkout <host checkout> --remote-config <host private config> --work-dir <laptop private work dir>`. The host must provide the exchange-root and secret-file environment variables to its noninteractive SSH command. The remote worker passes no exchange secret or secret-file path in its command arguments or laptop MCP configuration. The content-free host commands are `journal:work -- dispatch --json`, `stage-create`, `stage-check`, `promote`, and `stage-remove`. `total_cost_usd` is recorded with `cost_kind: subscription_cost_equivalent_not_charged`.

## 2. Tiers — hardest implemented; supervisor deferred

- The proposed third tier, `supervisor`, is deferred to the later supervisor task by the 2026-10-02 owner instruction. The exchange, dispatch records, and work server still accept only `standard` and `hardest`.
- On a `codex_exec_exchange` route, `hardest_lane.enabled` becomes available: hardest items carry model `claude-opus-5-5` and effort `max`, and `hardest_fresh_context_per_generate` and `hardest_authenticated_execution_profile_per_generate` are true. The daily limit and pause keep their current behaviour.

## 3. `npm run journal:import -- supervise --config <cfg> [--sample <n>]`

Runs on the host after a pilot or a full run, against the run's current committed or candidate generation.

- **Sample.** At least 20 units or 5% of processed units, whichever is larger, capped at the processed units. Stratify by the unit's outcome (clean, repaired, needs review), by size, and by stage of origin (text, visual). Include the units the importer's own audit sampled, up to half the sample, so the two audits can be compared. Store the seed and the sample, and reuse them on rerun.
- **Work.** For each sampled unit, the same two audit roles the importer's own audit uses, built by the same shared request builders: the source-first `reference_reader`, then the `fidelity_auditor` on the unit's imported records. They go out as `supervisor`-tier items under their own job IDs.
- **Report** (private runtime; the summary shows only counts and unit IDs):
  - per unit: preserved, omitted, distorted and unassessed reference items, critical misses, qualifier errors;
  - for units both audits covered: agreement counts per outcome pair (for example `supervisor: omitted, importer: preserved`);
  - for each omitted or distorted finding, the first stage that could have caught it: extraction (no record at all), the omission check (it ran and passed), reconciliation (it changed the record), or the importer's own audit (it scored the item preserved);
  - totals, and the residual counts this adds to the run summary under `supervisor_review`.

## 4. Retiring routine review

Proposed defaults; the owner can change them.

- Every finding the importer's own audit missed becomes a process fix (packet content, role instruction, batch bound, or a new mechanical check) with a synthetic test, and the next sample measures it again.
- Routine supervision stops after two consecutive samples in which the supervisor finds no critical miss that the importer's own audit missed, and the two audits agree on at least 90% of omitted and distorted items.
- After that, supervise one import in ten, and every import whose own audit reports a critical miss or more than 5% of audited units needing repair.

## Tests

1. A fake `claude` executable, reached through a fake SSH command that runs the host side locally: round trip for a hardest item, with response-reported evidence admitted only for that tier on the Codex route. The supervisor case belongs to the deferred supervisor task.
2. Admission refusals: `is_error`, a second model with output tokens, a missing session ID, nothing staged, timeout.
3. The secret never appears in arguments or on the laptop side; the mapped model argument; an unmapped label refused.
4. Deferred with section 3: `supervise` sampling, agreement, stage-attribution and summary tests.
5. Hardest lane on the Codex route: enabled, daily limit pause, replay without resend.
