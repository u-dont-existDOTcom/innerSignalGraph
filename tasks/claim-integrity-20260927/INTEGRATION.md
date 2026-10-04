# Claim integrity — integration ledger

Status: wording approved by the owner on 3 Oct 2026 ("1 A", 20:16 UTC); reconciled with `main`; merge still needs the owner's yes after the sample-reply result; installation, deployment and `stable` promotion not authorized
Date: 2026-09-27 to 2026-10-04
Branch: `claude/claim-integrity-checks-20260927`
Base: `187f2f4`, merged with `main` at `0764ab0` on 2026-10-04
Dispositions and anchors: `COVERAGE.json`

## Request

The owner asked that every public product carry the claim-integrity checks that apply to it, because published products do not load the development architecture. InnerSignal is a companion product, so it carries the companion checks: what a reply says the person said or did, quotation, "you never mentioned" claims, corrected reflections, and consistency across turns. CI-11 does not apply: companion replies are not among the outputs it covers, and the pack excludes companion and therapeutic replies. Claims about what the person said are held at the point of use by the added rules, and the separate critique and adjudication roles already review each reply. The owner excluded InnerSignal from the experimental key-condition check; in his words, "replies from innersignal are natural and not formulaic". The request and that decision were relayed by the supervising session; no verbatim owner quote is recorded here.

Adapted from the claim-integrity pack v1 in universal-dev-architecture (development-side lineage only; no runtime dependency). The runtime text is rewritten for the companion and names no outside repository.

## What changed

- `src/prompts/claim-integrity.mjs` (`claim-integrity-v1`): five rules and six audit codes. They govern what a reply claims about the person and the conversation, never its style. They say outright that nothing requires quoting, restating, or summarizing the person, that a reading beyond the person's words is offered lightly as the responder's own, and that quotation marks around suggested phrases and exercise wording stay allowed. Auditors are told not to flag natural paraphrase and to block only when an unsupported claim changes the person's account of themselves or someone else, or would change the next step.
- `src/prompts/common.mjs`: the rules join `longitudinalClinicalRules`, so they reach case audit, candidate drafting, critique, adjudication, realization, private audit, and private repair, each exactly once.
- `plugins/inner-signal-therapy/skills/inner-signal-therapy/references/CLAIM-INTEGRITY.md`: the same text, byte for byte after its header. `SKILL.md` lists it as always-read and adds one sentence pointing to it. `THERAPY_PROTOCOL_FILES` serves it over MCP.
- Not changed: extraction keeps its own anchoring rule; the hypnosis compiler, graphs, guides, schemas, model roles, deterministic routing, and storage are untouched. `COVERAGE.json` gives the reason for each boundary.

## Served protocol identity

The plugin version stays `0.2.0`; the repository treats the protocol hash as the identity (see `docs/CLAUDE-CONNECTOR.md`). Before (`main` at `0764ab0`): `protocol_sha256` `6d27393ec2640ef77459ebbf0c876acf28d913653f68fe1624c8eef52fa4c353`, 7 files. After: `dfb72a14a7a2bcf22f5981a3887a23f48ffe78ac8def4a33556444ad28589a54`, 8 files. The hosted MCP serves the new hash only after an owner-approved merge and redeploy.

## Reconciliation with main (2026-10-04)

`main` gained 17 commits since the branch was cut. Two touch therapy instructions: altered-state transfer routing (#120) and the Oct 3 guide sync with certainty routing (#124). They change graph labels, routing guides and two extraction fields; none governs what a reply claims about the person, and none duplicates or contradicts these rules. The approved wording is carried word for word in the served reference and the application rule, and each response consumer still receives it exactly once. The journal import roles that `main` now has were assessed and stay unchanged (`COVERAGE.json`). The only merge conflicts were the consumer map's trailing blank line and the state file's header.

## Verification

- `tests/claim-integrity.test.mjs`: dispositions for all twelve checks, every anchor word for word in its file, delivery to each consumer exactly once, byte match between the plugin reference and the application rule, MCP serving, self-contained wording, and the naturalness guards. Six synthetic contrast cases in `corpus/claim-integrity-cases.json`, one per audit code, are checked for internal consistency and reach every response consumer.
- Sample-reply test (2026-10-04, `sample-reply-test/`): 48 replies to 12 invented conversations, half with the rules, rated blind. Warmth 3.21 with the rules and 3.25 without (1 to 5), responsiveness 4.08 for both, about 10 words shorter with the rules, no over-hedging, and no claim problems in either version, so the test shows no cost and can't show a benefit.
- The complete gates for the final head are recorded in the pull request.

Tests pin delivery and wording. They do not show that a model follows the rules, and the synthetic cases are evaluation inputs, not completed model evaluations or clinical evidence.

## Follow-ups outside this change

- The Guide Packet compiler and reviewers are owner-only authoring tooling; review checks there would be a separate owner decision.
