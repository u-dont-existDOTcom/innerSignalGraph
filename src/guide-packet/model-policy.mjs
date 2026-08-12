export const GUIDE_PACKET_MODELS = Object.freeze({
  compiler: "claude-opus-5",
  reviewer: "gpt-5.6-sol",
  adjudicator: "claude-fable-5"
});

function requiredModel(role) {
  const model = GUIDE_PACKET_MODELS[role];
  if (!model) throw new Error(`Unknown Guide Packet model role: ${role}`);
  return model;
}

export function assertExactGuidePacketModel(provider, role) {
  const required = requiredModel(role);
  if (!provider || provider.model !== required) {
    const error = new Error(`Guide Packet ${role} requires exact model ${required}; received ${provider?.model || "CLI default"}.`);
    error.code = "GUIDE_PACKET_EXACT_MODEL_REQUIRED";
    throw error;
  }
  return provider;
}

export function assertGuidePacketEntitlementEvidence(provider, role) {
  assertExactGuidePacketModel(provider, role);
  const required = requiredModel(role);
  const evidence = provider.entitlementEvidence;
  if (!evidence || evidence.ok !== true || evidence.requestedModel !== required || !evidence.responseId || !evidence.probedAt) {
    const error = new Error(`Guide Packet ${role} requires successful live entitlement evidence for exact model ${required}.`);
    error.code = "GUIDE_PACKET_MODEL_EVIDENCE_REQUIRED";
    throw error;
  }
  return evidence;
}
