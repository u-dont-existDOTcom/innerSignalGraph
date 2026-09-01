export const PROVIDER_DISCLOSURE_FORMAT = "inner-signal-provider-path-disclosure-v1";

export const FREE_SIGNUP_COPY = "Free InnerSignal uses your own ChatGPT account. Your ChatGPT plan, Data Controls, and OpenAI's handling of those conversations are controlled by OpenAI and your account settings, not by InnerSignal. InnerSignal's separate community-learning program is on by default for free users. When InnerSignal identifies an eligible privacy-screened generalized lesson candidate, you will be shown the generalized candidate before any future submission and may choose not to contribute that candidate at no charge. Declining one candidate does not reduce your access and does not disable future candidate notices. InnerSignal does not authorize raw therapy-chat transmission to its community-learning queue.";

export const FREE_CANDIDATE_NOTICE = "Potential community lesson — generalized preview. Free InnerSignal contributes eligible generalized lesson candidates by default. You may choose “Do not contribute this candidate” before this candidate is sent. Declining this candidate does not affect your access. This candidate has no authority to change InnerSignal therapy behavior.";

export const PAID_API_SIGNUP_COPY = "Paid InnerSignal API mode uses an InnerSignal-controlled OpenAI API account rather than your personal ChatGPT account. OpenAI states that API content is not used to train or improve its models by default unless the API customer opts in. Standard API use is not automatically unmonitored or Zero Data Retention: abuse-monitoring logs may include prompts, responses, and derived metadata and are generally retained for up to 30 days, subject to documented exceptions, and some endpoints or features may retain application state. InnerSignal will not claim Modified Abuse Monitoring or Zero Data Retention unless that status and the exact endpoint configuration are separately verified before release. Paid API mode can provide a global InnerSignal community-learning contribution control. API mode is a paid feature.";

export const IDENTIFIABILITY_WARNING = "Privacy warning: account anonymity or API routing does not make message content anonymous. Names, contact details, exact locations, workplaces, unique events, health history, and combinations of facts can identify you. Remove identifying details you do not want processed before sending.";

export const PROVIDER_BOUNDARY_COPY = "InnerSignal can control which provider path it uses, but it cannot truthfully promise that ordinary OpenAI API traffic is never retained, reviewed, or processed for abuse monitoring. Any future stronger low-retention claim must be separately verified against the exact OpenAI account controls, endpoint, storage configuration, and approved retention program in use.";

export const COMMUNITY_LEARNING_BOUNDARY_COPY = "Community-learning contribution is evidence collection, not automatic truth. A disagreement, correction, or outcome report does not by itself change InnerSignal therapy policy. Generalized candidates require review, and any later therapy-policy change remains separately owner-approved and regression-tested.";

export const PROVIDER_PATH_DISCLOSURE = Object.freeze({
  format: PROVIDER_DISCLOSURE_FORMAT,
  freeUserChatgpt: Object.freeze({
    providerPath: "user-owned-chatgpt-account",
    innerSignalControlsOpenAIAccountSettings: false,
    communityContributionDefaultOn: true,
    generalizedCandidatePreviewRequired: true,
    freePerCandidateRefusal: true,
    rawTherapyChatTransmissionAuthorized: false
  }),
  paidApi: Object.freeze({
    providerPath: "innersignal-controlled-openai-api-account",
    paymentRequired: true,
    trainingUseDefault: "not-used-unless-api-customer-opts-in",
    ordinaryAbuseMonitoringPossible: true,
    ordinaryAbuseMonitoringRetention: "up-to-30-days-subject-to-documented-exceptions",
    applicationStateRetention: "endpoint-and-feature-dependent",
    modifiedAbuseMonitoringVerified: false,
    zeroDataRetentionVerified: false,
    globalCommunityContributionDisableAvailable: true,
    globalCommunityContributionSetting: "UNSPECIFIED_PENDING_FUTURE_BILLING_UI_DECISION"
  }),
  identifiabilityWarningRequired: true,
  identifiabilityWarningAppliesTo: Object.freeze(["user-owned-chatgpt-account", "innersignal-controlled-openai-api-account"]),
  privacyPolicyPublished: false,
  liveSignupEnabled: false,
  releaseAuthorized: false
});

export function disclosureForProviderPath(providerPath) {
  if (providerPath === "user-owned-chatgpt-account") return Object.freeze({ providerPath, signupCopy: FREE_SIGNUP_COPY, identifiabilityWarning: IDENTIFIABILITY_WARNING });
  if (providerPath === "innersignal-controlled-openai-api-account") return Object.freeze({ providerPath, signupCopy: PAID_API_SIGNUP_COPY, identifiabilityWarning: IDENTIFIABILITY_WARNING });
  throw new TypeError("Unknown provider path.");
}
