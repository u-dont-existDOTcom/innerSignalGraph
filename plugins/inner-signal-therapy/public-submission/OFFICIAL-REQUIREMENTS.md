# Current OpenAI public plugin requirements

Retrieved on 2026-08-31 from current official OpenAI documentation:

- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://developers.openai.com/plugins/deploy/submission

This is a concise preparation summary, not a substitute for re-reading the live submission
form and documentation at release time.

## Package and distribution

- Every plugin uses `.codex-plugin/plugin.json`; a `skills/` tree can be the complete
  functional package.
- `.app.json`, `.mcp.json`, lifecycle hooks, UI, authentication, and MCP endpoints are
  optional capabilities used only when the architecture needs them.
- Skills-only plugins can skip MCP connection testing.
- Public plugins are published to the universal directory shared by ChatGPT and Codex.
  Local and repository marketplaces are separate testing or private-distribution sources,
  and availability can differ by surface.

## Submission materials

- Public submission supports a **Skills only** type.
- The submitter needs plugin-submission write access in the owning Platform organization.
- Every public submission needs a verified developer or business identity that matches the
  public listing.
- Listing materials include customer-facing name, short and long descriptions, category,
  production logo, website, support URL, privacy policy URL, and terms URL.
- Skills should use the final tested file tree and contain clear, scoped instructions plus
  any referenced resources.
- Starter prompts should demonstrate realistic, adaptable workflows.
- Current testing requirements are at least five positive cases and three negative cases,
  each with reproducible expected behavior and no dependence on hidden internal context.
- The publisher must choose supported countries or regions only after product, support, and
  legal readiness is established.
- Release notes describe the plugin, whether the submission is initial or an update, and any
  reviewer setup facts.

## Separate release boundaries

Creating a portal draft, selecting **Submit for Review**, and publishing an approved plugin
are distinct actions. Submission begins OpenAI review and does not publish immediately.
After approval, the developer separately chooses when to publish. None of those portal or
release actions is authorized by this preparation packet.
