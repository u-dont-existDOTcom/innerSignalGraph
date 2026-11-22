# InnerSignal's feedback place (owner's i63b): design

Status: draft 3, 22 Nov 2026: the owner answered the release question (i66: `1a 2a 3a 4a 5b 6a 7a`, with his note on 2a), and
the changes it brings are in Appendix F (the address on innerself.love, the danger reader, the wording). Before that, draft 2 as
built, by the session building it (Claude Opus 5.5). Three things changed while building, each
marked "(built)": the read's two cursors and the one-message read (section 7), the trace line's hour (section 12), and the runner
link's switch (section 14). Draft 1 (`20017c7b4`) was red-teamed by Fable
(`/home/joel/askrigor-releases/20261122-innersignal-feedback/fable-redteam-design-20261122.md`: 3 blocking, 12 should-fix,
8 minor); every finding is answered in the appendix, and this draft is what gets built. Branch
`claude/feedback-place-20261122` from `origin/main` (`22a2a2901`). Not released: nothing goes to `main`'s served rules,
`stable`, the server or a switch without the owner's typed yes.

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
| GitHub private vulnerability reporting (`SECURITY.md`; enabled in `.github/codex-repository.json`) | Private route for security problems | Needs a GitHub account; security only. Stays as it is |
| `POST /v1/debug/feedback` in the local app (`src/dev/feedback-store.mjs`) | The owner's own ratings of replies (good, needs-work, too-slow) on his laptop | Local to his laptop; not reachable by users |
| The local app's diagnostics upload (`src/diagnostics/github-sync.mjs`) | Allowlisted, content-free fault records from an install to the `runtime-diagnostics` branch | Carries no words from a person, by design |
| The hosted connector (`src/server/private-case-mcp.mjs`) | Serves `/health`, OAuth metadata and MCP (at `/mcp` and, for a bare-origin resource, `/`) | Has no web page and no write path for the public |
| The owner's Signal username | Last resort for someone in crisis who has no one (owner answer 391a) | Not for feedback |

Pieces that exist and are reused or followed: `src/core/on-off-setting.mjs` (switches); the reply-draft switch pattern
(`src/server/supervisor-reply-setup.mjs`); the journal exchange's root checks (`resolveJournalWorkExchangeRoot`,
`assertJournalWorkExchangeRoot`); the local app's Content-Security-Policy style (`src/server/create-server.mjs`). Two HTML
escapes exist (`src/journal-import/pointer-examples.mjs`, private to that module; `src/authoring/mermaid-generator.mjs`,
for Mermaid labels): the page keeps its own six-line escape with the same characters rather than tie a public page to
journal code. Nothing in the repository seals data to a public key or limits request rates.

## 3. Where the page and the store live

**Routes on the hosted connector's own server, under `/feedback`, with the store on a volume of its own.** The connector
process hands every request whose path is `/feedback` or starts with `/feedback/` to a self-contained module
(`src/feedback/`). The store is a directory on its own volume (`/data/feedback` in the container; on the host
`/srv/inner-signal-private/feedback`, mode 0700, owned by the image's `node` user). The module takes everything it needs
as arguments, so it could run as its own service later without a rewrite.

Weighed: **a separate container** keeps the public form away from the process that holds the case keys, at the cost of
a second service, a proxy route and a hand-off for the chat tool. The connector already parses public JSON-RPC from
anyone (the protocol tools need no sign-in); the form adds input of the same kind, read with no dependencies, strict
size limits and a time limit that ends the connection, and never a file name taken from input. Recommended only if the
owner wants the stronger separation now (owner point 5). **Third-party forms and email** add a third party that reads
every message, and email draws spam; not what he chose.

**The address: `https://innerself.love/feedback`** (his answer 2a with his note: "the website for innersignal is
innerself.love and it's hosted on the netcup vps"; Appendix F). The server's own sslip.io address can't go into the served
rules (its digits read as a phone number to the rules' check) and looks like phishing. innerself.love is served on the same
server by Coolify's Traefik, which forwards to the site's own container (Caddy on port 8080); its source is
`u-dont-existDOTcom/innerself` (`DEPLOYMENT.md`, `Caddyfile`), which serves files only (no fallback that would take
`/feedback`, no scripts, no analytics, no cookies, no access log). The page is a path on the site: one Traefik router on the
connector's container, `Host(innerself.love) && (Path(/feedback) || PathPrefix(/feedback/))`, with a priority above the
site's router, sends those paths to the connector; the site's own app and its container are untouched, and no DNS record is
needed. The alternative, `feedback.innerself.love`, needs a DNS record from him and gives an address that says "feedback"
twice; kept as the fallback if the release's read-only check finds that the site's router can't be outranked. Whatever
address ships keeps answering (or redirecting) for as long as copies of the rules name it. One constant,
`FEEDBACK_PAGE_URL` in `src/feedback/address.mjs`, holds the address the rules name; tests keep the served sentence, the
runner's link and the setting equal to it.

## 4. Storage and encryption

**Sealed to the owner's key, so the server can't read what it keeps.** The owner makes an X25519 key pair on his laptop
(`scripts/feedback-inbox.mjs keygen`); the server is given only the public key (`INNER_SIGNAL_FEEDBACK_OWNER_PUBLIC_KEY`).
The server process sees a message in clear only while it seals it, as any web server sees what it receives; what it keeps
is sealed. Each message:

1. a fresh X25519 key pair; the shared secret with the owner's public key (a degenerate owner key is refused at start);
2. HKDF-SHA256 (salt: the fresh public key followed by the owner's public key; info: `inner-signal:feedback:v1:` and the
   message's id) gives a 32-byte key;
3. AES-256-GCM with a random 12-byte nonce; the associated data is the message's clear record as canonical JSON, so the
   record and the sealed part can't be swapped or edited without the opening failing;
4. the sealed JSON is padded with spaces to the next size step (512 bytes, then doubling), so a file's size shows only
   the step, not the message's length.

One file per message, `items/<id>.json`, written to a temporary file and linked into place (an existing name is never
overwritten), mode 0600, its file times set to the start of its day. (That hides the time from the file's modified and accessed
times and from copies that keep them, not from the disk itself: its change time, and a creation time where the file system
keeps one, still show when the file was written. Whoever has the server's disk can see when messages arrived, never what they
say. Found by Codex; stated rather than engineered around.)

- **in clear (what the server needs):** `format`, `id`, `seq` (a strictly increasing arrival number from a counter file,
  so the owner's read never skips one), `received_day` (the date only), `via` (`page` or `chat`, for the per-door caps
  and the owner's bulk delete), `key_id` (a hash of the public key that sealed it), `held_until` (chat messages only: the
  hour after which the owner's read returns it, section 7), `public_review` (true only for a page review with the tick)
  and, for those, `publish_mac` (section 8).
- **sealed:** `kind`, `text`, `reply_address` (or null), `may_show_publicly`, `received_at` (to the second), and, for a
  public review, `publish_key`.

Nothing else is kept with a message: no IP address, no browser details, no cookie, no account, no token. Rate limits
(section 5) live in memory only, keyed by an HMAC of the client address under a key made at start.

**The owner's files** (`~/.config/innersignal-feedback/`, 0700, outside every Git checkout): `owner-keys.json` (his
private keys, by key id, so a replaced key doesn't strand older messages) and `owner-token` (the read token), each 0600.
He should keep a second copy of both (his password manager). If every copy of a key is lost, the messages it sealed
can't be read; they can still be deleted, and new ones arrive under a new key.

**Other files:** `published/<id>.json` holds an approved review's exact text and month (public by then).
`deleted/<id>.json` records a deletion (id, its own `seq`, day, by whom), no content, and stays until the owner's read has
confirmed it (section 7), at most 400 days. `counter.json` holds the next arrival number.

**How long:** a message is deleted after 365 days (proposed; owner point 2) or sooner by the sender or the owner. A
published review's public copy stays until the sender or the owner removes it: its deletion code still removes it after
the message itself has expired. A sweep runs at start and every hour.

**Caps:** at most 5,000 stored messages and 50 MB, shared 3,500 for the page and 1,500 for the chat. When a door's
share is full, it says the box is full; the other door stays open; the owner's read reports which.

**A thief of the owner's token** can delete messages and unpublish reviews, but can't read a message or publish one.
**A thief of the server's disk** gets sealed files. **Whoever takes over the running server** reads new messages as they
arrive, never stored ones.

## 5. Spam and rate limits, without a third-party CAPTCHA

- **A form token** on the page, signed with a key made at start (issued time and a random value): a send is accepted
  from 2 seconds to 24 hours after the page was served, and once; a used token is remembered for its whole life with the
  code it gave, so pressing Send twice or reloading shows the same thank-you page and stores nothing more. After a
  restart an older token fails: the form comes back with the person's words in it, asking them to press Send again.
- **A hidden field** people never see (neutral name, off the keyboard order, `autocomplete=off`, labelled for screen
  readers "Leave this empty"). If it's filled, nothing is stored and the form comes back, with the person's words and
  "Please press Send once more", never a false "sent". The owner's read counts these.
- **Sizes:** the page's request body at most 64 KB; text 1 to 5,000 characters (Unicode code points, any script); reply
  address at most 200, one line; kind one of four. Control characters, direction overrides and invisible spaces are
  removed from the text (joiners that emoji and some scripts need are kept).
- **Rates:** page sends 5 per 10 minutes and 20 per day per client, 30 per 10 minutes and 150 per day overall; chat
  sends 10 per 10 minutes and 50 per day per client, 30 per 10 minutes and 150 per day overall; deletion attempts 30 per
  hour per client (no overall cap: an 80-bit code can't be guessed anyway, and a cap would let a stranger block everyone's
  deletions); failed owner sign-ins 5 per 10 minutes per client, 20 overall. A refused send says "busy, try again later"
  (page: HTTP 429; tool: `FEEDBACK_BUSY`).
- **Client address:** the connection's address, or, when `INNER_SIGNAL_FEEDBACK_TRUST_FORWARDED_FOR` is on (set at
  release only after reading the proxy's setup), the last address in `X-Forwarded-For`. IPv6 clients are keyed by their
  /64. Past 10,000 tracked clients, new clients are refused until old ones expire (an attacker with many addresses can't
  reset their own counters). With the setting off, everyone shares the proxy's address and the per-client limits act as
  overall limits.
- **The chat tool is the weaker door:** it needs no sign-in and has no form token or hidden field, and all ChatGPT users
  share a few addresses. A script can fill the chat's daily budget (150) and its share of storage (1,500, about 10
  days), but not the page's; the owner's bulk delete (`delete-many --via chat --from <day> --to <day>`) clears a flood.

## 6. The deletion code

- 80 random bits, shown as four groups of four characters from Crockford's base-32 alphabet (no I, L, O or U), for
  example `7Q2M-K9TC-XR4H-PN0A`. Reading accepts lower case, spaces, missing hyphens, and O, I, L typed for 0, 1, 1.
- The message's id is derived from the code one way (`fb_` and 20 base-32 characters of SHA-256 over a fixed label and
  the code), so the code finds its message directly and the server keeps nothing from which the code can be recovered.
- The code travels only in a form's body (`POST /feedback/delete`), never in a web address; no page links to a code.
- Shown once, on the thank-you page or in the tool's result, with the deletion page's address. Deleting removes the
  message and any public copy of it from the server at once, and leaves the deletion record that removes the Inbox copy
  the next time the owner's Inbox is updated.
- **Lost the code:** send a new message asking for the deletion, saying roughly when and about what; the owner deletes
  it from his Inbox.
- What deletion can't reach, said plainly: an answer he already sent stays in both mailboxes; a chat keeps its own copy
  of what the person wrote in it; server backups, if any, keep only the sealed copy until they're replaced (checked at
  release, section 15).

## 7. How the owner reads it (an owner-only read; no shell on the server; no model reads the texts)

**On the server**, routes under `/feedback/owner/`, answered only with the owner's read token (`Authorization: Bearer
…`). The server keeps only the token's SHA-256 (`INNER_SIGNAL_FEEDBACK_OWNER_TOKEN_SHA256`) and compares in constant
time; a correct token always works; wrong ones are counted and, past the limits, answered 429.

- `GET /feedback/owner/events?after=<seq>&confirmed=<seq>&limit=100`: the stored messages (sealed) and deletion records
  with an arrival number above `after`, in order, stopping before the first chat message still held; with counts (stored
  per door, full per door, sends refused for limits, hidden-field hits). `confirmed` is his last confirmed read: deletion
  records up to it are removed, never a later one, so paging through a long read removes nothing early (built: one cursor
  for both would have dropped deletion records before his Inbox took them in).
- `GET /feedback/owner/message?id=<id>`: one stored message, sealed, for `publish`; it confirms nothing (built).
- `POST /feedback/owner/delete {id}`; `POST /feedback/owner/delete-many {via, from_day, to_day}`;
  `POST /feedback/owner/publish {id, text, publish_key}`; `POST /feedback/owner/unpublish {id}`.

**On the laptop**, `scripts/feedback-inbox.mjs` (Node, no dependencies beyond the repository):

- `keygen`: writes the two owner files (never overwrites; a second run adds a new key and keeps the old ones) and prints
  the two server settings (the public key and the token's hash), never the private key or the token.
- `fetch --out <empty folder in the scratchpad>`: reads from the saved arrival number, opens each message, checks its
  clear record against the sealed one, and writes `feedback-batch.json`, an ArtifactData batch for the Inbox's
  `feedback` collection (one document per message, removals for deletions and for messages past 365 days). It prints
  **counts only** (new, by kind, reviews waiting for his yes, deletions, full doors), never a word of a message. The
  number moves on only with `fetch --confirm <folder>`, after the batch was sent; `confirm` deletes the folder, and the
  next `fetch` deletes any folder an interrupted turn left.
- `delete <id> --confirm <id>`, `delete-many …`, `publish <id> --export <Inbox export folder> --confirm <id>`,
  `unpublish <id> --confirm <id>`. Each prints what it will do. `publish` refuses unless the Inbox export holds his own
  choice "Show publicly" for that id, made in the page (`choices/feedback-<id>`): his yes is data he made, not something
  a session reads into its context.

**Each turn, the InnerSignal lane** (its Inbox README gains the step; the lane changes its own files): runs `fetch`,
sends `feedback-batch.json` to the Inbox with ArtifactData `batch` by `file_path`, confirms, and tells the owner the
counts ("3 new feedback messages, 1 review waiting for your yes"). **The lane never reads a message's text:** it doesn't
open the batch file, doesn't export or list the Inbox's `feedback` collection, and never hands the feedback step to Codex
or another model. A message's words therefore reach no model and no transcript; they go from the server, sealed, to his
laptop, and from there to his Inbox, where he reads them. They never go into owner-pages' Git, the handoff note, a log or
a commit.

**The Inbox's Feedback view** (`scripts/feedback-inbox-view.js`, tested here, added to the Inbox page by the lane): the
newest first, each with its kind, day, whether it came from the page or a chat, the reply address as plain text (never a
`mailto:` link), and the text, all set as text (`textContent`), never as HTML, so a sender's markup can't run in his
page; links in a message are not made clickable. Its only controls are fixed choices: "Show publicly" (only for a review
with the tick), "Don't show", "Delete". No replies or comments are typed on a feedback item, so no feedback words reach
the `replies` or `comments` collections that `sync.py` mirrors to Git.

**"Only he reads it", as it now holds:** the words are sealed on the server, opened on his laptop by a program, checked by
one AI call for possible danger (below), and shown to him in his private Inbox, a page in his Claude account that Anthropic
hosts. No other person is given them, and no other model: not the lane, not Codex. The page, the served sentence and the
tool say it in the same words (section 11).

**Danger-first reading (his answer 5b):** on his laptop, `fetch` has an AI with no tools read each newly opened message only to
flag whether the writer, or someone they mention, may be in danger (`src/feedback/danger-reader.mjs`). One sealed
`claude -p` call per message, as the runner trial's workers make them: no tools, no session kept on disk, safe mode, a strict
empty MCP configuration, an allowlisted environment, a fresh folder removed after the call, the rules in a system prompt file
and the message only on stdin, framed as data between markers with a random code. The answer must match a JSON schema with
one boolean. Each Inbox item records `flagged`, `not_flagged` or `not_checked` (the check was off or failed); the Feedback view
shows flagged messages first with a line saying so, then unchecked ones, then the rest. `fetch` prints counts only ("1 flagged
as possibly in danger"); with the check on it takes at most 50 messages per run, and after three failed checks in a row it
marks the rest "not checked" at once. Model: `claude-sonnet-5-5` unless set; Claude sign-in folder and command settable
(`--danger-model`, `--claude-config-dir`, `--claude-bin`, or `config.json`). His daily count: the lane's report each turn,
and a daily scheduled run of the lane's feedback step if he wants the count on days without a session (the lane's to set
up). The prompt was brainstormed and red-teamed (Appendix F). No server module imports the reader.

**In-chat hold:** a chat message is returned to the owner's read only after `held_until` (the full hour after one hour
from its arrival). The person can delete it with the code before he can see it. This is what the server can guarantee
about a chat send it can't watch (section 12).

## 8. How a review becomes public

1. Only from the page: the sender ticks "You may show this review publicly" with the kind Review (with another kind the
   form says to choose Review or untick it). A review sent from a chat is never public: its words are the AI's write-up,
   however much the person agreed, and the reviews page says its texts are the senders' own words. The tool points to
   the page for a public review.
2. In his Inbox the review shows the tick and the choices "Show publicly" and "Don't show".
3. The server shows exactly what the sender wrote, or nothing: at sending it made a random 32-byte `publish_key`, sealed
   it inside the message and kept `publish_mac` = HMAC-SHA256(`publish_key`, text) in clear. `publish` sends the opened
   text with the key; the server checks the HMAC and refuses any other text. Nobody without the private key can publish,
   and nobody can publish edited words.
4. Published reviews appear on `/feedback/reviews` with the month they were sent and no name or address (a name shows
   only if the sender wrote one into the review).
5. The sender withdraws it at any time with the deletion code; the owner can unpublish.

Weighed: stopping at "review waiting for your yes" in the Inbox, with him placing approved reviews where he likes, would
leave out the reviews page and three owner routes, but the sender's code would no longer withdraw a public copy. Kept,
since withdrawal is a privacy promise; he may also copy reviews elsewhere.

## 9. Someone in crisis who uses the feedback box

- **On every feedback page** (form, thank-you, already-sent, busy, full, closed, deletion, reviews): the emergency line,
  in his approved words from i62: "In danger right now? Call your local emergency number: 112 in the EU (and from mobiles
  in many other countries), 911 in the US and Canada, 999 in the UK." Then two new lines that need his yes: "Not in
  danger this minute, but thinking of ending your life? https://findahelpline.com lists crisis lines by country." (the
  link is in his approved crisis rules) and "This box is read by one person, not every day, and it can't send help."
- **In a chat** (served sentence and tool description): in a conversation where someone has said they want to die or
  might act, feedback isn't offered, nothing about that is sent through it, and it is never presented as reaching a
  person; the crisis section says who they can reach. The feedback link is not among the links that section allows.
- **When the owner reads:** he reads every new message; nothing is sent to a sender automatically.
- **On the server, no meaning check.** A word list would miss most such messages in other words or languages and misfire
  on bug reports that quote a crisis reply; judging meaning isn't a pattern's job.

## 10. The page

Plain HTML, no JavaScript, one inline stylesheet allowed by its hash. Works on a phone and with a screen reader (labels, a
fieldset for the kinds). English for now; people can write in any language.

Routes, with the page's switch on: `GET /feedback` (form), `POST /feedback` (send; form-encoded only),
`GET|POST /feedback/delete` (the code only in the POST body; a GET never reads one), `GET /feedback/reviews`, and the
owner routes. Headers on every page: `Content-Security-Policy: default-src 'none'; style-src 'sha256-…'; form-action
'self'; frame-ancestors 'none'; base-uri 'none'`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-Robots-Tag: noindex, nofollow`. Every value shown back is
HTML-escaped. A body is read only up to its size limit and for at most 10 seconds; past either, the answer is sent and
the connection closed. These limits apply to `/feedback` only; the connector's own timeouts don't change.

**Closed:** when the packaged rules name the feedback address and the page's switch is off, every `/feedback` path
answers 503 with a fixed page, "Feedback is closed for now", and the crisis lines; no form, no store, no owner routes. An
image whose rules don't name the address answers 404 exactly as today. So the served sentence never leads to a dead page,
and switching the page off is a safe rollback.

## 11. What the page tells the sender (exact words, for the owner's yes)

Title: **Send InnerSignal feedback**

> A suggestion, something that isn't working, praise or a review: write it here. No account needed.
>
> **In danger right now?** Call your local emergency number: 112 in the EU (and from mobiles in many other countries),
> 911 in the US and Canada, 999 in the UK. Not in danger this minute, but thinking of ending your life?
> https://findahelpline.com lists crisis lines by country. This box is read by one person, not every day, and it can't
> send help.

Fields: **What is it?** Suggestion / Something isn't working / Praise / Review. **Your message.** **How can he answer
you?** (optional: an email address or another way to reach you). **You may show this review publicly** (reviews only:
shown exactly as you wrote it, without your address, only if he agrees; it stays until you or he removes it).

> **What's kept:** your message, what kind it is, whether a review may be shown, the time you sent it and, if you give
> one, your address for an answer. Nothing else: no account, no name unless you write one, no IP address.
>
> **Who reads it:** only the person who makes InnerSignal. It's sealed on InnerSignal's server so that only he can open
> it. Once it's opened on his computer, an AI (Claude, made by Anthropic) reads it for one thing only: whether you, or
> someone you mention, may be in danger, so that he reads those messages first. It gives back only that yes or no. He
> reads your message in his private inbox, a page in his Claude account that Anthropic hosts. No one else is given it.
> Nothing from it goes into InnerSignal's rules or into anyone's case unless he decides so.
>
> **Deleting:** after sending you get a code. It deletes your message from the server at once, and from his inbox the
> next time he opens it. Messages are deleted after a year anyway; a review he shows publicly stays until you or he
> removes it.

Thank-you page:

> **Thank you, it's sent.** Your deletion code: **7Q2M-K9TC-XR4H-PN0A**. Keep it if you might want this message
> deleted: enter it on the deletion page. It can't be shown again. If he has already answered you, that answer stays in
> both your mailboxes.

and the crisis lines. Two sentences depend on what the release check finds (section 15): "no IP address" stays only if
the server's front proxy keeps no visit records for `/feedback` (otherwise it says for how long it keeps them), and a
backup sentence is added if `/srv` is backed up ("Server backups keep only the sealed copy until they're replaced").

## 12. In a chat: the served sentence and the tool

**Served sentence** (SKILL.md, after the guide-comment sentence, which stays word for word):

> To send InnerSignal a suggestion, a problem, praise or a review privately, without an account, there is its feedback
> page (https://innerself.love/feedback): it's sealed so that only InnerSignal's maker can open it, an AI checks each
> message only for signs that someone may be in danger so that he reads those first, and he reads it in his private inbox,
> a page in his Claude account; the page says what is kept and how to have it deleted. Where the host offers `send_feedback`,
> you can offer to write it up instead: show the person the exact text, its kind and any reply address, and send it
> unchanged only after they say yes to that text; leave out private details of their life or therapy unless they ask to
> include them. A review that may be shown publicly is written by the person on the page, in their own words. Feedback
> is read by one person, not quickly, and it can't send help or reach anyone: in a conversation where someone has said
> they want to die or might act, don't offer it, don't send anything about that through it, and never present it as
> reaching a person; the section on that says who they can reach.

It changes the served protocol's hash. **It stays out of `main` until the release:** it is its own commit on its own
branch (`claude/feedback-place-sentence-20261122`, on top of this one), merged only by the release pull request that
also turns the page on. Before then, nothing in `main` changes what InnerSignal says.

**The tool, `send_feedback`**, behind its own switch `INNER_SIGNAL_FEEDBACK_TOOL` (off; on only with the page's switch
on). With it off, `tools/list`, `initialize` and `/health` are byte-identical to today's.

- Inputs: `kind` (`suggestion`, `bug`, `praise`, `review`), `text` (1 to 5,000 characters), `reply_address` (optional,
  at most 200), `person_approved_exact_text` (required, must be `true`). No public tick (section 8).
- No sign-in (`securitySchemes: noauth`), like the protocol tools; a bearer token sent with the call is ignored, nothing
  about any account is kept, and the call's trace line leaves out whether a token came with it and gives the hour only, not
  the time (built). Annotations:
  `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true` (it sends a person's
  words outside the chat). Hosts that ask before such a tool show the person the call with its text; InnerSignal can't
  make a host ask, so nothing depends on it.
- Description (model-facing): the served sentence's rules, standing alone (with the rules in parts, pull request 232, the
  section holding the sentence may arrive later in a chat than the tool): show the exact text, kind and address; send
  only after a yes to that text, unchanged; leave out private details; say what is kept; afterwards show the stored text
  and the deletion code; no public reviews from a chat; not in a conversation where someone has said they want to die or
  might act, and never as reaching a person.
- Result: the exact text, kind and address as stored, the deletion code, the deletion page, and the hold: "It reaches
  InnerSignal's maker after about an hour. If it isn't what you agreed to send, this code deletes it before he can see
  it, and at any time after. Your chat keeps its own copy of what you wrote here."
- Refusals (tool errors the model can read): `FEEDBACK_TEXT_INVALID`, `FEEDBACK_KIND_INVALID`,
  `FEEDBACK_ADDRESS_INVALID`, `FEEDBACK_NOT_APPROVED`, `FEEDBACK_BUSY`, `FEEDBACK_FULL`, `FEEDBACK_UNAVAILABLE`.
- `initialize` gains one sentence when the tool is on: `send_feedback` is the one tool that sends something, and only
  after the person's yes to the exact text.

**What the approval rule can and can't guarantee** (for the release question, in plain words): the server can't see the
chat, so it can't check that the person said yes; that rests on the AI following the rule in the tool and the served
rules. What the server does guarantee: the person gets back exactly what was stored, with a code, and the message
waits an hour before he can see it, so a person who didn't approve it can delete it unread. Weighed and not chosen: a
two-step call (proves only that the text didn't change between calls); confirming by a click on the page (proves a yes,
but takes the person out of the chat, the opposite of his choice); MCP's ask-the-user request (needs sessions this
server doesn't keep, and ChatGPT doesn't offer it).

## 13. Switches and settings

| Setting | Meaning |
|---|---|
| `INNER_SIGNAL_FEEDBACK` | on/off (`readOnOffSetting`; anything else stops startup). Off: no form, no store; `/feedback` is 404, or the closed page when the rules name the address |
| `INNER_SIGNAL_FEEDBACK_ROOT` | absolute path of an existing directory outside the repository, mode 0700, owned by the process user |
| `INNER_SIGNAL_FEEDBACK_OWNER_PUBLIC_KEY` | the owner's current X25519 public key, base64url (43 characters) |
| `INNER_SIGNAL_FEEDBACK_OWNER_TOKEN_SHA256` | SHA-256 of the owner's read token, 64 hex |
| `INNER_SIGNAL_FEEDBACK_PUBLIC_URL` | the page's https address; must equal the address the packaged rules name, if they name one |
| `INNER_SIGNAL_FEEDBACK_TRUST_FORWARDED_FOR` | on/off, default off (section 5) |
| `INNER_SIGNAL_FEEDBACK_TOOL` | on/off, default off; on requires `INNER_SIGNAL_FEEDBACK` on |

With the page's switch on, root, key, token hash and address are required, or startup stops with a message naming the
setting (never its value). `/health` gains `feedback: {page: "on"|"closed", tool: "on"|"off"}` only when the page is on
or closed, and the ready line says the same; otherwise both are unchanged.

## 14. The runner's button

The runner trial's page (`apps/web`, branch `claude/runner-trial-20261121`, owned by the runner trial session) gets a
"Send feedback about InnerSignal" link, opening the page in a new tab with no referrer, shown with the "Runner trial"
banner. Its address is `FEEDBACK_PAGE_URL`, given by the local app's `/health` (the page itself holds no address).
**Built differently from draft 2:** instead of the local app checking at start whether the address answers, the link has
its own switch, `INNER_SIGNAL_RUNNER_FEEDBACK_LINK`, off until the page is released and turned on by that release: no
network call from the local app and none in its tests, and the trial never links to a page that isn't there. The patch
was handed to the runner session on 22 Nov 2026 (notes folder, `innersignal-feedback-runner-link.patch`); it applies it
on its branch. InnerSignal's older local pipeline reads an older copy of the rules and gets no sentence (section 16).

## 15. Release (later, with the owner's yes; nothing here is done by this branch)

- **Before the wording goes to him for his yes, read-only on the host** (with his yes for the access): which proxy
  fronts the container and whether its port is reachable other than through it (for `TRUST_FORWARDED_FOR`), whether the
  proxy or Docker keeps visit records for `/feedback` and for how long, and whether `/srv` is backed up. The two
  dependent sentences of section 11 follow from what is found.
- **Page:** the Traefik router for `innerself.love/feedback` on the connector's container (section 3; the release kit has the
  exact labels, written from the read-only check of the real ones); image with this code; volume
  `/srv/inner-signal-private/feedback` (0700, uid 1000); the settings; `INNER_SIGNAL_FEEDBACK=on`; the served sentence
  merged and released in the same step (stable skill and server); on his laptop, `INNER_SIGNAL_RUNNER_FEEDBACK_LINK=on` for
  the runner trial's link. Checks after: the address the served rules name answers 200; a synthetic send and its deletion;
  the owner's read; `tools/list` unchanged; `/health`.
- **The tool** with the release that changes the tool list anyway (pull request 232): `INNER_SIGNAL_FEEDBACK_TOOL=on`, 20
  tools instead of 19, one refresh in ChatGPT and one in Claude. That release also updates the texts that call every
  tool read-only (`plugins/inner-signal-therapy/.codex-plugin/plugin.json` capabilities, `docs/CLAUDE-CONNECTOR.md`).
- **Rollback:** switch the page off: the closed page answers, stored messages stay sealed on the volume. Going back to an
  image older than this feature is a rollback only together with the stable skill (the sentence), never alone.

## 16. Not in this build

Alerts to the owner when a message arrives (the lane's turn report gives counts; his scheduled routine could check
counts daily: owner point 6); replies sent from the server; screenshots or other attachments; deleting from inside a
chat (the page does it); pages in other languages; a separate feedback service (section 3); the sentence in InnerSignal's
older local pipeline, which reads its own older copy of the rules.

## 17. Owner points for the release question (answered 22 Nov 2026 as i66: `1a 2a 3a 4a 5b 6a 7a`; Appendix F)

1. The address: his own domain (recommended; one DNS record) or the server's own. Settled before the first release.
2. How long messages are kept: a year (proposed), or another period.
3. "Only he reads it": his Inbox is a page in his Claude account, hosted by Anthropic; no model reads the texts. Or a
   local reader on his laptop, with counts only in the Inbox.
4. A second copy of his two key files, which only he can make.
5. Same process (proposed) or a separate container for the page.
6. Danger-first reading and alerts: none (proposed: he reads every message), or a tool-less reader that flags possible
   danger and a daily count check by his routine.
7. Which address his answers come from (a dedicated one is better than his own), and the opening line of an answer:
   "Someone gave this address on InnerSignal's feedback page; if that wasn't you, ignore this and I won't write again."
8. The new page lines (the two crisis lines after his i62 line) and every word of section 11.
9. What the approval rule can and can't guarantee in a chat (section 12).

## Appendix F: the owner's answers (i66, 22 Nov 2026) and what they changed

His answers, verified by the InnerSignal lane (his Inbox at 12:08 UTC and his chat at 12:14 UTC): `1a 2a 3a 4a 5b 6a 7a`, with
his note on 2a: "the website for innersignal is innerself.love and it's hosted on the netcup vps. GPT is the one managing the
site so you can have GPT add to it."

- **1a, release:** prepared; nothing goes to the server, `main` or a switch until the lane sends his go.
- **2a, his own address, on innerself.love:** `https://innerself.love/feedback` (section 3). His site needs no change for the
  route; GPT, which manages the site, is asked only to confirm its router's rule and priority and, after the release, to add
  a "Feedback" link (`/home/joel/askrigor-releases/20261122-innersignal-feedback/gpt-request-draft.md`). The address has no
  digits, so the rules' phone-number check passes (`tests/feedback-served-sentence.test.mjs`).
- **3a** (a year), **4a** (his Inbox), **6a** (the connector's server) and **7a** (the page's words): as built.
- **5b, the danger reader:** built on the laptop side (section 7). Because "no AI reads the messages" stops being true, the
  privacy words change in three places, shown to him before the release: the page's "Who reads it" (section 11), the served
  sentence (section 12) and the tool's description, plus the Inbox view's two lines ("An AI check says the writer, or
  someone they mention, may be in danger: read this first." and "Not checked for danger (the check was off or failed).").
  The flag prompt: brainstormed, then red-teamed by Fable (2 blocking, 11 should-fix, 6 minor:
  `danger-reader-redteam.md` in the release folder); version 2 adopts its revised prompt and wrapper (kinds of danger, never
  phrases; one sign anywhere is enough; a part of the writer speaking is about the writer; reassurance cancels nothing; when not
  confident, true; always answer), and three of its four code changes (a refusal sorts with the flagged; whitespace isn't sent;
  each flag names the reader's version). Two blind runs on Fable's 49 invented messages agreed with every label
  (`danger-reader-eval.md`); one live check through the real reader stays in the release kit, and two calls per message are not
  needed unless that check misses one.

## Appendix B: Codex's first review of the build (22 Nov 2026, `origin/main..7b1c6fd2f`; 1 blocking, 10 should-fix)

Prompt and result: `/home/joel/askrigor-releases/20261122-innersignal-feedback/codex/review-1-prompt.md` and `review-1.txt`.

| # | Finding | Outcome |
|---|---|---|
| 1 | A deletion removed the message before writing its record: a crash between left the Inbox copy for good | **Fixed.** The record is written first; at open, a record whose message is still there finishes the deletion (test) |
| 2 | A message the laptop couldn't open was skipped for good | **Fixed.** Kept in the script's state and tried again by id at every fetch (test) |
| 3 | An interrupted fetch could leave opened messages in an untracked folder | **Fixed.** The folder is on record before anything is written, removed on any failure, and the record goes only after the folder (test) |
| 4 | The one-message read bypassed the chat hold | **Fixed.** It keeps the hold (test) |
| 5 | Parallel sends slipped under the limits | **Fixed.** Places are reserved before anything is awaited and given back on refusal (test: 15 at once, 10 accepted) |
| 6 | One form token could store two messages at once | **Fixed.** The token is claimed at once; a second send waits for the first's result and shows the same code (test) |
| 7 | Chat could fill the page's storage with bytes | **Fixed.** Each door has its own byte share (35 MB page, 15 MB chat) and a message's size is checked before it is written (test) |
| 8 | Early refusals didn't read or close the body | **Fixed.** Any reply to a body-bearing request sent before its body was read closes the connection (test) |
| 9 | The disk's change time still shows arrival times | **Stated** (section 4); not engineered around: hiding it would mean holding messages in memory, which loses them in a crash |
| 10 | Some startup errors printed the root's path | **Fixed.** Every root failure becomes fixed words with the setting's name and at most an error code (test) |
| 11 | The startup test conflicted with the held sentence | **Fixed.** The test reads which address the packaged rules name and expects the closed page then |

## Appendix C: Codex's second review (22 Nov 2026, `7b1c6fd2f..ee1802b21` and the whole change; 7 should-fix, 1 minor)

Prompt and result: `/home/joel/askrigor-releases/20261122-innersignal-feedback/codex/review-2-prompt.md` and `review-2.txt`. It found
seven of the first review's fixes complete; these eight are fixed, each with a test:

| # | Finding | Outcome |
|---|---|---|
| 1 | A deletion whose file couldn't be removed could lose its record at confirmation | A record goes only once nothing of its message is left; the message leaves the index at once and is never shown or published again |
| 2 | Finishing an interrupted expiry removed the review's public copy | Recovery follows the record's `by`: an expiry removes only the sealed message |
| 3 | Two runs of the owner's script could overwrite each other's folders | One command at a time (a lock file with its process id); a finished batch is confirmed or discarded explicitly (`fetch --discard`), never removed by another fetch |
| 4 | Two processes on one store could give out the same arrival number | The counter is read and written under a lock file; every owner's read rebuilds its view from the disk. One process stays the expected setup; with two, numbering and reads are safe and the caps approximate |
| 5 | A GET or HEAD that declares a body escaped the early close | Any request that declares a body and isn't fully read when refused closes the connection, whatever its method |
| 6 | A refund after a window restarted could free a newer send's place | A refund gives back only the window generation it was counted in |
| 7 | The laptop never removed Inbox copies past a year by itself | The script keeps a content-free inventory (ids and days) and removes Inbox copies past 365 days at any fetch |
| 8 | Deleting a message already gone on the server failed before its Inbox write | A 404 there is the same as deleted: the Inbox write still comes |

## Appendix D: Codex's third review, and the recurring class it showed (22 Nov 2026, `ee1802b21..c09e5f45c` and the whole change)

Prompt and result: `/home/joel/askrigor-releases/20261122-innersignal-feedback/codex/review-3-prompt.md` and `review-3.txt`. Five of
the second review's fixes were complete; three were not: a deleted review's public copy could stay visible when its file couldn't
be removed, the laptop's lock could be shared through a lock file read while still empty, and discarding a batch forgot which ids
it may already have put in the Inbox.

**The class, named:** every review since the first found another partial-failure state in hand-built file state (a crash or a
failed removal part-way, two commands at once, a batch dropped half-sent). Patching each state one at a time kept leaving the
next one. So the fix changes the mechanism, not the cases:

- **Deletion records are the truth.** Any deletion of something that exists writes its record first; from then on the message is
  out of the index, the public list hides its copy, and every rebuild (each owner's read and each open) removes again whatever of it
  is left. A record goes only once nothing of its message remains. No reader decides from which files happen to remain.
- **The kernel holds the laptop's lock.** On Linux (the owner's laptop) the lock is an abstract Unix socket: only one process can
  hold the name, and it is freed when that process ends, so there is no stale lock to judge and no take-over to race. Elsewhere an
  exclusive lock file, removed by hand after a crash.
- **The inventory only shrinks on a confirmed removal.** A discarded batch's ids stay in it, so an Inbox copy that may already
  exist is still removed after a year.

Each with a test.

## Appendix E: Codex's fourth review (22 Nov 2026, `13fdcc97a..97f8a4502` and the whole change; 2 should-fix, 1 minor)

Prompt and result: `/home/joel/askrigor-releases/20261122-innersignal-feedback/codex/review-4-prompt.md` and `review-4.txt`. It found
the deletion-record mechanism and the kernel-held lock correct, and nothing else in the whole change. Fixed, each with a test:

| # | Finding | Outcome |
|---|---|---|
| 1 | A message added on one page of a fetch and deleted before a later page could drop out of the inventory on a discard | A fetch keeps its additions and its removals apart; a discard keeps every addition and applies no removal; a confirmation applies both |
| 2 | A direct delete took the id out of the inventory before the Inbox removal was confirmed | It no longer touches the inventory: the server's deletion record removes it at a confirmed fetch, or the year's removal does |
| 3 | Unpublishing left the Inbox saying "shown publicly" | `unpublish` writes the Inbox update (`published: false`), as `publish` writes `true` |

## Appendix: the red team's findings and what changed

| # | Finding | Severity | Outcome |
|---|---|---|---|
| 1 | Anonymous text reaches a Claude session that holds the key, the token and a shell; the Feedback view could run a sender's markup | blocking | **Adopted.** No model reads the texts (section 7): `fetch` prints counts only, the batch goes by `file_path`, the lane never exports the `feedback` collection or hands the step to another model. `publish` needs his own choice in the Inbox export and `--confirm`. The view sets text only, no links, fixed choices only, and is tested here. Key and token in separate files. A tool-less danger reader is an owner point, not built |
| 2 | "A code that deletes it at any time" overclaims | blocking | **Adopted.** Deletion records stay until his read confirms them (at most 400 days); no feedback words enter a transcript (finding 1) or the Git-mirrored `replies`/`comments` (no typing on feedback items); `fetch` cleans leftover folders; the page and tool say what deletion can't reach; backups are read before the wording goes to him |
| 3 | The served sentence can point to a dead page | blocking | **Adopted.** The sentence stays off `main` until the release, on its own branch; a closed page answers whenever the rules name the address and the page is off; startup refuses an address that differs from the rules'; rollback is the closed page; a release check fetches the named address |
| 4 | One script closes both doors and fills the store | should-fix | **Adopted.** Separate overall budgets and storage shares per door; no overall deletion cap; `delete-many` for a chat flood; the tool named as the weaker door with what it tolerates |
| 5 | The cursor can skip a message stored in the same second | should-fix | **Adopted.** A strictly increasing arrival number from a counter file; the read stops before a held message; a test with messages around a read |
| 6 | Times to the second link a message to an address or account | should-fix | **Adopted.** Day only in clear, exact time sealed, file times set to the day, no bearer flag in the tool's trace line; logs and proxy read before the wording goes to him. `via` stays in clear for the per-door caps and bulk delete (with the day only, it no longer pins a message to a trace line) |
| 7 | "Only its maker reads it" said three ways | should-fix | **Adopted.** One wording in page, sentence and tool; kind and tick added to "what's kept"; never handed to Codex or another model; "the server sees it in clear only while sealing it" stated |
| 8 | In-chat approval: say what's promised; echo and hold | should-fix | **Adopted.** The result echoes what was stored; chat messages are held an hour; `openWorldHint: true`; the limit goes to him in plain words (owner point 9) |
| 9 | An AI write-up could be shown as the sender's words | should-fix | **Adopted.** Public reviews come only from the page; the tool has no public tick |
| 10 | Crisis: four gaps | should-fix | **Adopted.** (a) the findahelpline line; (b) a filled hidden field shows the form again, never a false "sent"; (c) no feedback offered or sent about wanting to die, never as reaching a person, and the link isn't among the crisis section's links; (d) the lines on every page, and only the first line is called his i62 wording |
| 11 | The reply address: harassment and his own address | should-fix | **Adopted.** Owner point 7 with the opening line; the view shows the address as plain text |
| 12 | The runner's button isn't designed | should-fix | **Adopted.** Section 14; the runner session adds it; the older local pipeline is listed in section 16 |
| 13 | The address is baked into the rules | should-fix | **Adopted.** Owner point 1 is a condition of the first release; old addresses keep answering; one constant with tests |
| 14 | Published reviews and the one-year limit | should-fix | **Adopted.** A public copy stays until the sender or the owner removes it; the code still removes it after the message expires; the form says so |
| 15 | Used tokens forgotten before the token expires | should-fix | **Adopted.** Remembered for the token's whole life |
| 16 | Section 2's HTML-escape claim | minor | **Adopted** (corrected; the diagnostics upload and the local app's policy added). Reuse declined: the existing escape is private to the journal module |
| 17 | Record which key sealed each message | minor | **Adopted.** `key_id` in clear; the owner's key file holds several keys |
| 18 | Length leaks; direction overrides in public text | minor | **Adopted.** Padding to size steps; direction overrides and invisible spaces removed (joiners kept) |
| 19 | IPv6 keys and the key map's eviction | minor | **Adopted.** /64 keys; new clients refused past 10,000 instead of dropping old counters |
| 20 | The deletion code never in a web address; noindex | minor | **Adopted** |
| 21 | Timeouts per route, ending the connection | minor | **Adopted**; the connector's own timeouts are unchanged |
| 22 | Texts that call every tool read-only | minor | **Adopted for the tool's release** (section 15). Building on top of pull request 232 declined: it is parked and its session asked that it be left alone; whichever merges second takes the other in |
| 23 | Over- and under-built | minor | **Partly adopted.** The reviews page is kept (withdrawal by code is a privacy promise), with the leaner alternative recorded in section 8; seven rate rules kept as one table (each has a door it protects); alerts and danger reading are owner point 6; the token-thief sentence added (section 4) |
