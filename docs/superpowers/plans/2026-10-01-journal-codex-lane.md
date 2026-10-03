# Journal import: the Codex exec lane

Date: 2026-10-01. Author: Claude (Opus), for implementation by Codex. Status: task. Classification: public design; no private data.

## Why

The owner wants the journal import's model calls to run through the Codex command-line tool on the import host, with supervisor review afterwards, and the import made faster without losing information or checks. Codex's fast mode stays off.

Today no answer can enter the import through the work exchange. `receiptFor` in `src/journal-import/exchange-port.mjs` requires an effective model and effort on the stored receipt, and the port reports `fresh_context_per_generate: false` and `authenticated_execution_profile_per_generate: false`, so `doctor` blocks the route (see the 2026-09-30 entries in `state/CODEX-CURRENT-STATE.md`). This task adds a dispatcher for Codex runs that supplies both facts, states exactly what kind of evidence they are, and keeps the ChatGPT connector route blocked as it is.

## What a Codex run can prove (probed 2026-10-01, codex-cli 0.158.0)

- `codex exec --json` prints `thread.started` with a new `thread_id` for every run, then `item.*` events, then `turn.completed` with token usage. It doesn't print the model.
- A model the sign-in doesn't offer fails the run with HTTP 400 ("model is not supported"). Codex doesn't switch to another model.
- Built-in web search is on by default (a trivial prompt triggered a `web_search` item). The global `$CODEX_HOME/AGENTS.md` loads even with `--ignore-user-config`.
- MCP tools are called through the code-mode host, so `code_mode_host` must stay enabled. Under `approval_policy="never"` an MCP call fails unless the server sets `default_tools_approval_mode="approve"`.
- With `--ephemeral`, a dedicated `CODEX_HOME` and the settings in section 3, a run against a synthetic two-tool MCP server fetched its packet, submitted the answer and printed only `mcp_tool_call` and `agent_message` items. A sentinel string in the packet appeared nowhere under `CODEX_HOME` afterwards.

So the execution profile is **request-pinned**: the dispatcher passes `-m <model>` and `model_reasoning_effort`, ignores the user config, and Codex refuses rather than substitutes. Each run is a new thread that isn't saved. The receipt records exactly that (`profile_evidence: "codex_exec_request_pinned"`) with the run's own thread ID as the request context. This is weaker than a provider response naming its model, and the receipt must not claim more.

## Rules

- Journal text, packets and answers never enter Git, logs or PR text. Tests use synthetic data and sentinel strings.
- Every existing job ID and operation key stays the same.
- The `chatgpt_connector_exchange` route behaves exactly as today, including its doctor blockers.
- Each change comes with a test that fails without it. `npm test`, `npm run verify`, `npm run audit:repository`, `npm run audit:publication` and `npm run journal:ui:test` pass on Node 24.18.0.
- Record the change in `state/CODEX-CURRENT-STATE.md`, in this PR's own entry, and add this plan to `docs/INDEX.md` (update the reviewed SHA-256 binding in `scripts/audit-repository.mjs` in the same change).

## 1. Route provider `codex_exec_exchange`

- `parseConfiguration` in `src/journal-import/provider-runtime.mjs` accepts `provider: "codex_exec_exchange"` with the same fields and checks as `chatgpt_connector_exchange` (zero spend, allowance evidence, `timeout_ms`, `exchange.poll_ms`, `exchange.ttl_ms`).
  - `model` must match `^[a-z0-9][a-z0-9.-]{0,63}$`. `effort` must be one of `low`, `medium`, `high`, `xhigh`, `max`.
  - Optional `role_effort`: an object from role name to one of those efforts, for roles that should run at a different effort. Unknown roles are refused.
- The pin in `openJournalExecutionRuntime` (`route.model === "GPT-5.6 Sol" && route.effort === "Pro"`) keeps applying to the two ChatGPT providers only.
- `loadExchangePort` passes `executionAttestation: "codex_exec"` and `roleEffort` to `createExchangeJournalInferencePort` for this provider.
- The hardest lane stays unavailable on this route for now: with `hardest_lane.enabled` true, loading fails with `HARDEST_LANE_ROUTE_UNAVAILABLE`, as it does for other unsupported routes.

## 2. The exchange port

With `executionAttestation: "codex_exec"`:
- `capabilities()` reports `transport: "codex_exec_exchange"`, `fresh_context_per_generate: true` and `authenticated_execution_profile_per_generate: true`, plus `execution_profile_evidence: "codex_exec_request_pinned"`.
- A dispatch record's `effort` is `roleEffort[role]` when set, else the route's effort.
- `receiptFor` also requires, on the authenticated stored receipt:
  - `profile_evidence === "codex_exec_request_pinned"`;
  - `effective_model_profile` and `effective_effort` equal to the dispatch record's model and effort;
  - `request_context_id` matching `^codex-thread:[0-9A-Za-z-]{8,64}$`.

  Anything else is `JOURNAL_EXCHANGE_EXECUTION_PROFILE_UNVERIFIED`, handled as today. The admitted receipt carries `request_context_id` and a new `execution_profile_evidence` field.

Without `executionAttestation` nothing changes.

## 3. Attested, staged answers

### The exchange (`src/journal-import/work-exchange.mjs`)
- `submitResult({ workId, output, subject, execution })`. `execution` is optional: `{ profile_evidence, effective_model_profile, effective_effort, request_context_id }`, each a string of at most 128 printable ASCII characters. When present, these four fields are added to the receipt fields, so the receipt tag covers them. Receipts without them stay valid.
- `stageResult({ stageDir, workId, output })` writes a validated answer as a sealed file `<stageDir>/<file key>.json`, mode 0600, first write wins (same temporary-file and `link()` method as the queues). It uses the exchange's encryption key, with a distinct direction in the associated data, so a staged file can't be read as a queue file or the reverse. `stageDir` must be an absolute, existing, real directory owned by the current user with mode 0700.
- A successful staged packet fetch writes a content-free, 0600 `<file key>.fetched` marker containing only a nonce and time. `stageResult` and `promoteStaged` require that same work ID's marker. Promotion removes both marker and staged answer.
- `promoteStaged({ stageDir, workId, subject, execution })` opens and authenticates the staged file, calls `submitResult` with `execution`, then removes the staged file and marker. It returns what `submitResult` returns.
- `INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE` is accepted wherever `INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64` is: an absolute path to a regular file of mode 0600 or stricter, opened without following links, holding the base64 secret. Setting both is an error.

### The local work server (`npm run journal:work:mcp`)
- New option `--stage-dir <absolute dir>`. With it, a successful `get_journal_work_packet` marks that work ID as fetched. `submit_journal_work_result` validates as today and calls `stageResult` instead of `submitResult`; without that marker it returns the tool error `JOURNAL_WORK_PACKET_NOT_FETCHED` to the model.
- `--stage-dir` together with `--tier hardest` is refused.

## 4. The worker: `npm run journal:work:codex`

Logic in `src/journal-import/codex-worker.mjs`, command in `src/cli/journal-codex-worker.mjs`.

### Configuration
- `--config <absolute private run config>`, as for `journal:work:mcp`.
- The exchange root and secret file from the environment (section 3).
- `--codex-home <absolute dir>` (required): mode 0700, owned by the user, holding `auth.json`. The worker refuses `AGENTS.md`, `AGENTS.override.md`, `config.toml`, or entries in `skills/` other than Codex's bundled `.system/` directory.
- `--work-dir <absolute dir>` (required): mode 0700, owned by the user. Each worker creates a private 0700 parent with a held `flock` lock file. Its runs stay under that parent; startup sweeps only unlocked sibling parents older than one hour.
- `--codex-bin` (default `codex`), `--concurrency` (default 2, 1 to 8), `--timeout-ms` (default 1,800,000), `--poll-ms` (default 5,000), `--limit-backoff-ms` (default 1,800,000), `--log <absolute file>` (default stderr), `--once` (finish the initial set, including limit backoff, then exit), `--max-items <n>` (non-limited runs only).
- `--import-command-json '<JSON array>'` (optional): a command, run without a shell, that starts one import run.
- `--import-env-names <comma-separated names>` passes only the named variables to the import process in addition to `PATH`, `HOME`, and `LANG`. `--import-timeout-ms` sets its separate timeout; by default the import has no timeout. `--import-interval-ms` (optional, not with `--once`) also starts an import run when none is running and none has finished for that long. The import command is normally a private wrapper that loads its own environment files. Node's `--env-file` can be used by that wrapper before `src/cli/journal-import.mjs` (the `journal:import` entry point); the worker does not load those files.

### Choosing items
Every `--poll-ms`, read the content-free dispatch listing. Take records that are unanswered, unexpired, `tier: "standard"`, not already running in this worker, and have a model and effort matching the section 1 patterns. Oldest `issued_at` first. Run up to `--concurrency` at once. The worker runs exactly the model and effort each record names; it has no model setting of its own.

### One run
1. Make a new private directory (0700) under the worker-owned parent in `--work-dir`, with a `stage/` directory inside (0700).
2. Spawn Codex without a shell, stdin from `/dev/null`, process group of its own, environment limited to `PATH`, `HOME`, `LANG` and `CODEX_HOME=<--codex-home>`:

   ```text
   codex exec --json --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules --strict-config
     -s read-only -C <run dir> -m <record.model>
     -c model_reasoning_effort="<record.effort>" -c web_search="disabled" -c service_tier="default"
     -c approval_policy="never"
     -c project_doc_max_bytes=0 -c project_root_markers=[]
     -c mcp_servers.journal.command="<node executable>"
     -c mcp_servers.journal.args=["<checkout>/src/cli/journal-work-mcp.mjs","--config","<config>","--principal","codex-standard","--tier","standard","--stage-dir","<run dir>/stage"]
     -c mcp_servers.journal.env={INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT="<root>",INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE="<secret file>"}
     -c mcp_servers.journal.default_tools_approval_mode="approve"
     --disable <feature> (once for each feature listed below)
     <instruction>
   ```

   Features to disable: `apps`, `auth_elicitation`, `browser_use`, `browser_use_external`, `browser_use_full_cdp_access`, `computer_use`, `fast_mode`, `goals`, `hooks`, `image_generation`, `in_app_browser`, `in_app_chat`, `in_app_local_automation`, `memories`, `multi_agent`, `multi_agent_v2`, `plugins`, `remote_plugin`, `realtime_conversation`, `shell_snapshot`, `shell_tool`, `skill_mcp_dependency_install`, `skill_search`, `sleep_tool`, `tool_suggest`, `unified_exec`, `unified_exec_tty`, `view_image`, `workspace_dependencies`, `worktrees`, `tool_call_mcp_elicitation`. Keep this list in one exported constant.

   The instruction is the existing fixed one, with the work ID filled in:
   > Private InnerSignal journal work item `<work_id>`. Call get_journal_work_packet with this work_id, follow its instruction using only its packet, then submit your JSON answer with submit_journal_work_result. If it lists schema problems, fix them and submit again. Reply only: done.
3. Read stdout as JSON lines, with a bound on line length and total size. Accept `turn.started`, `item.started`, and `item.updated` as lifecycle events while applying the item allowlist to every item event. For the two allowed MCP tools, inspect only `arguments.work_id`, completion status, and whether an error occurred. Keep no packet, answer, tool result, or other argument field.
4. **Admission.** Promote the staged answer only when all of these hold:
   - exit code 0, and no timeout;
   - exactly one `thread.started` with a `thread_id`, a `turn.completed`, and no `turn.failed` or `error` event;
   - every item is an `agent_message`, a `reasoning` item, a `todo_list` item (Codex's own plan, which reaches nothing outside the run), or an `mcp_tool_call` to server `journal` with tool `get_journal_work_packet` or `submit_journal_work_result`; `error` items are refused, including a "model rerouted" report;
   - a completed, error-free packet fetch for this work ID precedes the last completed submission for this work ID;
   - a staged answer exists for this work ID.

   Then call `promoteStaged` with subject `local:codex-standard` and
   `execution: { profile_evidence: "codex_exec_request_pinned", effective_model_profile: record.model, effective_effort: record.effort, request_context_id: "codex-thread:" + thread_id }`.

   If any check fails, delete the staged answer and record the reason. The item stays open. The worker tries it again later, at most three runs per item in its lifetime; after that it leaves the item to expire, and the importer's existing retry rules take over.
5. Always remove the run directory.
6. On timeout, kill the whole process group. On SIGTERM or SIGINT, stop scheduling immediately, wake backoff, kill running process groups, log killed runs as `stopped` without charging an attempt, remove run directories, and restore default signal handling after cleanup.

### Usage limits
If a run fails with a final HTTP 429 or usage-limit error, record `limited`, start no new runs until the reset time in Codex's local-time `Try again at ...` message or for `--limit-backoff-ms`, and let running ones finish. Limited runs do not consume the item's three-attempt budget or `--max-items`, but each item stops after 12 limit retries. A completed turn with a staged answer is not limited merely because stderr contains a transient retried 429.

### Import runs
With `--import-command-json`, start one import run when the worker starts and after each promoted answer (also one another worker stored first). If an import is still running, mark a rerun pending and start one more when it exits. Record only its exit code and duration.

Without `--once`, the worker also reads the answered items before its startup import and, on every poll, starts one import run for answers stored after that by another worker, such as the Claude lane's hardest items. It keeps polling for them through a usage limit. With `--import-interval-ms`, it also starts an import run when none is running and none has finished within that interval, so an import that stopped on a condition that clears with time, such as the hardest lane's daily limit, resumes without a new answer.

### Log
One JSON line per run: `at`, `work_id`, `role`, `model`, `effort`, `outcome` (`answered`, `already_answered`, `rejected:<reason code>`, `timeout`, `error`, `limited`, `stopped`), `duration_ms`, and the four usage numbers (`input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`). Nothing else.

## Tests

Use a fake `codex` executable: a Node script that records its arguments and environment keys, starts the real `journal-work-mcp.mjs` from the `mcp_servers.journal.*` arguments it was given, fetches the packet and submits a fixture answer over stdio, and prints fixture events. Cover:

1. Round trip: an item published by the exchange port is answered through the worker. The port admits it with `request_context_id` and `execution_profile_evidence` on the receipt. For a `codex_exec_exchange` route, `doctor` reports `inference_route: "authorized"` with no execution-profile blocker.
2. The `chatgpt_connector_exchange` route keeps its current doctor blockers, and a receipt without `execution` is still refused.
3. Admission refusals, each leaving the item unanswered and nothing staged: a `web_search` item, a `command_execution` item, a call to another MCP server or tool, a non-zero exit, a missing `thread.started`, a `turn.failed`, a timeout (the process group is killed).
4. The exact argument list and environment keys; the secret value never appears in the arguments; a `CODEX_HOME` holding `AGENTS.md` or `config.toml` is refused.
5. `role_effort` reaches the dispatch record and the run's `model_reasoning_effort`.
6. Concurrency: with `--concurrency 3` and five items, at most three runs overlap and all five are answered.
7. A usage-limit failure pauses new runs until the parsed reset time, and for the default back-off when there is none.
8. Staging: first write wins; a staged file can't be read as a queue file; a symbolic-link or group-readable stage directory is refused; `--stage-dir` with `--tier hardest` is refused.
9. The secret file: mode and link checks; both secret settings at once is an error.
10. Content-free output: a sentinel string in the packet and in the fake agent message never appears in the worker log, its stdout or stderr, or the MCP server's stderr.
