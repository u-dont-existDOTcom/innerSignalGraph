import fs from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("fake-claude-coding 1.0.0"); process.exit(0); }
if (args.includes("--help")) {
  console.log(`Usage: claude [OPTIONS]\n  -p, --print\n  --model <MODEL>\n  --effort <LEVEL>\n  --output-format <FORMAT>\n  --json-schema <SCHEMA>\n  --tools <TOOLS>\n  --max-turns <N>\n  --no-session-persistence\n  --permission-mode <MODE>\n  --no-chrome\n  --system-prompt-file <PATH>\n  --strict-mcp-config`);
  process.exit(0);
}
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
if (!stdin.includes("Repair cycle")) { console.error("missing repair task"); process.exit(4); }
await fs.mkdir(path.join(process.cwd(), "src"), { recursive: true });
await fs.writeFile(path.join(process.cwd(), "src", "autonomous-repair-marker.txt"), "repaired\n");
console.log(JSON.stringify({
  session_id: "fake-dev-session",
  structured_output: {
    status: "implemented",
    summary: "Added isolated fake repair marker.",
    regression_added: true,
    changed_files: ["src/autonomous-repair-marker.txt"],
    tests_run: ["npm test"],
    policy_change_claim: "none",
    blocker: ""
  }
}));
