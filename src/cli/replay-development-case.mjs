import fs from "node:fs/promises";
import { loadConfig } from "../core/config.mjs";
import { createProviders } from "../providers/factory.mjs";
import { buildContext } from "../orchestrator/context-builder.mjs";
import { runTieredTherapyPipeline } from "../orchestrator/run-tiered-pipeline.mjs";

const filePath = process.argv[2];
if (!filePath) throw new Error("Usage: node src/cli/replay-development-case.mjs <development-case.json>");
const developmentCase = JSON.parse(await fs.readFile(filePath, "utf8"));
const ledgerContext = developmentCase.ledger?.context;
if (!ledgerContext?.userMessage) throw new Error("Development case lacks a full replayable decision ledger. Use LEDGER_MODE=full for autonomous replay.");
const config = loadConfig({ mode: "cli", ledgerMode: "off" });
const providers = createProviders(config);
const context = await buildContext({
  userMessage: ledgerContext.userMessage,
  recentTranscript: ledgerContext.recentTranscript ?? "",
  userFacts: ledgerContext.userFacts ?? [],
  priorCaseSnapshot: ledgerContext.priorCaseSnapshot ?? null,
  priorInterventionContract: ledgerContext.priorInterventionContract ?? null,
  priorProcessingTier: ledgerContext.priorProcessingTier ?? ""
}, config);
const requested = ["fast", "reviewed", "deep", "forensic"].includes(developmentCase.feedback?.processingTier)
  ? developmentCase.feedback.processingTier
  : "auto";
const result = await runTieredTherapyPipeline({ context, providers, config, processingMode: requested });
process.stdout.write(`${JSON.stringify(result)}\n`);
