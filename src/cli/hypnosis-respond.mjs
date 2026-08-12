import fs from "node:fs/promises";
import { loadConfig } from "../core/config.mjs";
import { buildHypnosisContext } from "../orchestrator/context-builder.mjs";
import { createProviders } from "../providers/factory.mjs";
import { runHypnosisCompilerPipeline } from "../orchestrator/run-hypnosis-compiler.mjs";
import { runCliMain } from "../core/cli-main.mjs";
import { createProgressReporter } from "../core/progress.mjs";

await runCliMain(async () => {
  const config = loadConfig();
  const inputText = await fs.readFile(0, "utf8");
  let input;
  try { input = JSON.parse(inputText); }
  catch { throw new Error("hypnosis:respond requires JSON input containing userMessage and hypnosisRequest."); }
  const context = await buildHypnosisContext(input, config);
  const providers = createProviders(config);
  return await runHypnosisCompilerPipeline({
    context,
    providers,
    config,
    onProgress: createProgressReporter({ prefix: "hypnosis" })
  });
});
