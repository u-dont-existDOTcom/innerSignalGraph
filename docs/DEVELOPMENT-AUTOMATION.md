# Continuous development automation

Inner Signal should not use the human as a shell-script operator, log courier, or "what next?" scheduler.

The local runtime now has two development queues:

1. **Incident queue** — human `Needs work` / `Too slow` feedback and deterministic runtime contract failures.
2. **Autonomous engineering roadmap** — bounded implementation work that can proceed even when the user is not sending therapy messages.

The worker always drains unresolved incidents first. A blocked incident produced by an older development-engine revision is automatically retried once the repair machinery itself has materially improved. Human-rejected policy decisions remain terminal.

When the incident queue is empty, the worker advances the highest-priority safe engineering task from `roadmap/autonomous-development.json`. Each task runs through:

- read-only Codex applicability/policy audit;
- isolated candidate workspace;
- Opus implementation, with Fable only on the bounded escalation cycle;
- targeted regression work inside the candidate;
- complete deterministic tests;
- graph regressions;
- package verification;
- independent Codex patch review;
- automatic promotion only when the change is non-substantive/restorative and does not touch a safety-sensitive policy boundary.

A validated restorative candidate is promoted locally and Inner Signal restarts itself. The next launch continues with the next roadmap task.

Human input is reserved for substantive therapy/product policy, safety-sensitive architecture whose effect cannot be classified as purely restorative, account/OS permission, missing canonical source material, or irreversible data/key-management choices.

The foreground terminal mirrors the development-worker progress log so an apparently idle chat window does not hide active development work. The web UI also shows the active or next roadmap task.

All development evidence remains local and is included in the optional one-click diagnostic ZIP. Routine development does not require log upload.

## Supervisor anti-livelock contract

The Overall Development supervisor is driven by deterministic state fingerprints, not a timer alone. A blocked state that has exhausted its bounded repair budget is analyzed once, then remains visible as `BLOCKED_INTERNAL` without repeated model calls until the underlying task/job state or development-engine revision changes. Each supervisor repair has a stable dispatch key and is considered queued only after the roadmap query can see the exact task. Restart reconciliation restores a missing durable dispatch without incrementing the recovery count. Supervisor-state writes are serialized to prevent concurrent progress and analysis updates from colliding.
