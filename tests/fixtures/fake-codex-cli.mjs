import fs from "node:fs/promises";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("fake-codex 1.0.0");
  process.exit(0);
}
if (args[0] === "exec" && args.includes("--help")) {
  console.log(`Usage: codex exec [OPTIONS]
  --ephemeral
  --json
  --sandbox <MODE>
  --ask-for-approval <POLICY>
  --skip-git-repo-check
  --model <MODEL>
  -c <KEY=VALUE>
  --output-schema <PATH>
  --output-last-message <PATH>
  --ignore-user-config
  --ignore-rules`);
  process.exit(0);
}
for (const required of ["exec", "--output-schema", "--output-last-message"]) {
  if (!args.includes(required)) {
    console.error(`missing required flag: ${required}`);
    process.exit(3);
  }
}
const outputIndex = args.indexOf("--output-last-message");
if (outputIndex < 0 || !args[outputIndex + 1]) {
  console.error("missing output path");
  process.exit(2);
}
let input = "";
for await (const chunk of process.stdin) input += chunk;
if (!input.includes("SYSTEM INSTRUCTIONS") || !input.includes("USER MESSAGE AND CONTEXT")) {
  console.error("combined prompt was not passed through stdin");
  process.exit(4);
}
await fs.writeFile(args[outputIndex + 1], '{"ok":true}\n');
console.log(JSON.stringify({ type: "thread.started", thread_id: "fake-codex-thread" }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }));
