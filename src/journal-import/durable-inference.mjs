import { createHash } from "node:crypto";
import { JournalInferencePortError } from "./provider-port.mjs";
import { ValidationError } from "../core/errors.mjs";

/**
 * Immutable submission intents and results. Unknown submissions never auto-repeat.
 *
 * A port whose capabilities declare `authoritative_completion` (the connector exchange) knows for
 * certain whether a submission was answered, is still open, or was closed unanswered. For such a
 * port an existing intent is resumed through the port itself, which waits on the same submission
 * instead of sending it again, and a definite "not submitted" or "invalid output" is recorded so the
 * caller's normal retry rules apply. Every other port keeps the original rule: an intent without a
 * result is "completion unknown" until the port reports it completed.
 */
export function createDurableJournalInferencePort({ port, corpusStore }) {
  const hash = (v) => createHash("sha256").update(v).digest("hex");
  const id = (key, attempt, suffix) => `inference:${hash(key)}:${attempt === 1 ? "" : `attempt:${attempt}:`}${suffix}`;
  const authoritative = async (operationKey, input = null, intent = null) => {
    if (typeof intent?.authoritative_completion === "boolean") return intent.authoritative_completion;
    if (typeof port.isAuthoritativeCompletion === "function") {
      return (await port.isAuthoritativeCompletion(operationKey, input)) === true;
    }
    return port.capabilities?.()?.authoritative_completion === true;
  };
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
  // Once an answer is stored here, the port may let go of its own copy. A failure to do so leaves
  // only a stale item behind, never a lost answer, so it does not fail the call.
  const release = async (key) => {
    try { await port.release?.(key); } catch { /* the answer is already durable */ }
  };
  async function settle(key, attempt, input) {
    try {
      const output = await port.invoke(input);
      await writeResult(key, attempt, { status: "completed", ...output });
      await release(key);
      return output;
    } catch (e) {
      if (["not_submitted", "completed_invalid", "exhausted"].includes(e.submissionStatus)) {
        await writeResult(key, attempt, {
          status: e.submissionStatus === "completed_invalid" ? "invalid_output" : e.submissionStatus, code: e.code
        });
        if (e.submissionStatus === "completed_invalid") await release(key);
      }
      throw e;
    }
  }
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
      if (result?.status === "exhausted") throw new JournalInferencePortError(result.code, { submissionStatus: "exhausted" });
      if (result?.status === "invalid_output") throw new JournalInferencePortError("INVALID_STRUCTURED_OUTPUT", { submissionStatus: "completed_invalid" });
      if (result?.status === "not_submitted") throw new JournalInferencePortError("INFERENCE_RETRY_LIMIT", { submissionStatus: "not_submitted" });
      if (intent) {
        // Resume the same submission; the port neither sends it twice nor loses its answer.
        const completionIsAuthoritative = await authoritative(input.operationKey, input, intent);
        if (completionIsAuthoritative) return settle(input.operationKey, attempt, input);
        const completion = await port.getCompletion(input.operationKey, { authoritativeCompletion: completionIsAuthoritative });
        if (completion.status !== "completed") throw new JournalInferencePortError("COMPLETION_UNKNOWN", { submissionStatus: "unknown" });
        await writeResult(input.operationKey, attempt, completion);
        await release(input.operationKey);
        return { output: completion.output, receipt: completion.receipt };
      }
      const authoritativeCompletion = await authoritative(input.operationKey, input);
      await corpusStore.writeJsonObject({ objectId: id(input.operationKey, attempt, "intent"), value: {
        operation_key: input.operationKey,
        input_sha256: digest,
        authoritative_completion: authoritativeCompletion,
        recorded_at: new Date().toISOString()
      } });
      return settle(input.operationKey, attempt, input);
    },
    async getCompletion(key, options = {}) {
      const { attempt, intent, result } = await latest(key);
      if (result) {
        if (result.status === "not_submitted" && options.tier === "hardest" && await authoritative(key, null, intent)) {
          return port.getCompletion(key, options);
        }
        if (result.status === "invalid_output") return (await authoritative(key, null, intent)) ? { status: "invalid_output" } : { status: "unknown" };
        return result;
      }
      if (!intent) {
        // Hardest resends must consult the host's identity hold before the runtime
        // charges a slot, even when this new key has no durable intent yet.
        if (options.tier === "hardest" && await authoritative(key)) return port.getCompletion(key, options);
        return { status: "not_submitted" };
      }
      const completionIsAuthoritative = await authoritative(key, null, intent);
      const completion = await port.getCompletion(key, { ...options, authoritativeCompletion: completionIsAuthoritative });
      if (completion.status === "completed") {
        await writeResult(key, attempt, completion);
        await release(key);
        return completion;
      }
      if (completionIsAuthoritative && completion.status === "not_submitted") {
        await writeResult(key, attempt, { status: "not_submitted", code: completion.code ?? "INFERENCE_NOT_SUBMITTED" });
        return { status: "not_submitted" };
      }
      if (completionIsAuthoritative && completion.status === "invalid_output") {
        await writeResult(key, attempt, { status: "invalid_output", code: "INVALID_STRUCTURED_OUTPUT" });
        await release(key);
        return { status: "invalid_output" };
      }
      if (completionIsAuthoritative && completion.status === "exhausted") {
        await writeResult(key, attempt, { status: "exhausted", code: completion.code });
        return completion;
      }
      return { status: "unknown" };
    },
    isAuthoritativeCompletion: authoritative,
    close() { return port.close?.(); }
  });
}
