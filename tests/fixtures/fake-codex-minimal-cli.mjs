import fs from "node:fs/promises";
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("fake-codex-minimal 1.0.0"); process.exit(0); }
if (args[0] === "exec" && args.includes("--help")) {
  console.log(`Usage: codex exec [OPTIONS]\n  --output-schema <PATH>\n  --output-last-message <PATH>`);
  process.exit(0);
}
const allowed = new Set(["exec", "--output-schema", "--output-last-message", "-"]);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (!allowed.has(arg)) {
    console.error(`unsupported optional flag leaked: ${arg}`);
    process.exit(5);
  }
  if (arg === "--output-schema" || arg === "--output-last-message") i += 1;
}
const outputIndex = args.indexOf("--output-last-message");
if (outputIndex < 0 || !args[outputIndex + 1]) process.exit(2);
let input = "";
for await (const chunk of process.stdin) input += chunk;
if (!input.includes("SYSTEM INSTRUCTIONS")) process.exit(4);
await fs.writeFile(args[outputIndex + 1], '{"ok":true}\n');
