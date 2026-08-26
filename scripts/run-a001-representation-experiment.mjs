import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ClaudeCliProvider } from "../src/providers/claude-cli.mjs";

export const MODEL = "claude-sonnet-4-6";
export const EFFORT = "high";
export const MAP_COMMIT = "75e239eafe50293b36de22bd1d8ddd7cdb9d88bd";
export const MAP_SHA256 = "1dd737e498495e7eaa28d7a3cb534440a12d72e27a7703817e5e1b16fdd5cb2f";
export const A001_SHA256 = "13b6503e2557665add98fd4f96b3f841ec40c06a9bfda3c2a7442efc2baf19b6";
export const TASK = "You are responding as Inner Signal. Use the supplied therapy map as advisory clinical/therapeutic architecture. Understand this particular person rather than mechanically reciting the map. Preserve uncertainty and safety constraints. Give the most useful response and next move. Do not mention the map.";
export const MANDATORY_REALIZATION_INVARIANTS = `These constrain the final answer; they do not prescribe its formulation, conclusions, wording, or node coverage. Choose the most useful central insight freely and omit irrelevant material.

1. Speaker identity: Sequence alone does not establish that caring, resentful, or blaming statements came from one internal stance. Do not state or imply common identity unless the user established it. Later hostility may make the relationship feel unsafe without proving that earlier care contained the hostility or was conditional.

2. Love and trust: If love or care is explicitly accessible, do not erase or withdraw it. Keep it distinct from evidence-sensitive trust. Distrust, anger, rejection, mockery, or nonreciprocity may remain while love remains. Do not reduce love to procedural reliability or use love to invalidate anger.

3. Epistemic calibration: Do not infer or certify an internal position's fear, belief, knowledge, meaning, or available options as fact when the transcript does not establish it. Treat these as conditional hypotheses; causal compassion frames what to understand but does not supply the answer. A disputed interpretation may be understandable, plausible, or coherent from one position without being objectively accurate.

4. Resentment differential: Do not assign anger or resentment a hidden function without evidence. Actual grievance, responsibility concern, shame, learned criticism, defensive process, ordinary frustration, mixed motives, and an unknown function must remain possible; do not automatically select a Protector or an avoidance story.

5. Causal compassion without prosecution: Understand a past version through what it could perceive, know, tolerate, access, and control. Do not turn the intervention or final question into a search for what it should have done differently, unused childhood capacity, a guilty age, or the version that failed unless the user's actual question independently requires that inquiry. Consequences, learning, responsibility, and repair remain valid.

6. Caring proxy is conditional: If self-application is distorted and a caring-proxy operation genuinely fits, allow one bounded shift. Do not require a real loved person; a known exemplar, imagined caring adult, future self, value, safe plan, or minimum believable non-cruelty can supply one function. Its target may be a skeptical position, a resentful or self-attacking position, or the whole conflict. Do not force the operation when another move is better.

7. Relational credibility: When distrust is central, do not only describe how trust might update later. When appropriate, enact one fitting move now: hear distrust, allow anger, retain warmth, acknowledge concrete truth, tolerate nonreciprocity, or model repair. Practical action may also count; credibility is not merely task completion.

8. Compression: Default to one consequential insight, one useful distinction, one experiment or next move if useful, and one next question. Do not mechanically realize every rule or repeat a caring-proxy exercise.

9. Final question: Make it premise-light and genuinely discriminating. Do not assume avoidance, hidden grief, common speaker identity, refusal to agree, failed capacity, or a specific protective function.

Before returning the answer, silently check the draft against these invariants and revise any violation. Do not mention the check or list the invariants in the answer.`;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mapPath = path.join(projectRoot, "docs/INNER-CHILD-THERAPY-MAP.md");

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildRepresentationPrompt({ architecture, userMessage, mode }) {
  const architectureTag = mode === "r1" ? "therapy_map" : "relevant_therapy_architecture";
  const invariantBlock = mode === "c1"
    ? `\n\n<mandatory_realization_invariants>\n${MANDATORY_REALIZATION_INVARIANTS}\n</mandatory_realization_invariants>`
    : "";
  return {
    system: "",
    user: `<${architectureTag}>\n${architecture}\n</${architectureTag}>\n\n<user_message>\n${userMessage}\n</user_message>\n\n<task>\n${TASK}\n</task>${invariantBlock}`
  };
}

function extractSection(map, heading) {
  const start = map.indexOf(`${heading}\n`);
  if (start === -1) throw new Error(`Projection source section missing: ${heading}`);
  const next = map.indexOf("\n## ", start + heading.length + 1);
  return map.slice(start, next === -1 ? map.length : next).trim();
}

function selectExactLines(section, prefixes) {
  const lines = section.split("\n");
  return prefixes.map((prefix) => {
    const matches = lines.filter((line) => line.startsWith(prefix));
    if (matches.length !== 1) throw new Error(`Projection source line is not unique: ${prefix}`);
    return matches[0];
  });
}

export function buildRelevantRouteProjection(map) {
  const contract = extractSection(map, "## Credibility-route response contract");
  const operating = extractSection(map, "## Operating interpretation");
  const invariants = extractSection(map, "## Response-shaping invariants");
  const sourceLadder = extractSection(map, "## Borrowed-care source ladder");
  const canonicalRoute = extractSection(map, "## Credibility route — canonical sequence");

  const selectedOperating = selectExactLines(operating, [
    "- **Safety can override introspection.",
    "- **Love and trust are different variables.",
    "- **Do not use love to erase anger.",
    "- **Sequence is not speaker identity.",
    "- **Anger and resentment get a differential, not an automatic Protector label.",
    "- **Causal compassion replaces prosecution.",
    "- **Care does not require pretending harmful choices had no consequences.",
    "- **Criticism gets decomposed, not swallowed or fought.",
    "- **Credibility is relational and practical evidence.",
    "- **Relational evidence may be enacted in the response.",
    "- **Validation is not epistemic surrender.",
    "- **Promises stay controllable."
  ]);
  const selectedInvariants = selectExactLines(invariants, [
    "1. **Add insight before procedure.",
    "2. **Do not invent the insight.",
    "3. **Use the person’s language before framework language.",
    "4. **One central formulation, one useful experiment, one next question.",
    "5. **Do not seed stronger accusations or memories.",
    "10. **Treat anger/resentment as data with multiple hypotheses.",
    "12. **Validate intelligibility without certifying every inference.",
    "13. **Make the next question genuinely discriminating and premise-light.",
    "14. **End when the useful move is clear."
  ]);

  return [
    contract,
    "## Selected operating interpretation",
    ...selectedOperating,
    "## Selected response-shaping invariants",
    ...selectedInvariants,
    sourceLadder,
    canonicalRoute
  ].join("\n\n");
}

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      flags.add(arg);
      continue;
    }
    if (!arg.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`Invalid argument: ${arg}`);
    }
    values.set(arg, argv[index + 1]);
    index += 1;
  }

  const mode = values.get("--mode");
  if (!new Set(["r1", "r2", "c1"]).has(mode)) throw new Error("--mode must be r1, r2, or c1.");
  const inputPath = values.get("--input-json");
  if (!inputPath) throw new Error("--input-json is required.");
  const outputRoot = values.get("--output-root");
  if (!flags.has("--dry-run") && !outputRoot) throw new Error("--output-root is required unless --dry-run is used.");
  return { mode, inputPath, outputRoot, dryRun: flags.has("--dry-run") };
}

async function loadExactA001(inputPath) {
  const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const userMessage = input.value?.userMessage ?? input.userMessage;
  if (typeof userMessage !== "string" || sha256(userMessage) !== A001_SHA256) {
    throw new Error("Exact A001 input identity check failed.");
  }
  return userMessage;
}

async function loadArchitecture({ mode }) {
  const map = await fs.readFile(mapPath, "utf8");
  const actualMapSha256 = sha256(map);
  if (actualMapSha256 !== MAP_SHA256) {
    throw new Error(`Frozen map identity check failed: ${actualMapSha256}`);
  }
  if (mode !== "r1") {
    return {
      architecture: buildRelevantRouteProjection(map),
      architectureSource: `${MAP_COMMIT}:docs/INNER-CHILD-THERAPY-MAP.md#exact-section-projection-v1`,
      canonicalMapSha256: actualMapSha256
    };
  }
  return {
    architecture: map,
    architectureSource: `${MAP_COMMIT}:docs/INNER-CHILD-THERAPY-MAP.md`,
    canonicalMapSha256: actualMapSha256
  };
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const [userMessage, loaded] = await Promise.all([
    loadExactA001(options.inputPath),
    loadArchitecture(options)
  ]);
  if (loaded.canonicalMapSha256 !== MAP_SHA256) {
    throw new Error(`Canonical map changed: ${loaded.canonicalMapSha256}`);
  }

  const prompt = buildRepresentationPrompt({
    architecture: loaded.architecture,
    userMessage,
    mode: options.mode
  });
  const promptReceipt = {
    systemRole: { empty: true, sha256: sha256(prompt.system), chars: prompt.system.length },
    userRole: {
      order: options.mode === "r1"
        ? ["therapy_map", "user_message", "task"]
        : options.mode === "r2"
          ? ["relevant_therapy_architecture", "user_message", "task"]
          : ["relevant_therapy_architecture", "user_message", "task", "mandatory_realization_invariants"],
      delimiterStyle: "descriptive XML",
      sha256: sha256(prompt.user),
      chars: prompt.user.length
    }
  };
  const source = {
    mapCommit: MAP_COMMIT,
    mapSha256: loaded.canonicalMapSha256,
    architectureSource: loaded.architectureSource,
    architectureSha256: sha256(loaded.architecture),
    inputSha256: sha256(userMessage),
    taskSha256: sha256(TASK),
    mandatoryRealizationInvariantsSha256: options.mode === "c1" ? sha256(MANDATORY_REALIZATION_INVARIANTS) : null,
    mandatoryRealizationInvariantsChars: options.mode === "c1" ? MANDATORY_REALIZATION_INVARIANTS.length : null
  };

  if (options.dryRun) {
    return { dryRun: true, mode: options.mode, model: MODEL, effort: EFFORT, prompt: promptReceipt, source };
  }

  const provider = new ClaudeCliProvider({
    model: MODEL,
    effort: EFFORT,
    timeoutMs: 900000,
    cwd: projectRoot,
    isolateConfig: true
  });
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const raw = await provider.generate({
    system: prompt.system,
    user: prompt.user,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["answer"],
      properties: { answer: { type: "string", minLength: 1 } }
    },
    metadata: { stage: `inner_child_map_representation_${options.mode}_blind_a001` }
  });
  const selectors = Object.keys(raw.modelUsage ?? {});
  if (raw.model !== MODEL || !selectors.includes(MODEL)) {
    throw new Error(`Exact Sonnet model not confirmed: ${raw.model}; ${selectors.join(",")}`);
  }
  const answer = JSON.parse(raw.text).answer.trim();
  if (!answer) throw new Error("Blind generator returned no answer.");

  const completedAt = new Date().toISOString();
  const artifact = {
    schemaVersion: 1,
    experiment: options.mode === "c1"
      ? "inner-child-map-constraint-backed-advisory-realization"
      : "inner-child-map-representation",
    mode: options.mode,
    startedAt,
    completedAt,
    generator: {
      provider: raw.provider,
      requestedModel: MODEL,
      returnedModel: raw.model,
      effort: EFFORT,
      requestId: raw.requestId,
      responseId: raw.responseId,
      latencyMs: Date.now() - started,
      usage: raw.usage ?? null,
      modelUsage: raw.modelUsage ?? null
    },
    blindness: {
      supplied: options.mode === "r1"
        ? ["exact-frozen-map", "exact-user-message", "neutral-task"]
        : options.mode === "r2"
          ? ["compact-existing-map-projection", "exact-user-message", "neutral-task"]
          : ["compact-existing-map-projection", "exact-user-message", "neutral-task", "general-mandatory-realization-invariants"],
      excluded: ["target-answer", "owner-critiques", "evaluation-rubric", "prior-responses", "prior-verdicts", "supervisor-analysis"]
    },
    prompt: promptReceipt,
    source,
    response: { answer, answerSha256: sha256(answer), answerChars: answer.length }
  };

  await fs.mkdir(options.outputRoot, { recursive: true, mode: 0o700 });
  const outputPath = path.join(
    options.outputRoot,
    `A001-representation-${options.mode}-${completedAt.replaceAll(/[:.]/g, "-")}-${randomUUID()}.json`
  );
  await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await fs.chmod(outputPath, 0o600);

  return {
    outputPath,
    mode: options.mode,
    generator: artifact.generator,
    prompt: promptReceipt,
    source,
    answerSha256: artifact.response.answerSha256,
    answerChars: artifact.response.answerChars
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}
