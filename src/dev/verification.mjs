import { runSubprocess } from "../core/subprocess.mjs";

export async function runDeterministicDevelopmentGates(candidateRoot, {
  runner = runSubprocess,
  env = process.env,
  labelPrefix = "development"
} = {}) {
  const gates = [];
  for (const [id, command, args, timeoutMs] of [
    ["tests", "npm", ["test"], 900000],
    ["graph-regressions", "npm", ["run", "graph:test"], 300000],
    ["package-verify", "npm", ["run", "verify"], 1200000]
  ]) {
    const startedAt = new Date().toISOString();
    const gateEnv = id === "package-verify"
      ? { ...env, INNER_SIGNAL_MODE: "mock", LEDGER_MODE: "off", AUTOPILOT_LAUNCH_APP: "false", DEV_AUTOMATION_ENABLED: "false" }
      : env;
    const run = await runner({ command, args, cwd: candidateRoot, env: gateEnv, timeoutMs, label: `${labelPrefix} ${id}` });
    const entry = {
      id,
      ok: run.code === 0,
      code: run.code,
      startedAt,
      completedAt: new Date().toISOString(),
      stdoutTail: String(run.stdout || "").slice(-12000),
      stderrTail: String(run.stderr || "").slice(-12000)
    };
    gates.push(entry);
    if (!entry.ok) break;
  }
  return { ok: gates.every((item) => item.ok), gates };
}
