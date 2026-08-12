import fs from "node:fs/promises";
import path from "node:path";

export async function createRunState(root, { prefix = "autopilot" } = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const runDir = path.join(root, `run-${stamp}`);
  await fs.mkdir(runDir, { recursive: true });
  return { stamp, runDir };
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeFinalStatus(stateRoot, status) {
  await fs.mkdir(stateRoot, { recursive: true });
  const latest = path.join(stateRoot, "latest.json");
  await writeJson(latest, status);
  const lines = [
    `# Inner Signal Autopilot`,
    "",
    `**Status:** ${status.status}`,
    `**Stage:** ${status.stage}`,
    "",
    status.summary || ""
  ];
  if (status.nextAction) lines.push("", "## Action", "", status.nextAction);
  const failure = status.details?.failure;
  if (failure) {
    lines.push(
      "",
      "## Failure",
      "",
      `- Class: ${failure.classification ?? "UNKNOWN"}`,
      `- Stage: ${failure.stage ?? status.stage ?? "unknown"}`,
      `- Provider/model: ${failure.provider ?? "unknown"}/${failure.model ?? "unknown"}`,
      `- Cause: ${failure.message ?? "No normalized cause was recorded."}`,
      `- Retryable: ${failure.retryable === true ? "yes" : "no"}`
    );
  }
  if (status.doNotDo?.length) {
    lines.push("", "## Do not", "", ...status.doNotDo.map((item) => `- ${item}`));
  }
  lines.push("", `Run directory: \`${status.runDir}\``);
  await fs.writeFile(path.join(stateRoot, status.status === "PASS" ? "LAST-PASS.md" : "ACTION-REQUIRED.md"), `${lines.join("\n")}\n`);
  return latest;
}
