import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const CHECKPOINT_VERSION = "a001-stage-checkpoint-v1";
const LEDGER_VERSION = "a001-stage-attempts-v1";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function safeLane(value) {
  const lane = String(value ?? "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(lane)) throw new Error(`Invalid A001 recovery lane: ${lane || "(empty)"}`);
  return lane;
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return fallback;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}-${process.pid}-${randomUUID()}.tmp`);
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
}

export function buildA001StageFingerprint(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function decideA001FailureRoute({ failure, result, acceptance, fableEnabled, primaryAnthropicModel }) {
  if (failure?.stage === "case_audit" && failure?.role === "auditor") {
    return { kind: "TERMINAL_STAGE_FAILURE", failure };
  }
  if (failure?.classification === "AUTH_REQUIRED") {
    return { kind: "TERMINAL_STAGE_FAILURE", failure };
  }
  const fableAvailable = Boolean(fableEnabled) && !/fable/i.test(primaryAnthropicModel ?? "");
  if (failure?.stage === "case_extraction") {
    return fableAvailable
      ? { kind: "FABLE_REASONING_ESCALATION" }
      : { kind: "TERMINAL_STAGE_FAILURE", failure };
  }
  if (fableAvailable && (!result || !acceptance?.ok)) return { kind: "FABLE_REASONING_ESCALATION" };
  return { kind: "NO_ESCALATION" };
}

export function buildA001StageTerminal(failure, { checkpointAvailable = false } = {}) {
  const authentication = failure?.classification === "AUTH_REQUIRED";
  const stageName = failure?.stage === "case_extraction" ? "A001-case-extraction" : "A001-case-audit";
  const resumable = checkpointAvailable && failure?.stage === "case_audit";
  return {
    status: authentication ? "ACTION_REQUIRED" : "BLOCKED",
    stage: stageName,
    summary: failure?.message ?? "An A001 model stage failed without a normalized cause.",
    nextAction: authentication
      ? "Complete the browser sign-in opened by the wrapper. The interrupted audit will resume automatically from the saved extraction."
      : resumable
        ? "The completed Claude extraction is saved. The next automatic validation will resume the failed Codex audit without repeating Claude work."
        : "The exact stage failure is preserved locally for bounded automatic recovery or a corrected runtime release.",
    doNotDo: ["Do not bypass the failed audit.", "Do not upload logs.", "Do not add API credentials."],
    details: {
      actionCode: failure?.actionCode ?? null,
      failure,
      checkpointAvailable: Boolean(checkpointAvailable)
    },
    exitCode: authentication ? 2 : 1
  };
}

export function createA001StageRecovery({ stateDir, lane, fingerprint, maxAuditAttempts = 2 }) {
  const resolvedLane = safeLane(lane);
  if (!/^[a-f0-9]{64}$/i.test(String(fingerprint ?? ""))) throw new Error("A001 recovery fingerprint must be a SHA-256 hex digest.");
  if (!Number.isInteger(maxAuditAttempts) || maxAuditAttempts < 1 || maxAuditAttempts > 3) {
    throw new Error("A001 maxAuditAttempts must be an integer from 1 to 3.");
  }
  const checkpointPath = path.join(stateDir, "a001-stage", `${resolvedLane}.json`);
  const attemptsPath = path.join(stateDir, "a001-stage-attempts.json");
  let writeChain = Promise.resolve();

  function serializeWrite(operation) {
    const next = writeChain.then(operation, operation);
    writeChain = next.catch(() => {});
    return next;
  }

  return {
    lane: resolvedLane,
    fingerprint,
    maxAuditAttempts,
    checkpointPath,
    attemptsPath,

    async loadExtraction({ provider }) {
      await writeChain;
      const stored = await readJson(checkpointPath);
      if (!stored || stored.version !== CHECKPOINT_VERSION || stored.fingerprint !== fingerprint) return null;
      if (stored.lane !== resolvedLane) return null;
      if (stored.extractor?.provider !== provider?.id || stored.extractor?.model !== provider?.model) return null;
      if (!stored.extraction || typeof stored.extraction !== "object" || Array.isArray(stored.extraction)) return null;
      return {
        value: stored.extraction,
        raw: { requestId: stored.extractor.requestId ?? null },
        durationMs: stored.extractor.durationMs ?? 0,
        resumed: true,
        checkpointedAt: stored.completedAt
      };
    },

    async saveExtraction({ value, providerMetadata }) {
      return await serializeWrite(async () => {
        const completedAt = new Date().toISOString();
        await writeJsonAtomic(checkpointPath, {
          version: CHECKPOINT_VERSION,
          lane: resolvedLane,
          fingerprint,
          completedAt,
          extractor: {
            provider: providerMetadata.provider,
            model: providerMetadata.model,
            requestId: providerMetadata.requestId ?? null,
            durationMs: providerMetadata.durationMs ?? null
          },
          extraction: value
        });
        return completedAt;
      });
    },

    async recordAuditAttempt({ attempt, failure = null, completed = null }) {
      return await serializeWrite(async () => {
        const ledger = await readJson(attemptsPath, { version: LEDGER_VERSION, attempts: [] });
        const occurredAt = completed?.completedAt ?? failure?.occurredAt ?? new Date().toISOString();
        const entry = {
          attemptId: randomUUID(),
          lane: resolvedLane,
          fingerprint,
          attempt,
          status: failure ? "FAILED" : "COMPLETED",
          provider: completed?.provider ?? failure?.provider ?? null,
          model: completed?.model ?? failure?.model ?? null,
          stage: "case_audit",
          occurredAt,
          durationMs: completed?.durationMs ?? null,
          requestId: completed?.requestId ?? null,
          failure
        };
        await writeJsonAtomic(attemptsPath, {
          version: LEDGER_VERSION,
          attempts: [...(Array.isArray(ledger?.attempts) ? ledger.attempts : []), entry],
          updatedAt: occurredAt
        });
        return entry;
      });
    },

    async clearExtraction() {
      return await serializeWrite(async () => {
        await fs.rm(checkpointPath, { force: true });
      });
    }
  };
}
