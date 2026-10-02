# Journal import: the Claude lane, supervisor review, and retiring routine review

Date: 2026-10-01. Author: Claude (Opus), for implementation by Codex. Status: sections 1 and 2 implemented for the hardest tier on 2026-10-02; supervisor tier, section 3, and section 4 deferred by the owner. Built on the Codex exec lane (`2026-10-01-journal-codex-lane.md`). Classification: public design; no private data.

## Owner decisions

- 2026-09-28: steps that fail all standard attempts get one hardest attempt from Claude Opus, at most 20 a day; past that the run pauses until the next UTC day.
- 2026-10-01: the supervisor review uses Claude Opus at max effort.
- 2026-10-01: the goal is to improve the import so that routine supervisor review isn't needed. The review is a measurement that drives fixes, not a permanent stage.

## What a Claude Code run can prove (synthetic sentinel probes 2026-10-02, Claude Code 2.1.286 and 2.1.287)

- `--output-format stream-json --verbose` emits init with MCP server names/statuses, tools, skills, slash commands, plugins, agents, session ID and `claude_code_version`; result carries `is_error`, `subtype`, `session_id`, `modelUsage` and usage. The owner's 2.1.286 run began with `system/init`; the reviewer's real 2.1.287 run against a fake Anthropic API began with content-free `system/ui_invalidate`, followed by init. `--include-hook-events` reports hook lifecycle events. Stream lines are parsed only in memory; packet/answer/result prose is never retained in worker logs.
- The owner's current customizations still load with the earlier flags: 3 plugins, 20 skills, 57 slash commands and 5 agents, and plugin hooks are present. `--safe-mode` was rejected because it also removes the configured MCP server and tools. `--bare` was rejected because it requires API-key authentication while this lane uses the owner's sign-in.
- `--setting-sources "" --settings '{"disableAllHooks":true}' --disable-slash-commands` with `--strict-mcp-config --tools ""` yielded exactly `journal:connected` and the two journal tools, zero skills and slash commands. Plugins and agents still appeared in init; their counts are recorded, not asserted zero. The 2.1.287 reviewer probe found no CLAUDE.md or AGENTS.md at the API and no hook events. These measurements support the flags' isolation behavior, not a provider attestation about hidden context.
- The SSH probe authenticated with only `PATH`, `HOME` and `LANG`, `BatchMode=yes`, and a key file without an agent. Every SSH invocation also disables agent and X11 forwarding.
- Persistence measurement: a 120 KB MCP result was saved as plaintext at `~/.claude/projects/<slug(cwd)>/<session-id>/tool-results/mcp-journal-<tool>-<n>.txt` despite `--no-session-persistence`; the model saw only about a 2 KB preview. A 40 KB result on 2.1.287 was not saved; the observed threshold is about 50 KB. Declaring `_meta: {"anthropic/maxResultSizeChars": 500000}` stopped saving in the probe and delivered the complete result. Its stream-json line was 246 KB because the packet appeared about twice. This is bounded version-specific evidence, not a promise for all future CLI releases.
- Every run created an empty `~/.claude/projects/<slug(cwd)>/` directory and about a 1.7 KB successful-call MCP log at `~/.cache/claude-cli-nodejs/<slug(cwd)>/mcp-logs-journal/<timestamp>.jsonl`. Success logs had no result prose, but an `isError: true` tool result was logged in full. The slug replaces each non-alphanumeric character of absolute cwd with `-` (`/tmp/tmp.AbC` becomes `-tmp-tmp-AbC`). The measured `~/.claude.json` gained neither sentinel nor slug. The worker does not edit that shared sign-in file.
- A real HTTP 429 on 2.1.287 emitted an assistant with `error: "rate_limit"`, followed by a result with `is_error: true`, `subtype: "success"`, `api_error_status: 429`, then exited 1. That version also defines `rate_limit_event` with status and `resetsAt`. Limit classification precedes exit-code refusal.

## Rules

As in the Codex lane plan: no journal text, packets or answers in Git, logs or PR text; synthetic tests with sentinels; unchanged job IDs and operation keys for existing work; the listed gates pass; a state entry and a `docs/INDEX.md` line with its SHA-256 binding.

## 1. The Claude lane — implemented for hardest work

Generalize the worker to `--agent codex|claude` (keep `journal:work:codex` as the Codex default).

- **Where it runs.** Claude Code is signed in on the owner's laptop; the exchange is on the import host. With `--remote <ssh host> --remote-checkout <path> --remote-config <path>`, every exchange action runs on the host over SSH (`-o BatchMode=yes -o ClearAllForwardings=yes`):
  - the dispatch listing;
  - the stdio work server, as the MCP server's command (`ssh ... node <checkout>/src/cli/journal-work-mcp.mjs ... --stage-dir <host dir>`);
  - promotion, through a new content-free subcommand on the host: `npm run journal:work -- promote --work-id <id> --stage-dir <dir> --execution-json <json> --subject <name>`.
  The secret never leaves the host.
- **The run.** In a new empty temporary directory, without a shell, environment limited to `PATH`, `HOME`, `LANG` and `XDG_CACHE_HOME=<per-item run dir>/cache`. SSH host actions still receive only PATH, HOME and LANG. The CLI invocation is:

  ```text
  claude -p "<instruction>" --model <record.model> --effort <record.effort> --output-format stream-json --verbose
    --setting-sources "" --settings '{"disableAllHooks":true}' --disable-slash-commands --include-hook-events
    --mcp-config <0600 file> --strict-mcp-config --tools ""
    --allowedTools mcp__journal__get_journal_work_packet mcp__journal__submit_journal_work_result
    --permission-mode dontAsk --no-session-persistence
  ```

  Dispatch labels for this lane: model `claude-opus-5-5`, effort `max`. The Claude Code model argument is `opus`; map the label explicitly and refuse any other.
- **Full packet and memory bounds.** Both stdio tool definitions declare `_meta: {"anthropic/maxResultSizeChars": 4194304}`. This exceeds the 180,000-byte source extraction/reconciliation bounds in `private-runtime.mjs` and the default 50,000-byte pattern bound in `pattern-stage.mjs`, with room for schema, instructions and context. Configurable batching alone is not a global cap: the exchange caps the entire encrypted entry at 4 MiB. `packet-check` measures the exact serialized fetch value on the host before starting Claude, and the hardest tool independently enforces the same character cap. Over-limit items have content-free `rejected:PACKET_TOO_LARGE` outcomes and are never truncated. The Claude reader allows 49 MiB per line (two copies, up to sixfold JSON escaping, plus 1 MiB overhead) and 196 MiB per stream, in memory only. Codex keeps its existing 1 MiB line/16 MiB stream caps and invocation; it ignores the extra tool metadata.
- **Isolation and model reach.** Content-free system events may precede init; init is mandatory before assistant or user events. Bad/duplicate init, extra server/tool, nonzero skills/slash commands or a hook event kills the process group immediately and produces `isolation_refused`, even before packet fetch. Any assistant/user event, any nonzero usage, or any result is evidence that the model was reached; init's position and mere presence are never such evidence. Init's sanitized version is logged as `claude_code_version`; model reach is a boolean. A bad init before an assistant or other model-reach evidence is recorded as never reached, but its isolation marker is retained.
- **Persistence and admission.** XDG puts MCP logs, including content-free tool errors, inside the removable per-item directory. After child termination, a finally block checks `~/.claude/projects/<slug(runDir)>` and the fallback `~/.cache/claude-cli-nodejs/<slug(runDir)>`. Any file refuses admission as `rejected:LOCAL_PERSISTENCE` before promotion; both directories are removed even when empty. Cleanup errors also refuse admission. The process group is terminated before this check; run and host stage directories are removed in outer finally. Startup sweeps leftover project/cache directories matching only this worker's run-directory prefix. Exit 0, the exact isolation init, no hook events, `is_error: false`, `subtype: success`, a new session ID, positive expected-model output with no other output-producing model, fetch before first submit, and the host fetch marker/staged answer are all required. Keep only content-free metadata; never log result prose. Schema errors in both lanes contain fixed codes, anonymized JSON pointer property tokens, array indices and counts; no supplied keys or values.
- **Attempt markers and operator recovery.** The host reserves before launch by writing a same-directory temporary file, fsyncing it, linking it exclusively to the final name, unlinking the temporary file and syncing the directory. Status changes use a synced temporary file and atomic rename. `attempt-status --work-id <id>` reports `none`, `reserved`, `attempted` or `isolation_refused` and `age_seconds` (null for none). Malformed markers count as attempted and cannot crash the worker loop. Mark attempted only after stream evidence of model reach and after excluding limits and isolation refusal; init alone does not mark attempted. Normal prestart/no-model failures release their reservation. Isolation refusal retains an `isolation_refused` marker until explicit operator recovery. Reservations left by a killed worker fail closed. `already_attempted` and `isolation_refused` do not consume `--max-items`.
  Operator command: `npm run journal:work -- attempt-clear --work-id <id>`. It clears only `isolation_refused`, or a `reserved` marker older than its recorded run timeout (30 minutes for older markers without a timeout). It refuses attempted and malformed markers, and fresh reservations. Marker commands sweep their own `.tmp` files older than an hour. Dispatch records have no separate operation-key field, but the current exchange encodes the stable operation digest in `journal-work:<48 hex>` and adds `:rN` for expired-item successors; markers use the digest portion, so resends cannot buy another Opus run. Other producers without that encoded identity fall back to the exact work ID.
- **Evidence.** `execution: { profile_evidence: "claude_code_model_usage_reported", effective_model_profile: <the model key from modelUsage>, effective_effort: record.effort, request_context_id: "claude-session:" + session_id }`, subject `local:claude-hardest`. The exchange port accepts this evidence kind for the `hardest` tier on the Codex route. Supervisor admission is deferred.
- **Usage limits.** Recognize assistant `error: rate_limit`, error results with HTTP status 429 (including subtype success), structured usage/rate-limit errors and limited/rejected `rate_limit_event` status. Normalize numeric `resetsAt` in seconds or milliseconds; pause until reset, or 30 minutes without one. A limit remains `limited`, never marks attempted, and releases the reservation. If release fails, retain the reservation and the limited outcome, retry release at the next loop before admitting more work, and continue the pause. A concurrent persistence or isolation refusal still refuses admission; a persistence refusal alongside a limit also releases or queues release of the reservation and pauses without marking attempted. A stop/crash can leave that reservation for explicit operator recovery. The usage log adds `total_cost_usd`, labelled as a cost equivalent that a subscription doesn't charge.

The implemented worker is `npm run journal:work:claude -- --remote <ssh host> --remote-checkout <host checkout> --remote-config <host private config> --work-dir <laptop private work dir>`. The host must provide the exchange-root and secret-file environment variables to its noninteractive SSH command. The remote worker passes no exchange secret or secret-file path in its command arguments or laptop MCP configuration. The content-free host commands are `journal:work -- dispatch --json`, `packet-check`, `stage-create`, `stage-check`, `stage-sweep`, `promote`, `stage-remove`, and the attempt-marker commands. `total_cost_usd` is recorded with `cost_kind: subscription_cost_equivalent_not_charged`.

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

Second-round regression coverage includes content-free pre-init system events, stream-derived model reach/version, immediate isolation termination before packet fetch, project/fallback file cleanup and startup sweep, a 1.5 MB result line, exact 429/assistant/rate-event limits and release retry, schema key/value sentinels in both lanes, exclusive marker writes, corrupt-marker refusal, status/age/operator clearing, stable resend identity, skipped-item counting, and concurrent stage removal. These are synthetic fakes and parser/filesystem checks; the supplied real-CLI measurements above remain owner/reviewer evidence.

1. A fake `claude` executable, reached through a fake SSH command that runs the host side locally: round trip for a hardest item, with response-reported evidence admitted only for that tier on the Codex route. The supervisor case belongs to the deferred supervisor task.
2. Admission refusals: `is_error`, a second model with output tokens, a missing session ID, nothing staged, timeout.
3. The secret never appears in arguments or on the laptop side; the mapped model argument; an unmapped label refused.
4. Deferred with section 3: `supervise` sampling, agreement, stage-attribution and summary tests.
5. Hardest lane on the Codex route: enabled, daily limit pause, replay without resend.
