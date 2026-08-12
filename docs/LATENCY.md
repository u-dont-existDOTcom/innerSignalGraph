# Latency model

Before v0.8.0 every therapy turn used eight model calls:

1. Claude case extraction.
2. GPT case audit.
3–4. GPT + Claude independent candidates (parallel).
5–6. GPT + Claude cross-critiques (parallel).
7. GPT adjudication.
8. Sonnet final realization.

The final visible prose was written by Sonnet, but Sonnet was only the last call. That is why a response could still take several minutes.

v0.8.0 defaults to auto-tiering:

- Fast: 2 calls.
- Reviewed: 3 calls.
- Adversarial: 8 calls.

Parallel candidate/critique pairs reduce wall-clock time but do not remove the sequential extraction, audit, adjudication, and realization dependencies.

Startup validation is also expensive because H001 and A001 are development/release gates. The bootstrap server now starts before those gates so they do not delay opening the application.
