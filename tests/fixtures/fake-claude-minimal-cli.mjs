const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("fake-claude-minimal 1.0.0"); process.exit(0); }
if (args.includes("--help")) {
  console.log(`Usage: claude [OPTIONS]\n  -p, --print\n  --output-format <FORMAT>\n  --json-schema <SCHEMA>\n  --system-prompt <TEXT>`);
  process.exit(0);
}
const valueFlags = new Set(["--output-format", "--json-schema", "--system-prompt"]);
const allowed = new Set(["-p", ...valueFlags]);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (!allowed.has(arg)) {
    console.error(`unsupported optional flag leaked: ${arg}`);
    process.exit(5);
  }
  if (valueFlags.has(arg)) i += 1;
}
let input = "";
for await (const chunk of process.stdin) input += chunk;
if (!input.trim()) process.exit(4);
console.log(JSON.stringify({ session_id: "minimal-claude-session", structured_output: { ok: true } }));
