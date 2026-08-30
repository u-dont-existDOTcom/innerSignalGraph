# InnerSignal Commons MVP

Primary operational maps: [`ARCHITECTURE.md`](ARCHITECTURE.md).

This directory contains the first executable slice of the opt-in InnerSignal community-learning architecture.

## What is implemented

- invitation-capable pseudonymous sessions with one-time recovery codes;
- asynchronous Commons posts and replies;
- per-post response contracts;
- support reactions separated from experience/evidence follow-ups;
- no direct messages;
- deterministic moderation holds for possible danger, coercion, personal contact data, recovered-memory certainty, or solicitation;
- a key-protected human moderation queue and publish/remove/escalate decisions;
- structured Field Notes with immediate and delayed outcome windows;
- contribution-specific consent grants and inspectable receipts;
- withdrawal with Learning Card recomputation;
- contradiction-aware deterministic Learning Cards;
- non-activating proposal exports with hashes and an explicit next gate;
- participant data export and account/data deletion;
- a separate local data boundary from private therapy and hypnosis state.

## Authority boundary

Community posts are conversation-only. Field Notes can enter community aggregation or product learning only through explicit per-contribution scopes. Learning Cards have `runtimeAuthority: "none"`. Proposal exports are fixed to:

```json
{
  "candidateOnly": true,
  "activation": "proposal-only",
  "runtimeWritable": false
}
```

No Commons route writes to `THERAPY-LESSONS`, Guide Packets, guide graphs, prompts, `stable`, or the installed runtime.

## Run locally

```bash
npm ci --ignore-scripts
npm run community:verify
npm run community:serve
```

Default address: `http://localhost:8790`.

Local-only mode permits blank invitation and moderator keys. Any non-loopback bind fails closed unless both `COMMUNITY_INVITE_CODE` and `COMMUNITY_MODERATOR_KEY` are set.

## Environment

See `.env.example`. Runtime data defaults to:

```text
.inner-signal-autopilot/community-learning/
```

The state snapshot is accompanied by an append-only bounded event ledger. Session tokens and recovery codes are stored only as SHA-256 hashes. The raw token and new recovery code are returned only at creation. Shared Learning Cards suppress community-derived groups below three independent contributors and do not republish raw Field Note context, confounders, or adverse-event prose.

### Human moderation API

For a network pilot, set a long random `COMMUNITY_MODERATOR_KEY`. Moderators can inspect and decide held material without receiving participant session cookies:

```bash
curl -H "x-innersignal-moderator-key: $COMMUNITY_MODERATOR_KEY" \
  http://localhost:8790/v1/moderation/queue

curl -X POST -H "content-type: application/json" \
  -H "x-innersignal-moderator-key: $COMMUNITY_MODERATOR_KEY" \
  --data '{"targetType":"post","targetId":"<uuid>","decision":"publish","note":"Reviewed"}' \
  http://localhost:8790/v1/moderation/decision
```

## Deliberate limitations

This is a private workflow prototype for the unique InnerSignal consent/learning layer, not a replacement for the planned mature Discourse conversation substrate, a production social network, or a clinical system. It does not yet include:

- Discourse federation or SSO;
- email recovery;
- moderator accounts and a graphical review console (the MVP has a key-protected moderation API);
- end-to-end encryption;
- AI extraction or summarization;
- external evidence review;
- research protocol management;
- production-grade PostgreSQL or distributed locking;
- automated runtime proposals.

The MVP uses a first-party JSON snapshot plus append-only event log so the consent, provenance, withdrawal, contradiction, and non-activation contracts can be tested before infrastructure scale is introduced.
