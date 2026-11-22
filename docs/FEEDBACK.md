# InnerSignal's feedback place

A private place where people send InnerSignal suggestions, problems, praise and reviews, without an account, and where only
the owner reads them (owner answer i63b, 22 Nov 2026). Design, red team and every decision:
`docs/superpowers/specs/2026-11-22-feedback-place-design.md`. Code: `src/feedback/`. Owner's script:
`scripts/feedback-inbox.mjs`. Inbox view: `scripts/feedback-inbox-view.js`. Tests: `tests/feedback-*.test.mjs`.

**Off unless switched on.** With `INNER_SIGNAL_FEEDBACK` off the connector is as before: no `/feedback` route (404), no tool, no
field in `/health` or the ready line. When the packaged rules name the feedback address and the page is off, every
`/feedback` path answers a closed page with the crisis lines instead, so the served rules never lead to a dead page.

## What it is

- **The page** at `<address>/feedback` on the hosted connector: kind (suggestion, something isn't working, praise, review), the
  message, an optional address for an answer, and for a review a tick that lets it be shown publicly. Plain HTML, no
  JavaScript. A deletion page (`/feedback/delete`) and a reviews page (`/feedback/reviews`).
- **The chat tool** `send_feedback`, behind its own switch `INNER_SIGNAL_FEEDBACK_TOOL`: the AI writes the feedback up and sends it
  only after the person's yes to the exact text; the result echoes what was stored and gives the deletion code; the message
  waits an hour before the owner can see it, so a person who didn't approve it can delete it unread. No public reviews from a
  chat. The tool needs no sign-in. Turning it on adds a tool, so each app needs one refresh: it goes out with the release that
  changes the tool list anyway (pull request 232).
- **The store**: one sealed file per message on the connector's own volume, sealed to the owner's X25519 public key (the server
  can't open what it keeps). In clear only the id, an arrival number, the day, the door (page or chat), the key id, a chat
  message's hold hour and, for a page review the sender let be shown, its publish check. No IP address, account or token is kept.
- **The owner's routes** under `/feedback/owner/`, answered only with his read token (the server keeps its SHA-256).

## Settings

| Setting | Meaning |
|---|---|
| `INNER_SIGNAL_FEEDBACK` | on/off (off by default; any other value stops startup) |
| `INNER_SIGNAL_FEEDBACK_ROOT` | the store: an existing directory outside the repository, mode 0700, owned by the process user (in the image: `/data/feedback` on its own volume) |
| `INNER_SIGNAL_FEEDBACK_OWNER_PUBLIC_KEY` | the owner's X25519 public key (base64url), printed by `keygen` |
| `INNER_SIGNAL_FEEDBACK_OWNER_TOKEN_SHA256` | SHA-256 of the owner's read token, printed by `keygen` |
| `INNER_SIGNAL_FEEDBACK_PUBLIC_URL` | the page's https address; must equal the address the served rules name, if they name one |
| `INNER_SIGNAL_FEEDBACK_TRUST_FORWARDED_FOR` | on only once the proxy's setup is read: then the last `X-Forwarded-For` address keys the limits |
| `INNER_SIGNAL_FEEDBACK_TOOL` | on/off, off by default; needs the page on |

A missing or wrong setting stops startup with the setting's name, never its value.

## The owner's side (his laptop only)

1. Once: `node scripts/feedback-inbox.mjs keygen --server https://<address>/feedback`. It writes
   `~/.config/innersignal-feedback/owner-keys.json` and `owner-token` (both 0600) and prints the two server settings. Keep a
   second copy of both files somewhere only he can open: if every copy of a key is lost, the messages it sealed can't be read.
2. Each InnerSignal lane turn:
   - `node scripts/feedback-inbox.mjs fetch --out <new folder in the scratchpad>`. It prints counts only;
   - send each batch in `<folder>/plan.json` to the InnerSignal Inbox with ArtifactData `batch` (the entries point at files; never
     open them);
   - `node scripts/feedback-inbox.mjs fetch --confirm <folder>`;
   - tell the owner the counts.
   If `fetch` says an earlier batch is waiting, confirm it if its batches were sent, or `fetch --discard <folder>` if not (the
   next fetch reads the same messages again). One command runs at a time; a second one says so and stops.
   The lane never reads a message's words: it doesn't open the batch files, doesn't export or list the Inbox's `feedback`
   collection, and never hands this step to Codex or another model.
3. His choices in the Inbox's Feedback view (`choices/feedback-<id>`) are acted on with `publish <id>` or `delete <id>`, each with
   `--export <this turn's Inbox export> --confirm <id>`; both refuse without his own choice for that id. `delete-many` clears a
   flood from one door; `unpublish` takes a review down.

## Privacy, as it holds

- What's kept: the message, its kind, whether a review may be shown, the time, and an optional reply address. Sealed on the
  server; opened only on the owner's laptop; shown to him in his private Inbox (a page in his Claude account that Anthropic hosts).
  The clear record holds the day only, but the disk's own change time on each file shows when it was written: whoever has the
  server's disk sees when messages arrived, never what they say.
- Deletion by the sender's code removes the message and any public copy from the server at once, and from his Inbox at its next
  update. An answer he already sent, the sender's own chat copy and (if any) sealed copies in server backups are out of its reach;
  the page says so.
- Messages are deleted after 365 days; a published review stays until the sender or the owner removes it.
- No meaning check on the server. The page carries the crisis lines on every page; in a conversation where someone has said
  they want to die or might act, the rules say feedback isn't offered and is never presented as reaching a person.

## One process per store

The store expects one connector process. With two on the same volume, arrival numbers stay unique (a lock file around the
counter) and every owner's read sees both processes' messages (it reads the disk), but the caps are only approximate.

## Release and rollback

See the design's section 15. Rollback is the page's switch off (the closed page answers; stored messages stay sealed). Going back
to an image older than this feature is a rollback only together with the stable skill that names the address.
