import fs from "node:fs/promises";
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("fake-codex-dev 1.0.0"); process.exit(0); }
if (args[0] === "exec" && args.includes("--help")) {
  console.log(`Usage: codex exec [OPTIONS]\n  --ephemeral\n  --json\n  --sandbox <MODE>\n  --ask-for-approval <POLICY>\n  --skip-git-repo-check\n  --model <MODEL>\n  -c <KEY=VALUE>\n  --output-schema <PATH>\n  --output-last-message <PATH>\n  --ignore-user-config\n  --ignore-rules`);
  process.exit(0);
}
const outIndex = args.indexOf("--output-last-message");
let input = "";
for await (const chunk of process.stdin) input += chunk;
let value;
if (input.includes("regression adjudicator")) {
  value = {
    verdict: "improved", addresses_feedback: true, preserves_prior_strengths: true,
    introduces_new_overclaim: false, findings: ["The candidate fixes the reported fidelity defect."],
    human_decision_reason: "", behavioral_effect: "Restores the existing contract.",
    worst_plausible_failure: "A hidden regression could remain.", confidence: "high"
  };
} else {
  value = {
    verdict: "approve", policy_change: "restorative", promotion_safe: true,
    safety_guard_weakening: false, test_weakening: false, findings: ["Narrow regression-backed repair."],
    required_changes: [], human_decision_reason: "", behavioral_effect: "Restores the intended response contract.",
    worst_plausible_failure: "An unrelated response class could regress.", confidence: "high"
  };
}
await fs.writeFile(args[outIndex + 1], `${JSON.stringify(value)}\n`);
console.log(JSON.stringify({ type: "thread.started", thread_id: "fake-dev-review" }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }));
