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

Off unless a flag turns them on: `--kept-plan` (`INNER_SIGNAL_RUNNER_KEPT_PLAN`), `--feedback-link`
(`INNER_SIGNAL_RUNNER_FEEDBACK_LINK`) and `--owner-fallback` (`INNER_SIGNAL_OWNER_FALLBACK`). No `INNER_SIGNAL_` setting of the shell
reaches the trial's server, so one set for the usual app can't turn anything on or point the trial at another vault.

The rest of the page runs in mock mode: its other tabs call no model, and no decision ledger is written into the checkout. With the
trial on, the badge at the top shows who reads, writes and checks, and the page hides the usual app's "Reasoning depth" menu and
its sentences about the fast Sonnet path.

## Keep one address

The page keeps its settings in the browser, per address. Open `http://127.0.0.1:8797` each time; the server's own first line names
`localhost`, which the browser treats as another site.
