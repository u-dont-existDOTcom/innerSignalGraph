# Starting the runner trial

The runner trial (design: `docs/superpowers/specs/2026-11-21-runner-trial-design.md`) runs on the app's own page, with real
models, in a vault of its own. One command starts it on this computer:

```bash
node scripts/runner-trial-start.mjs --provider mixed
```

`mixed` puts the readers and the checker on Claude and the writer on GPT. It measured fastest of the arrangements tried (22 Nov
2026: replies in 19.8 s at the median and 24.5 s in 9 of 10, the provisional reply in 5.1 s, no repairs). Each provider's plan pays
for its own calls, and both companies see the conversation. `--provider codex` (GPT only) or `--provider claude` (Claude only)
keeps every call with one company.

The command prints the page's address, `http://127.0.0.1:8797`, once the server answers with the trial on. Stop it with Ctrl+C.
It runs on any recent Node; InnerSignal itself needs Node 24 (`.nvmrc`), so when the shell's `node` is another version, the
command starts the server with nvm's copy of Node 24.

## What it sets up

One folder outside the checkout, only yours (mode 0700): `$HOME/.local/share/inner-signal-runner-trial`, or `--dir PATH`.

- `vault/`: the trial's encrypted vault. The app's usual vault is never touched: a build without the trial can't read the trial's
  records (design, section 11).
- `credentials.json` (mode 0600): the vault's development credentials, in the shape `docs/PRIVATE-CASE-CONTINUITY.md` gives: one
  grant (read, write and audit) for one case, whose keys are made once from random bytes and never changed. A new token is made at
  every start; only its SHA-256 is written, and the token goes to the server through its environment, nowhere else. Nothing prints
  a key or the token. This is the development file provider, not OS-backed security: whoever can read your files can open the vault.
  If the file goes missing while the vault holds files, the command stops instead of making new keys, which couldn't open them.
- `released-rules/`: a private (0700) snapshot of `origin/stable`'s `plugins/inner-signal-therapy`, extracted with `git archive`.
  Before starting the server the command quietly tries `git fetch origin stable`; if that fails it uses the local ref. A complete
  snapshot is published through an atomically replaced commit link, never an in-progress extraction.
- `runner-log.jsonl` (mode 0600): the word-free run log described below.
- `settings-<provider>.json` (mode 0600, `INNER_SIGNAL_RUNNER_TRIAL_SETTINGS`), written at every start: the arrangement that
  measured best, the whole writer with one whole checker, readers and checkers at low effort and the writer at medium, each worker
  on the provider the choice gives it.

The server is told the case the credentials grant (`INNER_SIGNAL_RUNNER_TRIAL_CASE_ID`), and `/health` names it. A page that holds
another case, as a fresh browser does, takes this one when it loads: its settings stay, and the conversation comes back from the
vault.

## Providers

- `mixed`: the readers on Claude Sonnet 5.5 and the checker on Claude Opus 5.5; the writer and its repair on GPT through Codex.
- `codex`: every worker through `codex exec` on the ChatGPT plan Codex is signed into (`codex login status`), with Codex's own
  model.
- `claude`: every worker through `claude -p`: readers on Sonnet 5.5, writer and checker on Opus 5.5.

Claude workers use the sign-in folder `INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR` (default `$HOME/.config/claude-innersignal`; sign in
there once with `CLAUDE_CONFIG_DIR=<that folder> claude`, then `/login`). Each worker's packet, the person's words included, goes to
the company that runs it (design, section 6).

## Switches

Off unless a flag turns them on: `--kept-plan` (`INNER_SIGNAL_RUNNER_KEPT_PLAN`), `--number-now`
(`INNER_SIGNAL_RUNNER_NUMBER_NOW`, off until the owner says; design, section 9b), `--feedback-link`
(`INNER_SIGNAL_RUNNER_FEEDBACK_LINK`), `--owner-fallback` (`INNER_SIGNAL_OWNER_FALLBACK`), `--fixed-message-on-failure`
(`INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_FAILURE`, only with `--owner-fallback`: the owner's fixed message also when the plan's
limit, a lapsed sign-in or the time ends a turn of a conversation about wanting to die or getting safe; design, section 7) and
`--fixed-message-on-any-failure` (`INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_ANY_FAILURE`, only with `--fixed-message-on-failure` and
`--owner-fallback`: his fixed message after every failure in such a conversation, a refusal, a failed call and an interruption
too; off until he answers question i68, part 2; design, section 7). No `INNER_SIGNAL_` setting of the shell reaches the trial's
server, so one set for the usual app can't turn anything on or point the trial at another vault.

The rest of the app runs in mock mode, and no decision ledger is written into the checkout. During the trial, Structured hypnosis
and Supervisor drafts are hidden because they use the app's separate model pipelines (hypnosis can fail in mock mode). Guide Packet
is hidden because it manages the app's rules, not this trial's; no Guide Packet installation is needed. Local data is hidden because
its export/import/erase buttons handle browser-session memory, not the trial vault. State & tracker remains available: its state,
tracker, journal and encrypted handoff routes work against the trial's own case without a model. The tab bar explains which part is
the trial. With the trial on, the badge at the top shows who reads, writes and checks, and the page hides the usual app's "Reasoning depth" menu and
its sentences about the fast Sonnet path.

## Keep one address

The page keeps its settings in the browser, per address. Open `http://127.0.0.1:8797` each time; the server's own first line names
`localhost`, which the browser treats as another site.

## Released rules and the page version

`INNER_SIGNAL_RUNNER_RULES_ROOT` tells the trial controller which plugin tree to load, with box guidance on. The start command
passes the extracted release tree and `INNER_SIGNAL_RUNNER_TRIAL_DIR`, the trial's folder. A rules root must be an absolute path
to a directory inside that folder, checked on real paths so a symlink cannot escape it; otherwise trial startup fails. The settings
file's containing folder can also identify the trial folder for callers that do not set `INNER_SIGNAL_RUNNER_TRIAL_DIR`.

If there is no local `origin/stable` ref, the command plainly says it is using this checkout's rules. With no rules-root setting,
the controller also uses the checkout. `/health` reports `runnerRules: { version, sha256, source }` only with the trial on: source
is `stable <short commit>` for a release snapshot, or `checkout`. The footer separates the rules version and hash from the page's
runtime version and warns when the rules come from the checkout. With the trial off the ordinary footer and tabs stay as before.
The always-visible emergency line keeps its words and note role, in small muted text below the message box and Send button. The
highlighted emergency line inside a conversation and its triggers are unchanged.

## Run log

The trial's **Run log** button opens a summary and one expandable row per finished runtime turn. It reads only stored turns through
`GET /v1/runner/log?caseId=…`, with the runner page's local-owner, matching-origin and case-read authorization checks. Browsers omit
Origin on a same-origin GET; that route also accepts a matching Referer together with `Sec-Fetch-Site: same-origin`. A bearer token,
foreign host, foreign origin or foreign referrer does not grant access to the page route.

The log holds start/end times, total milliseconds, time to first words (the provisional reply, highlighted line, or final reply or
closing, whichever was first), delivery or closing kind and reason code, the crisis reader's level, repairs attempted, and every
recorded worker call's role, attempt, provider, model, effort, duration and reported input/cache-read/cache-write/output/reasoning
counts. Rule-part names and byte sizes appear where recorded. Checker findings contain codes and severities only. The summary has
turn count, median and nearest-rank 90th-percentile total/first-word times, mean workers and repairs per turn, token sums by provider
and model, finding-code frequencies and failure-code counts. Token categories preserve each provider's reported meanings; they are
not a currency estimate and cache/reasoning counts must not be added to other categories as if every provider counts them separately.

**No words are stored in this log.** It has no person's messages, replies, provisional replies, highlighted lines, journal text,
kept-plan text, finding descriptions, quotes or links. Fields are copied individually from an allow-list. Findings outside the fixed
protocol/program code list become `UNSPECIFIED_FINDING`; unknown failure codes become `PROVIDER_FAILED`. Unreported historical token
counts, durations, efforts and rule parts stay unknown rather than being guessed. Earlier failures whose receipts were never stored
cannot be reconstructed; new failed calls retain their receipts too.

The server appends the same turn rows to `<trial dir>/runner-log.jsonl` (0600), with a header naming the rules and arrangement at
file creation and a new header whenever they change. Each turn belongs to the nearest header above it. Before appending, an
incomplete final line is discarded; earlier complete lines stay unchanged. If the file is missing on startup, it rebuilds it from
stored finished turns, then appends newly finished turns once.
An unfinished turn appears after reconciliation closes it. Writes run after the response, and logging errors are caught and dropped;
they never fail a turn. **Delete this case deletes the JSONL file too**, and clears the page's log panel. No log route, file writing or
Run log button is active when the trial is off.
