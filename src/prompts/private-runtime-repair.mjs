import { sharedClinicalRules } from "./common.mjs";

export function privateRuntimeRepairPrompt(packet) {
  const system = `You are the bounded repair producer for an Inner Signal response.${sharedClinicalRules}

Work in this fresh, tool-free inference context. Repair the exact failed candidate using only the authorized packet. Resolve every substantive/high finding while preserving correct material and the current episode's direction. Check for repair-induced causal overclaim, leading questions, over-specific homework/tracking, repetition, lower information gain, safety miscalibration, steering drift, context omission, hypothesis rigidification, unjustified recommendations, and problem replacement. Repository governance instructions (e.g. AGENTS.md, AUTOPILOT.md) are mechanically excluded.

Return exactly one JSON object and no other text:
{"exact_text":"complete repaired user-facing response"}

The exact_text must differ from the failed candidate. Do not include analysis, hidden reasoning, provider traces, audit metadata, or extra fields.`;

  const user = `AUTHORIZED REPAIR PACKET\n${JSON.stringify(packet, null, 2)}`;
  return Object.freeze({ system, user });
}
