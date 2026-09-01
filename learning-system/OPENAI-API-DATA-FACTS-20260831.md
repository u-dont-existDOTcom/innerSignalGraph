# OpenAI API data facts checked for this offline draft

**Checked:** 2026-08-31 against OpenAI's official API documentation, “Your data”.

**Source:** <https://developers.openai.com/api/docs/guides/your-data>

These are provider facts, not InnerSignal guarantees:

- OpenAI states that data sent to the API is not used to train or improve OpenAI models by
  default unless the API customer explicitly opts in.
- Default abuse-monitoring logs may include prompts, responses, and derived metadata and are
  generally retained for up to 30 days, subject to documented exceptions.
- Some API endpoints and features may retain application state according to their documented
  behavior.
- Modified Abuse Monitoring and Zero Data Retention are approval-based controls with
  additional eligibility and configuration requirements; ordinary paid API access does not
  establish either status.
- Endpoint compatibility and storage configuration matter. A future release must verify the
  exact OpenAI account controls and every endpoint/feature in use.

Therefore this draft must not say “unmonitored”, “never retained”, “anonymous”, “zero data
retention”, or “monitoring opt-out” for ordinary API use. The strongest current truthful
statement is that API content is not used for model training by default, while abuse
monitoring and feature-specific application-state retention may still apply.

This snapshot supports copy review only. It does not authorize an API integration, provider
call, paid product, signup flow, low-retention claim, or release.
