import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ClaudeCliProvider } from "../src/providers/claude-cli.mjs";
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

export const PROJECTION_SHA256 = "e52626efa8c0f0e2a0d92df89ac15621868de6bcbf66593ba98475007200b66a";
export const INVARIANTS_SHA256 = "39d0be2aff205362e52c411378c9a7ca3d43c57dd5d66ccc9808d75f37df1006";
export const CRITIC_CONTRACT = `You are the final semantic critic and reviser for an Inner Signal response.

The draft was generated freely. Do not replace its formulation merely because you could write a different or more polished answer.

Inspect the draft only for concrete violations of the supplied mandatory realization invariants.

Preserve:
- useful transcript-grounded insights;
- natural conversational language;
- emotional warmth;
- uncertainty that is appropriately preserved;
- concise structure;
- claims that the transcript adequately supports.

For every apparent problem, distinguish:
1. an actual invariant violation;
2. a stylistic preference;
3. a merely different but valid therapeutic formulation.

Revise only actual invariant violations or important omissions directly caused by them.

Do not invent a new therapeutic theory merely to repair the answer.

Do not force every invariant into the prose.

Prefer the smallest repair that makes the answer semantically sound.

In particular, check carefully for:
- speaker identities inferred only from sequence;
- love made conditional because blame appears elsewhere;
- uncertain internal beliefs, fears, knowledge, meanings, or capacities stated as facts;
- anger or resentment assigned a hidden function without evidence;
- causal compassion turned into a search for what a younger self failed to do;
- skeptical interpretations certified as objectively correct;
- seeded explanations in the final question;
- relational credibility discussed abstractly when a natural relational response should instead be enacted;
- duplicate or forced caring-proxy interventions.

If no caring-proxy operation is genuinely useful, do not insert one merely for coverage.

If the draft already handles a point correctly, leave it alone.

Return:
1. the concrete invariant violations actually found;
2. one revised final answer.

The revised answer must stand alone as the response to the user and must not mention this critique process.`;

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
    violations: {
      type: "array",
      items: { type: "string", minLength: 1 }
    },
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
  const inputPath = values.get("--input-json");
  if (!inputPath) throw new Error("--input-json is required.");
  const outputRoot = values.get("--output-root");
  if (!dryRun && !outputRoot) throw new Error("--output-root is required unless --dry-run is used.");
  return { inputPath, outputRoot, dryRun };
}

async function loadFrozenInputs(inputPath) {
  const [map, inputText] = await Promise.all([
    fs.readFile(mapPath, "utf8"),
    fs.readFile(inputPath, "utf8")
  ]);
  if (sha256(map) !== MAP_SHA256) throw new Error(`Frozen map identity check failed: ${sha256(map)}`);
  const projection = buildRelevantRouteProjection(map);
  if (sha256(projection) !== PROJECTION_SHA256) throw new Error(`Frozen projection identity check failed: ${sha256(projection)}`);
  if (sha256(MANDATORY_REALIZATION_INVARIANTS) !== INVARIANTS_SHA256) {
    throw new Error(`Frozen invariant identity check failed: ${sha256(MANDATORY_REALIZATION_INVARIANTS)}`);
  }
  const parsed = JSON.parse(inputText);
  const userMessage = parsed.value?.userMessage ?? parsed.userMessage;
  if (typeof userMessage !== "string" || sha256(userMessage) !== A001_SHA256) {
    throw new Error("Exact A001 input identity check failed.");
  }
  return { map, projection, userMessage };
}

export function buildCriticPrompt({ userMessage, draft }) {
  return {
    system: "",
    user: `<user_message>\n${userMessage}\n</user_message>\n\n<draft>\n${draft}\n</draft>\n\n<mandatory_realization_invariants>\n${MANDATORY_REALIZATION_INVARIANTS}\n</mandatory_realization_invariants>\n\n<task>\n${CRITIC_CONTRACT}\n</task>`
  };
}

function promptReceipt(prompt, order) {
  return {
    systemRole: { empty: true, sha256: sha256(prompt.system), chars: prompt.system.length },
    userRole: {
      order,
      delimiterStyle: "descriptive XML",
      sha256: sha256(prompt.user),
      chars: prompt.user.length
    }
  };
}

function verifyModel(raw, stage) {
  const selectors = Object.keys(raw.modelUsage ?? {});
  if (raw.model !== MODEL || !selectors.includes(MODEL)) {
    throw new Error(`${stage} exact Sonnet model not confirmed: ${raw.model}; ${selectors.join(",")}`);
  }
}

function generatorMetadata(raw, latencyMs) {
  return {
    provider: raw.provider,
    requestedModel: MODEL,
    returnedModel: raw.model,
    effort: EFFORT,
    requestId: raw.requestId,
    responseId: raw.responseId,
    latencyMs,
    usage: raw.usage ?? null,
    modelUsage: raw.modelUsage ?? null
  };
}

async function writePrivateJson(outputPath, value) {
  await fs.writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await fs.chmod(outputPath, 0o600);
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const { projection, userMessage } = await loadFrozenInputs(options.inputPath);
  const pass1Prompt = buildRepresentationPrompt({ architecture: projection, userMessage, mode: "c1" });
  const pass1PromptReceipt = promptReceipt(
    pass1Prompt,
    ["relevant_therapy_architecture", "user_message", "task", "mandatory_realization_invariants"]
  );
  const source = {
    mapCommit: MAP_COMMIT,
    mapSha256: MAP_SHA256,
    projectionSha256: PROJECTION_SHA256,
    inputSha256: A001_SHA256,
    taskSha256: sha256(TASK),
    mandatoryRealizationInvariantsSha256: INVARIANTS_SHA256,
    criticContractSha256: sha256(CRITIC_CONTRACT)
  };

  if (options.dryRun) {
    const criticTemplate = buildCriticPrompt({ userMessage, draft: "FRESH_PASS_1_DRAFT" });
    return {
      dryRun: true,
      model: MODEL,
      effort: EFFORT,
      pass1Prompt: pass1PromptReceipt,
      pass2Template: promptReceipt(
        criticTemplate,
        ["user_message", "draft", "mandatory_realization_invariants", "task"]
      ),
      pass2StructuredOutput: ["violations", "revised_answer"],
      source
    };
  }

  await fs.mkdir(options.outputRoot, { recursive: true, mode: 0o700 });
  const runId = randomUUID();
  const provider = new ClaudeCliProvider({
    model: MODEL,
    effort: EFFORT,
    timeoutMs: 900000,
    cwd: projectRoot,
    isolateConfig: true
  });

  const pass1StartedAt = new Date().toISOString();
  const pass1Started = Date.now();
  const pass1Raw = await provider.generate({
    system: pass1Prompt.system,
    user: pass1Prompt.user,
    outputSchema: answerSchema,
    metadata: { stage: "inner_child_two_pass_a001_generator" }
  });
  verifyModel(pass1Raw, "Pass 1");
  const draft = JSON.parse(pass1Raw.text).answer.trim();
  if (!draft) throw new Error("Pass 1 returned no draft.");
  const pass1CompletedAt = new Date().toISOString();
  const pass1Artifact = {
    schemaVersion: 1,
    experiment: "inner-child-two-pass-sonnet-revision",
    stage: "pass1-generator",
    startedAt: pass1StartedAt,
    completedAt: pass1CompletedAt,
    generator: generatorMetadata(pass1Raw, Date.now() - pass1Started),
    blindness: {
      supplied: ["compact-frozen-map-projection", "exact-A001", "neutral-task", "frozen-mandatory-invariants"],
      excluded: ["prior-responses", "prior-verdicts", "owner-critiques", "evaluation-rubric", "target-answer", "supervisor-analysis"]
    },
    prompt: pass1PromptReceipt,
    source,
    response: { draft, draftSha256: sha256(draft), draftChars: draft.length }
  };
  const pass1Path = path.join(options.outputRoot, `A001-two-pass-pass1-${pass1CompletedAt.replaceAll(/[:.]/g, "-")}-${runId}.json`);
  await writePrivateJson(pass1Path, pass1Artifact);

  const pass2Prompt = buildCriticPrompt({ userMessage, draft });
  const pass2PromptReceipt = promptReceipt(
    pass2Prompt,
    ["user_message", "draft", "mandatory_realization_invariants", "task"]
  );
  const pass2StartedAt = new Date().toISOString();
  const pass2Started = Date.now();
  const pass2Raw = await provider.generate({
    system: pass2Prompt.system,
    user: pass2Prompt.user,
    outputSchema: criticSchema,
    metadata: { stage: "inner_child_two_pass_a001_critic_reviser" }
  });
  verifyModel(pass2Raw, "Pass 2");
  const parsedCritic = JSON.parse(pass2Raw.text);
  if (!Array.isArray(parsedCritic.violations) || parsedCritic.violations.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("Pass 2 returned invalid violations.");
  }
  const violations = parsedCritic.violations.map((item) => item.trim());
  const revisedAnswer = parsedCritic.revised_answer?.trim();
  if (!revisedAnswer) throw new Error("Pass 2 returned no revised answer.");
  const pass2CompletedAt = new Date().toISOString();
  const finalArtifact = {
    schemaVersion: 1,
    experiment: "inner-child-two-pass-sonnet-revision",
    startedAt: pass1StartedAt,
    completedAt: pass2CompletedAt,
    pass1: {
      generator: pass1Artifact.generator,
      prompt: pass1PromptReceipt,
      response: pass1Artifact.response
    },
    pass2: {
      generator: generatorMetadata(pass2Raw, Date.now() - pass2Started),
      blindness: {
        supplied: ["exact-A001", "exact-fresh-draft", "frozen-mandatory-invariants", "critic-revision-contract"],
        excluded: ["map-or-projection", "prior-failed-examples", "prior-verdicts", "owner-critiques", "evaluation-rubric", "target-answer", "supervisor-analysis"]
      },
      prompt: pass2PromptReceipt,
      structuredOutputValid: true,
      response: {
        violations,
        violationsSha256: sha256(JSON.stringify(violations)),
        revisedAnswer,
        revisedAnswerSha256: sha256(revisedAnswer),
        revisedAnswerChars: revisedAnswer.length
      }
    },
    source
  };
  const finalPath = path.join(options.outputRoot, `A001-two-pass-final-${pass2CompletedAt.replaceAll(/[:.]/g, "-")}-${runId}.json`);
  await writePrivateJson(finalPath, finalArtifact);

  return {
    pass1Path,
    finalPath,
    model: MODEL,
    effort: EFFORT,
    pass1: {
      generator: pass1Artifact.generator,
      prompt: pass1PromptReceipt,
      draftSha256: pass1Artifact.response.draftSha256,
      draftChars: pass1Artifact.response.draftChars
    },
    pass2: {
      generator: finalArtifact.pass2.generator,
      prompt: pass2PromptReceipt,
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
