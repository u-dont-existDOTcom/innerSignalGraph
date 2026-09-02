import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readZipEntries } from "../core/zip.mjs";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function collectRegularFiles(root, current = root, output = new Map()) {
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isSymbolicLink()) throw new Error(`Frozen guide fixture contains a symbolic link: ${relative}`);
    if (entry.isDirectory()) {
      await collectRegularFiles(root, absolute, output);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Frozen guide fixture contains a non-regular file: ${relative}`);
    output.set(relative, await fs.readFile(absolute));
  }
  return output;
}

function assertSameEntries(archiveEntries, treeEntries, label) {
  const archiveNames = [...archiveEntries.keys()].sort();
  const treeNames = [...treeEntries.keys()].sort();
  if (JSON.stringify(archiveNames) !== JSON.stringify(treeNames)) {
    throw new Error(`${label} archive and tracked packet tree have different members.`);
  }
  for (const name of archiveNames) {
    if (!archiveEntries.get(name).equals(treeEntries.get(name))) {
      throw new Error(`${label} archive and tracked packet tree differ at ${name}.`);
    }
  }
}

function parseSidecar(text, archiveName) {
  const match = text.match(/^([a-f0-9]{64})\s+\*?([^\r\n]+)\r?\n?$/i);
  if (!match || path.basename(match[2].trim()) !== archiveName) {
    throw new Error(`Frozen guide fixture checksum sidecar is malformed for ${archiveName}.`);
  }
  return match[1].toLowerCase();
}

async function writeIfDifferent(source, destination, data) {
  if (path.resolve(source) === path.resolve(destination)) return;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, data);
}

export async function materializeFrozenGuidePacketFixture({ fixtureDir, outputDir, archiveName }) {
  const sourceRoot = path.resolve(fixtureDir);
  const targetRoot = path.resolve(outputDir);
  const sourceArchive = path.join(sourceRoot, archiveName);
  const sourceSidecar = `${sourceArchive}.sha256`;
  const packetRoot = path.join(sourceRoot, "packet");

  const [archive, sidecar, treeEntries] = await Promise.all([
    fs.readFile(sourceArchive),
    fs.readFile(sourceSidecar, "utf8"),
    collectRegularFiles(packetRoot)
  ]);
  const archiveEntries = readZipEntries(archive);
  assertSameEntries(archiveEntries, treeEntries, archiveName);

  const expectedSha256 = parseSidecar(sidecar, archiveName);
  const actualSha256 = sha256(archive);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Frozen guide fixture archive hash does not match its sidecar: ${archiveName}.`);
  }

  if (sourceRoot !== targetRoot) await fs.rm(targetRoot, { recursive: true, force: true });
  for (const [name, data] of archiveEntries) {
    await writeIfDifferent(path.join(packetRoot, name), path.join(targetRoot, "packet", name), data);
  }
  await writeIfDifferent(sourceArchive, path.join(targetRoot, archiveName), archive);
  await writeIfDifferent(sourceSidecar, path.join(targetRoot, `${archiveName}.sha256`), Buffer.from(sidecar, "utf8"));

  return {
    zipPath: path.join(targetRoot, archiveName),
    packetSha256: actualSha256,
    manifest: JSON.parse(archiveEntries.get("manifest.json").toString("utf8"))
  };
}
