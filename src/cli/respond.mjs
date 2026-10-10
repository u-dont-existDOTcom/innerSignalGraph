import { loadConfig } from "../core/config.mjs";
import { reviseUnsentSupervisorCandidate } from "../orchestrator/pending-reply-revision.mjs";
import { buildContext } from "../orchestrator/context-builder.mjs";
import { createProviders } from "../providers/factory.mjs";
import { runFormulatedPipeline } from "../orchestrator/run-formulated-pipeline.mjs";
import { runCliMain } from "../core/cli-main.mjs";
import { createProgressReporter } from "../core/progress.mjs";

await runCliMain(async () => {
  // Node 24 fs.promises.readFile does not accept fd 0; use the stdin stream.
  process.stdin.setEncoding("utf8");
  let inputText = "";
  for await (const chunk of process.stdin) inputText += chunk;
  let input;
  try { input = JSON.parse(inputText); } catch { input = { userMessage: inputText.trim() }; }
  // Explicit supervisor editing never enters clinical extraction, inference,
  // or an outbound delivery contract. The returned artifact remains unsent.
  if (input?.pendingReplyRevision) return reviseUnsentSupervisorCandidate(input.pendingReplyRevision);
  const config = loadConfig();
  const context = await buildContext(input, config);
  const providers = createProviders(config);
  return await runFormulatedPipeline({
    context,
    providers,
    config,
    onProgress: createProgressReporter({ prefix: "therapy" })
  });
});
