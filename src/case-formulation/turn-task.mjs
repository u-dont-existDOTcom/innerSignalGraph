import { ValidationError } from "../core/errors.mjs";

// A current-session record, not a second goal system, diagnosis or memory store.
const KINDS = ["action", "emotion", "relationship_repair", "spiritual_struggle", "nonengagement", "exploration"];
const PHASES = ["assess", "offer", "practice", "review", "close"];
const FOCI = ["none", "choose_action", "cue", "barrier", "review_attempt", "emotional_fit", "emotional_need", "consent", "source_fit", "unknown"];
const str = { type: "string", maxLength: 1600 };
const record = (properties) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
export const turnTaskSchema = {
  anyOf: [{ type: "null" }, record({
    version: { type: "integer", enum: [1] }, issue: str, node_id: str,
    kind: { type: "string", enum: KINDS }, phase: { type: "string", enum: PHASES },
    agreement: { type: "string", enum: ["unknown", "accepted", "declined"] },
    observation_ids: { type: "array", maxItems: 12, items: { type: "string" } },
    marker: str, last_response: str,
    capacity: { type: "string", enum: ["unknown", "adequate", "needs_support"] },
    question_focus: { type: "string", enum: FOCI },
    action: { anyOf: [{ type: "null" }, record({ step: str, cue: str, size: str, barriers: str, purpose: str, outcome: { type: "string", enum: ["not_reported", "not_attempted", "partial", "completed", "appropriately_abandoned"] }, result: str, adjustment: str })] },
    emotion: { anyOf: [{ type: "null" }, record({ process: { type: "string", enum: ["unclear_feeling", "self_treatment", "interruption", "relational_hurt", "anguish", "adaptive_emotion", "unknown"] }, response: str, change_point: str })] }
  })]
};

export function validateTurnTask(input, { issue, observationIds } = {}) {
  if (input == null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("turn_task must be an object or null.");
  const shape = turnTaskSchema.anyOf[1];
  function check(obj, spec, name) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new ValidationError(`${name} must be an object.`);
    for (const key of Object.keys(obj)) if (!Object.hasOwn(spec.properties, key)) throw new ValidationError(`${name}.${key} is not declared.`);
    for (const key of spec.required) {
      const rule = spec.properties[key], value = obj[key];
      if (rule.anyOf) { if (value !== null) check(value, rule.anyOf[1], `${name}.${key}`); }
      else if (rule.type === "string" && (typeof value !== "string" || value.length > (rule.maxLength ?? 1600))) throw new ValidationError(`${name}.${key} must be bounded text.`);
      else if (rule.type === "integer" && !Number.isInteger(value)) throw new ValidationError(`${name}.${key} must be an integer.`);
      else if (rule.type === "array" && (!Array.isArray(value) || value.length > 12 || value.some(x => typeof x !== "string" || x.length > 160))) throw new ValidationError(`${name}.${key} must contain bounded observation IDs.`);
      if (rule.enum && !rule.enum.includes(value)) throw new ValidationError(`${name}.${key} is invalid.`);
    }
  }
  check(input, shape, "turn_task");
  if (!input.issue.trim() || !input.marker.trim()) throw new ValidationError("turn_task needs a current issue and a transcript-grounded marker.");
  // Stale task state never controls a new problem or survives withdrawn evidence.
  if (issue != null && input.issue !== issue) return null;
  if (observationIds && (!input.observation_ids.length || input.observation_ids.some(id => !observationIds.has(id)))) return null;
  if (input.agreement !== "unknown" && !input.observation_ids.length) throw new ValidationError("Task agreement needs observation references.");
  if (input.capacity === "adequate" && !input.observation_ids.length) throw new ValidationError("Task capacity needs observation references.");
  return structuredClone(input);
}

export function immediateProtectionNeeded(v = {}) {
  return v.present_safety === "unsafe" || v.orientation === "disoriented" || v.ability_to_stop === "no"
    || v.ability_to_return === "no" || v.dissociation === "high" || v.suicidal_state === "imminent";
}

export function taskQuestion(task) {
  if (!task || task.phase === "close" || task.agreement === "declined") return "";
  const a = task.action;
  const q = task.question_focus;
  if (q === "choose_action" && !a?.step) return "What small, feasible action would serve what matters to you here?";
  if (q === "cue" && !a?.cue) return "When or where would it be realistic to try that step?";
  if (q === "barrier" && !a?.barriers) return "What is the main obstacle to trying the step you chose?";
  if (q === "review_attempt" && a?.outcome === "not_reported") return "What happened when you tried the step, including anything that got in the way?";
  if (q === "emotional_fit") return "Does that fit what you are experiencing, or is something important different?";
  if (q === "emotional_need") return "What feels needed now that this has become clearer?";
  if (q === "consent" && task.agreement === "unknown") return "Would you like to try a small step with this, or leave it here for now?";
  if (q === "source_fit") return "What does turning toward that spiritual source bring up for you now?";
  return "";
}

// Original task guidance adapting the approved source reconciliation. No copied forms.
export function guidanceForTask(task) {
  if (!task) return [];
  if (task.agreement === "declined") return ["Respect the refusal. Do not perform, re-offer repeatedly, or reinterpret the declined exercise as resistance. Address the current request without covertly continuing the refused task."];
  if (task.phase === "close") return ["Give this task a definite ending. Name only what was actually learned or changed, preserve unfinished material without another compulsory assignment, and return to ordinary life."];
  const common = ["Use the current reported marker and response, not a presumed hidden cause. Carry forward partial changes; do not restart a completed step."];
  if (task.kind === "relationship_repair") return [...common, "Inspect the app's own misunderstanding or intrusive proposal first. Correct what was wrong and adapt the help without endorsing unrelated unsupported claims or treating disagreement as a protector."];
  if (task.kind === "action") return [...common,
    task.phase === "review" ? "Review the actual attempt and its immediate/later consequences as reported. Noncompletion may reflect resources, opportunity, skill, safety or a poor plan. Completion and instant mood improvement are not the sole outcomes; change the plan when appropriate."
      : "Make only needed details of the person's chosen action concrete: cue, feasible size, resources, barriers, personally useful purpose and review. Rest, connection, flexibility or approaching grief can be useful actions; do not equate activation with productivity.",
    "Use their existing goal. Do not demand a child image or motivation ritual before a feasible chosen action. Keep help and interdependence available."];
  if (task.kind === "nonengagement") return [...common, "Leave the repetitive operation unanswered without suppression or denial. Do not require certainty, total calm, complete healing or unanimous parts agreement before ordinary life. Do not turn this technique into another checking ritual."];
  if (task.kind === "spiritual_struggle") return [...common, "Hear the sacred loss or conflict in its own terms. Do not automatically intensify prayer, infer divine judgment, reduce it to parental projection, or require leaving the tradition. Consent to discussion is not consent to a spiritual exercise."];
  if (task.kind === "emotion") {
    const advice = {
      unclear_feeling: "Offer one tentative way to describe or contact the unclear concern and check fit. No inner child, hidden memory or elaborate theory is required.",
      self_treatment: "Attend to the reported self-treatment and how the message is experienced. Preserve valid correction and accountability while interrupting contempt and global condemnation. A credibility/age-prosecution story is not a default explanation.",
      interruption: "Hear the reported interruption and what it is trying to prevent. Acknowledge the current stance and only the agreed next step; silence alone does not establish a protector.",
      relational_hurt: "After relevant present-day assessment, hear the unfinished hurt and unmet need. Imagined responses do not establish another person's intentions; neither forgiveness nor contact is compulsory.",
      anguish: "If contact, willingness and stopping remain intact, offer responsive care without automatically making emotion smaller. Adapt intrusive distance, touch or imagery. Do not call tears a breakthrough. Loss of orientation or stopping changes the job to stabilization.",
      adaptive_emotion: "Respect the information in proportionate anger or grief. Do not presume all anger hides sadness or require calming before a sane protective response.",
      unknown: "Explore only what is reported, using a tentative fit check instead of assigning an emotional category with certainty."
    };
    return [...common, advice[task.emotion?.process ?? "unknown"], "A softer critic, clearer need or partial ability to receive care may change the next step. Do not force a full resolution, chairwork, memory search or emotional intensity. Text alone does not reveal voice tone or facial expression."];
  }
  return [...common, "Support the user's own inquiry and capacity without supplying an elaborate interpretation merely because one is possible."];
}

// Topic-bound completion/permission cannot be inherited across a newly named issue.
// Conservatively request fresh assessment on the new issue; this is not a global trait.
export function reconcileIssueScope(snapshot, priorSnapshot) {
  if (!priorSnapshot?.current_issue || snapshot.current_issue === priorSnapshot.current_issue) return snapshot;
  return {
    ...snapshot,
    variables: { ...snapshot.variables, relational_check_status: "unknown", loop_target_relation: "unknown", guard_engagement: "unknown", leave_alone_eligibility: "unknown" }
  };
}
