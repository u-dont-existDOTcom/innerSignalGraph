import { validatePersonalizationMemory } from "./contracts.mjs";

export const PERSONALIZATION_PRECEDENCE = Object.freeze([
  "hard-safety-and-epistemic-policy",
  "current-explicit-user-instruction",
  "current-case-evidence",
  "user-outcome-caution",
  "style-process-framing-preference",
  "default"
]);

export function memoryPrecedenceClass(memory) {
  validatePersonalizationMemory(memory);
  return memory.memoryType === "user-outcome-caution" ? "user-outcome-caution" : "style-process-framing-preference";
}

export function resolvePersonalizationPrecedence(options) {
  if (!Array.isArray(options)) throw new TypeError("Precedence options must be an array.");
  const normalized = options.map((option, index) => {
    if (!option || typeof option !== "object" || Array.isArray(option)) throw new TypeError(`Option ${index} must be an object.`);
    const keys = Object.keys(option);
    if (keys.length !== 3 || !keys.includes("precedenceClass") || !keys.includes("value") || !keys.includes("sourceId")) throw new TypeError(`Option ${index} has unsupported or missing fields.`);
    if (!PERSONALIZATION_PRECEDENCE.includes(option.precedenceClass)) throw new TypeError(`Option ${index} has an invalid precedence class.`);
    if (typeof option.value !== "string" || option.value.length === 0 || typeof option.sourceId !== "string" || option.sourceId.length === 0) throw new TypeError(`Option ${index} must contain bounded identifiers and values.`);
    return { ...option, inputIndex: index };
  });
  normalized.sort((a, b) => PERSONALIZATION_PRECEDENCE.indexOf(a.precedenceClass) - PERSONALIZATION_PRECEDENCE.indexOf(b.precedenceClass) || a.inputIndex - b.inputIndex);
  if (!normalized.length) return null;
  const selected = normalized[0];
  return Object.freeze({ precedenceClass: selected.precedenceClass, value: selected.value, sourceId: selected.sourceId });
}
