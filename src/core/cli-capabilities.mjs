import { runSubprocess } from "./subprocess.mjs";

// Escapes every regular-expression special character, brackets included. (The earlier pattern's character class closed at its
// first "]", so in practice it escaped nothing; that matters once a flag is looked up in its bracketed form below.)
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasFlag(helpText, flag) {
  return new RegExp(`(^|\\s)${escapeRegExp(flag)}(?:[=\\s,]|$)`, "m").test(helpText);
}

async function help(command, args, label) {
  const run = await runSubprocess({ command, args, timeoutMs: 30000, label });
  return `${run.stdout}\n${run.stderr}`;
}

export async function detectCodexCapabilities(command, baseArgs = []) {
  const text = await help(command, [...baseArgs, "exec", "--help"], "Codex CLI help check");
  return {
    helpText: text,
    flags: {
      ephemeral: hasFlag(text, "--ephemeral"),
      json: hasFlag(text, "--json"),
      sandbox: hasFlag(text, "--sandbox"),
      approval: hasFlag(text, "--ask-for-approval"),
      skipGit: hasFlag(text, "--skip-git-repo-check"),
      model: hasFlag(text, "--model"),
      config: hasFlag(text, "-c") || hasFlag(text, "--config"),
      outputSchema: hasFlag(text, "--output-schema"),
      outputLastMessage: hasFlag(text, "--output-last-message"),
      ignoreUserConfig: hasFlag(text, "--ignore-user-config"),
      ignoreRules: hasFlag(text, "--ignore-rules")
    }
  };
}

export async function detectClaudeCapabilities(command, baseArgs = []) {
  const text = await help(command, [...baseArgs, "--help"], "Claude CLI help check");
  // Claude Code 2.1.323 and 2.1.330 give --system-prompt-file no option line of its own: the help names it only inside the --bare
  // option's text, as "--system-prompt[-file]", the CLI's short form for both --system-prompt and --system-prompt-file. The flag
  // itself works, so that form counts for both. (--append-system-prompt[-file] is another flag and doesn't count.)
  const systemPromptBothForms = hasFlag(text, "--system-prompt[-file]");
  return {
    helpText: text,
    flags: {
      print: hasFlag(text, "-p") || hasFlag(text, "--print"),
      model: hasFlag(text, "--model"),
      effort: hasFlag(text, "--effort"),
      outputFormat: hasFlag(text, "--output-format"),
      jsonSchema: hasFlag(text, "--json-schema"),
      tools: hasFlag(text, "--tools"),
      maxTurns: hasFlag(text, "--max-turns"),
      noSessionPersistence: hasFlag(text, "--no-session-persistence"),
      permissionMode: hasFlag(text, "--permission-mode"),
      noChrome: hasFlag(text, "--no-chrome"),
      systemPromptFile: hasFlag(text, "--system-prompt-file") || systemPromptBothForms,
      systemPrompt: hasFlag(text, "--system-prompt") || systemPromptBothForms,
      safeMode: hasFlag(text, "--safe-mode"),
      strictMcpConfig: hasFlag(text, "--strict-mcp-config")
    }
  };
}
