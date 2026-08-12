import fs from "node:fs/promises";
import { loadConfig } from "../core/config.mjs";
import { buildContext } from "../orchestrator/context-builder.mjs";
import { createProviders } from "../providers/factory.mjs";
import { runFormulatedPipeline } from "../orchestrator/run-formulated-pipeline.mjs";
import { runCliMain } from "../core/cli-main.mjs";
import { createProgressReporter } from "../core/progress.mjs";

await runCliMain(async () => {
  const config = loadConfig();
  const inputText = await fs.readFile(0, "utf8");
  let input;
  try { input = JSON.parse(inputText); } catch { input = { userMessage: inputText.trim() }; }
  const context = await buildContext(input, config);
  const providers = createProviders(config);
  return await runFormulatedPipeline({
    context,
    providers,
    config,
    onProgress: createProgressReporter({ prefix: "therapy" })
  });
});
