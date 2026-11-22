# Starting the runner trial

The runner trial (design: `docs/superpowers/specs/2026-11-21-runner-trial-design.md`) runs on the app's own page, with real
models, in a vault of its own. One command starts it on this computer:

```bash
node scripts/runner-trial-start.mjs --provider codex
```

or `--provider claude`. It prints the page's address, `http://127.0.0.1:8797`, once the server answers with the trial on. Stop it
with Ctrl+C. The command runs on any recent Node; InnerSignal itself needs Node 24 (`.nvmrc`), so when the shell's `node` is
another version, the command starts the server with nvm's copy of Node 24.

## What it sets up

One folder outside the checkout, only yours (mode 0700): `$HOME/.local/share/inner-signal-runner-trial`, or `--dir PATH`.

- `vault/`: the trial's encrypted vault. The app's usual vault is never touched: a build without the trial can't read the trial's
  records (design, section 11).
- `credentials.json` (mode 0600): the vault's development credentials, in the shape `docs/PRIVATE-CASE-CONTINUITY.md` gives: one
  grant (read, write and audit) for one case, whose keys are made once from random bytes and never changed. A new token is made at
  every start; only its SHA-256 is written, and the token goes to the server through its environment, nowhere else. Nothing prints
  a key or the token. This is the development file provider, not OS-backed security: whoever can read your files can open the vault.
  If the file goes missing while the vault holds files, the command stops instead of making new keys, which couldn't open them.
- `settings-codex.json` or `settings-claude.json` (mode 0600, `INNER_SIGNAL_RUNNER_TRIAL_SETTINGS`), written at every start: the
  arrangement that measured best, the whole writer with one whole checker, readers and checkers at low effort and the writer at
  medium, every worker on the chosen provider.

## Providers

- `codex`: every worker through `codex exec` on the ChatGPT plan Codex is signed into (`codex login status`), with Codex's own
  model.
- `claude`: every worker through `claude -p`, signed in at `INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR` (default
  `$HOME/.config/claude-innersignal`; sign in there once with `CLAUDE_CONFIG_DIR=<that folder> claude`, then `/login`). Readers on
  Sonnet 5.5, writer and checker on Opus 5.5.

Each worker's packet, the person's words included, goes to the company that runs it (design, section 6).

## Switches

Off unless a flag turns them on: `--kept-plan` (`INNER_SIGNAL_RUNNER_KEPT_PLAN`), `--feedback-link`
(`INNER_SIGNAL_RUNNER_FEEDBACK_LINK`) and `--owner-fallback` (`INNER_SIGNAL_OWNER_FALLBACK`). No `INNER_SIGNAL_` setting of the shell
reaches the trial's server, so one set for the usual app can't turn anything on or point the trial at another vault.

The rest of the page runs in mock mode: its other tabs call no model, and the badge at the top says `mock-anthropic + mock-openai`
although the trial's workers are real. No decision ledger is written into the checkout. The "Reasoning depth" menu and the notice
about the fast Sonnet path describe the usual app; the trial doesn't use them.

## Keep one address

The page keeps its case ID in the browser, per address. Always open `http://127.0.0.1:8797` (not `localhost`, not another port),
or the page starts with another case ID. The server's own first line names `localhost`; use the address the command prints last.

## Known gap (22 Nov 2026)

In a fresh browser the page makes up its own case ID (`apps/web/app.js`, `emptyPageState`), and the credentials grant only the
case this command made (`grants[0].case_ids[0]` in `credentials.json`). The server refuses every other case, so the page's
reconcile gets 403 and a message shows "Runtime error: InnerSignal could not safely complete this request." The page works once
its stored case ID is the granted one; a fix that lets the page take the trial's case from the server is needed before the trial
is used.
