import fs from "node:fs/promises";

export async function readEnvFile(file) {
  let text = "";
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return { text, values };
}

export async function setEnvValues(file, updates) {
  const { text } = await readEnvFile(file);
  const lines = text ? text.split(/\r?\n/) : [];
  const pending = new Map(Object.entries(updates));
  const next = lines.map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line.trim());
    if (!match || !pending.has(match[1])) return line;
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return `${match[1]}=${value}`;
  });
  for (const [key, value] of pending) next.push(`${key}=${value}`);
  while (next.length && next.at(-1) === "") next.pop();
  await fs.writeFile(file, `${next.join("\n")}\n`, { mode: 0o600 });
}
