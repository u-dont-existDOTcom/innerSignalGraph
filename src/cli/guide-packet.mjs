#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, projectRoot } from "../core/config.mjs";
import { buildGuidePacket } from "../guide-packet/builder.mjs";
import { ensureBundledGuidePacketCandidate, DEFAULT_BUNDLED_GUIDE_PACKET } from "../guide-packet/autopilot.mjs";
import { readGuidePacketStatus, stageGuidePacket } from "../guide-packet/store.mjs";
import { verifyGuidePacket } from "../guide-packet/verifier.mjs";

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function serializableVerification(result) {
  return {
    ok: result.ok,
    errors: result.errors,
    warnings: result.warnings,
    installable: result.installable,
    monotonic: result.monotonic,
    approved: result.approved,
    packetSha256: result.packetSha256,
    manifest: result.manifest,
    qualityAudit: result.qualityAudit,
    regressionStatus: result.regressionStatus,
    behavioralDiff: result.behavioralDiff,
    decisionCards: result.decisionCards,
    affectedCases: result.behavioralDiff?.affectedCases ?? []
  };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (!command || ["help", "--help", "-h"].includes(command)) {
    process.stdout.write([
      "Usage: node src/cli/guide-packet.mjs <command>",
      "  build-fixture [--output DIR]",
      "  build-r02-fixture [--output DIR]",
      "  verify ZIP",
      "  stage ZIP",
      "  stage-fixture [--no-review]",
      "  status"
    ].join("\n") + "\n");
    return;
  }

  if (command === "build-fixture") {
    const outputDir = path.resolve(option(args, "--output", path.join(projectRoot, "guide-packets/fixtures/r01-candidate")));
    const built = await buildGuidePacket({
      runtimeRoot: projectRoot,
      somaticHtmlPath: path.join(projectRoot, "guide-packets/source-input/somatic-guide-r01-candidate.html"),
      innerChildHtmlPath: path.join(projectRoot, "guide-packets/source-input/inner-child-guide-r01-candidate.html"),
      outputDir,
      packetVersion: "2026.08.11-r01-candidate",
      packetRevision: 1,
      status: "candidate",
      createdAt: "2026-08-11T19:30:00.000Z"
    });
    process.stdout.write(JSON.stringify({ ok: true, zipPath: built.zipPath, packetSha256: built.packetSha256, manifest: built.manifest }, null, 2) + "\n");
    return;
  }

  if (command === "build-r02-fixture") {
    const outputDir = path.resolve(option(args, "--output", path.join(projectRoot, "guide-packets/fixtures/r02-candidate")));
    const built = await buildGuidePacket({
      runtimeRoot: projectRoot,
      somaticHtmlPath: path.join(projectRoot, "guide-packets/source-input/somatic-guide-r01-candidate.html"),
      innerChildHtmlPath: path.join(projectRoot, "guide-packets/source-input/inner-child-guide-r01-candidate.html"),
      vagalSourcePath: path.join(projectRoot, "guides/vagal-blitz-source.pdf"),
      vagalSafetyTextPath: path.join(projectRoot, "guide-packets/source-input/vagal-blitz-safety-p5.txt"),
      outputDir,
      packetVersion: "2026.08.12-r02-candidate",
      packetRevision: 2,
      status: "candidate",
      createdAt: "2026-08-12T02:45:00.000Z"
    });
    process.stdout.write(JSON.stringify({ ok: true, zipPath: built.zipPath, packetSha256: built.packetSha256, manifest: built.manifest }, null, 2) + "\n");
    return;
  }

  if (command === "verify") {
    const zipPath = args[0];
    if (!zipPath) throw new Error("verify requires a packet ZIP path.");
    const buffer = await fs.readFile(path.resolve(zipPath));
    const result = verifyGuidePacket(buffer);
    process.stdout.write(JSON.stringify(serializableVerification(result), null, 2) + "\n");
    if (!result.ok) process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  if (command === "status") {
    process.stdout.write(JSON.stringify(await readGuidePacketStatus(config), null, 2) + "\n");
    return;
  }
  if (command === "stage") {
    const zipPath = args[0];
    if (!zipPath) throw new Error("stage requires a packet ZIP path.");
    const candidate = await stageGuidePacket(config, await fs.readFile(path.resolve(zipPath)));
    process.stdout.write(JSON.stringify({ staged: true, reviewed: false, candidate }, null, 2) + "\n");
    return;
  }
  if (command === "stage-fixture") {
    const result = await ensureBundledGuidePacketCandidate({ config, fixturePath: DEFAULT_BUNDLED_GUIDE_PACKET, reviewer: null });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  throw new Error(`Unknown guide packet command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
