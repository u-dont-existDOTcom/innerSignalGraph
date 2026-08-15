# Security policy

Inner Signal is a critical-risk application that processes local therapy and hypnosis interactions. Security reports must preserve both credential and user-data boundaries.

## Private reporting

Use GitHub private vulnerability reporting once it is enabled. Until then, or if that route is unavailable, create a draft security advisory in this repository's **Security → Advisories** area or contact the repository owner through the already established private collaboration channel. If neither fallback is available, open only a metadata-only issue asking for a private contact path; do not include exploit details or sensitive material.

Do not place credentials, tokens, cookies, `.env` values, private keys, browser chat, therapy/hypnosis content, prompts, model output/reasoning, raw sensitive logs, usernames, hostnames, IP addresses, or absolute home paths in an issue, pull request, workflow log, or artifact. Revoke or rotate exposed credentials through their provider rather than copying them into the report.

## Report contents

Safe reports should include the affected version or exact commit, bounded reproduction steps using synthetic data, impact, expected behavior, and a suggested private follow-up route. Use redacted or synthetic markers for excluded data.

## Scope and response

Security fixes must retain diagnostic privacy, transactional update/rollback, exact model-role enforcement, and owner-gated therapy/framework policy. A security review cannot approve policy for the owner or promote `stable`. The owner coordinates severity, remediation, disclosure, and any release.
