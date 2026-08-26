import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CodexCliProvider } from "../src/providers/codex-cli.mjs";
import {
  A001_SHA256,
  MANDATORY_REALIZATION_INVARIANTS,
  MAP_COMMIT,
  MAP_SHA256,
  TASK,
  buildRelevantRouteProjection,
  sha256
} from "./run-a001-representation-experiment.mjs";
import {
  CRITIC_CONTRACT,
  INVARIANTS_SHA256,
  PROJECTION_SHA256,
  buildCriticPrompt
} from "./run-a001-two-pass-revision-experiment.mjs";

export const GPT_MODEL = "gpt-5.6-sol";
export const GPT_REASONING_EFFORT = "high";
export const FIXED_DRAFT_SHA256 = "6805b23441f0c3a78bea98e497e7d0cc20325350b0486aae7dfd20d3bb37efdb";
export const CONTROLLED_CRITIC_PROMPT_SHA256 = "2b787220fd5be819afa2a7b13e3801104aa40a0c16c616e876014c731c8adb67";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mapPath = path.join(projectRoot, "docs/INNER-CHILD-THERAPY-MAP.md");

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
  const fixedArtifactPath = values.get("--fixed-artifact");
  const outputRoot = values.get("--output-root");
  if (!inputPath) throw new Error("--input-json is required.");
  if (!fixedArtifactPath) throw new Error("--fixed-artifact is required.");
  if (!dryRun && !outputRoot) throw new Error("--output-root is required unless --dry-run is used.");
  return { inputPath, fixedArtifactPath, outputRoot, dryRun };
}

async function loadFrozenStageI({ inputPath, fixedArtifactPath }) {
  const [map, inputText, fixedArtifactText] = await Promise.all([
    fs.readFile(mapPath, "utf8"),
    fs.readFile(inputPath, "utf8"),
    fs.readFile(fixedArtifactPath, "utf8")
  ]);
  if (sha256(map) !== MAP_SHA256) throw new Error(`Frozen map identity check failed: ${sha256(map)}`);
  const projection = buildRelevantRouteProjection(map);
  if (sha256(projection) !== PROJECTION_SHA256) throw new Error(`Frozen projection identity check failed: ${sha256(projection)}`);
  if (sha256(MANDATORY_REALIZATION_INVARIANTS) !== INVARIANTS_SHA256) {
    throw new Error(`Frozen invariant identity check failed: ${sha256(MANDATORY_REALIZATION_INVARIANTS)}`);
  }
  const input = JSON.parse(inputText);
  const userMessage = input.value?.userMessage ?? input.userMessage;
  if (typeof userMessage !== "string" || sha256(userMessage) !== A001_SHA256) {
    throw new Error("Exact A001 input identity check failed.");
  }
  const fixedArtifact = JSON.parse(fixedArtifactText);
  const draft = fixedArtifact.pass1?.response?.draft ?? fixedArtifact.response?.draft;
  if (typeof draft !== "string" || sha256(draft) !== FIXED_DRAFT_SHA256) {
    throw new Error(`Fixed draft identity check failed: ${typeof draft === "string" ? sha256(draft) : "missing"}`);
  }
  return { userMessage, draft };
}

function promptReceipt(prompt) {
  return {
    systemRole: { empty: true, sha256: sha256(prompt.system), chars: prompt.system.length },
    userRole: {
      order: ["user_message", "draft", "mandatory_realization_invariants", "task"],
      delimiterStyle: "descriptive XML",
      sha256: sha256(prompt.user),
      chars: prompt.user.length
    }
  };
}

function verifyStructuredCritic(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.violations) || parsed.violations.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("GPT critic returned invalid violations.");
  }
  const violations = parsed.violations.map((item) => item.trim());
  const revisedAnswer = parsed.revised_answer?.trim();
  if (!revisedAnswer) throw new Error("GPT critic returned no revised answer.");
  return { violations, revisedAnswer };
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const { userMessage, draft } = await loadFrozenStageI(options);
  const prompt = buildCriticPrompt({ userMessage, draft });
  const receipt = promptReceipt(prompt);
  if (receipt.userRole.sha256 !== CONTROLLED_CRITIC_PROMPT_SHA256) {
    throw new Error(`Controlled critic prompt changed: ${receipt.userRole.sha256}`);
  }
  const source = {
    mapCommit: MAP_COMMIT,
    mapSha256: MAP_SHA256,
    projectionSha256: PROJECTION_SHA256,
    inputSha256: A001_SHA256,
    taskSha256: sha256(TASK),
    fixedDraftSha256: FIXED_DRAFT_SHA256,
    mandatoryRealizationInvariantsSha256: INVARIANTS_SHA256,
    criticContractSha256: sha256(CRITIC_CONTRACT),
    controlledCriticPromptSha256: CONTROLLED_CRITIC_PROMPT_SHA256
  };

  if (options.dryRun) {
    return {
      dryRun: true,
      stage: "stage1-fixed-draft-cross-family-critic",
      model: GPT_MODEL,
      reasoningEffort: GPT_REASONING_EFFORT,
      prompt: receipt,
      structuredOutput: ["violations", "revised_answer"],
      source
    };
  }

  const provider = new CodexCliProvider({
    model: GPT_MODEL,
    reasoningEffort: GPT_REASONING_EFFORT,
    timeoutMs: 900000,
    cwd: projectRoot,
    isolateConfig: true
  });
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const raw = await provider.generate({
    system: prompt.system,
    user: prompt.user,
    outputSchema: criticSchema,
    metadata: { stage: "inner_child_cross_family_stage1_gpt_critic_reviser" }
  });
  if (raw.model !== GPT_MODEL) throw new Error(`Exact GPT model not confirmed: ${raw.model}`);
  const { violations, revisedAnswer } = verifyStructuredCritic(raw.text);
  const completedAt = new Date().toISOString();
  const artifact = {
    schemaVersion: 1,
    experiment: "inner-child-cross-family-critic",
    stage: "stage1-fixed-draft",
    startedAt,
    completedAt,
    generator: {
      provider: raw.provider,
      requestedModel: GPT_MODEL,
      returnedModel: raw.model,
      reasoningEffort: GPT_REASONING_EFFORT,
      requestId: raw.requestId,
      responseId: raw.responseId,
      latencyMs: Date.now() - started,
      usage: raw.usage ?? null,
      transport: raw.transport ?? null
    },
    blindness: {
      supplied: ["exact-A001", "exact-fixed-Sonnet-draft", "frozen-mandatory-invariants", "frozen-critic-contract"],
      excluded: ["map-or-projection", "prior-Sonnet-critic-findings", "prior-revised-answer", "prior-verdict", "owner-critiques", "evaluation-rubric", "target-answer", "supervisor-analysis"]
    },
    prompt: receipt,
    source,
    structuredOutputValid: true,
    response: {
      violations,
      violationsSha256: sha256(JSON.stringify(violations)),
      revisedAnswer,
      revisedAnswerSha256: sha256(revisedAnswer),
      revisedAnswerChars: revisedAnswer.length
    }
  };
  await fs.mkdir(options.outputRoot, { recursive: true, mode: 0o700 });
  const outputPath = path.join(
    options.outputRoot,
    `A001-cross-family-stage1-${completedAt.replaceAll(/[:.]/g, "-")}-${randomUUID()}.json`
  );
  await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await fs.chmod(outputPath, 0o600);

  return {
    outputPath,
    stage: artifact.stage,
    generator: artifact.generator,
    prompt: receipt,
    source,
    structuredOutputValid: true,
    violationsSha256: artifact.response.violationsSha256,
    violationsCount: violations.length,
    revisedAnswerSha256: artifact.response.revisedAnswerSha256,
    revisedAnswerChars: artifact.response.revisedAnswerChars
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
