import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, projectRoot } from "../core/config.mjs";
import { buildHypnosisContext } from "../orchestrator/context-builder.mjs";
import { createProviders } from "../providers/factory.mjs";
import { runHypnosisCompilerPipeline } from "../orchestrator/run-hypnosis-compiler.mjs";
import { runCliMain } from "../core/cli-main.mjs";
import { createProgressReporter } from "../core/progress.mjs";

async function findCasePath(caseId) {
  const corpusRoot = path.join(projectRoot, "corpus/difficult-cases");
  const entries = await fs.readdir(corpusRoot, { withFileTypes: true });
  const matches = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(`${caseId}-`));
  if (matches.length !== 1) throw new Error(`Expected exactly one corpus directory beginning ${caseId}-, found ${matches.length}.`);
  return path.join(corpusRoot, matches[0].name, "case.json");
}

await runCliMain(async () => {
  const caseId = process.argv[2] ?? "H001";
  const casePath = await findCasePath(caseId);
  const definition = JSON.parse(await fs.readFile(casePath, "utf8"));
  const config = loadConfig();
  const context = await buildHypnosisContext(definition.input, config);
  const providers = createProviders(config, { fixturePath: path.join(projectRoot, definition.mockFixture) });
  const onProgress = createProgressReporter({ prefix: `hypnosis:${caseId}` });
  return await runHypnosisCompilerPipeline({ context, providers, config, caseId, onProgress });
});
