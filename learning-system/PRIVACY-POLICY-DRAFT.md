# InnerSignal privacy policy — unpublished working draft

**Not published. Not legal advice. No live signup, billing, API provider route, learning
transport, or retention schedule is implemented by this document.**

## Provider processing

Free InnerSignal uses the user's own ChatGPT account. OpenAI, not InnerSignal, controls that
account's plan, Data Controls, monitoring, and handling of the conversation. Users should
review and choose their OpenAI account settings directly.

Paid InnerSignal API mode would instead use an InnerSignal-controlled OpenAI API account and
would require payment. OpenAI states that API content is not used to train or improve its
models by default unless the API customer opts in. Ordinary API operation does not by itself
eliminate abuse monitoring or guarantee Zero Data Retention. Default abuse-monitoring logs
may include prompts, responses, and derived metadata and are generally retained for up to
30 days, subject to documented exceptions. Some endpoints or features may retain application
state. InnerSignal will make no Modified Abuse Monitoring or Zero Data Retention claim until
the exact account approval and endpoint configuration are separately verified before release.

Paid API mode is designed to shield your personal ChatGPT account identity from the downstream model request by using an InnerSignal-controlled provider account instead of your personal ChatGPT account. InnerSignal does not intentionally forward your personal ChatGPT account identifier as the model-provider account identity.

This is account-identity shielding, not anonymity. InnerSignal or its payment/account infrastructure may know who you are; providers and network systems may process request, usage, safety, abuse-monitoring, or technical metadata; and your prompt or a combination of ordinary facts can identify you even without an explicit name, email address, or phone number.

InnerSignal can control which provider path it uses, but it cannot truthfully promise that ordinary OpenAI API traffic is never retained, reviewed, or processed for abuse monitoring. Any future stronger low-retention claim must be separately verified against the exact OpenAI account controls, endpoint, storage configuration, and approved retention program in use.

## Community learning

The separate InnerSignal community-learning program is on by default for free users. It can
consider only privacy-screened, generalized lesson candidates—not raw therapy chats. Before
any future submission, the user must see the generalized candidate and may refuse that
candidate at no charge. Refusal does not reduce access. Paid API mode may later include a
global contribution control, but this draft does not decide that control's default.

The current app can persist a reviewed generalized candidate only to its private local loopback
learning queue. It is not sent off the device and no existing local candidate is backfilled.
Withdrawal, revocation, and deletion must remain available without an added fee before a
live contribution release. This draft deliberately selects no InnerSignal retention duration.

Community-learning contribution is evidence collection, not automatic truth. A disagreement, correction, or outcome report does not by itself change InnerSignal therapy policy. Generalized candidates require review, and any later therapy-policy change remains separately owner-approved and regression-tested.

## Identifiability

Privacy warning: account anonymity or API routing does not make message content anonymous. Names, contact details, exact locations, workplaces, unique events, health history, and combinations of facts can identify you. Remove identifying details you do not want processed before sending.

An automated pattern warning may identify common risky categories, but it is not an
anonymizer. A clean result never establishes that content is anonymous or non-identifying.

## Release boundary

This draft is a repository artifact only. `privacyPolicyPublished`, `liveSignupEnabled`,
`candidateTransmissionEnabled`, and `releaseAuthorized` remain false.
