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
command starts the server with nvm's copy of Node 24. Without a terminal, the icon does the same start (below).

## Without a terminal: the icon, Restart and Stop

The owner asked for the runner without the terminal (IS24, 24 Nov 2026, and his answer `i80 1a`, 26 Nov 2026; design:
`docs/superpowers/specs/2026-11-26-runner-journal-upload-and-tab-design.md`, sections 2 and 10, pull request 2). Once installed, an
icon starts the runner and opens its page, and the page has **Restart** and **Stop** at the top.

**Installing the icon** is done once, from the checkout the icon is to run, with the start's own flags:

```bash
node scripts/runner-launcher.mjs --install --provider mixed --kept-plan --number-now --owner-fallback \
  --fixed-message-on-failure --fixed-message-on-any-failure --feedback-link
```

It writes two files and starts nothing:

- `launcher.json` in the trial folder (mode 0600): those flags, in one fixed order and checked as the start checks them (never
  `--prepare-only`, `--add-client`, `--journal-consent` or `--dir` among them), with where the install found the workers' commands
  (Codex's and Claude's) and, when set, `INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR`, so the icon runs them whatever the desktop's PATH
  holds. The launcher refuses a file others can read, a link, or anything else in it.
- `inner-signal-runner.desktop` in `$XDG_DATA_HOME/applications` (by default `~/.local/share/applications`): "InnerSignal runner" in
  the applications menu, which can be pinned to the dock. It runs this checkout's `scripts/runner-launcher.mjs` with the Node 24 the
  install ran on, without a terminal, and with `--dir` when the install was given one. A path holding `"`, `` ` ``, `$`, `\`, `%` or a
  control character is refused rather than escaped.

`--uninstall` takes both away again. A runner started from a terminal keeps running: stop it there once, then start it with the icon.

**The icon.** When the runner already answers on its port, it only opens the page. Otherwise the launcher does what a start does (the
folder, this start's grants from the client list, the released rules, the server) with the flags from `launcher.json`, opens the
browser at the page and stays as the server's parent. A click while another start is under way waits for it, then opens the page.
When the runner can't start, a desktop notification says so and names the log.

**Restart and Stop** are at the top of the page for a runner the icon started; one started from a terminal shows "Restart from the
terminal" instead (`/health` names the state as `runnerLauncher`: `on`, `off`, `restarting` or `stopping`). Each asks once in plain
words, then sends `POST /v1/runner/restart` or `/v1/runner/stop` with `{"confirmed": true}` (JSON, at most 1 KiB, from the owner's page
on this machine only, as for the page's other routes). The server refuses while a reply is being written or a case is being deleted
(`RUNNER_BUSY`, naming which); otherwise, in the same step, it stops taking work (a turn, a reconcile or a deletion that comes after is
refused with `RUNNER_CLOSING`) and asks the launcher over its IPC channel. The launcher stops the server (it finishes what it is
sending and lets go of the vault; one still running 20 seconds later is ended) and, for a restart, starts it again. The page reloads
once the restarted runner answers; after Stop it says that the icon starts it again.

**What a restart takes in.** It is the same start again, so clients added and consents recorded since the last start take effect (new
grants from the client list, a confirmed client's `session_use` purpose included), with the released rules the runner already runs: a
new release reaches it only through a start that fetches one (Stop, then the icon).

**The launcher's log**, `launcher.log` in the trial folder (mode 0600; past 512 KiB the last one is kept as `launcher.log.1`), holds
the start's own lines and codes, each with its time: never a label, a message or anything a person wrote, and not the server's own
output, of which it keeps only the error codes Node prints (such as `BAD_CONFIG`). An unexpected error is logged by its code alone.

Limits: the icon is a desktop entry for Linux desktops. It runs the checkout it was installed from with the Node it names, so moving
or removing either means installing it again. The launcher owns the server's life: if the launcher is ended, the server stops too.

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
- `journal/<case id>/`: a client's journal folder, with their key for journal copies (`copy-key.json`, mode 0600, made by
  `--copy-key`), the cold-test receipt for their journal copy, the marker of the cold test started last and the passages GPT's questions
  tool holds back (`questions-held-back.json`, digests only, mode 0600) (below). Their Delete removes it.
- `settings-<provider>.json` (mode 0600, `INNER_SIGNAL_RUNNER_TRIAL_SETTINGS`), written at every start: the arrangement that
  measured best, the whole writer with one whole checker, readers and checkers at low effort and the writer at medium, each worker
  on the provider the choice gives it.
- `launcher.json` and `launcher.log` (mode 0600), once the icon is installed: its start's flags, and its log of the start's lines and
  codes (above).

The server is told your own case (`INNER_SIGNAL_RUNNER_TRIAL_CASE_ID`), and `/health` names it, and each client's token for that
client's case alone (`INNER_SIGNAL_RUNNER_TRIAL_CLIENT_TOKENS`). It takes the tokens out of its environment once it has read them, so
no program it starts (a model CLI included) inherits one. The page doesn't take its case from `/health`: it asks
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
start, which Restart at the top of the page makes for a runner the icon started; a consent recorded meanwhile takes effect then too.

## A client's journal

A client's journal can inform their replies only through the session-use journal reader (pull request 241), with
`--response-evidence` on, and only when all three hold for that client at that moment:

1. **Consent.** You confirm that the client agreed to their journal being used in these sessions, and to their words and journal
   excerpts going to the companies that run the trial's workers (with `--provider mixed`, Anthropic and OpenAI):

   ```bash
   node scripts/runner-trial-start.mjs --journal-consent confirm
   ```

   It lists the clients by number (their labels are on the page) and asks which. `--journal-consent withdraw` records a
   withdrawal, which holds at once, also while the trial runs. A consent gives the client's grant its `session_use` purpose from
   the next start; a withdrawal drops it at the next start. One of these commands, `--add-client` or a start changes the trial
   folder at a time; another one meanwhile is refused with a message, and can simply be run again. A command that ended without
   finishing (a crash, say) leaves its lock behind: the next one names the file, to be removed by hand once no runner-trial
   command is running. One that has done its work and can't look at its lock, or remove it, names the file itself; only a lock file
   that's gone already is let go in silence. One that was stopped and can't either, a start included, names it after what stopped it.
   A start holds the lock until its server has read the credentials, and stops that server when the lock can't be let go then.
2. **A published copy.** The client's journal copy in their runner case, with an active generation published for session use.
   The copy step has two halves, each run only on your go:
   - **Where the journal lives**, the journal import's `export` (`npm run journal:import -- export --config ...`), with
     `runner_trial_export` in the import's private configuration: `corpus_id` (the client's published corpus there),
     `recipient_public_key` (what `--copy-key` prints for that client), `output_path` (a new file outside the checkout) and, when
     the import's operator grant holds write only, `"scope": "case:write"`. The grant needs the vault's `export` purpose. It opens
     the active generation, published for session use, through the session-use reader's own checks, reads it whole (the records,
     the source texts, the indexes its builder added, the source order), seals it for that key alone (X25519, HKDF-SHA-256,
     AES-256-GCM) and writes it to a new file (mode 0600), whole or not at all and never over another: a synced temporary file
     beside it, given its name by a hard link. An export killed part-way leaves at most that temporary file, sealed too, and can be
     run again. `output_path` needs a filesystem with hard links: on one without them the export publishes nothing and fails
     (`JOURNAL_COPY_PUBLISH_UNSUPPORTED`), and you can choose another path. The seal keeps the copy confidential; it doesn't prove
     who made it, so import only a file you carried from the export yourself. Carrying it here is your step.
   - **On this laptop**, with the trial stopped:

     ```bash
     node scripts/runner-trial-journal.mjs --copy-key
     node scripts/runner-trial-journal.mjs --import /absolute/path/copy.sealed.json
     ```

     Both ask the client's number (the one `--journal-consent` shows). `--copy-key` makes that client's key once and prints its
     public half; the private half stays in their journal folder, which their Delete removes, and with it the means to open any
     copy sealed for them. `--import` takes a file outside the trial folder and opens it with that client's key: a copy sealed for
     another key is refused, and so is a copy of a journal already copied for another client. A client's copies come from one
     server case until their Delete: before the vault is touched, the list names that server case (as a digest; a server case is
     one person's, whatever its corpora) and keeps it also when the import then fails, so a copy from another one is refused for
     them, and one from theirs for any other client. While the trial runs (it holds the vault) nothing is imported.

     Under a grant made for that command and that case alone (write, and the archive, organize_search and session_use purposes
     the store asks) it checks the whole copy before writing (its digest, its graph, and that the store can take it), imports it
     into a corpus the copy itself names and publishes it for session use without archive. Then it checks what is stored against
     the export: every usable quotation against the stored bytes, and every record (deleted and revoked ones stay in a faithful
     copy, and no reader uses them), source text and index of its builder. The list then names the corpus. The same file can be
     imported again, after a failure or not: a copy already there is checked again, not written twice, and one an import left
     unpublished is refused (export a new one). **No receipt survives an import that starts:** once it holds the vault, and before it
     writes anything there, it removes the client's cold-test receipt, whatever copy it names, and its test's marker, for good (their
     folder synced). So an import that fails or is killed part-way leaves the journal closed, also where an earlier copy was in use:
     the cold test is run again. When the two can't be removed for good, nothing is imported and the message gives the code (the
     receipt may be gone by then, which only closes the journal); an import the running trial refuses leaves them. The earlier copy
     stays in the case, unused, until the client's Delete.

     The sealed file stays where you put it: once imported it's no longer needed, and you may delete it. One that's left can't be
     opened any more once the client's Delete has removed their key.
3. **A passing cold test of exactly that copy.** A receipt at `journal/<case id>/cold-test-receipt.json` (mode 0600) naming the
   case, corpus, generation, manifest and visibility epoch the reader opens, the version of the reader that was tested and the pass
   rule's; a pass on another generation, of another reader or by another rule doesn't carry over.

   ```bash
   node scripts/runner-trial-journal.mjs --cold-test /absolute/path/questions.json --provider mixed
   ```

   The questions file (mode 0600, outside the checkout) is `{"schema_version": 1, "kind": "journal_cold_questions", "author": ...,
   "questions": [...]}`. `author` is who wrote it: `anthropic`, `openai` or `person`; not the company whose model judges (with `mixed`,
   Anthropic), or the command refuses it. Up to 100 questions, each `{"id", "question", "answerable", "evidence_quotes", "planted"}`: the id
   is your own name for it and isn't used outside the file (everywhere else a question is named by its place in it); an answerable one
   names its evidence by exact words of the journal, each found in one to three usable passages of the copy (exactly, after Unicode
   normalization and with runs of white space as one), and no passage is the evidence of more than two questions; an unanswerable one
   (absent, a false premise) names none; no question is asked twice. `planted`, on answerable ones only, is a wrong answer the judge must
   catch: `{"kind": "negation" | "person" | "time" | "happened" | "certainty", "answer": "..."}` (a "not" dropped or added, another person,
   another time, something planned, wished or dreamed told as done or the other way round, something uncertain told as certain). For a pass
   the file needs 40 answerable questions that share a search word with the passages of all their evidence, 20 unanswerable ones for which
   the search returns something all the same, and 20 planted answers, three of each kind.

   Or GPT writes the run's questions (your i77 3a and i81 5b; `docs/superpowers/specs/2026-11-26-runner-journal-upload-and-tab-design.md`,
   section 3), in place of the file:

   ```bash
   node scripts/runner-trial-journal.mjs --cold-test --gpt-questions --provider mixed --dir /absolute/path/invented-trial
   ```

   The trial's sealed Codex worker (no tools, an empty folder, no session kept; on your ChatGPT plan, whatever `--provider` says) gets
   passages of the copy sampled across it, under opaque names, each with the date its entry gives, and writes questions about some of
   them, with their exact evidence and planted wrong answers. For the questions the journal doesn't answer, the program chooses the
   subject from a fixed list among those no passage names, and GPT gives a verb from the program's list and a short phrase holding a
   word of a passage it was given ("When did I visit the planetarium after the market?"). Passages about dying are sampled like any
   other. The program checks every candidate, and GPT checks each answerable key on its evidence passage alone. Short of what a pass
   needs, or of 8 questions in other words, after at most one more batch of each kind that is short, the tool stops with a code and its
   counts, and no test runs. At most 150 passages and 20 calls a run. A packet still without an answer in its schema after two more asks
   (which is how a refusal by GPT would most likely come), or that a worker says it refused, is dropped, and its passages are held back
   from the tool's later calls for that client, by the digests of their words in `journal/<case id>/questions-held-back.json` (the
   design's sections 3.2 and 12 say what is matched, and what that leaves). The questions and their key live in the command's memory for
   that run alone; the command prints the tool's numbers before the test's. The questions' author is `openai`, so the tool doesn't run
   with `--provider codex`, whose judge is GPT too.

   Until a consent in its new words names GPT's questions (pull request 3 of that design), they run only on an invented journal: in a
   trial folder set apart for invented journals by a file named `invented-journals-only` in it (with no permission for group or others;
   no command writes it), never the default trial folder or a folder a runner starts from, one holding the icon's `launcher.json`
   (refused even with the file), and on a copy whose first passage, in the copy's source order, is a passage a reply may quote whose
   words are exactly this sentence of the code's, byte for byte (the invented-journal sentinel):

   ```text
   This journal is invented for a test of InnerSignal, and nothing in it is anyone's: no person wrote it, no person is in it, and no reply to any person will ever quote it.
   ```

   A journal opens with that sentence only if someone put it there. The check is of the copy's first passage, not of the file it came
   from. That passage goes to none of GPT's question calls. Elsewhere they are refused before any call. None of it has been run against
   a model: the measured run on an invented journal comes once this is merged (i81 6a).

   For each question, the test gives a fresh call of the trial's writer's worker (with `--provider mixed`, GPT) exactly what a reply to
   that question as the message would get from the copy: the replies' reader's own search, at most six passages, each with when it was
   written, its wording cues and its lifecycle, and what was searched. It never gets the key. It answers from those passages alone, says
   whether they answer the question, and cites every passage it uses. A judge, a fresh call of the trial's checker's worker (with `mixed`,
   Claude), then gets the question, whether the journal answers it, its key quotes (none when it doesn't), the same passages and the
   answer, and says whether it is right, incomplete or wrong. A wrong is asked again: an answer counts as wrong when two of at most three
   calls say so, and as disputed when one does. A planted wrong answer goes to the judge in the same packet as a real one and through the
   same calls. That is two calls a question, and two more for a planted answer: for the smallest file that can pass about 160 calls, one at a
   time, and one or two more for each other answer the judge finds wrong. A call that fails for its form is made again, at most twice and six
   times in a test; a plan limit stops it. A refusal by Claude, known by its own stop reason, leaves the question out (and a planted answer
   Claude refuses isn't caught). One by GPT can't be told, as Codex gives no sign of one: it would most likely come as a malformed answer, be
   asked twice more and then stop the test.

   The copy passes when the file is large enough; the judge caught at least four in five of the planted answers, and half of each kind; not
   one answer is wrong (judged so, a passage cited that it wasn't given, or an answer said to be supported that cites none), to any
   question (your i77 2b, 24 Nov 2026); at least two thirds of the questions of the first sort (the 40's) are right (their passages found
   and cited, supported in words, judged right) and of the second (the 20's); at most one
   question in ten is left out (its search took over four seconds, after which a reply goes without the journal, or Claude refused it);
   and the copy's publication is the same before and after. A miss is safe in use: the reply is then made from the conversation alone.
   Questions worded without their passages' words, which a word search can't find, and those that find nothing, are counted and shown, and
   not required; a wrong answer to one counts all the same.

   A test that starts removes the copy's receipt; only a pass gives a new one. Too many wrong answers, a malformed one, a file too small, a
   failed call, a key quote that doesn't fit, a part of the journal the reader can't give, a withdrawn consent or a deleted case leaves
   none. With not one wrong answer allowed, a good copy may well fail a test by chance: one whose answers are wrong 1 to 3% of the
   time passes 18 to 53% of its runs (computed, not measured; the judge's own mistakes are in it). So the report, the receipt and
   the last line say how many tests were started on this copy (an import begins a new count): a copy that passes only after several tests
   may have passed by chance. Of tests of one copy that overlap, the one started last decides. Each marks its start in the client's journal
   folder (`cold-test-attempt.json`, mode 0600: an id of its own, the time, the copy and that count). A pass gives a receipt, and a test that doesn't pass takes one
   away, only while the marker still names that test. So once a newer test has started, an earlier one that passes gives no receipt, also
   when the newer one failed or was killed (it says that the newer one decides), and an earlier one that doesn't pass leaves the receipt
   the newer one gave. An earlier test runs on to its end, its packets included.

   The test sends excerpts of the client's journal to the companies that run its two workers: with `mixed`, Anthropic and OpenAI; with
   `claude`, Anthropic; with `codex`, OpenAI. So it needs the client's confirmed consent, read again under the trial folder's lock right
   before each packet is handed to a worker's process, and before the receipt is written, with the copy: that the list names it and that the
   vault has it as it was published when the test started (a Delete takes the case from the vault first, and may not get to the list). A
   withdrawal, a Delete or another publication before that reading stops the packet; one after the hand-over is honoured at the next packet,
   or before the receipt is written.

   What it prints is numbers: how many questions of each kind, how many had their passages found and how many were answered right (each
   for the questions the rule counts and for the others), what was wrong (and how many answers were judged), disputed, incomplete or left
   out, how many planted answers of each kind were caught and how many were refused, calls made again, the slowest search, the points of the
   rule that aren't met, each question's place in the file with its scores, and an opaque name for the snapshot tested. No
   command here prints a label, a question's id, an answer, journal text or the judge's reason (which isn't kept), nor an unexpected
   error's own words, which can quote a file: its code only.

   Limits: all but the judge's part are exact checks. With `claude` or `codex` the judge is the consumer's own company's model. The test
   makes no reading of the message, where a conversation that could be about wanting to die gets no journal. It asks one short question at a
   time on a quiet computer, where real messages are paragraphs and are searched while other work runs. And it shows what a model makes of
   the passages with an instruction of its own, not the writer's whole prompt, so not whether a reply leaves alone quotations that have
   nothing to do with its message. A change of the reader (an update of the trial that searches another way) or of the pass rule closes
   every client's journal until its copy has passed again, and a receipt of the test's first design, which names no reader, opens nothing.
   Nothing here has been run against a model or a real journal. The method is as you decided in i77 (24 Nov 2026): this pass
   rule (2b), and GPT writes the questions and the planted answers from the journal's own quotes, part of the questions worded without the
   quotes' words (3a; built as `--gpt-questions` above, on invented journals only for now).

Short of any of them, the turn's evidence records why (`journal_consent_missing`, `no_journal_copy`,
`cold_test_receipt_missing` or `cold_test_receipt_mismatch`) and the reply is made from the conversation alone.

**How a journal is searched** (`docs/superpowers/specs/2026-11-24-runner-journal-search-design.md`). The readers read the message first,
and its first words (a provisional reply, the emergency line) wait for no search. Then one ranked search goes by the message's less common
words (of the whole message, up to 40,000 characters): at most six quotations come back, each with when its entry says it was written,
its wording cues (found for English wording only) and its lifecycle. Sharing words doesn't make a quotation relevant: the writer is told to use one only when it helps,
and the checker checks every claim against its source. A repair whose check asked for history searches each of its questions (at most four)
and adds to the quotations, up to twelve. A message that shares no less common word with the journal finds nothing.

**A conversation about wanting to die gets no journal.** When the message isn't read, or is read as anything but none (wanting to die, having
acted or being about to, thoughts of death with no wish to act, or something that could mean either), or, with the number now on, as needing
the emergency number now, or its conversation has been read as one about wanting to die by any reader or checker, no search is made, and the
turn's evidence says `journal_withheld`. When only the checker reads it as one, after a draft was written with quotations in view, that draft
isn't sent, and its repair gets neither them nor the draft. The reply is made from the conversation alone; a new conversation gets the journal
again. Once a case has read its journal, no turn of it gets anything but the conversation and its own quotations as evidence: no unsent draft,
report, instruction or list of them, since any of these may hold the journal's words (a rule about the whole case, in place of following
each draft, which kept leaving a way).

**Once a client's case has read its journal, the case is used only while the gate is open.** The gate is open when the owner's
confirmation of the consent stands, the client list names the copy, the client's current grant opens it for session use, and a
passing cold-test receipt names exactly the copy's current publication, the reader in use and the pass rule. It is asked when a turn starts, before
every call of a reader, the writer, a checker or the repair (each retry included), by the worker itself at the last moment before its
packet leaves, before a provisional reply is shown (the fixed emergency line shows instead) and before a reply is delivered. The consent
is read last in each check, so a withdrawal holds for everything that starts after it; a packet already past its last check, in
the instant before it leaves, still goes. Each output to the person (a provisional reply, a delivered reply) in such a case is
checked and made under the trial folder's lock, which `--journal-consent` takes too, so a withdrawal lands wholly before it (and
nothing is shown) or wholly after it; a command waits up to ten seconds for that lock. The output is made when it is recorded in
the case as shown or delivered: a withdrawal after that moment doesn't recall it, so its answer to the page, and the page showing
the conversation again later, still carry it. While it is closed (a withdrawal, a lost or replaced receipt, a changed publication, reader
or rule, a grant without the purpose), that case makes no model call at all and delivers nothing: every turn closes as a failed check,
also an approved one a restart's reconcile finds, because the case's drafts, findings, evidence and delivered replies may hold the
journal's words. Confirming the consent again (with the copy's receipt in place) opens it, and so does a passing cold test where only
the receipt was missing, or of another reader or rule; deleting the case removes the case, its copies, their journal folder (the key and the
receipt) and everything drawn from it, and the list then names no copy and no server case of theirs (the consent stays as recorded),
so the client starts afresh. The page says so under a client whose consent
is withdrawn. A client's deletion is made under the trial folder's lock: while that can't be had, nothing is deleted and the page
says why. Once the case is gone from the vault, it's deleted whatever becomes of the rest (the vault's own last steps, the client's
place on the list, their journal folder, what the running trial remembers, the case's run log): each is tried, the page forgets the
case all the same and names what couldn't be cleared ("The case was deleted. Some leftovers on this computer remain: …; press Delete
again to clear them."), and Delete again clears it. A vault that fails with the case's file gone already (found by loading the case)
leaves "some of the vault's own files for the case", also for your own case; a client's server case then stays theirs on the list (no
other client's copy can come from it) until a Delete the vault finishes. One that fails with the case still there, or where that
can't be seen, deletes nothing more, and the page says that Delete didn't finish. The journal folder counts as removed once the folder
it was in is synced, so a power cut can't bring the key back. (The folder's lock, when it can't be looked at or removed, is named too:
stop the trial and remove it by hand.) Cases that never read a journal, the owner's own included, are never stopped by the gate. With
`--response-evidence`, every turn (your own included) is checked against the sources it rests on: the writer sees the turn's evidence,
the whole checker returns the evidence review the program then checks word for word, a declared journal quote must be word for word in
its source, and the store admits the reply only with its evidence. It needs the whole checker. A reply resting on the journal sends up
to about 8,000 more tokens of quotations (six of them, twelve after a repair's search) to the writer and the checker, again at each
repair.

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
they never fail a turn. **Delete this case deletes that case's JSONL file too** (and, for a client, their journal folder and their
copy's place on the client list; the page names what it can't clear), and clears the page's log panel. No log route, file writing or
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
