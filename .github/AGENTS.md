# `.github/` Agent Instructions

- Treat workflow, model-evaluation, release, ownership, and repository-policy changes as privileged high-consequence changes.
- Declare explicit least-privilege `permissions`; begin with `contents: read` and add write scopes only to the smallest job that needs them.
- Pin remote actions and reusable workflows to reviewed full 40-character commit SHAs; retain release tags only as comments and update through reviewed dependency automation.
- Never check out or execute untrusted pull-request code in a privileged `pull_request_target` context.
- Separate untrusted validation from model-provider, package, release, and deployment credentials. Prefer protected environments and short-lived/OIDC credentials.
- Keep model/API credentials, therapy-user data, generated private guidance, and secret values out of workflows, logs, artifacts, prompts, and state files.
- Workflow cleanup must not weaken psychological-safety, adversarial-evaluation, live-model, or release-evidence gates.
- PR templates must request exact tests/evaluations, risk/rollback, final-diff review, continuity updates, and residual uncertainty.
- CODEOWNERS does not prove branch protection. Do not claim rulesets or hosted scanning controls are enabled without GitHub settings/API evidence.
- Do not rename required checks without verifying and updating the ruleset atomically.
- Run all repository-declared deterministic, adversarial, safety, and audit gates before reporting changes complete.
