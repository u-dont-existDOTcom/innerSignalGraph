import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { recordSupervisorAnalysis } from "../src/dev/supervisor-state.mjs";
import { updateGuidePacketProcessingStatus } from "../src/guide-packet/store.mjs";

test("Guide Packet foreground status never appends an unrelated development-supervisor repair directive", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-status-domain-"));
  const config = loadConfig({
    mode: "mock",
    ledgerMode: "off",
    autopilotStateDir: root,
    guidePacketRoot: path.join(root, "guide-packets"),
    devJobRoot: path.join(root, "development-jobs")
  });
  await recordSupervisorAnalysis(config, {
    analysis: {
      action: "AUTO_REPAIR",
      target_task_id: "DEV-OLD",
      trajectory: "old-development-blocker",
      failure_class: "IMPLEMENTATION_FAILURE",
      root_issue: "Old development roadmap failure.",
      repair_directive: "Autonomous roadmap implementation budget exhausted by an unrelated old task.",
      evidence_refs: ["roadmap:DEV-OLD"],
      human_decision_required: false,
      human_decision_reason: "",
      worst_plausible_failure: "Old repair loops.",
      confidence: "high"
    }
  });
  await updateGuidePacketProcessingStatus(config, {
    active: false,
    lifecycle: "blocked",
    overall: "BLOCKED_AUTO_RECOVERY",
    stageId: "opus-compilation-blocked",
    packetId: "inner-signal-guides-2026.08.12-r02-candidate",
    model: "claude-opus-5",
    blocker: "Canonical source compilation needs restorative packet repair.",
    failureClass: "VERIFICATION_FAILURE",
    recoveryAction: "resume-r02-from-staged-candidate",
    expectedNextStage: "opus-source-role-compilation",
    nextAutomaticAction: "AUTO_REPAIR",
    humanActionRequired: false
  });

  const providers = createProviders(config);
  const server = createInnerSignalServer({ config, providers });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/dev/status`);
    const status = await response.json();
    assert.equal(response.status, 200);
    assert.equal(status.supervisor.current.taskId, "GUIDE_PACKET");
    assert.equal(status.supervisor.statusDomain, "guide-packet");
    assert.match(status.supervisor.nextAutomaticLabel, /AUTO_REPAIR/i);
    assert.match(status.supervisor.nextAutomaticLabel, /resume-r02-from-staged-candidate/i);
    assert.doesNotMatch(status.supervisor.nextAutomaticLabel, /roadmap implementation budget exhausted/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
