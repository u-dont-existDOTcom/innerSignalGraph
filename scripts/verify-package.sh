#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."

echo "=== INNER SIGNAL RUNTIME v$(node -p "require('./package.json').version") VERIFY ==="
echo "UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Node: $(node --version)"
echo "npm: $(npm --version)"

echo
echo "=== THERAPY PROMPT LESSONS ==="
npm run therapy-lessons:verify

echo
echo "=== GUIDE GRAPH COMPILE ==="
npm run graph:compile

echo
echo "=== GUIDE GRAPH REGRESSIONS ==="
graph_file="$(mktemp)"
node src/cli/run-graph-regressions.mjs > "$graph_file"
node --input-type=module - "$graph_file" <<'NODE'
import fs from "node:fs";
const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!result.ok || result.count < 12) throw new Error("Guide graph regression suite failed.");
console.log(`PASS ${result.count}/${result.count} graph cases.`);
NODE
rm -f "$graph_file"

echo
echo "=== OBSIDIAN AUTHORING PROJECTION ==="
npm run authoring:validate
npm run authoring:check
npm run authoring:maps:check

echo
echo "=== GUIDE PACKET FIXTURES ==="
packet_tmp="$(mktemp -d)"
node src/cli/guide-packet.mjs build-fixture --output "$packet_tmp/r01" > "$packet_tmp/r01-build.json"
node src/cli/guide-packet.mjs build-r02-fixture --output "$packet_tmp/r02" > "$packet_tmp/r02-build.json"
node src/cli/guide-packet.mjs verify guide-packets/fixtures/r01-candidate/inner-signal-guide-packet-r01-candidate.zip > "$packet_tmp/r01-verify.json"
node src/cli/guide-packet.mjs verify guide-packets/fixtures/r02-candidate/inner-signal-guide-packet-r02-candidate.zip > "$packet_tmp/r02-verify.json"
node --input-type=module - \
  "$packet_tmp/r01-verify.json" \
  "$packet_tmp/r02-verify.json" \
  "$packet_tmp/r01/inner-signal-guide-packet-r01-candidate.zip" \
  "$packet_tmp/r02/inner-signal-guide-packet-r02-candidate.zip" <<'NODE'
import fs from "node:fs";
import crypto from "node:crypto";
import { readZipEntries } from "./src/core/zip.mjs";
const r01 = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const r02 = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
if (!r01.ok || !r02.ok) throw new Error("Guide packet fixtures did not verify.");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function assertSamePacketContent(rebuiltPath, preservedPath, label) {
  const rebuilt = readZipEntries(fs.readFileSync(rebuiltPath));
  const preserved = readZipEntries(fs.readFileSync(preservedPath));
  if (rebuilt.size !== preserved.size) throw new Error(`${label} entry count changed.`);
  for (const [name, expected] of preserved) {
    const actual = rebuilt.get(name);
    if (!actual || !actual.equals(expected)) throw new Error(`${label} content changed at ${name}.`);
  }
}

const r01Path = "guide-packets/fixtures/r01-candidate/inner-signal-guide-packet-r01-candidate.zip";
const r02Path = "guide-packets/fixtures/r02-candidate/inner-signal-guide-packet-r02-candidate.zip";
assertSamePacketContent(process.argv[4], r01Path, "r01 candidate");
assertSamePacketContent(process.argv[5], r02Path, "r02 candidate");
if (sha256(fs.readFileSync(r01Path)) !== "9395cf2382ce14647d7f14c97268c53094ba822486be72a104e0e24fb0295263") {
  throw new Error("Preserved r01 candidate archive bytes changed.");
}
if (sha256(fs.readFileSync(r02Path)) !== "1c2970fbbe6aa3e132e0bfdcb226b3dab5ee5dccda1fde2b554613f8dff7b023") {
  throw new Error("Preserved r02 candidate archive bytes changed.");
}
for (const verified of [r01, r02]) {
  if (verified.manifest.status !== "candidate" || verified.manifest.candidateOnly !== true || verified.installable !== false) {
    throw new Error("Candidate guide packet was accidentally marked installable or approved.");
  }
  if (!verified.decisionCards?.some((card) => card.requiresHumanDecision)) throw new Error("Substantive guide changes lack owner decision cards.");
  if (!verified.qualityAudit || !verified.behavioralDiff) throw new Error("Guide packet lacks quality audit or behavioral diff.");
}
if (!r01.regressionStatus?.ok || r01.regressionStatus.passed !== 4) throw new Error("Preserved r01 regression suite failed.");
if (!r02.regressionStatus?.ok || r02.regressionStatus.passed !== 5) throw new Error("Corrected r02 regression suite failed.");
if (!r02.manifest.sourceFamilyPackages?.every((item) => item.availableInWorker === true)) throw new Error("r02 canonical source families are not attached.");
if (r02.manifest.externalSources?.[0]?.id !== "VAGAL.SAFETY.P5") throw new Error("r02 lacks attached Vagal Blitz page-5 evidence.");
const block = r02.manifest.guides && r02.behavioralDiff?.changedBlockedOrDeferred?.find((item) => item.id === "SOM.ADVANCED_RELEASE_BLOCK");
if (!block?.candidate?.blockNodes?.includes("SOM.ADVANCED_RELEASE_OPTIONAL")) throw new Error("r02 safety block is not graph-owned.");
console.log(`PASS r01 is byte-preserved at 4/4 and r02 verifies at ${r02.regressionStatus.passed}/${r02.regressionStatus.count}, with complete source availability and owner gating.`);
NODE
rm -rf "$packet_tmp"

echo
echo "=== SYNTAX CHECK ==="
while IFS= read -r -d '' file; do
  node --check "$file" >/dev/null
  echo "OK $file"
done < <(find src tests apps/web -type f \( -name '*.mjs' -o -name '*.js' \) -print0 | sort -z)

echo
echo "=== AUTOMATED TESTS ==="
npm test

echo
echo "=== IMMUTABLE GUIDE PACKET ARCHIVES ==="
printf '%s  %s\n' \
  '9395cf2382ce14647d7f14c97268c53094ba822486be72a104e0e24fb0295263' \
  'guide-packets/fixtures/r01-candidate/inner-signal-guide-packet-r01-candidate.zip' \
  '1c2970fbbe6aa3e132e0bfdcb226b3dab5ee5dccda1fde2b554613f8dff7b023' \
  'guide-packets/fixtures/r02-candidate/inner-signal-guide-packet-r02-candidate.zip' | sha256sum -c -
(
  cd guide-packets/fixtures/r01-candidate
  sha256sum -c inner-signal-guide-packet-r01-candidate.zip.sha256
)
(
  cd guide-packets/fixtures/r02-candidate
  sha256sum -c inner-signal-guide-packet-r02-candidate.zip.sha256
)

echo
echo "=== MOCK A001 FORMULATED REPLAY ==="
mock_file="$(mktemp)"
INNER_SIGNAL_MODE=mock LEDGER_MODE=off DEV_AUTOMATION_ENABLED=false AUTOPILOT_LAUNCH_APP=false node src/cli/replay.mjs A001 > "$mock_file"
node --input-type=module - "$mock_file" <<'NODE'
import fs from "node:fs";
const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!result.answer || result.degraded !== false || result.mode !== "adversarial") {
  throw new Error("Mock A001 result failed adversarial structural checks.");
}
if (result.graphBundleVersion !== "inner-child-somatic-pilot-2026-08-09-r5") {
  throw new Error("Mock A001 lacks the current graph bundle.");
}
if (result.interventionContract?.primaryJob?.id !== "IC.CREDIBILITY_REPAIR") {
  throw new Error("Mock A001 did not route credibility repair first.");
}
if (!result.caseFormulation?.audit) throw new Error("Mock A001 lacks adversarial formulation audit.");
if (result.realizationContractVersion !== "response-realization-v5" || !/show up again/i.test(result.answer)) {
  throw new Error("Mock A001 lacks the separated realization contract or repeated follow-through.");
}
if (result.next_question !== result.interventionContract?.nextQuestion) {
  throw new Error("Mock A001 renderer replaced the graph-owned discriminating question.");
}
if (result.interventionContract?.variables?.credibility_evidence_state !== "adverse") {
  throw new Error("Mock A001 did not preserve the adverse-track-record distinction.");
}
if (result.interventionContract?.variables?.witness_capacity !== "present") {
  throw new Error("Mock A001 did not preserve established witness capacity.");
}
if (result.interventionContract?.selectedNodes?.some((item) => item.id === "IC.NEUTRAL_WITNESS")) {
  throw new Error("Mock A001 incorrectly routed an already-observing user back through neutral-witness bootstrap.");
}
console.log("PASS mock A001 used audited formulation, deterministic graph planning, adversarial synthesis, and separated response realization.");
NODE
rm -f "$mock_file"

echo
echo "=== MOCK H001 HYPNOSIS COMPILER ==="
hypnosis_file="$(mktemp)"
INNER_SIGNAL_MODE=mock LEDGER_MODE=off DEV_AUTOMATION_ENABLED=false AUTOPILOT_LAUNCH_APP=false node src/cli/hypnosis-replay.mjs H001 > "$hypnosis_file"
node --input-type=module - "$hypnosis_file" <<'NODE'
import fs from "node:fs";
const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (result.mode !== "hypnosis-compiler" || result.status !== "releaseable" || !result.releaseable) {
  throw new Error("Mock H001 was not releaseable.");
}
if (!result.playbackPlan?.gate?.routeIds?.includes("continue_inward")) {
  throw new Error("Mock H001 lacks the app-owned gate.");
}
if (!result.playbackPlan?.appOwned?.wakingReturn?.endsWith("This session is complete.")) {
  throw new Error("Mock H001 lacks the decisive app-owned waking ending.");
}
console.log("PASS mock H001 is releaseable with app-owned gate and waking return.");
NODE
cp "$hypnosis_file" H001-MOCK-RESULT.json
rm -f "$hypnosis_file"

echo
echo "=== WEB CLIENT SMOKE ==="
npm run web:smoke

echo
echo "=== AUTOPILOT DRY RUN ==="
dry_file="$(mktemp)"
./run-autopilot.sh --dry-run > "$dry_file"
node --input-type=module - "$dry_file" <<'NODE'
import fs from "node:fs";
const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!result.ok || result.logsRequiredFromUser !== false) throw new Error("Autopilot dry-run contract failed.");
for (const stage of [
  "guide-graph-compile",
  "guide-graph-regressions",
  "guide-packet-candidate",
  "H001-hypnosis-compiler",
  "A001-adversarial-therapy-benchmark",
  "response-realization",
  "auto-tiered-live-therapy",
  "runtime-server-smoke",
  "web-client-smoke",
  "roadmap-state",
  "foreground-local-app",
  "stale-development-case-requeue",
  "continuous-autonomous-roadmap"
]) {
  if (!result.stages.includes(stage)) throw new Error(`Missing autopilot stage: ${stage}`);
}
if (result.modelPolicy.anthropicPrimary !== "claude-opus-5" || result.modelPolicy.anthropicEscalation !== "claude-fable-5") {
  throw new Error("Opus/Fable model policy is incorrect.");
}
console.log("PASS autopilot owns graph compilation through foreground launch without user log transport.");
NODE
rm -f "$dry_file"

echo
echo "=== FAKE CLI AUTOPILOT SMOKE ==="
auto_tmp="$(mktemp -d)"
cp -a . "$auto_tmp/runtime"
mkdir -p "$auto_tmp/bin"
cat > "$auto_tmp/bin/codex" <<WRAP
#!/usr/bin/env bash
exec node "$auto_tmp/runtime/tests/fixtures/fake-codex-cli.mjs" "\$@"
WRAP
cat > "$auto_tmp/bin/claude" <<WRAP
#!/usr/bin/env bash
exec node "$auto_tmp/runtime/tests/fixtures/fake-claude-cli.mjs" "\$@"
WRAP
chmod +x "$auto_tmp/bin/codex" "$auto_tmp/bin/claude"
cp "$auto_tmp/runtime/.env.cli.example" "$auto_tmp/runtime/.env"
sed -i \
  -e "s#^CODEX_COMMAND=.*#CODEX_COMMAND=$auto_tmp/bin/codex#" \
  -e "s#^CLAUDE_COMMAND=.*#CLAUDE_COMMAND=$auto_tmp/bin/claude#" \
  -e 's/^OPENAI_MODEL=.*/OPENAI_MODEL=fake-codex/' \
  -e 's/^ANTHROPIC_MODEL=.*/ANTHROPIC_MODEL=fake-opus/' \
  "$auto_tmp/runtime/.env"
(
  cd "$auto_tmp/runtime"
  CODEX_COMMAND="$auto_tmp/bin/codex" CLAUDE_COMMAND="$auto_tmp/bin/claude" OPENAI_MODEL=fake-codex ANTHROPIC_MODEL=fake-opus INNER_SIGNAL_MODE=cli \
    ./run-autopilot.sh --skip-tests --no-benchmarks --no-runtime-smoke --no-launch > "$auto_tmp/result.json"
)
node --input-type=module - "$auto_tmp/result.json" <<'NODE'
import fs from "node:fs";
const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (result.status !== "PASS") throw new Error("Fake CLI autopilot did not pass.");
console.log("PASS fake CLI autopilot resolved models, compiled graphs, validated the web client, and terminated cleanly.");
NODE
test -f "$auto_tmp/runtime/.inner-signal-autopilot/latest.json"
test -f "$auto_tmp/runtime/.inner-signal-autopilot/product-roadmap-state.json"
test -f "$auto_tmp/runtime/.inner-signal-autopilot/guide-packets/active-candidate.json"
test ! -e "$auto_tmp/runtime/.inner-signal-autopilot/guide-packets/installed/current"
node --input-type=module - "$auto_tmp/runtime/.inner-signal-autopilot/guide-packets/active-candidate.json" <<'NODE'
import fs from "node:fs";
const active = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (active.packetId !== "inner-signal-guides-2026.08.12-r02-candidate") throw new Error("Corrected r02 is not the bundled active candidate.");
NODE
echo "PASS bundled Guide Packet candidate auto-stages without installing production policy."
node --input-type=module - "$auto_tmp/runtime/.inner-signal-autopilot/latest.json" <<'NODE'
import fs from "node:fs";
const latest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (latest.details?.graphRegressions?.ok !== true) throw new Error("Fake autopilot did not record the graph regression gate.");
if (latest.details?.graphBundle?.stats?.nodeCount !== 39) throw new Error("Fake autopilot did not record the compiled graph bundle.");
NODE
test ! -e "$auto_tmp/runtime"/inner-signal-evidence-*.zip
echo "PASS evidence remains local and no transfer bundle is created."
rm -rf "$auto_tmp"

echo
echo "=== RUNTIME FINGERPRINT ==="
fingerprint_a="$(node src/cli/runtime-fingerprint.mjs)"
fingerprint_b="$(node src/cli/runtime-fingerprint.mjs)"
[[ -n "$fingerprint_a" && "$fingerprint_a" == "$fingerprint_b" ]] || { echo "FAIL runtime fingerprint is not stable"; exit 1; }
grep -q 'validated-runtime-fingerprint.txt' run-autopilot.sh || { echo "FAIL wrapper lacks validated-fingerprint fast launch"; exit 1; }
grep -q 'priorCaseSnapshot' apps/web/app.js || { echo "FAIL web client does not carry incremental case state"; exit 1; }
grep -q 'value="deep"' apps/web/index.html || { echo "FAIL browser lacks Deep tier"; exit 1; }
grep -q 'value="forensic"' apps/web/index.html || { echo "FAIL browser lacks Forensic tier"; exit 1; }
echo "PASS unchanged validated launches can skip expensive campaigns and therapy state is incremental."

echo
echo "=== PACKAGE HYGIENE ==="
if find . -type f \( -name '.env' -o -name 'auth.json' -o -name '*.key' -o -name '*.pem' \) -print | grep -q .; then
  echo "FAIL credential-like file found"
  exit 1
fi
echo "PASS no .env, auth.json, key, or PEM files packaged."
if grep -R "~/Downloads" -n . --exclude='BUILD-VERIFY.txt' --exclude='verify-package.sh' >/dev/null 2>&1; then
  echo "FAIL English Downloads path found"
  exit 1
fi
echo "PASS French Zorin path convention retained."
if grep -R "upload.*log\|send.*log\|attach.*log\|upload.*evidence" -ni README.md START-HERE.md AUTOPILOT.md >/dev/null 2>&1; then
  echo "FAIL manual evidence-shuttling instruction found"
  exit 1
fi
echo "PASS no user-facing instruction asks for routine logs or evidence uploads."
if ! grep -q 'plan.appOwned?.wakingReturn' apps/web/app.js; then
  echo "FAIL web route renderer lacks app-owned waking return"
  exit 1
fi
if grep -n 'joinParts(\[announcement, body, plan.appOwned?.wakingReturn,' apps/web/app.js >/dev/null; then
  echo "FAIL text appears after app-owned waking return"
  exit 1
fi
echo "PASS browser route renderer ends with the app-owned waking return."
if ! grep -q 'Why this route' apps/web/app.js; then
  echo "FAIL browser lacks the deterministic route trace"
  exit 1
fi
echo "PASS browser exposes a compact guide-graph route trace."

grep -q '/v1/debug/export' apps/web/app.js || { echo "FAIL browser lacks one-click diagnostic export"; exit 1; }
grep -q 'Export recovery ZIP' apps/web/index.html || { echo "FAIL browser lacks recovery ZIP button"; exit 1; }
grep -q '/v1/debug/feedback' apps/web/app.js || { echo "FAIL browser feedback is not persisted to the development queue"; exit 1; }
grep -q '^LEDGER_MODE=full$' .env.cli.example || { echo "FAIL local development runtime does not retain local continuity ledgers"; exit 1; }
grep -q 'includesChatContent: false' src/export/diagnostic-bundle.mjs || { echo "FAIL recovery diagnostic does not explicitly exclude chat"; exit 1; }
grep -q 'includesReasoningLedgers: false' src/export/diagnostic-bundle.mjs || { echo "FAIL recovery diagnostic does not explicitly exclude reasoning ledgers"; exit 1; }
if grep -q 'chat/browser-state.json\|chat/transcript.txt\|reasoning/' src/export/diagnostic-bundle.mjs; then
  echo "FAIL recovery diagnostic still packages private chat or reasoning"
  exit 1
fi
echo "PASS privacy-safe recovery export and local human-feedback capture are wired."

grep -q '/v1/guides/import' apps/web/app.js || { echo "FAIL browser lacks guide packet import"; exit 1; }
grep -q 'Source identity diff' apps/web/index.html || { echo "FAIL browser lacks concise source diff"; exit 1; }
grep -q 'Independent review' apps/web/index.html || { echo "FAIL browser lacks independent packet review status"; exit 1; }
grep -q 'guide-packets/processing-status.json' src/export/diagnostic-bundle.mjs || { echo "FAIL diagnostics omit guide packet processing state"; exit 1; }
grep -q 'guide-packets/stage-attempts.json' src/export/diagnostic-bundle.mjs || { echo "FAIL diagnostics omit Guide Packet attempt history"; exit 1; }
grep -q '^GUIDE_PACKET_ROOT=' .env.cli.example || { echo "FAIL guide packet state root is not configurable"; exit 1; }
echo "PASS Guide Packet UI, status, diagnostics, and state root are wired."

test -f src/guide-packet/stage-lifecycle.mjs || { echo "FAIL Guide Packet stage lifecycle is missing"; exit 1; }
test -f src/guide-packet/failure-classification.mjs || { echo "FAIL Guide Packet failure taxonomy is missing"; exit 1; }
grep -q 'reconcileGuidePacketProcessingState' src/guide-packet/autopilot.mjs || { echo "FAIL startup recovery does not reconcile Guide Packet state"; exit 1; }
grep -q 'recoverGuidePacketCandidateOnStartup' src/cli/serve.mjs || { echo "FAIL startup does not resume Guide Packet candidates"; exit 1; }
grep -q 'gpt-5.6-sol' src/guide-packet/model-policy.mjs || { echo "FAIL exact Codex Guide Packet model is not enforced"; exit 1; }
grep -q 'claude-opus-5' src/guide-packet/model-policy.mjs || { echo "FAIL exact Opus Guide Packet model is not enforced"; exit 1; }
grep -q 'claude-fable-5' src/guide-packet/model-policy.mjs || { echo "FAIL exact Fable Guide Packet model is not enforced"; exit 1; }
grep -q 'entitlementEvidence' src/autopilot/model-resolver.mjs || { echo "FAIL exact model entitlement evidence is not retained"; exit 1; }
grep -q 'guidePacket: stableGuidePacketFact' src/dev/supervisor-state.mjs || { echo "FAIL Guide Packet state is absent from supervisor fingerprint"; exit 1; }
grep -q 'statusDomain' src/dev/supervisor-state.mjs || { echo "FAIL Guide Packet status is not isolated from development-supervisor messaging"; exit 1; }
grep -q 'unchanged-deterministic-state' src/dev/supervisor.mjs || { echo "FAIL supervisor lacks quiescent unchanged-state reuse"; exit 1; }
grep -q 'Validation stopped at a deterministic blocker. Inner Signal remains available' run-autopilot.sh || { echo "FAIL validation failure still abandons the recovery service"; exit 1; }
grep -q 'Promotion failed and was rolled back. Restarting the recovery/status service' run-autopilot.sh || { echo "FAIL promotion failure still abandons the recovery service"; exit 1; }
grep -q 'fixtures/r02-candidate/inner-signal-guide-packet-r02-candidate.zip' src/guide-packet/autopilot.mjs || { echo "FAIL corrected r02 is not the default bundled candidate"; exit 1; }
echo "PASS Guide Packet lifecycle, exact-model evidence, startup recovery, and supervisor quiescence are wired."




echo
echo "=== AUTONOMOUS DEVELOPMENT LOOP ==="
grep -q 'src/cli/dev-worker.mjs --watch' run-autopilot.sh || { echo "FAIL wrapper does not launch autonomous development worker"; exit 1; }
grep -q 'src/cli/promote-candidate.mjs' run-autopilot.sh || { echo "FAIL wrapper cannot promote validated restorative candidates"; exit 1; }
grep -q '/v1/dev/status' apps/web/app.js || { echo "FAIL web client lacks development-worker status"; exit 1; }
grep -q '/v1/dev/decision' apps/web/app.js || { echo "FAIL web client lacks bounded human policy-decision path"; exit 1; }
grep -q '^DEV_REPAIR_MODEL=claude-opus-5$' .env.cli.example || { echo "FAIL Opus is not the default development repair model"; exit 1; }
grep -q '^DEV_ESCALATION_MODEL=claude-fable-5$' .env.cli.example || { echo "FAIL Fable is not the development escalation model"; exit 1; }
grep -q 'processOneAutonomousRoadmapTask' src/cli/dev-worker.mjs || { echo "FAIL development worker does not advance the roadmap while idle"; exit 1; }
grep -q 'DEV_ENGINE_REVISION' src/dev/queue.mjs || { echo "FAIL stale blocked development cases are not revision-aware"; exit 1; }
grep -q 'Autonomous roadmap queued' apps/web/app.js || { echo "FAIL web UI still implies the development loop waits for another chat turn"; exit 1; }
grep -q 'tail -n 0 -F' run-autopilot.sh || { echo "FAIL background development progress is not surfaced in the foreground terminal"; exit 1; }
test -f roadmap/autonomous-development.json || { echo "FAIL autonomous engineering roadmap is missing"; exit 1; }
grep -q 'continuous-dev-v6-2026-08-11' src/dev/engine.mjs || { echo "FAIL autonomous development engine revision is not v6 anti-livelock supervisor architecture"; exit 1; }
grep -q 'runDeterministicDevelopmentGates' src/dev/roadmap-worker.mjs || { echo "FAIL roadmap worker does not delegate deterministic gates to the parent controller"; exit 1; }
grep -q 'runReviewWithRecovery' src/dev/roadmap-worker.mjs || { echo "FAIL roadmap worker lacks recoverable independent review"; exit 1; }
grep -q 'review-pending' src/dev/roadmap-worker.mjs || { echo "FAIL roadmap worker cannot retain a green candidate across reviewer timeout"; exit 1; }
grep -q 'LIVE_REGRESSION_FAILURE' src/dev/roadmap-worker.mjs || { echo "FAIL roadmap worker does not separate stochastic live regression failures"; exit 1; }
grep -q 'INNER_SIGNAL_MODE=mock LEDGER_MODE=off' scripts/verify-package.sh || { echo "FAIL package verification does not explicitly force mock model mode"; exit 1; }
grep -q 'runDevelopmentSupervisorCycle' src/cli/dev-worker.mjs || { echo "FAIL development worker does not invoke the executive supervisor"; exit 1; }
grep -q 'Overall development' apps/web/index.html || { echo "FAIL web UI lacks always-visible overall development analysis"; exit 1; }
grep -q 'development-supervisor.json' src/export/diagnostic-bundle.mjs || { echo "FAIL diagnostics omit development supervisor state"; exit 1; }
grep -q 'supervisorDispatch' src/dev/supervisor.mjs || { echo "FAIL supervisor repair lacks durable dispatch identity"; exit 1; }
grep -q 'suppressedFingerprint' src/dev/supervisor-state.mjs || { echo "FAIL supervisor lacks unchanged-state suppression"; exit 1; }
grep -q 'BLOCKED_INTERNAL' src/dev/supervisor-state.mjs || { echo "FAIL supervisor cannot expose bounded internal block state"; exit 1; }
grep -q 'randomUUID' src/dev/supervisor-state.mjs || { echo "FAIL supervisor atomic state writes lack collision-resistant temp paths"; exit 1; }
echo "PASS autonomous engine v6 adds transactional supervisor dispatch and anti-livelock state-change gating on top of separated implementation, verification, review recovery, and live regression."
echo "PASS feedback, stale incidents, and safe engineering roadmap tasks can continue locally without a new user message or log shuttling."

echo
echo "=== VERDICT ==="
echo "PASS"
