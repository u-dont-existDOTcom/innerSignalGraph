# InnerSignal's feedback place (owner's i63b): design

Status: draft 1, 22 Nov 2026 (written from 00:48 UTC by the session building it, Claude Opus 5.5). Not built, not
reviewed, not released. Branch `claude/feedback-place-20261122` from `origin/main` (`22a2a2901`). Nothing here is live,
and nothing goes to `stable`, the server or a switch without the owner's typed yes.

## 1. What the owner asked for

His words, 20 Nov 2026 (23:45 UTC, with his answer on the crisis contacts): "a place where people can send InnerSignal
suggestions, bugs, praise and reviews". He chose i63b on 22 Nov 2026 (chat, 00:37 UTC):

- **a, the private feedback page:** no account needed. The person picks suggestion, bug, praise or review, writes it,
  can leave an address for a reply, and can tick "you may show this review publicly". It's kept on InnerSignal's own
  server and comes to him in his InnerSignal Inbox. InnerSignal gives the link when someone wants to suggest, report or
  praise something; the runner trial's page gets a button to the same page. A review is shown publicly only with the
  sender's tick and his yes.
- **b, also sending from inside a chat:** InnerSignal writes the feedback up and the person approves the exact text
  before it's sent. A new tool, so his ChatGPT app and Claude connector each need one refresh: it goes out with the
  next release that needs a refresh anyway (the parked rules-in-parts release, pull request 232, also changes the tool
  list).
- **Privacy, promised in the question:** the page says what is kept (the text, the time and the optional address), that
  only he reads it, and how to have it deleted. Nothing from a feedback message goes into InnerSignal's rules or
  anyone's case without his decision.

His guides' comments stay what he said they're for: therapy questions the bot can't answer, and suggestions and praise
(SKILL.md, "Reader guides and altered-state routing", last sentence, pinned by `tests/crisis-rules-and-guards-20261121.test.mjs`).

## 2. What exists today (checked before calling anything missing)

| Place | What it is | Why it isn't the feedback place |
|---|---|---|
| Guide comments (`innerchild.u-dont-exist.com` and the other guides) | Public comments on Substack; the served rules already send therapy questions, suggestions and praise there | Public; needs a Substack sign-in to comment |
| GitHub issues on `innerSignalGraph` | Public issue tracker | Public, needs a GitHub account; people may paste therapy content |
| GitHub private vulnerability reporting (`SECURITY.md`, enabled in `.github/codex-repository.json`) | Private route for security problems | Needs a GitHub account; security only. Stays as it is |
| `POST /v1/debug/feedback` in the local app (`src/dev/feedback-store.mjs`) | The owner's own ratings of replies (good, needs-work, too-slow) on his laptop, feeding development cases | Local to his laptop; not reachable by users |
| The hosted connector (`src/server/private-case-mcp.mjs`) | Serves `/health`, OAuth metadata and MCP (at `/mcp` and, for a bare-origin resource, `/`) | Has no web page and no write path for the public |
| The owner's Signal username | Last resort for someone in crisis who has no one (owner answer 391a) | Not for feedback |

Nothing in the repository seals data to a public key, limits request rates or escapes HTML today (searched `src/` and
`scripts/` for X25519, `diffieHellman`, rate limits, `escapeHtml`, honeypot). The closest pieces, reused where they fit:
`src/core/on-off-setting.mjs` (switches), the reply-draft switch pattern (`src/server/supervisor-reply-setup.mjs`), the
journal exchange's root checks (`resolveJournalWorkExchangeRoot`, `assertJournalWorkExchangeRoot` in
`src/journal-import/work-exchange.mjs`), AES-256-GCM as used by the vault (`src/storage/vault-crypto.mjs`).

## 3. Where the page and the store live

**Choice: routes on the hosted connector's own server, under `/feedback`, with the store on a volume of its own.** The
connector process (`src/cli/private-case-mcp.mjs` → `createPrivateCaseMcpServer`) hands every request whose path is
`/feedback` or starts with `/feedback/` to a self-contained module (`src/feedback/`), only when the switch is on. The
store is a directory on its own volume (`/data/feedback` in the container; on the host
`/srv/inner-signal-private/feedback`, mode 0700, owned by the image's `node` user).

Address today: `https://private-mcp.185-233-106-15.sslip.io/feedback`. It works without a DNS change, a new certificate
or a proxy change. A nicer address (for example `feedback.u-dont-exist.com`) is the owner's choice: one DNS record and
one proxy route to the same container; the served sentence's link changes with it (it names the address), and the
setting `INNER_SIGNAL_FEEDBACK_PUBLIC_URL` gives every page and tool text the address in use.

Why here, and what else was weighed:

- **Same process, own volume (chosen).** One image swap per release, as today; the page and the chat tool share one
  store and one set of limits without a hand-off between processes. Risk: a public form is parsed by the process that
  holds the case keys in memory. The connector already parses public JSON-RPC from anyone (the protocol tools need no
  sign-in), so the form adds input of the same kind; it is handled with no dependencies, strict size and time limits,
  and no file name ever taken from input (section 10).
- **A separate container** would keep the form away from the case keys. It needs a second service, a proxy route, and a
  shared volume or an internal call for the chat tool, so more release work. The module takes everything it needs as
  arguments (root, keys, limits, clock), so moving it into its own service later is a deployment change, not a rewrite.
  Recommended only if the owner wants the stronger separation now.
- **Third-party forms** (Google Forms, Tally) and **email** aren't on InnerSignal's server and add a third party that
  reads every message; email also needs a mailbox and draws spam. Not what he chose.

## 4. Storage and encryption

**Sealed to the owner's key, so the server can't read what it stores.** The owner holds an X25519 key pair made on his
laptop (`scripts/feedback-inbox.mjs keygen`). The server is given only the public key
(`INNER_SIGNAL_FEEDBACK_OWNER_PUBLIC_KEY`). Each message is sealed on arrival:

1. a fresh X25519 key pair for this message; the shared secret with the owner's public key;
2. HKDF-SHA256 (salt: the fresh public key followed by the owner's public key; info: `inner-signal:feedback:v1:` and the
   message's id) gives a 32-byte key;
3. AES-256-GCM with a random 12-byte nonce; the associated data is the message's clear record (below) as canonical
   JSON, so the record and the sealed part can't be swapped or edited without the opening failing.

What is stored, one file per message, `items/<id>.json`, written to a temporary file and linked into place (an
existing name is never overwritten), mode 0600:

- **in clear:** `format` (`inner-signal-feedback-v1`), `id`, `received_at` (UTC, to the second; the file's own time
  shows it anyway), `via` (`page` or `chat`), `public_review` (true only for a review with the tick), and for those
  `publish_mac` (section 8). The server needs these to sort, expire, delete and publish.
- **sealed:** `kind`, `text`, `reply_address` (or null), `may_show_publicly`, and for a public review `publish_key`.

Nothing else is stored with a message: no IP address, no browser details, no cookie, no account, no token, no
language guess. The rate limits (section 5) live only in memory, keyed by an HMAC of the client address under a key
made at start, and forget each key when its window ends.

**The owner's file** (`~/.config/innersignal-feedback/owner.json`, mode 0600, outside every Git checkout) holds the
private key and the read token (section 7). He should keep a second copy (his password manager): if both copies are
lost, stored messages can't be read (they can still be deleted, and new ones still arrive under a new key).

**Other files:** `published/<id>.json` holds an approved review's exact text and the month it was sent (it is public
by then). `deleted/<id>.json` holds a deletion's id, time and who deleted it (sender, owner or expiry), no content, for
90 days, so the owner's Inbox drops its copy at the next read.

**How long:** until the sender or the owner deletes it, at most 365 days (proposed; owner point). A sweep runs at start
and every hour.

**Caps:** at most 5,000 stored messages and 50 MB. When full, the page says the box is full and to try later, and the
tool returns `FEEDBACK_FULL`; the owner's read reports it.

## 5. Spam and rate limits, without a third-party CAPTCHA

- **A form token.** The page carries a token signed with a key made at start (issued time and a random value). A send
  is accepted from 2 seconds to 24 hours after the page was served, and once: a used token is remembered for 30
  minutes with the message it made, so pressing Send twice or reloading shows the same thank-you page with the same
  code and stores nothing more. After a restart, an older page's token fails: the form comes back with the person's
  words filled in and asks them to press Send again. Nothing is lost.
- **A hidden field** that people never see or fill (labelled for screen readers as "leave this empty", off the
  keyboard order, `autocomplete=off`). If it's filled, the sender sees the ordinary thank-you page and nothing is
  stored; the owner's read counts these.
- **Sizes:** the page's request body at most 64 KB (room for 5,000 characters of any script, percent-encoded); text 1
  to 5,000 characters (counted as Unicode code points); reply address at most 200; kind one of four; anything else is
  refused with the form shown again.
- **Rates, per client address:** page sends 5 per 10 minutes and 20 per day; chat sends 10 per 10 minutes and 50 per
  day; deletion attempts 10 per hour; failed owner sign-ins 5 per 10 minutes. **Overall:** 30 sends per 10 minutes and
  300 per day (page and chat together); 100 deletion attempts per hour; 20 failed owner sign-ins per 10 minutes. A send
  over a limit gets "busy, try again later" (page: HTTP 429; tool: `FEEDBACK_BUSY`).
- **Client address:** the connection's address, unless `INNER_SIGNAL_FEEDBACK_TRUST_FORWARDED_FOR` is on, which the
  release turns on only after reading the proxy's setup: then the last address in `X-Forwarded-For` (the one our own
  proxy appends). With it off, every visitor shares the proxy's address and the per-client limits act as one more
  overall limit. Chat sends come from ChatGPT's and Anthropic's servers, so their per-client limit is wider.
- **Effect of a flood:** the feedback box is busy for the window; the connector's MCP answers are untouched (their
  path never reaches the feedback limits).

## 6. The deletion code

- 80 random bits, shown as four groups of four characters from Crockford's base-32 alphabet (no I, L, O or U), for
  example `7Q2M-K9TC-XR4H-PN0A`. Reading accepts lower case, spaces, missing hyphens, and O/I/L typed for 0/1/1.
- The message's id is derived from the code one way: `fb_` and the first 20 base-32 characters of
  SHA-256(`inner-signal:feedback:delete:v1:` + the normalized code). So the code finds its message directly, and the
  server keeps nothing from which the code can be recovered.
- Shown once, on the thank-you page or in the tool's result, with the deletion page's link. Deleting
  (`/feedback/delete`) removes the message and, for a published review, its public copy at once, and leaves the
  tombstone of section 4 so the owner's Inbox copy goes at his next read.
- **Lost the code:** the page says to send a new message asking for the deletion, saying roughly when and about what;
  the owner deletes it from his Inbox. He can always delete any message.
- The page says plainly that an answer he already sent to their address stays in both mailboxes.

## 7. How the owner reads it (an owner-only read; never a production shell command)

**On the server**, routes under `/feedback/owner/`, answered only with the owner's read token (`Authorization: Bearer
…`). The server keeps only the token's SHA-256 (`INNER_SIGNAL_FEEDBACK_OWNER_TOKEN_SHA256`) and compares in constant
time; a correct token always works; wrong tokens are counted and, past the limits, answered 429.

- `GET /feedback/owner/items?after=<cursor>&limit=100`: the sealed messages and the deletions since the cursor, in
  order, with counts (stored, sends refused for limits, hidden-field hits, full refusals since start). Never any
  plaintext: the server has none.
- `POST /feedback/owner/delete {id}`; `POST /feedback/owner/publish {id, text, publish_key}`;
  `POST /feedback/owner/unpublish {id}`.

**On the laptop**, `scripts/feedback-inbox.mjs` (Node, no dependencies beyond the repository):

- `keygen`: writes the owner file (refuses to overwrite one) and prints the two server settings (the public key and
  the token's hash), never the private key or the token.
- `fetch --out <empty folder in the scratchpad>`: reads from the cursor, opens each message with the private key,
  checks the clear record against the sealed one, and writes an ArtifactData batch for the Inbox's `feedback`
  collection (one document per message: id, kind, text, reply address, received time, via, public tick, status) and a
  list of deletions to remove. The cursor is kept in `~/.config/innersignal-feedback/state.json` and moves only after
  the lane confirms the batch was sent (`fetch --confirm <folder>`), so a failed turn re-reads rather than loses.
- `delete <id>`, `publish <id>`, `unpublish <id>`.

**Each turn, the InnerSignal lane** (its Inbox README gains the step; the lane changes its own files): runs `fetch`,
sends the batch to the Inbox with ArtifactData, confirms, deletes the scratchpad folder, and reports new messages to
the owner: anything that reads like someone in danger first (section 9), then reviews waiting for his yes, then the
rest. The texts go into the Inbox's database only: never into owner-pages' Git, the handoff note, a log or a commit.
The Inbox page gains a Feedback view (drafted for the lane: `inbox-feedback-view-draft.md` in the release folder).

**What this means for the promise "only he reads it":** his Inbox is a page in his Claude account, and the lane that
reads new messages is a Claude session, so the text passes through Anthropic as his assistant. The page says so in
plain words (section 11). If he'd rather it didn't, the alternative is a local reader on his laptop, with the Inbox
showing counts only (owner point).

## 8. How a review becomes public

1. The sender ticks "You may show this review publicly" (page; only with the kind Review, otherwise the form says to
   choose Review or untick it), or says so in the chat (the tool's `may_show_publicly`, refused for other kinds).
2. In his Inbox the review shows the tick and asks "Show it publicly?". Only his yes leads to `publish <id>`.
3. The server shows exactly what the sender wrote, or nothing. At sending, the server made a random 32-byte
   `publish_key`, sealed it inside the message, and stored `publish_mac` = HMAC-SHA256(`publish_key`, text) in clear.
   `publish` sends the opened text with the key; the server checks the HMAC and refuses any other text. The server
   can't brute-force short texts from the mac (the key is only inside the sealed part), and nobody can publish an
   edited version.
4. Published reviews appear on `/feedback/reviews` with the month they were sent and no name or address (a name shows
   only if the sender wrote one into the review).
5. The sender withdraws it at any time with the deletion code; the owner can unpublish.

## 9. Someone in crisis who uses the feedback box

- **On the page,** above the form and again on the thank-you page, the owner-approved line from i62: "In danger right
  now? Call your local emergency number: 112 in the EU (and from mobiles in many other countries), 911 in the US and
  Canada, 999 in the UK." and "This box is read by one person, not every day, and it can't send help."
- **In a chat,** the served sentence (section 12) and the tool's description: someone who wants to die or is in danger
  gets the reply the crisis section gives first; feedback is never offered instead of help.
- **When the owner reads,** the lane puts any message that may come from someone in danger at the top of its report to
  him, with whether an address was left. He decides whether to write. Nothing is sent automatically.
- **On the server, no meaning check.** A word list would miss most such messages in other words or languages and would
  misfire on bug reports that quote a crisis reply; judging meaning is the model's job (the lane), not a pattern's.

## 10. The page

Plain HTML, no JavaScript, one inline stylesheet allowed by its hash. Works on a phone and with a screen reader
(labels, a fieldset for the kinds). English for now; people can write in any language.

Routes (only with the switch on; otherwise 404 exactly as today): `GET /feedback` (form), `POST /feedback` (send;
`application/x-www-form-urlencoded` only), `GET|POST /feedback/delete`, `GET /feedback/reviews`, the owner routes of
section 7. Headers on every page: `Content-Security-Policy: default-src 'none'; style-src 'sha256-…'; form-action
'self'; frame-ancestors 'none'; base-uri 'none'`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`. Every value shown back is HTML-escaped. Reading a request
stops at its size limit and after 10 seconds.

## 11. What the page tells the sender (exact words, for the owner's yes)

Title: **Send InnerSignal feedback**

> A suggestion, something that isn't working, praise or a review: write it here. No account needed.
>
> **In danger right now?** Call your local emergency number: 112 in the EU (and from mobiles in many other countries),
> 911 in the US and Canada, 999 in the UK. This box is read by one person, not every day, and it can't send help.

Fields: **What is it?** Suggestion / Something isn't working / Praise / Review. **Your message.** **How can we answer
you?** (optional: an email address or another way to reach you). **You may show this review publicly** (reviews only:
shown exactly as written, without your address, only if the maker agrees).

> **What's kept:** your message, the time you sent it and, if you give one, your address for an answer. Nothing else:
> no account, no name unless you write one, no IP address. It's stored encrypted on InnerSignal's server so that only
> the person who makes InnerSignal can read it. He reads it in his own inbox with the help of his AI assistant (Claude,
> made by Anthropic). Nothing from it goes into InnerSignal's rules or into anyone's case unless he decides so. It's
> deleted after a year, or sooner: after sending you get a code that deletes it at any time.

Thank-you page:

> **Thank you, it's sent.** Your deletion code: **7Q2M-K9TC-XR4H-PN0A**. Keep it if you might want this message
> deleted: enter it at [the deletion page]. It can't be shown again. (If he has already answered you, that answer stays
> in both your mailboxes.)

plus the emergency line. The "no IP address" sentence is true of InnerSignal's store; whether the server's proxy logs
visits is read at release (section 15), and the sentence gains a clause if it does.

## 12. In a chat: the served sentence and the tool

**Served sentence** (SKILL.md, after the guide-comment sentence, which stays word for word):

> To send InnerSignal a suggestion, a problem, praise or a review privately, without an account, there is its feedback
> page (https://private-mcp.185-233-106-15.sslip.io/feedback): only its maker reads what's sent there, and the page says
> what is kept and how to have it deleted. Where the host offers `send_feedback`, you can offer to write it up instead:
> show the person the exact text, its kind, any reply address and, for a review, whether it may be shown publicly, and
> send it unchanged only after they say yes to that text; leave out private details of their life or therapy unless
> they ask to include them. Feedback is read by one person, not quickly, and it can't send help: someone who wants to
> die or is in danger gets the reply the section on that gives first, and feedback is never offered instead of help.

It changes the served protocol's hash, so it goes out with a release, and that release must turn the page on in the
same step (section 15): the sentence must never point to a page that isn't there.

**The tool, `send_feedback`**, behind its own switch `INNER_SIGNAL_FEEDBACK_TOOL` (off; on only with the page's
switch on). With it off, `tools/list`, `initialize` and `/health` are byte-identical to today's.

- Inputs: `kind` (`suggestion`, `bug`, `praise`, `review`), `text` (1 to 5,000 characters), `reply_address` (optional,
  at most 200), `may_show_publicly` (optional boolean, reviews only), `person_approved_exact_text` (required, must be
  `true`: the rule written into the schema; not proof of a yes).
- No sign-in (`securitySchemes: noauth`), like the protocol tools; a bearer token sent with the call is ignored and
  nothing about any account is stored. Annotations: `readOnlyHint: false`, `destructiveHint: false`,
  `idempotentHint: false`, `openWorldHint: false`. Hosts that ask before a tool that changes something will show the
  person the call with its text; InnerSignal can't make a host do that, so the rule doesn't depend on it.
- Description (model-facing):

  > Send the person's feedback about InnerSignal (a suggestion, a problem, praise or a review) privately to InnerSignal's
  > maker, who alone reads it. Call it only after you have shown the person, in the chat, the exact text you will send,
  > its kind, any reply address and, for a review, whether it may be shown publicly, and they have said yes to exactly
  > that; send that text unchanged. Write it from what they told you and leave out private details of their life or
  > therapy unless they ask to include them. Before they agree, tell them what is kept: the text, the time and the
  > reply address if they give one, nothing else. Afterwards give them the deletion code from the result and the page
  > where it deletes the message. It is not a way to get help: someone who wants to die or is in danger gets your
  > crisis reply first, never this instead.

- Refusals (tool errors the model can read): `FEEDBACK_TEXT_INVALID`, `FEEDBACK_KIND_INVALID`,
  `FEEDBACK_ADDRESS_INVALID`, `FEEDBACK_PUBLIC_ONLY_FOR_REVIEWS`, `FEEDBACK_NOT_APPROVED`, `FEEDBACK_BUSY`,
  `FEEDBACK_FULL`, `FEEDBACK_UNAVAILABLE`.
- Result: the deletion code, the deletion page, what was kept, and a line to show the person.
- `initialize` instructions gain one sentence when the tool is on: `send_feedback` is the one tool that sends something,
  and only after the person's yes to the exact text.
- The call trace (`callLog`) stays content-free: tool name, bearer present, ok, code, time, size class.

**Two-step preview (weighed, not chosen):** a first call returning the text to show and a second to send would only
prove the text didn't change between the calls, not that the person said yes, and doubles the calls; ChatGPT's apps
handle one write call more reliably. **Confirming on the web page instead (weighed, not chosen):** a human click proves
a yes, but it takes the person out of the chat, which is the opposite of what the owner chose.

## 13. Switches and settings

| Setting | Meaning |
|---|---|
| `INNER_SIGNAL_FEEDBACK` | on/off (`readOnOffSetting`; anything else stops startup). Off: no route, no store, nothing changes |
| `INNER_SIGNAL_FEEDBACK_ROOT` | absolute path of an existing directory outside the repository, mode 0700, owned by the process user |
| `INNER_SIGNAL_FEEDBACK_OWNER_PUBLIC_KEY` | the owner's X25519 public key, base64url (43 characters) |
| `INNER_SIGNAL_FEEDBACK_OWNER_TOKEN_SHA256` | SHA-256 of the owner's read token, 64 hex |
| `INNER_SIGNAL_FEEDBACK_PUBLIC_URL` | the page's https address, for links in pages and tool texts |
| `INNER_SIGNAL_FEEDBACK_TRUST_FORWARDED_FOR` | on/off, default off (section 5) |
| `INNER_SIGNAL_FEEDBACK_TOOL` | on/off, default off; on requires `INNER_SIGNAL_FEEDBACK` on |

With the page's switch on, all four of root, key, token hash and address are required, or startup stops with a message
naming the setting (never its value). `/health` gains `feedback: {page: "on", tool: "on"|"off"}` only when the page's
switch is on, and so does the ready line; otherwise both are unchanged.

## 14. Tests (synthetic texts only)

Sealing (round trip; wrong key, edited record or edited ciphertext fail; the server modules never import the opening
code); codes (alphabet, normalization, id derivation); the store (atomic, 0600, no overwrite, caps, expiry, tombstones,
published copies); the page (switch off gives 404 and identical `/health`; headers; a valid send; hidden field; bad,
early, late and reused tokens; limits; sizes; tick on a non-review; deletion by code; reviews page); owner routes (no or
wrong token, limits, sealed-only answers, publish with a wrong key or text refused, unpublish, delete); the tool (off:
identical `tools/list` and `initialize`, call refused as today; on: listed with `noauth`, schema, refusals, result,
content-free trace); the laptop script against a local server (keygen modes, fetch, confirm, deletions, publish);
the served sentence present and the guide-comment sentence unchanged. Markers in test texts are checked never to appear
in clear files, owner answers, traces or logs.

## 15. Release (later, with the owner's yes; nothing here is done by this branch)

- **Page alone** (no app refresh): image with this code; volume `/srv/inner-signal-private/feedback` (0700, uid 1000);
  the settings; `INNER_SIGNAL_FEEDBACK=on`; the served sentence released in the same step. Read first, read-only: which
  proxy fronts the container, whether the container's port is reachable other than through it (for
  `TRUST_FORWARDED_FOR`), whether it logs visits, and whether `/srv` is backed up (the page then says deleted messages
  leave backups within that period). Checks after: `GET /feedback` 200, a synthetic send and its deletion, `tools/list`
  unchanged, `/health` and the owner read.
- **The tool** with the release that changes the tool list anyway (pull request 232): `INNER_SIGNAL_FEEDBACK_TOOL=on`,
  20 tools instead of 19, one refresh in ChatGPT and one in Claude.
- **Rollback:** switch off (the routes go back to 404; stored messages stay sealed on the volume), or the previous image.

## 16. Not in this build

Email or other alerts to the owner; replies sent from the server; screenshots or other attachments; deleting from
inside a chat (the page does it); pages in other languages; a separate feedback service (section 3).

## 17. Owner points for the release question

1. The address: the server's own address now, or a nicer one on his domain (a DNS record from him).
2. How long messages are kept: a year (proposed), or another period.
3. "Only he reads it": his Inbox is a Claude page, so texts pass through Anthropic as his assistant; the page says so.
   Or a local reader, with counts only in the Inbox.
4. A second copy of his key file, which only he can make.
5. Same process (proposed) or a separate container for the page.
