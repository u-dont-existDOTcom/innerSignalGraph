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
  grant (read, write and audit) per case, your own case first and then each client's (below), each case's keys made once from random
  bytes and never changed. A new token is made for every grant at every start; only its SHA-256 is written, and the tokens go to the
  server through its environment, nowhere else. Nothing prints a key or a token. This is the development file provider, not
  OS-backed security: whoever can read your files can open the vault. If the file goes missing while the vault or the client list
  holds anything, the command stops instead of making new keys, which couldn't open them.
- `clients.json` (mode 0600), once you add a client: each client's label, case and journal consent (below).
- `released-rules/`: a private (0700) snapshot of `origin/stable`'s `plugins/inner-signal-therapy`, extracted with `git archive`.
  Before starting the server the command quietly tries `git fetch origin stable`; if that fails it uses the local ref. A complete
  snapshot is published through an atomically replaced commit link, never an in-progress extraction.
- `runner-log.jsonl` (mode 0600): the word-free run log described below, for your own case; each client's case has its own,
  `runner-log-<case id>.jsonl`.
- `journal/<case id>/`: a client's journal folder, with the cold-test receipt for their journal copy (below).
- `settings-<provider>.json` (mode 0600, `INNER_SIGNAL_RUNNER_TRIAL_SETTINGS`), written at every start: the arrangement that
  measured best, the whole writer with one whole checker, readers and checkers at low effort and the writer at medium, each worker
  on the provider the choice gives it.

The server is told your own case (`INNER_SIGNAL_RUNNER_TRIAL_CASE_ID`), and `/health` names it, and each client's token for that
client's case alone (`INNER_SIGNAL_RUNNER_TRIAL_CLIENT_TOKENS`). The page doesn't take its case from `/health`: it asks
`GET /v1/runner/clients` which cases it may use (below). With no clients it takes your own case when it loads; its settings stay,
and the conversation comes back from the vault.

## Clients

The trial can hold a case for each person you work with, in its own vault (the owner's answer 1a to question i73, 24 Nov 2026;
design: `docs/superpowers/specs/2026-11-23-runner-client-cases-design.md`). Your clients' real InnerSignal records on the server
are never opened or changed.

```bash
node scripts/runner-trial-start.mjs --add-client
```

asks for the label you'll know the client by, at a hidden prompt (it isn't shown as you type, and it never goes on the command line,
so it stays out of the shell's history and off the screen). Initials or a code word are enough. It makes the client's case with keys
of its own and stops; the next start gives the case its grant. Labels are shown only by the trial's page on this computer, beside
each client's number. They go into no Git file, log, run log, worker packet or report.

On the page, **Who is this conversation with?** lists your own case and each client's, as `number. label`. With clients, no case is
chosen until you pick one, Send waits for the pick, and after each pick the page asks once more before the first message: a message
can't be moved to another case afterwards, short of deleting that case. The line at the top says whose case the conversation is in.
Each case keeps its own conversation, risk record, kept plan, run log and Delete; switching keeps each case's page state apart, and
a reply that finishes while another case is on the page shows when you switch back. Every message in a client's case is read as the
client's own words, so your own notes don't belong there. The server refuses a case that isn't on its list (`RUNNER_CASE_UNKNOWN`),
and each client's token opens only that client's case. A client added while the trial runs is counted on the page until the next
start.

## A client's journal

A client's journal can inform their replies only through the session-use journal reader (pull request 241), with
`--response-evidence` on, and only when all three hold for that client at that moment:

1. **Consent.** You confirm that the client agreed to their journal being used in these sessions, and to their words and journal
   excerpts going to the companies that run the trial's workers (with `--provider mixed`, Anthropic and OpenAI):

   ```bash
   node scripts/runner-trial-start.mjs --journal-consent confirm
   ```

   It lists the clients by number (their labels are on the page) and asks which. `--journal-consent withdraw` records a
   withdrawal, which holds at once, also while the trial runs: no retrieval uses the journal any more, and an approved reply
   written with the journal in view isn't delivered (its turn closes as a failed check, also when a restart's reconcile finds
   it). A consent gives the client's grant its `session_use` purpose from the next start; a withdrawal drops it at the next start.
2. **A published copy.** The client's journal copy in their runner case, with an active generation published for session use.
   The copy step (an export on the server, on your go each time, and an import into the client's runner case checked against the
   export) **isn't built yet**, so no client has a copy.
3. **A passing cold test of exactly that copy.** A receipt at `journal/<case id>/cold-test-receipt.json` (mode 0600) naming the
   case, corpus, generation, manifest and visibility epoch the reader opens; a pass on another generation doesn't carry over. The
   cold test that writes it **isn't built yet** either; the receipt's shape is `validateColdTestReceipt` in
   `src/runner-trial/clients.mjs`.

Short of any of them, the turn's evidence records why (`journal_consent_missing`, `no_journal_copy`,
`cold_test_receipt_missing` or `cold_test_receipt_mismatch`) and the reply is made from the conversation alone. With
`--response-evidence`, every turn (your own included) is checked against the sources it rests on: the writer sees the turn's
evidence, the whole checker returns the evidence review the program then checks word for word, a declared journal quote must be
word for word in its source, and the store admits the reply only with its evidence. It needs the whole checker. A reply resting on
the journal sends up to about 8,000 more tokens of quotations to the writer and the checker, again at each repair.

## Providers

- `mixed`: the readers on Claude Sonnet 5.5 and the checker on Claude Opus 5.5; the writer and its repair on GPT through Codex.
- `codex`: every worker through `codex exec` on the ChatGPT plan Codex is signed into (`codex login status`), with Codex's own
  model.
- `claude`: every worker through `claude -p`: readers on Sonnet 5.5, writer and checker on Opus 5.5.

Claude workers use the sign-in folder `INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR` (default `$HOME/.config/claude-innersignal`; sign in
there once with `CLAUDE_CONFIG_DIR=<that folder> claude`, then `/login`). Each worker's packet, the person's words included, goes to
the company that runs it (design, section 6).

## Switches

Off unless a flag turns them on: `--response-evidence` (`INNER_SIGNAL_RESPONSE_EVIDENCE`, for the trial only; above),
`--kept-plan` (`INNER_SIGNAL_RUNNER_KEPT_PLAN`), `--number-now`
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
counts. Rule-part names and byte sizes appear where recorded. Checker findings contain codes and severities only. Each turn's
`failures` list holds invocation-level failure codes, including failures after workers answered; the summary counts these without
counting the same failure on that invocation's terminal worker attempt twice. An earlier failed attempt followed by a successful
retry is still counted separately from a later invocation failure. The summary has
turn count, median and nearest-rank 90th-percentile total/first-word times, mean workers and repairs per turn, token sums by provider
and model, finding-code frequencies and failure-code counts. Token categories preserve each provider's reported meanings; they are
not a currency estimate and cache/reasoning counts must not be added to other categories as if every provider counts them separately.

**No words are stored in this log.** It has no person's messages, replies, provisional replies, highlighted lines, journal text,
kept-plan text, finding descriptions, quotes or links. Fields are copied individually from an allow-list. Findings outside the fixed
protocol/program code list become `UNSPECIFIED_FINDING`; unknown failure codes become `PROVIDER_FAILED`. Unreported historical token
counts, durations, efforts and rule parts stay unknown rather than being guessed. Earlier failures whose receipts were never stored
cannot be reconstructed; new failed calls retain their receipts too.

The server rewrites `<trial dir>/runner-log.jsonl` (0600; a client's case, `runner-log-<case id>.jsonl`) in full from stored finished turns after each turn, after reconciliation,
and at server start, whether or not a file already exists. The first line is one header naming this server's rules and arrangement.
Every turn row has a `schema_version` and its own `rules` and `arrangement`, saved with the turn when it was created; both are `null`
for turns that ran before this was recorded. Old rows keep their own configuration after a restart with different settings. Provider
names in the arrangement are only `claude` or `codex`, and rules versions contain three digit groups separated by dots; invalid
stored values project as `null`.
Each rewrite uses a new, exclusively created temporary file in the same folder (0600, no symlink followed), syncs it, then atomically
renames it over the log. An interrupted rewrite leaves the previous complete log intact; a leftover temporary file is never read.
An unfinished turn appears after reconciliation closes it. Writes run after the response, and logging errors are caught and dropped;
they never fail a turn. **Delete this case deletes that case's JSONL file too** (and a client's journal folder), and clears the page's log panel. No log route, file writing or
Run log button is active when the trial is off.

## Details view

Each Run log row's **Details** button opens that turn's words on the owner's local page only. `GET
/v1/runner/turn-details?caseId=…&turn=…` uses the Run log's turn number (a positive decimal integer, without leading zeroes),
the same local-owner, matching-origin and case-read checks, and `Cache-Control: no-store`. Unknown, unfinished or malformed turn
numbers return the fixed `RUNNER_TURN_NOT_FOUND` error without details.

It reads the encrypted case on request and writes nothing. It shows the person's message, stored reader results, refused
provisional problems, any provisional reply, drafts in order, each checker's full stored findings, program-check problems,
the stored findings supplied for repair, the delivered reply or closing, and that turn's rules and worker receipts' rule-part
names and sizes. Missing outputs, separate quoted spans, exact repair prompts and individual concurrent-worker completion order
are marked **not stored**. The highlighted emergency line's stored reason is shown; its historical exact wording is not stored.
One Details panel opens at a time; Close Details or Escape closes it. All content is literal, wrapping text, with no active links.
The **Run log still holds no words**, in its route, panel and JSONL file. With the trial off neither view is available.
