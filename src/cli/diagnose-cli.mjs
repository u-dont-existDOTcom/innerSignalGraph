import { loadConfig } from "../core/config.mjs";
import { runSubprocess } from "../core/subprocess.mjs";
import { detectCodexCapabilities, detectClaudeCapabilities } from "../core/cli-capabilities.mjs";
import { runCliMain } from "../core/cli-main.mjs";

async function version(command, label) {
  const run = await runSubprocess({ command, args: ["--version"], timeoutMs: 30000, label });
  return { code: run.code, text: (run.stdout || run.stderr).trim() };
}

await runCliMain(async () => {
  const config = loadConfig({ mode: "cli", ledgerMode: "off" });
  const [codexVersion, claudeVersion, codexCaps, claudeCaps] = await Promise.all([
    version(config.codexCommand, "Codex CLI version check"),
    version(config.claudeCommand, "Claude CLI version check"),
    detectCodexCapabilities(config.codexCommand),
    detectClaudeCapabilities(config.claudeCommand)
  ]);
  const requiredCapabilities = {
    codex: codexCaps.flags.outputSchema && codexCaps.flags.outputLastMessage,
    claude: claudeCaps.flags.print && claudeCaps.flags.outputFormat && claudeCaps.flags.jsonSchema
  };
  return {
    ok: codexVersion.code === 0 && claudeVersion.code === 0 && requiredCapabilities.codex && requiredCapabilities.claude,
    configuredModels: { openai: config.openaiModel || "CLI default", anthropic: config.anthropicModel || "CLI default" },
    versions: { codex: codexVersion, claude: claudeVersion },
    requiredCapabilities,
    capabilities: { codex: codexCaps.flags, claude: claudeCaps.flags }
  };
});
