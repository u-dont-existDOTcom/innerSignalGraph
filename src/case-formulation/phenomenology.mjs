import { ValidationError } from "../core/errors.mjs";

const choice = values => ({ type: "string", enum: values });
const nullable = schema => ({ anyOf: [{ type: "null" }, schema] });
const text = { type: "string", minLength: 1, maxLength: 1600 };
const record = properties => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });

export const INNER_SPEECH_FREQUENCIES = Object.freeze([
  "RARE_OR_ABSENT",
  "SOMETIMES",
  "OFTEN",
  "ALMOST_CONSTANT",
  "UNKNOWN"
]);

export const DELIBERATE_INNER_SPEECH = Object.freeze([
  "EASY",
  "EFFORTFUL",
  "MINIMAL_OR_UNAVAILABLE",
  "UNKNOWN"
]);

export const INNER_SPEECH_FORMS = Object.freeze([
  "NONE_OR_RARE",
  "ISOLATED_WORDS_OR_PHRASES",
  "SENTENTIAL_MONOLOGUE",
  "DIALOGIC",
  "MIXED",
  "UNKNOWN"
]);

export const PHENOMENOLOGY_MODES = Object.freeze([
  "BODY_SENSATION",
  "EMOTION_AFFECT",
  "IMAGE_SCENE",
  "INNER_WORDS",
  "URGE_ACTION_TENDENCY",
  "MEMORY",
  "SOUND_MUSIC",
  "UNSYMBOLIZED_OR_HARD_TO_CATEGORIZE",
  "OTHER",
  "UNKNOWN"
]);

export const innerSpeechProfileSchema = nullable({
  ...record({
    spontaneous_frequency: choice(INNER_SPEECH_FREQUENCIES),
    deliberate_speech: choice(DELIBERATE_INNER_SPEECH),
    usual_form: choice(INNER_SPEECH_FORMS),
    context_variation: nullable(text),
    source: { type: "string", enum: ["EXPLICIT_USER_REPORT"] }
  }),
  description: "Trait-level user report about ordinary inner speech. Keep spontaneous frequency separate from deliberate silent-speech capacity. This is a non-diagnostic prior, never a global representation type. Do not infer it from prose fluency, imagery, body focus, diagnosis, occupation, or the representation used in one episode."
});

export const observationPhenomenologySchema = nullable({
  ...record({
    direct_modes: { type: "array", minItems: 1, maxItems: 8, items: choice(PHENOMENOLOGY_MODES) },
    literal_inner_words: nullable(text),
    appraisal_or_meaning: nullable(text),
    verbalization_relation: choice(["LITERAL_AT_TIME", "RETROSPECTIVE_TRANSLATION", "MIXED", "UNKNOWN"]),
    claim_scope: choice(["INTERNAL_EXPERIENCE", "EXTERNAL_PERSON_OR_EVENT", "MIXED", "NONE", "UNKNOWN"])
  }),
  description: "Episode-level provenance for one direct observation. It distinguishes what the person reports directly noticing from later appraisal/meaning and distinguishes literal inner words from retrospective wording. These are not universal temporal or neural stages: categories may overlap, occur in another order, or be absent. Nonverbal or earlier material is not thereby deeper or truer, and verbal analysis remains a legitimate tool."
});

function validateEnum(value, values, label) {
  if (!values.includes(value)) throw new ValidationError(`${label} is invalid.`);
}

export function validateInnerSpeechProfile(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("inner_speech_profile must be an object or null.");
  const declared = new Set(["spontaneous_frequency", "deliberate_speech", "usual_form", "context_variation", "source"]);
  if (Object.keys(value).some(key => !declared.has(key))) throw new ValidationError("inner_speech_profile has undeclared fields.");
  for (const key of declared) if (!Object.hasOwn(value, key)) throw new ValidationError(`inner_speech_profile.${key} is required.`);
  validateEnum(value.spontaneous_frequency, INNER_SPEECH_FREQUENCIES, "inner_speech_profile.spontaneous_frequency");
  validateEnum(value.deliberate_speech, DELIBERATE_INNER_SPEECH, "inner_speech_profile.deliberate_speech");
  validateEnum(value.usual_form, INNER_SPEECH_FORMS, "inner_speech_profile.usual_form");
  if (value.context_variation !== null && (typeof value.context_variation !== "string" || !value.context_variation.trim() || value.context_variation.length > 1600)) {
    throw new ValidationError("inner_speech_profile.context_variation must be bounded text or null.");
  }
  if (value.source !== "EXPLICIT_USER_REPORT") throw new ValidationError("inner_speech_profile must come from explicit user report.");
  return structuredClone(value);
}

export function validateObservationPhenomenology(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("observation phenomenology must be an object or null.");
  const declared = new Set(["direct_modes", "literal_inner_words", "appraisal_or_meaning", "verbalization_relation", "claim_scope"]);
  if (Object.keys(value).some(key => !declared.has(key))) throw new ValidationError("observation phenomenology has undeclared fields.");
  for (const key of declared) if (!Object.hasOwn(value, key)) throw new ValidationError(`observation phenomenology.${key} is required.`);
  if (!Array.isArray(value.direct_modes) || value.direct_modes.length < 1 || value.direct_modes.length > 8) {
    throw new ValidationError("observation phenomenology.direct_modes must be a non-empty bounded array.");
  }
  for (const mode of value.direct_modes) validateEnum(mode, PHENOMENOLOGY_MODES, "observation phenomenology.direct_modes");
  if (new Set(value.direct_modes).size !== value.direct_modes.length) throw new ValidationError("observation phenomenology.direct_modes must be unique.");
  if (value.direct_modes.includes("UNKNOWN") && value.direct_modes.length > 1) throw new ValidationError("UNKNOWN phenomenology cannot be combined with an observed mode.");
  for (const key of ["literal_inner_words", "appraisal_or_meaning"]) {
    const item = value[key];
    if (item !== null && (typeof item !== "string" || !item.trim() || item.length > 1600)) throw new ValidationError(`observation phenomenology.${key} must be bounded text or null.`);
  }
  validateEnum(value.verbalization_relation, ["LITERAL_AT_TIME", "RETROSPECTIVE_TRANSLATION", "MIXED", "UNKNOWN"], "observation phenomenology.verbalization_relation");
  validateEnum(value.claim_scope, ["INTERNAL_EXPERIENCE", "EXTERNAL_PERSON_OR_EVENT", "MIXED", "NONE", "UNKNOWN"], "observation phenomenology.claim_scope");
  if (value.literal_inner_words !== null && !value.direct_modes.includes("INNER_WORDS")) {
    throw new ValidationError("Literal inner words require INNER_WORDS among the directly reported modes.");
  }
  if (value.verbalization_relation === "LITERAL_AT_TIME" && value.literal_inner_words === null) {
    throw new ValidationError("LITERAL_AT_TIME requires the reported literal inner words.");
  }
  return structuredClone(value);
}
