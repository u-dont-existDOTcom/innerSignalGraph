/** Pure routing adapters for the bounded wisdom-practice addition.
 * No storage, provider, network, send, approval, or ontology authority.
 */
export const PERSPECTIVE_NODE_BY_VALUE = Object.freeze({
  "wiser_self": "IC.WISER_SELF_PERSPECTIVE",
  "draft_editor": "IC.DRAFT_EDITOR",
  "return_to_care": "IC.DRAFT_RETURN_TO_CARE",
  "story_punctuation": "IC.COMPASSIONATE_STORY",
  "past_competence": "IC.PAST_COMPETENCE",
  "common_humanity": "IC.COMMON_HUMANITY",
  "criticism_kernel": "IC.CRITICISM_KERNEL",
  "caring_company": "IC.CARING_COMPANY"
});
export const PERSPECTIVE_PRACTICE_VALUES = Object.freeze([
  ...Object.keys(PERSPECTIVE_NODE_BY_VALUE), "unknown"
]);
const NODE_VALUES = new Map(Object.entries(PERSPECTIVE_NODE_BY_VALUE).map(([v,id]) => [id,v]));
const PLANNABLE_PHASES = new Set(["offer", "practice", "review"]);

export function perspectivePracticesEnabled(graphs = []) {
  return graphs.length > 0 && graphs.every(g => g.taskPolicyVersion === 1)
    && Object.values(PERSPECTIVE_NODE_BY_VALUE).every(id => graphs.some(g => g.nodes?.some(n => n.id === id)));
}

/** Call with the existing validated, current-issue turn task only.
 * An observation-backed request can be offered. An accepted task can be practiced.
 * Raw case-variable values never choose an intervention.
 */
export function perspectivePracticeForTask(task, graphs = []) {
  if (!perspectivePracticesEnabled(graphs) || !task || !PLANNABLE_PHASES.has(task.phase)
      || task.agreement === "declined" || !task.observation_ids?.length) return "unknown";
  if (task.phase !== "offer" && task.agreement !== "accepted") return "unknown";
  return NODE_VALUES.get(task.node_id) ?? "unknown";
}

/** Keep outward action primary; compose editing as an explicitly necessary support.
 * This does not lower a safety, relationship, anti-bypass or trajectory gate.
 */
export function eligibleDraftEditorSupport({primary, eligible = [], task, variables = {}, interrupt = false, emergency = false}) {
  if (interrupt || emergency || primary?.id !== "ROUTE.ACT_OUTWARD"
      || task?.node_id !== PERSPECTIVE_NODE_BY_VALUE.draft_editor
      || task.agreement !== "accepted" || task.kind !== "action"
      || !["practice", "review"].includes(task.phase) || !task.observation_ids?.length
      || !task.action?.step?.trim()) return null;
  const relational = variables.other_person_central === "yes"
    || variables.influence_domain === "ordinary_social"
    || variables.emotional_takeover_pressure === "present";
  if (relational && !["completed", "not_needed"].includes(variables.relational_check_status)) return null;
  if (variables.present_safety === "unsafe" || variables.orientation === "disoriented"
      || variables.ability_to_stop === "no" || variables.ability_to_return === "no"
      || variables.dissociation === "high" || variables.suicidal_state === "imminent") return null;
  return eligible.find(n => n.id === PERSPECTIVE_NODE_BY_VALUE.draft_editor) ?? null;
}
