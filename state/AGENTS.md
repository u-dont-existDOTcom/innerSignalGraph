# `state/` Agent Instructions

- Treat checkpoints as routing documents, not substitutes for source code, tests, model-evaluation artifacts, or current owner instructions.
- Before trusting a checkpoint, inspect actual Git state, current runtime/model configuration, recent verified reports/results, and newer owner instructions; repair stale entries immediately.
- Record goal, authoritative baseline, psychological-safety constraints, completed work not to repeat, current step, last verified durable boundary, remaining work, blockers, exact tests/evaluations/commits, and next safe action.
- Never store model/API credentials, private therapy-user data, secret values, private chain-of-thought, or large raw model logs here.
- Distinguish deterministic test success, mock results, live-model results, adversarial review, domain-safety review, planned work, and unverified claims.
- A checkpoint never outranks current owner instruction, exact source, tests, safety evidence, or current configuration.
- After interruption or a fresh thread, identify exactly what survived and resume without repeating completed work.
