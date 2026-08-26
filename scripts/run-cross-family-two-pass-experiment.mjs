import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ClaudeCliProvider } from "../src/providers/claude-cli.mjs";
import { CodexCliProvider } from "../src/providers/codex-cli.mjs";
import {
  A001_SHA256,
  EFFORT,
  MANDATORY_REALIZATION_INVARIANTS,
  MAP_COMMIT,
  MAP_SHA256,
  MODEL,
  TASK,
  buildRelevantRouteProjection,
  buildRepresentationPrompt,
  sha256
} from "./run-a001-representation-experiment.mjs";
import {
  CRITIC_CONTRACT,
  INVARIANTS_SHA256,
  PROJECTION_SHA256,
  buildCriticPrompt
} from "./run-a001-two-pass-revision-experiment.mjs";
import { GPT_MODEL, GPT_REASONING_EFFORT } from "./run-a001-cross-family-critic-experiment.mjs";

export const CASE_X = "I cannot think of anyone I love or trust enough for the best-friend exercise. Imagining somebody who cared about me makes me feel more alone.";
export const CASE_Y = "I made a choice that seriously hurt somebody. I understand why I did it, but it was still wrong and there are consequences.";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mapPath = path.join(projectRoot, "docs/INNER-CHILD-THERAPY-MAP.md");

const answerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: { answer: { type: "string", minLength: 1 } }
};

const criticSchema = {
  type: "object",
  additionalProperties: false,
  required: ["violations", "revised_answer"],
  properties: {
    violations: { type: "array", items: { type: "string", minLength: 1 } },
    revised_answer: { type: "string", minLength: 1 }
  }
};

function parseArgs(argv) {
  const values = new Map();
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (!arg.startsWith("--") || index + 1 >= argv.length) throw new Error(`Invalid argument: ${arg}`);
    values.set(arg, argv[index + 1]);
    index += 1;
  }
  const caseId = values.get("--case") ?? "a001";
  if (!new Set(["a001", "x", "y"]).has(caseId)) throw new Error("--case must be a001, x, or y.");
  const inputPath = values.get("--input-json");
  if (caseId === "a001" && !inputPath) throw new Error("--input-json is required for A001.");
  const outputRoot = values.get("--output-root");
  if (!dryRun && !outputRoot) throw new Error("--output-root is required unless --dry-run is used.");
  return { caseId, inputPath, outputRoot, dryRun };
}

async function loadFrozenInputs({ caseId, inputPath }) {
  const map = await fs.readFile(mapPath, "utf8");
  if (sha256(map) !== MAP_SHA256) throw new Error(`Frozen map identity check failed: ${sha256(map)}`);
  const projection = buildRelevantRouteProjection(map);
  if (sha256(projection) !== PROJECTION_SHA256) throw new Error(`Frozen projection identity check failed: ${sha256(projection)}`);
  if (sha256(MANDATORY_REALIZATION_INVARIANTS) !== INVARIANTS_SHA256) {
    throw new Error(`Frozen invariant identity check failed: ${sha256(MANDATORY_REALIZATION_INVARIANTS)}`);
  }

  let userMessage;
  if (caseId === "a001") {
    const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
    userMessage = input.value?.userMessage ?? input.userMessage;
    if (typeof userMessage !== "string" || sha256(userMessage) !== A001_SHA256) {
      throw new Error("Exact A001 input identity check failed.");
    }
  } else {
    userMessage = caseId === "x" ? CASE_X : CASE_Y;
  }
  return { projection, userMessage };
}

function promptReceipt(prompt, order) {
  return {
    systemRole: { empty: true, sha256: sha256(prompt.system), chars: prompt.system.length },
    userRole: { order, delimiterStyle: "descriptive XML", sha256: sha256(prompt.user), chars: prompt.user.length }
  };
}

function verifySonnet(raw) {
  const selectors = Object.keys(raw.modelUsage ?? {});
  if (raw.model !== MODEL || !selectors.includes(MODEL)) {
    throw new Error(`Exact Sonnet model not confirmed: ${raw.model}; ${selectors.join(",")}`);
  }
}

function verifyCritic(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.violations) || parsed.violations.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("GPT critic returned invalid violations.");
  }
  const revisedAnswer = parsed.revised_answer?.trim();
  if (!revisedAnswer) throw new Error("GPT critic returned no revised answer.");
  return { violations: parsed.violations.map((item) => item.trim()), revisedAnswer };
}

async function writePrivateJson(outputPath, value) {
  await fs.writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await fs.chmod(outputPath, 0o600);
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const { projection, userMessage } = await loadFrozenInputs(options);
  const pass1Prompt = buildRepresentationPrompt({ architecture: projection, userMessage, mode: "c1" });
  const pass1Receipt = promptReceipt(
    pass1Prompt,
    ["relevant_therapy_architecture", "user_message", "task", "mandatory_realization_invariants"]
  );
  const source = {
    caseId: options.caseId,
    mapCommit: MAP_COMMIT,
    mapSha256: MAP_SHA256,
    projectionSha256: PROJECTION_SHA256,
    inputSha256: sha256(userMessage),
    taskSha256: sha256(TASK),
    mandatoryRealizationInvariantsSha256: INVARIANTS_SHA256,
    criticContractSha256: sha256(CRITIC_CONTRACT)
  };

  if (options.dryRun) {
    const pass2Template = buildCriticPrompt({ userMessage, draft: "FRESH_PASS_1_DRAFT" });
    return {
      dryRun: true,
      architecture: "claude-sonnet-4-6-generator-to-gpt-5.6-sol-critic",
      caseId: options.caseId,
      pass1: { model: MODEL, effort: EFFORT, prompt: pass1Receipt },
      pass2: {
        model: GPT_MODEL,
        reasoningEffort: GPT_REASONING_EFFORT,
        promptTemplate: promptReceipt(
          pass2Template,
          ["user_message", "draft", "mandatory_realization_invariants", "task"]
        ),
        structuredOutput: ["violations", "revised_answer"]
      },
      source
    };
  }

  await fs.mkdir(options.outputRoot, { recursive: true, mode: 0o700 });
  const runId = randomUUID();
  const runStartedAt = new Date().toISOString();
  const sonnet = new ClaudeCliProvider({
    model: MODEL,
    effort: EFFORT,
    timeoutMs: 900000,
    cwd: projectRoot,
    isolateConfig: true
  });
  const pass1Started = Date.now();
  const pass1Raw = await sonnet.generate({
    system: pass1Prompt.system,
    user: pass1Prompt.user,
    outputSchema: answerSchema,
    metadata: { stage: `inner_child_cross_family_${options.caseId}_generator` }
  });
  verifySonnet(pass1Raw);
  const draft = JSON.parse(pass1Raw.text).answer?.trim();
  if (!draft) throw new Error("Sonnet generator returned no draft.");
  const pass1CompletedAt = new Date().toISOString();
  const pass1 = {
    generator: {
      provider: pass1Raw.provider,
      requestedModel: MODEL,
      returnedModel: pass1Raw.model,
      effort: EFFORT,
      requestId: pass1Raw.requestId,
      responseId: pass1Raw.responseId,
      latencyMs: Date.now() - pass1Started,
      usage: pass1Raw.usage ?? null,
      modelUsage: pass1Raw.modelUsage ?? null
    },
    blindness: {
      supplied: ["compact-frozen-map-projection", `exact-${options.caseId}-input`, "neutral-task", "frozen-mandatory-invariants"],
      excluded: ["prior-responses", "prior-verdicts", "owner-critiques", "evaluation-rubric", "target-answer", "supervisor-analysis"]
    },
    prompt: pass1Receipt,
    response: { draft, draftSha256: sha256(draft), draftChars: draft.length }
  };
  const pass1Path = path.join(options.outputRoot, `${options.caseId}-cross-family-pass1-${pass1CompletedAt.replaceAll(/[:.]/g, "-")}-${runId}.json`);
  await writePrivateJson(pass1Path, { schemaVersion: 1, experiment: "inner-child-cross-family-two-pass", stage: "pass1-generator", source, ...pass1 });

  const pass2Prompt = buildCriticPrompt({ userMessage, draft });
  const pass2Receipt = promptReceipt(
    pass2Prompt,
    ["user_message", "draft", "mandatory_realization_invariants", "task"]
  );
  const gpt = new CodexCliProvider({
    model: GPT_MODEL,
    reasoningEffort: GPT_REASONING_EFFORT,
    timeoutMs: 900000,
    cwd: projectRoot,
    isolateConfig: true
  });
  const pass2Started = Date.now();
  const pass2Raw = await gpt.generate({
    system: pass2Prompt.system,
    user: pass2Prompt.user,
    outputSchema: criticSchema,
    metadata: { stage: `inner_child_cross_family_${options.caseId}_critic_reviser` }
  });
  if (pass2Raw.model !== GPT_MODEL) throw new Error(`Exact GPT model not confirmed: ${pass2Raw.model}`);
  const { violations, revisedAnswer } = verifyCritic(pass2Raw.text);
  const completedAt = new Date().toISOString();
  const finalArtifact = {
    schemaVersion: 1,
    experiment: "inner-child-cross-family-two-pass",
    caseId: options.caseId,
    startedAt: runStartedAt,
    completedAt,
    source,
    pass1,
    pass2: {
      generator: {
        provider: pass2Raw.provider,
        requestedModel: GPT_MODEL,
        returnedModel: pass2Raw.model,
        reasoningEffort: GPT_REASONING_EFFORT,
        requestId: pass2Raw.requestId,
        responseId: pass2Raw.responseId,
        latencyMs: Date.now() - pass2Started,
        usage: pass2Raw.usage ?? null,
        transport: pass2Raw.transport ?? null
      },
      blindness: {
        supplied: [`exact-${options.caseId}-input`, "exact-fresh-Sonnet-draft", "frozen-mandatory-invariants", "frozen-critic-contract"],
        excluded: ["map-or-projection", "prior-experiments", "prior-verdicts", "owner-critiques", "evaluation-rubric", "target-answer", "supervisor-analysis"]
      },
      prompt: pass2Receipt,
      structuredOutputValid: true,
      response: {
        violations,
        violationsSha256: sha256(JSON.stringify(violations)),
        revisedAnswer,
        revisedAnswerSha256: sha256(revisedAnswer),
        revisedAnswerChars: revisedAnswer.length
      }
    }
  };
  const finalPath = path.join(options.outputRoot, `${options.caseId}-cross-family-final-${completedAt.replaceAll(/[:.]/g, "-")}-${runId}.json`);
  await writePrivateJson(finalPath, finalArtifact);

  return {
    pass1Path,
    finalPath,
    architecture: "claude-sonnet-4-6-generator-to-gpt-5.6-sol-critic",
    caseId: options.caseId,
    pass1: {
      generator: pass1.generator,
      prompt: pass1Receipt,
      draftSha256: pass1.response.draftSha256,
      draftChars: pass1.response.draftChars
    },
    pass2: {
      generator: finalArtifact.pass2.generator,
      prompt: pass2Receipt,
      structuredOutputValid: true,
      violationsSha256: finalArtifact.pass2.response.violationsSha256,
      violationsCount: violations.length,
      revisedAnswerSha256: finalArtifact.pass2.response.revisedAnswerSha256,
      revisedAnswerChars: finalArtifact.pass2.response.revisedAnswerChars
    },
    source
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
