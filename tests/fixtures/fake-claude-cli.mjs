const args = process.argv.slice(2);
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
  --strict-mcp-config`);
  process.exit(0);
}
for (const required of ["-p", "--output-format", "--json-schema", "--system-prompt-file"]) {
  if (!args.includes(required)) {
    console.error(`missing required flag: ${required}`);
    process.exit(3);
  }
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
