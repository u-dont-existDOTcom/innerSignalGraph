import {
  OPERATION_CLASSES,
  PROTOCOL_PROFILE_ENUMS,
  PROTOCOL_PROFILE_FIELDS,
  PROTOCOL_TEXT_FIELDS,
  blankProtocolProfile
} from "./contract.mjs";

function validationError(message) {
  const error = new Error(message);
  error.name = "ValidationError";
  return error;
}

function cleanText(value, field) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw validationError(`protocol_profile.${field} must be a string.`);
  return value.trim();
}

export function validateProtocolProfile(input = null) {
  if (input === null || input === undefined) return { profile: blankProtocolProfile(), explicit: false };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw validationError("protocol_profile must be an object.");
  }
  const allowed = new Set([...PROTOCOL_PROFILE_FIELDS, ...PROTOCOL_TEXT_FIELDS]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw validationError(`protocol_profile.${key} is not allowed.`);
  }
  const profile = blankProtocolProfile();
  for (const field of PROTOCOL_PROFILE_FIELDS) {
    const value = input[field] ?? "unknown";
    if (!PROTOCOL_PROFILE_ENUMS[field].includes(value)) {
      throw validationError(`protocol_profile.${field} has invalid value ${JSON.stringify(value)}.`);
    }
    profile[field] = value;
  }
  for (const field of PROTOCOL_TEXT_FIELDS) profile[field] = cleanText(input[field], field);
  return { profile, explicit: true };
}

function existingIntentOperation(intent) {
  if (["deep_dialogue", "hypnosis", "memory_processing", "photo_work", "altered_state", "advanced_release"].includes(intent)) {
    return OPERATION_CLASSES.DEPTH_ACCESS;
  }
  if (intent === "gentle_practice") return OPERATION_CLASSES.LIGHT_REPARENTING;
  if (intent === "integration") return OPERATION_CLASSES.TRUST_BEHAVIOR;
  if (intent === "conversation") return OPERATION_CLASSES.SUPPORT_ORIENT;
  return "unknown";
}

export function deriveProtocolProfile({ protocolProfile = null, variables = {} } = {}) {
  const validated = validateProtocolProfile(protocolProfile);
  const profile = { ...validated.profile };

  if (profile.current_sobriety === "unknown") {
    if (variables.altered_state === "sober") profile.current_sobriety = "sober";
    if (variables.altered_state === "altered") profile.current_sobriety = "altered";
  }
  if (profile.witness_capacity === "unknown" && ["present", "partial", "absent"].includes(variables.witness_capacity)) {
    profile.witness_capacity = variables.witness_capacity;
  }
  if (profile.requested_operation === "unknown") {
    profile.requested_operation = existingIntentOperation(variables.current_intent);
  }
  if (profile.operation_consent === "unknown" && profile.requested_operation === OPERATION_CLASSES.SUPPORT_ORIENT) {
    profile.operation_consent = "not_applicable";
  }

  const compatibilitySignals = [
    variables.credibility_conflict === "present",
    variables.coherent_child_state === "present" || variables.coherent_child_state === "unclear",
    variables.identity_blur === "present",
    variables.protective_response === "present",
    variables.self_criticism === "present",
    variables.current_intent && variables.current_intent !== "unknown"
  ].some(Boolean);

  if (!validated.explicit) {
    profile.request_actor = "self";
    profile.beneficiary_present = "yes";
    profile.primary_problem_class = compatibilitySignals ? "internal_developmental" : "unknown";
    profile.operation_consent = profile.operation_consent === "unknown" ? "yes" : profile.operation_consent;
  }

  return { profile, explicit: validated.explicit };
}

export function applyProtocolProfileCorrections(profileInput, corrections = []) {
  const { profile } = validateProtocolProfile(profileInput);
  for (const [index, correction] of corrections.entries()) {
    if (!correction || typeof correction !== "object" || Array.isArray(correction)) {
      throw validationError(`protocol_profile_corrections[${index}] must be an object.`);
    }
    const { field, value } = correction;
    if (PROTOCOL_PROFILE_FIELDS.includes(field)) {
      if (!PROTOCOL_PROFILE_ENUMS[field].includes(value)) {
        throw validationError(`protocol_profile_corrections[${index}] value is invalid for ${field}.`);
      }
      profile[field] = value;
    } else if (PROTOCOL_TEXT_FIELDS.includes(field)) {
      profile[field] = cleanText(value, field);
    } else {
      throw validationError(`protocol_profile_corrections[${index}] field is invalid.`);
    }
  }
  return profile;
}
