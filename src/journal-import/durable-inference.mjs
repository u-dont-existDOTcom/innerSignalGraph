import { createHash } from "node:crypto";
import { JournalInferencePortError } from "./provider-port.mjs";
import { ValidationError } from "../core/errors.mjs";

/** Immutable submission intents and results. Unknown submissions never auto-repeat. */
export function createDurableJournalInferencePort({ port, corpusStore }) {
  const hash = (v) => createHash("sha256").update(v).digest("hex");
  const id = (key, attempt, suffix) => `inference:${hash(key)}:${attempt === 1 ? "" : `attempt:${attempt}:`}${suffix}`;
  const read = async (objectId) => {
    try { return await corpusStore.readJsonObject({ objectId }); }
    catch (e) { if (e.code === "ENOENT") return null; throw e; }
  };
  async function latest(key) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const intent = await read(id(key, attempt, "intent"));
      const result = await read(id(key, attempt, "result"));
      if (!intent || result?.status !== "not_submitted" || attempt === 2) return { attempt, intent, result };
    }
  }
  const writeResult = (key, attempt, value) => corpusStore.writeJsonObject({ objectId: id(key, attempt, "result"), value });
  return Object.freeze({
    capabilities: () => port.capabilities(),
    async invoke(input) {
      const { grant, role, packet } = input;
      if (grant?.revoked || (grant?.expires_at && Date.now() > Date.parse(grant.expires_at))) throw new JournalInferencePortError("GRANT_REVOKED");
      if (grant?.purpose !== packet?.grant_purpose || !grant?.allowed_roles?.includes(role)) throw new JournalInferencePortError("GRANT_ROLE_DENIED");
      const digest = hash(JSON.stringify(input));
      const first = await read(id(input.operationKey, 1, "intent"));
      if (first && first.input_sha256 !== digest) throw new ValidationError("OPERATION_KEY_CONFLICT", { code: "OPERATION_KEY_CONFLICT" });
      const { attempt, intent, result } = await latest(input.operationKey);
      if (result?.status === "completed") return { output: result.output, receipt: { ...result.receipt, replay: true } };
      if (result?.status === "invalid_output") throw new JournalInferencePortError("INVALID_STRUCTURED_OUTPUT", { submissionStatus: "completed_invalid" });
      if (result?.status === "not_submitted") throw new JournalInferencePortError("INFERENCE_RETRY_LIMIT", { submissionStatus: "not_submitted" });
      if (intent) {
        const completion = await port.getCompletion(input.operationKey);
        if (completion.status !== "completed") throw new JournalInferencePortError("COMPLETION_UNKNOWN", { submissionStatus: "unknown" });
        await writeResult(input.operationKey, attempt, completion);
        return { output: completion.output, receipt: completion.receipt };
      }
      await corpusStore.writeJsonObject({ objectId: id(input.operationKey, attempt, "intent"), value: { operation_key: input.operationKey, input_sha256: digest, recorded_at: new Date().toISOString() } });
      try {
        const output = await port.invoke(input);
        await writeResult(input.operationKey, attempt, { status: "completed", ...output });
        return output;
      } catch (e) {
        if (["not_submitted", "completed_invalid"].includes(e.submissionStatus)) await writeResult(input.operationKey, attempt, {
          status: e.submissionStatus === "not_submitted" ? "not_submitted" : "invalid_output", code: e.code
        });
        throw e;
      }
    },
    async getCompletion(key) {
      const { attempt, intent, result } = await latest(key);
      if (result) return result.status === "invalid_output" ? { status: "unknown" } : result;
      if (!intent) return { status: "not_submitted" };
      const completion = await port.getCompletion(key);
      if (completion.status === "completed") { await writeResult(key, attempt, completion); return completion; }
      return { status: "unknown" };
    },
    close() { return port.close?.(); }
  });
}
