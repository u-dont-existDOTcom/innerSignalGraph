import { loadConfig } from "../core/config.mjs";
import { createProviders } from "../providers/factory.mjs";
import { entitlementSchema } from "../schemas/json-schemas.mjs";
import { parseModelJson } from "../core/json.mjs";
import { runSubprocess } from "../core/subprocess.mjs";
import { runCliMain } from "../core/cli-main.mjs";
import { createProgressReporter } from "../core/progress.mjs";

const progress = createProgressReporter({ prefix: "check-cli" });

async function version(command, label) {
  try {
    const run = await runSubprocess({ command, args: ["--version"], timeoutMs: 30000, label });
    return run.code === 0 ? (run.stdout || run.stderr).trim() : `exit ${run.code}: ${run.stderr.trim()}`;
  } catch (error) {
    return `unavailable: ${error.message}`;
  }
}

await runCliMain(async () => {
  const baseConfig = loadConfig({ mode: "cli", ledgerMode: "off" });
  const config = { ...baseConfig, requestTimeoutMs: baseConfig.entitlementTimeoutMs };
  progress({ stage: "versions", status: "started" });
  const versions = {
    codex: await version(config.codexCommand, "Codex CLI version check"),
    claude: await version(config.claudeCommand, "Claude CLI version check")
  };
  progress({ stage: "versions", status: "completed", detail: `${versions.codex}; ${versions.claude}` });

  const providers = createProviders(config);
  const results = [];
  for (const provider of [providers.openai, providers.anthropic]) {
    progress({ stage: `entitlement:${provider.id}`, status: "started", detail: provider.model });
    const started = Date.now();
    try {
      const response = await provider.generate({
        system: "This is a model-entitlement and structured-output check. Return only the requested schema.",
        user: "Return {\"ok\": true}.",
        outputSchema: entitlementSchema,
        metadata: { stage: "entitlement-check" }
      });
      const parsed = parseModelJson(response.text, `${provider.id} entitlement response`);
      results.push({
        provider: provider.id,
        transport: "cli",
        requestedModel: provider.model,
        ok: parsed.ok === true,
        responseId: response.responseId,
        modelUsage: response.modelUsage,
        elapsedMs: Date.now() - started
      });
      progress({ stage: `entitlement:${provider.id}`, status: "completed", detail: `${((Date.now() - started) / 1000).toFixed(1)}s` });
    } catch (error) {
      results.push({
        provider: provider.id,
        transport: "cli",
        requestedModel: provider.model,
        ok: false,
        error: error.message,
        code: error.code,
        details: error.details,
        elapsedMs: Date.now() - started
      });
      progress({ stage: `entitlement:${provider.id}`, status: "failed", detail: error.message });
    }
  }

  if (results.some((item) => !item.ok)) process.exitCode = 1;
  return { ok: results.every((item) => item.ok), versions, results };
});
