# Live local learning lifecycle

**Scope:** functioning main-app lifecycle on the existing loopback server. This is not a
remotely hosted community queue, public pilot, therapy-policy activation, or release.

InnerSignal recognizes a bounded set of explicit rejection/correction signals and preserves a
category-only private stub in the browser. The user may write a redacted summary. Choosing
**Preview learning contribution** sends only the strict generalized evidence record to the
same-device loopback server. The server validates it, performs a deterministic privacy-risk
screen, and returns the exact record plus a single-use preview nonce. Preview writes nothing
to disk.

The preview offers two actions:

- **Continue with default contribution** — persists the derived record in the private local
  queue and returns an `ISL-LOCAL-*` receipt;
- **Do not contribute this candidate** — creates no queue record and does not reduce access.

There is no timer, background submission, old-candidate backfill, or raw-chat field. A clean
pattern screen is not an anonymity or de-identification result. A contributed occurrence can
be revoked without payment; removing the final occurrence deletes the candidate and its review
metadata from this queue.

Maintainers can inspect and disposition the local evidence using:

```text
npm run learning:review -- status
npm run learning:review -- list
npm run learning:review -- show <ISL-LOCAL-receipt>
npm run learning:review -- decide <ISL-LOCAL-receipt> <disposition>
```

Disposition is triage only. Even `prepare-therapy-policy-decision` changes the local status to
`needs-owner-therapy-decision`; it cannot write a therapy ledger, change a guide/graph/prompt,
generate an adopted therapy regression, install anything, or affect a therapy response.
