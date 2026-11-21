const args = process.argv.slice(2);
// Test controls, given in the base arguments so that they reach both the help check and the call. --fake-help-lacks=<flag> leaves that
// flag out of --help (and out of what --fake-require-sealed demands). --fake-args-file=<path> records the arguments: a sealed call's
// environment is allowlisted, so FAKE_CLAUDE_ARGS_FILE does not reach it.
const option = (name) => args.filter((arg) => arg.startsWith(`${name}=`)).map((arg) => arg.slice(name.length + 1));
const lacking = option("--fake-help-lacks");
if (args.includes("--version")) {
  console.log("fake-claude 1.0.0");
  process.exit(0);
}
if (args.includes("--help")) {
  console.log(`Usage: claude [OPTIONS]
  -p, --print
  --model <MODEL>
  --effort <LEVEL>
  --output-format <FORMAT>
  --json-schema <SCHEMA>
  --tools <TOOLS>
  --max-turns <N>
  --no-session-persistence
  --permission-mode <MODE>
  --no-chrome
  --system-prompt-file <PATH>
  --safe-mode
  --strict-mcp-config`.split("\n").filter((line) => !lacking.includes(line.trim().split(" ")[0])).join("\n"));
  process.exit(0);
}
for (const required of ["-p", "--output-format", "--json-schema", "--system-prompt-file"]) {
  if (!args.includes(required)) {
    console.error(`missing required flag: ${required}`);
    process.exit(3);
  }
}
if (args.includes("--fake-require-sealed")) {
  for (const required of ["--tools", "--max-turns", "--no-session-persistence", "--permission-mode", "--no-chrome", "--safe-mode", "--strict-mcp-config"].filter((flag) => !lacking.includes(flag))) {
    if (!args.includes(required)) {
      console.error(`missing sealed inference flag: ${required}`);
      process.exit(6);
    }
  }
}
const argsFile = option("--fake-args-file")[0] ?? process.env.FAKE_CLAUDE_ARGS_FILE;
if (argsFile) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(argsFile, JSON.stringify(args));
}
let input = "";
for await (const chunk of process.stdin) input += chunk;
if (!input.trim()) {
  console.error("user prompt was not passed through stdin");
  process.exit(4);
}
console.log(JSON.stringify({
  session_id: "fake-claude-session",
  structured_output: { ok: true },
  usage: { input_tokens: 1, output_tokens: 1 },
  modelUsage: { "fake-fable": { inputTokens: 1, outputTokens: 1 } }
}));
