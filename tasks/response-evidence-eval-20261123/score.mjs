import fs from "node:fs/promises";
import path from "node:path";
import { HARD_CAP, RUN_SCHEMA, callId, json, outsideRepository, packetId, readJson, sha256 } from "./common.mjs";
import { buildSchedule, readReceipts } from "./audit.mjs";

export function judge(label, arm, result, dimension) {
  const ok = result?.outcome === "ok";
  const derived = result?.derived_findings ?? [];
  return { outcome: result?.outcome ?? "not_run", verdict: ok ? result.verdict : null,
    false_approval: ok && label === "block" && result.verdict === "pass",
    unnecessary_block: ok && label === "pass" && result.verdict === "fail",
    cause: ok && label === "pass" && result.verdict === "fail" ? derived.length ? "derived_evidence_finding" : "only_ordinary_findings" : null,
    malformed: arm === "E" && result?.outcome === "malformed",
    dimension_agreement: arm === "E" && label === "block" && ok && result.verdict === "fail" ? (result.derived_dimensions ?? []).includes(dimension) : null,
    finding_ids: result?.finding_ids ?? [], codes: result?.codes ?? [], derived_findings: derived,
    usage: result?.usage ?? null, ms: result?.ms ?? null, effective_models: result?.effective_models ?? [] };
}

const blank = () => ({ attempted: 0, verdicts: 0, block_labels_with_verdict: 0, pass_labels_with_verdict: 0, false_approvals: 0, unnecessary_blocks: 0,
  derived_evidence_blocks: 0, only_ordinary_blocks: 0, malformed: 0, dimension_agreements: 0, dimension_comparisons: 0, input_tokens: 0, output_tokens: 0, ms: 0 });
function count(row, sample, label) {
  if (sample.outcome !== "not_run") row.attempted++;
  if (sample.verdict) { row.verdicts++; row[label === "block" ? "block_labels_with_verdict" : "pass_labels_with_verdict"]++; }
  row.false_approvals += Number(sample.false_approval); row.unnecessary_blocks += Number(sample.unnecessary_block); row.malformed += Number(sample.malformed);
  row.derived_evidence_blocks += Number(sample.cause === "derived_evidence_finding"); row.only_ordinary_blocks += Number(sample.cause === "only_ordinary_findings");
  if (sample.dimension_agreement != null) { row.dimension_comparisons++; row.dimension_agreements += Number(sample.dimension_agreement); }
  for (const key of ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) row.input_tokens += sample.usage?.[key] ?? 0;
  row.output_tokens += sample.usage?.output_tokens ?? 0; row.ms += sample.ms ?? 0;
}

export async function score({ runDir }) {
  runDir = await outsideRepository(runDir);
  const run = await readJson(path.join(runDir, "run.json")), manifestBytes = await fs.readFile(path.join(runDir, "sealed-manifest.json"));
  if (run.schema !== RUN_SCHEMA || sha256(manifestBytes) !== run.sealed_manifest_sha256) throw new Error("Run and sealed manifest do not agree.");
  const manifest = JSON.parse(manifestBytes), history = await readReceipts(path.join(runDir, "receipts"));
  const known = new Map(buildSchedule(manifest, 2).map((slot) => [slot.call, slot]));
  const entries = new Map(manifest.packets.map((e) => [e.id, e]));
  const settings = ["mode", "requested_model", "effort", "provider", "sealed_manifest_sha256"];
  for (const [call, record] of history) {
    const slot = known.get(call), entry = entries.get(slot?.packet);
    if (!slot || !record.started) throw new Error("Unrecognized call receipt.");
    for (const receipt of [record.started, record.result].filter(Boolean)) {
      if (settings.some((key) => receipt[key] !== run[key]) || receipt.call !== call || receipt.packet !== slot.packet || receipt.sample !== slot.sample
          || receipt.system_sha256 !== entry.system.sha256 || receipt.user_sha256 !== entry.user.sha256 || receipt.output_schema_sha256 !== entry.output_schema.sha256) throw new Error("Mixed settings or changed prompt in receipts.");
      if (receipt.outcome === "ok" && (!["pass", "fail"].includes(receipt.verdict) || receipt.model_confirmed === false)) throw new Error("A verdict or responding model cannot be admitted.");
    }
  }
  const invocationFile = path.join(runDir, "invocations.jsonl");
  const invocations = (await fs.readFile(invocationFile, "utf8").catch((error) => { if (error.code === "ENOENT") return ""; throw error; }))
    .split("\n").filter(Boolean).map((line) => JSON.parse(line));
  if (invocations.some((record) => settings.some((key) => record[key] !== run[key]) || ![1, 2].includes(record.samples))) throw new Error("Invocation log contains mixed settings.");
  const maxSample = Math.max(1, ...invocations.map((i) => i.samples), ...[...history.keys()].map((id) => known.get(id).sample));
  const byArm = { G: blank(), E: blank() }, byArmRole = {}, cases = [];
  for (const spec of manifest.cases) {
    const row = { ...spec, arms: {} };
    for (const arm of ["G", "E"]) {
      const samples = [];
      for (let sample = 1; sample <= maxSample; sample++) {
        const call = callId(packetId(spec.id, arm), sample), record = history.get(call);
        const result = record?.result ?? (record?.started ? { outcome: "ambiguous_not_retried" } : null);
        samples.push({ sample, call, ...judge(spec.expected, arm, result, spec.dimension) });
      }
      row.arms[arm] = samples;
      const roleKey = `${arm}:${spec.role}`;
      byArmRole[roleKey] ??= { arm, role: spec.role, ...blank() };
      for (const sample of samples) { count(byArm[arm], sample, spec.expected); count(byArmRole[roleKey], sample, spec.expected); }
    }
    cases.push(row);
  }
  const result = { schema: "response-evidence-score-v1", mode: run.mode, requested_model: run.requested_model, effort: run.effort, provider: run.provider,
    corpus_commit: manifest.corpus_commit, corpus_sha256: manifest.corpus_sha256, sealed_manifest_sha256: run.sealed_manifest_sha256,
    labels_status: manifest.status, exploratory: "Counts from short synthetic cases; no pooled rate or reliability claim. Mock results test propagation only.",
    hard_cap: HARD_CAP, calls_recorded: history.size, samples_scheduled: maxSample,
    cli_versions: [...new Set(invocations.map((i) => i.preflight?.claude_version).filter(Boolean))],
    by_arm: byArm, by_arm_role: Object.values(byArmRole), cases };
  await fs.writeFile(path.join(runDir, "score.json"), json(result), { mode: 0o600 });
  await fs.writeFile(path.join(runDir, "report.txt"), `${renderReport(result)}\n`, { mode: 0o600 });
  return result;
}

export function renderReport(result) {
  const lines = ["Response-evidence evaluation (exploratory).", `Corpus commit: ${result.corpus_commit}; SHA-256: ${result.corpus_sha256}.`,
    `Sealed manifest SHA-256: ${result.sealed_manifest_sha256}.`, `Run: ${result.mode}; model: ${result.requested_model}; effort: ${result.effort}; provider: ${result.provider}.`,
    result.labels_status, result.exploratory, ""];
  const show = (name, r) => `${name}: false approvals ${r.false_approvals} of ${r.block_labels_with_verdict}; unnecessary blocks ${r.unnecessary_blocks} of ${r.pass_labels_with_verdict} (${r.derived_evidence_blocks} derived evidence, ${r.only_ordinary_blocks} only ordinary); malformed ${r.malformed} of ${r.attempted} attempts; dimension agreement ${r.dimension_agreements} of ${r.dimension_comparisons} blocked E comparisons; ${r.input_tokens} input tokens, ${r.output_tokens} output tokens, ${r.ms.toFixed(1)} ms summed latency.`;
  for (const arm of ["G", "E"]) lines.push(show(arm, result.by_arm[arm]));
  for (const row of result.by_arm_role) lines.push(show(`${row.arm} ${row.role}`, row));
  lines.push("", "Every case (each sample shown; absent/invalid answers have no verdict):");
  for (const row of result.cases) lines.push(`${row.id} | label ${row.expected} | ${row.role} | dimension ${row.dimension ?? "none"} | ` + ["G", "E"].map((arm) => `${arm}: ${row.arms[arm].map((s) => `s${s.sample} ${s.verdict ?? s.outcome} [${s.codes.join(", ") || "no codes"}]${s.cause ? ` (${s.cause})` : ""}; ${s.ms == null ? "unknown" : s.ms.toFixed(1)} ms; tokens ${JSON.stringify(s.usage)}`).join("; ")}`).join(" | "));
  return lines.join("\n");
}
