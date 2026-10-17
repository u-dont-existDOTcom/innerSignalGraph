import fs from "node:fs/promises";

// Test switches, not Codex flags: --fake-tool-item makes the agent run a command before answering; --fake-no-receipt
// writes the answer but prints no completed turn or agent message, as a changed event format would; --fake-broken-event
// prints a truncated action event among otherwise whole ones.
const fakeToolItem = process.argv.includes("--fake-tool-item");
const fakeNoReceipt = process.argv.includes("--fake-no-receipt");
const fakeBrokenEvent = process.argv.includes("--fake-broken-event");
const switches = new Set(["--fake-tool-item", "--fake-no-receipt", "--fake-broken-event"]);
const args = process.argv.slice(2).filter((arg) => !switches.has(arg));
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
if (process.env.FAKE_CODEX_ARGS_FILE) await fs.writeFile(process.env.FAKE_CODEX_ARGS_FILE, JSON.stringify(args));
let input = "";
for await (const chunk of process.stdin) input += chunk;
if (!input.includes("SYSTEM INSTRUCTIONS") || !input.includes("USER MESSAGE AND CONTEXT")) {
  console.error("combined prompt was not passed through stdin");
  process.exit(4);
}
await fs.writeFile(args[outputIndex + 1], '{"ok":true}\n');
console.log(JSON.stringify({ type: "thread.started", thread_id: "fake-codex-thread" }));
console.log(JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "reasoning", text: "synthetic" } }));
if (fakeToolItem) {
  // An agent that ran a command before answering: started and completed, one action.
  console.log(JSON.stringify({ type: "item.started", item: { id: "item_1", type: "command_execution", command: "ls", status: "in_progress" } }));
  console.log(JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "command_execution", command: "ls", status: "completed" } }));
}
if (fakeBrokenEvent) console.log('{"type":"item.completed","item":{"id":"item_1","type":"command_execution","comm');
if (!fakeNoReceipt) {
  console.log(JSON.stringify({ type: "item.completed", item: { id: "item_2", type: "agent_message", text: "{\"ok\":true}" } }));
  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }));
}
