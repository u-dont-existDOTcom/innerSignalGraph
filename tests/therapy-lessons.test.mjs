import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { verifyTherapyLessons } from "../scripts/verify-therapy-lessons.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packetId = "fixture-guides-r02-candidate";
const createdAt = "2026-08-12T02:45:00.000Z";
const decisions = Array.from({ length: 5 }, (_, index) => ({
  id: `decision-${index + 1}`,
  classification: "substantive",
  requiresHumanDecision: true,
  status: "pending"
}));

function metadata(entry) {
  return `<!-- therapy-lesson ${JSON.stringify(entry)} -->`;
}

function validEntries() {
  return [
    { lessonId: "active-one", learnedAt: createdAt, activation: "active-runtime" },
    ...decisions.map((decision) => ({
      lessonId: `candidate-${decision.id}`,
      decisionId: decision.id,
      packetId,
      learnedAt: createdAt,
      activation: "candidate-awaiting-owner"
    }))
  ];
}

async function fixture(t, { entries = validEntries(), raw = null } = {}) {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-therapy-lessons-"));
  t.after(() => fs.rm(fixtureRoot, { recursive: true, force: true }));
  const packetRoot = path.join(fixtureRoot, "guide-packets", "fixtures", "r02-candidate", "packet");
  await fs.mkdir(path.join(packetRoot, "audit"), { recursive: true });
  await fs.writeFile(path.join(packetRoot, "manifest.json"), `${JSON.stringify({
    status: "candidate",
    packetRevision: 2,
    packetId,
    createdAt,
    paths: { ownerDecisions: "audit/owner-decisions.json" }
  }, null, 2)}\n`);
  await fs.writeFile(path.join(packetRoot, "audit", "owner-decisions.json"), `${JSON.stringify({ cards: decisions }, null, 2)}\n`);
  await fs.writeFile(path.join(fixtureRoot, "THERAPY-LESSONS"), raw ?? `${entries.map(metadata).join("\n")}\n`);
  return fixtureRoot;
}

test("therapy lesson log covers every substantive decision in the latest uploaded guide candidate", async () => {
  const result = await execFileAsync(process.execPath, ["scripts/verify-therapy-lessons.mjs"], {
    cwd: root
  }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error) => ({ code: error?.code ?? 1, stdout: error?.stdout ?? "", stderr: error?.stderr ?? error?.message ?? "" })
  );
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^PASS 5\/5 substantive therapy prompt lessons tracked for /);
});

test("therapy lesson identity is scoped by packet as the cumulative log gains a new revision", async (t) => {
  const entries = validEntries();
  entries.push({
    lessonId: "older-packet-decision-one",
    decisionId: "decision-1",
    packetId: "fixture-guides-r01-candidate",
    learnedAt: createdAt,
    activation: "candidate-awaiting-owner"
  });
  const result = await verifyTherapyLessons({ rootDir: await fixture(t, { entries }) });
  assert.equal(result.tracked, 5);
});

test("therapy lesson validation rejects a missing substantive decision", async (t) => {
  const rootDir = await fixture(t, { entries: validEntries().filter((entry) => entry.decisionId !== "decision-2") });
  await assert.rejects(verifyTherapyLessons({ rootDir }), /decision-2; found 0/);
});

test("therapy lesson validation rejects a duplicate substantive decision", async (t) => {
  const entries = validEntries();
  entries.push({ ...entries[1], lessonId: "duplicate-decision-one" });
  await assert.rejects(verifyTherapyLessons({ rootDir: await fixture(t, { entries }) }), /decision-1; found 2/);
});

test("therapy lesson validation rejects malformed metadata", async (t) => {
  await assert.rejects(verifyTherapyLessons({
    rootDir: await fixture(t, { raw: '<!-- therapy-lesson {"lessonId":} -->\n' })
  }), /Malformed therapy lesson metadata/);
});

test("therapy lesson validation rejects a wrong packet identity", async (t) => {
  const entries = validEntries();
  entries[1] = { ...entries[1], packetId: "wrong-packet" };
  await assert.rejects(verifyTherapyLessons({ rootDir: await fixture(t, { entries }) }), /decision-1 names the wrong Guide Packet/);
});

test("therapy lesson validation rejects a pending decision marked active", async (t) => {
  const entries = validEntries();
  entries[1] = { ...entries[1], activation: "active-runtime" };
  await assert.rejects(verifyTherapyLessons({ rootDir: await fixture(t, { entries }) }), /decision-1 is falsely marked active-runtime/);
});
