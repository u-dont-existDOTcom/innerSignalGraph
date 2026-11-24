import { createHash } from "node:crypto";

// A fixed runner-trial scenario whose worker packets are compared byte for byte (tests/runner-trial-kept-plan.test.mjs): with the
// kept plan switched off, every worker must get exactly what it got before the kept plan was built. It takes the modules it runs
// as an argument, so the same scenario can be run on an older checkout of src/ to record the expected digest:
//
//   git archive aa9d03112 src | tar -x -C <scratch folder>   (with node_modules linked beside it)
//   then call runPacketScenario with that folder's modules and print packetDigest(calls).
//
// The rules are a synthetic protocol, so the digest doesn't change when the served protocol does; the clocks are fixed, and every
// worker is a stand-in that answers in the shape the schemas had before the kept plan. Every conversation is synthetic.

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

const REFERENCES = [
  "PROTECTIVE-COMPATIBILITY", "PHENOMENOLOGY-AND-REPRESENTATION", "PROTOCOL-STATE-PROVENANCE", "ROLE-BELIEF-INTEGRITY",
  "FOCUS-DISCIPLINE", "LONGITUDINAL-SYNTHESIS", "RESPONSE-FIDELITY", "GUIDE-REFERRALS"
];
const BOXES = ["IC.SAFETY_ORIENTATION", "IC.ADULT_SEAT", "IC.SOLAR_PLEXUS_RELAXATION", "IC.NAMING", "IC.HOLDING", "IC.LISTENING", "IC.RETURN", "IC.PACING", "IC.REST"];
const ROUTES = ["ROUTE.MEDICAL_RED_FLAG", "ROUTE.PAIN_CARE"];

export const SYNTHETIC_PROTOCOL = Object.freeze({
  protocolId: "synthetic-protocol",
  version: "0.0.0-synthetic",
  protocolSha256: "0".repeat(64),
  instructions: [
    "# Synthetic SKILL",
    "",
    "Synthetic opening rules.",
    "",
    "## When someone may want to die",
    "",
    "Synthetic crisis rules: the levels, the first step, the replies and step 5, the plan for the next hours.",
    "",
    "## Chronic pain care navigation and prior medical harm",
    "",
    "Synthetic pain rules.",
    "",
    "## Reader guides and altered-state routing",
    "",
    "When someone says they are about to take something, synthetic harm-reduction rules.",
    "",
    "## A last synthetic section",
    "",
    "Synthetic closing rules.",
    ""
  ].join("\n"),
  files: [
    {
      path: "references/INNER-CHILD-BOX-GUIDANCE.md",
      content: [
        "# Synthetic box guidance", "", "Synthetic preamble.", "", "## Inner-child boxes", "",
        ...BOXES.flatMap((id) => [`### ${id}: Synthetic ${id.slice(3).toLowerCase()}`, `Synthetic advice for ${id}.`, ""]),
        "## Cross-guide routes", "",
        ...ROUTES.flatMap((id) => [`### ${id}: Synthetic ${id.slice(6).toLowerCase()}`, `Synthetic route ${id}.`, ""])
      ].join("\n")
    },
    { path: "references/INNER-CHILD-THERAPY-MAP.md", content: "# Synthetic map\n\nSynthetic map rules.\n" },
    ...REFERENCES.map((name) => ({ path: `references/${name}.md`, content: `# Synthetic ${name}\n\nSynthetic ${name} rules.\n` }))
  ]
});

const CLOCK = "2026-11-21T10:00:00.000Z";
const packetOf = (request) => JSON.parse(request.user.slice(request.user.indexOf("{")));
const latest = (request) => packetOf(request).latest_message?.text ?? "";
const reading = (level, extra = {}) => ({ level, wish_or_intent: level === "wants_to_die" ? "wish" : "not_applicable", pain_linked: false, danger_to_others: false, in_danger_from_someone: false, asking_about_someone_else: false, may_be_under_18: false, home_unsafe: false, reason: `synthetic ${level}`, provisional_reply: null, ...extra });
const crisisMessage = (text) => /want to die|safer/u.test(text);

// The messages, in order: [text, what the page sends with it].
export const SCENARIO_MESSAGES = Object.freeze({
  split: [
    ["Synthetic: I keep thinking I want to die.", {}],
    ["Synthetic: I'm a bit safer now. My plan is to text Sam tonight.", {}],
    ["Synthetic: Yes, please keep the plan for next time.", {}],
    ["Synthetic: Hello again, it's been a while.", { newConversation: true, resumeConfirmed: true }],
    ["Synthetic: Please delete the kept plan.", { resumeConfirmed: true }]
  ],
  whole: [
    ["Synthetic: I want to die tonight.", {}],
    ["Synthetic: Back again.", { newConversation: true, resumeConfirmed: true }]
  ]
});

// Stand-in workers in the shapes the schemas had before the kept plan. Each call is kept: role, system, user and schema.
function scriptedWorkers(REPAIR_INDUCED_ERROR_CHECKS) {
  const calls = [];
  const script = {
    R1: (count, request) => reading(crisisMessage(latest(request)) ? "wants_to_die" : "none"),
    R2: () => ({ boxes: ["IC.SAFETY_ORIENTATION"] }),
    R3: () => ({ compatibility_assessment: null }),
    W: (count, request) => {
      const text = latest(request);
      if (/My plan is/u.test(text)) return { reply: "Your plan for the next hours: text Sam \"rough night, can I call you?\" before ten. Then rest with the lamp on.", answered_level: "wants_to_die", quotes: [] };
      return { reply: `Synthetic reply ${count}.`, answered_level: crisisMessage(text) ? "wants_to_die" : "none", quotes: [] };
    },
    "W-repair": (count) => ({ reply: `Your plan for the next hours: text Sam "rough night, can I call you?" before ten. Synthetic repair ${count}.`, answered_level: "wants_to_die", quotes: [] }),
    C1: (count, request) => ({ findings: [], level: crisisMessage(latest(request)) ? "wants_to_die" : "none", repair_induced_checks: [], missed_boxes: [] }),
    // The plan turn's first draft is stopped once, so the repair writer and the repair comparer are in the scenario.
    C2: (count, request) => (/My plan is/u.test(latest(request)) && !packetOf(request).candidate_reply.includes("Synthetic repair")
      ? { findings: [{ code: "VERBOSITY", severity: "substantive", summary: "synthetic: too long", evidence_turn_ids: [] }], level: "none", repair_induced_checks: [], missed_boxes: [] }
      : { findings: [], level: "none", repair_induced_checks: [], missed_boxes: [] }),
    C3: () => ({ findings: [], level: "none", repair_induced_checks: [], missed_boxes: [] }),
    C4: () => ({ findings: [], level: "none", repair_induced_checks: [], missed_boxes: [] }),
    C5: () => ({ findings: [], level: "none", repair_induced_checks: [...REPAIR_INDUCED_ERROR_CHECKS], missed_boxes: [] }),
    CW: (count, request) => ({ findings: [], level: crisisMessage(latest(request)) ? "wants_to_die" : "none", repair_induced_checks: [], missed_boxes: [] })
  };
  let session = 0;
  const workerFor = (role) => ({
    async call(request) {
      const count = calls.filter((entry) => entry.role === role).length + 1;
      calls.push({ role, system: request.system, user: request.user, schema: request.schema });
      const value = await script[role](count, request);
      session += 1;
      return { value, receipt: { provider: "fake", model: "fake", session_id: `fake-${role}-${session}` } };
    }
  });
  return { calls, workerFor };
}

// Runs both arms (focused writer with split checkers, whole writer with the whole checker), each in its own vault under `root`,
// and returns every worker call in order. `runtimeOptions` is added to the runtime's options (the kept plan's switch, when given).
export async function runPacketScenario({ modules, root, runtimeOptions = {} }) {
  const { createEncryptedPrivateCaseStore, createRunnerTrialRuntime, createPrivateTherapyTurnController, cutRuleParts, REPAIR_INDUCED_ERROR_CHECKS } = modules;
  const parts = cutRuleParts(SYNTHETIC_PROTOCOL);
  const all = [];
  for (const [arm, settings] of [["split", { writerMode: "focused", checkerMode: "split" }], ["whole", { writerMode: "whole", checkerMode: "whole" }]]) {
    const store = createEncryptedPrivateCaseStore({ rootDir: `${root}/${arm}`, routineKek: Buffer.alloc(32, 71), recoverySecretBytes: Buffer.alloc(32, 72), developmentExternalCredentialAuthorized: true, now: () => CLOCK });
    const workers = scriptedWorkers(REPAIR_INDUCED_ERROR_CHECKS);
    const runtime = createRunnerTrialRuntime({ privateCaseSource: store, parts, settings, workerFor: workers.workerFor, now: () => Date.parse(CLOCK), ...runtimeOptions });
    const controller = createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime: runtime, maximumInvocationAttempts: 1 });
    const caseId = `synthetic-golden-${arm}`;
    for (const [index, [text, userInput]] of SCENARIO_MESSAGES[arm].entries()) {
      const exchangeId = `exchange-${index + 1}`;
      const result = await controller.run({ caseId, runtimeTurnId: `runtime:${exchangeId}`, exchangeId, userTurnId: `${exchangeId}-user`, assistantTurnId: `${exchangeId}-assistant`, userMessage: text, userInput });
      if (result.deliveryKind !== "candidate") throw new Error(`The ${arm} scenario's turn ${index + 1} wasn't delivered.`);
    }
    all.push(...workers.calls.map((call) => ({ arm, ...call })));
  }
  return all;
}

// One digest over every call's arm, role, system prompt, packet and schema, in order.
export function packetDigest(calls) {
  return sha256(JSON.stringify(calls.map((call) => [call.arm, call.role, call.system, call.user, call.schema])));
}
