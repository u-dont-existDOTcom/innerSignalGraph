import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import { PRIVATE_CASE_SCOPES } from "../storage/private-case-access.mjs";
import { JOURNAL_WORK_ID_PATTERN, MAX_JOURNAL_RESULT_BYTES } from "../journal-import/work-exchange.mjs";

// Two connector tools for the private journal import. ChatGPT fetches one work item (instruction,
// packet, output schema), does the role's work in a fresh chat, and submits its JSON answer. The
// answer is checked against the item's schema here, so the model can fix mistakes in the same chat.
// Only items the import runtime published are served, only for the configured case, and nothing
// the tools handle is logged.

const WORK_ID_SCHEMA = Object.freeze({ type: "string", pattern: JOURNAL_WORK_ID_PATTERN.source });
const CASE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const MAX_REPORTED_SCHEMA_ERRORS = 25;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const JOURNAL_WORK_TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: "get_journal_work_packet",
    title: "Get a private InnerSignal journal work item",
    description: "Return one private journal work item: its role instruction, its source packet and the JSON Schema the answer must satisfy. Follow the instruction using only this packet, then call submit_journal_work_result.",
    inputSchema: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: ["work_id"],
      properties: Object.freeze({ work_id: WORK_ID_SCHEMA })
    }),
    annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })
  }),
  Object.freeze({
    name: "submit_journal_work_result",
    title: "Submit a private InnerSignal journal work result",
    description: "Store the JSON answer for one journal work item. The answer is checked against the item's JSON Schema; if it fails, fix the listed problems and submit again. The first valid answer for an item is kept.",
    inputSchema: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: ["work_id", "output"],
      properties: Object.freeze({ work_id: WORK_ID_SCHEMA, output: Object.freeze({ type: "object" }) })
    }),
    annotations: Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false })
  })
]);

export const JOURNAL_WORK_TOOL_SCOPES = Object.freeze({
  get_journal_work_packet: Object.freeze([PRIVATE_CASE_SCOPES.READ]),
  submit_journal_work_result: Object.freeze([PRIVATE_CASE_SCOPES.JOURNAL_SUBMIT])
});

export const JOURNAL_WORK_INSTRUCTIONS = "For a private InnerSignal journal work item, call get_journal_work_packet, follow its instruction using only its packet, then submit the JSON answer with submit_journal_work_result. If the submission lists schema problems, fix them and submit again. Do not repeat the packet or the answer in the chat.";

const toolError = (code, message, details = undefined) => ({ toolError: { code, message, ...(details ? { details } : {}) } });
const value = (result) => ({ value: result });

export function createJournalWorkTools({ exchange, caseId, authorizeCase, tier = null } = {}) {
  if (!exchange || typeof exchange.readWork !== "function" || typeof exchange.submitResult !== "function") {
    throw new TypeError("A journal work exchange is required.");
  }
  if (typeof caseId !== "string" || !CASE_ID.test(caseId)) throw new TypeError("A valid journal work case ID is required.");
  if (typeof authorizeCase !== "function") throw new TypeError("authorizeCase is required.");
  if (tier !== null && !["standard", "hardest"].includes(tier)) throw new TypeError("tier is invalid.");

  // One compiled validator per distinct schema. Each gets its own Ajv instance, so two schema
  // versions that share an $id never collide.
  const validators = new Map();
  function validatorFor(schema) {
    const key = sha256(JSON.stringify(schema));
    let validate = validators.get(key);
    if (!validate) {
      validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
      if (validators.size >= 32) validators.clear();
      validators.set(key, validate);
    }
    return validate;
  }

  async function outstanding(workId) {
    const entry = await exchange.readWork(workId);
    if (!entry || entry.case_id !== caseId || (tier !== null && (entry.tier ?? "standard") !== tier)) {
      return toolError("JOURNAL_WORK_NOT_FOUND", "This journal work item doesn't exist or is already finished. Stop here.");
    }
    if (exchange.isExpired(entry)) return toolError("JOURNAL_WORK_EXPIRED", "This journal work item has expired. Stop here.");
    return { entry };
  }

  async function getPacket(workId, authContext) {
    await authorizeCase(caseId, authContext, PRIVATE_CASE_SCOPES.READ);
    const found = await outstanding(workId);
    if (found.toolError) return found;
    if (await exchange.hasResult(workId)) {
      return value({ work_id: workId, status: "already_submitted", message: "An answer for this item is already stored. Stop here." });
    }
    const { entry } = found;
    return value({
      work_id: workId,
      status: "ready",
      role: entry.role,
      instruction: entry.instruction,
      packet: entry.packet,
      output_schema: entry.output_schema,
      expected_generation: entry.expected_generation,
      expires_at: entry.expires_at,
      submit_with: "submit_journal_work_result"
    });
  }

  async function submit(workId, output, authContext) {
    const authorization = await authorizeCase(caseId, authContext, PRIVATE_CASE_SCOPES.JOURNAL_SUBMIT);
    const found = await outstanding(workId);
    if (found.toolError) return found;
    if (!isPlainObject(output)) return toolError("JOURNAL_WORK_OUTPUT_INVALID", "output must be a JSON object that satisfies output_schema.");
    if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_JOURNAL_RESULT_BYTES) {
      return toolError("JOURNAL_WORK_OUTPUT_TOO_LARGE", "The answer is too large to store.");
    }
    const validate = validatorFor(found.entry.output_schema);
    if (!validate(output)) {
      const errors = (validate.errors ?? []).slice(0, MAX_REPORTED_SCHEMA_ERRORS).map(({ instancePath, keyword, message, params }) => ({
        instance_path: instancePath || "/",
        keyword,
        message,
        params
      }));
      return toolError("JOURNAL_OUTPUT_SCHEMA_INVALID", "The answer does not satisfy output_schema. Fix these problems and submit again.", {
        errors,
        total_errors: validate.errors?.length ?? errors.length
      });
    }
    const stored = await exchange.submitResult({ workId, output, subject: authorization.principalId });
    return value({
      work_id: workId,
      ...stored,
      message: stored.already
        ? "An answer for this item was already stored, so this one wasn't needed. Stop here."
        : "Stored. Reply only: done."
    });
  }

  return Object.freeze({
    names: new Set(JOURNAL_WORK_TOOL_DEFINITIONS.map((tool) => tool.name)),
    definitions: JOURNAL_WORK_TOOL_DEFINITIONS,
    scopes: (name) => JOURNAL_WORK_TOOL_SCOPES[name] ?? [],
    instructions: JOURNAL_WORK_INSTRUCTIONS,
    async call(name, args, authContext) {
      const workId = args?.work_id;
      if (typeof workId !== "string" || !JOURNAL_WORK_ID_PATTERN.test(workId)) {
        return toolError("JOURNAL_WORK_ID_INVALID", "work_id is missing or malformed. Use the exact work_id you were given.");
      }
      if (name === "get_journal_work_packet") return getPacket(workId, authContext);
      if (name === "submit_journal_work_result") return submit(workId, args?.output, authContext);
      return toolError("MCP_TOOL_NOT_FOUND", `Unknown journal work tool ${name}.`);
    }
  });
}
