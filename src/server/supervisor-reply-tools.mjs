import Ajv2020 from "ajv/dist/2020.js";
import { PRIVATE_CASE_SCOPES } from "../storage/private-case-access.mjs";
import { sha256Json } from "../storage/private-case-supervisor.mjs";
import { supervisorOperationKeyForIdempotencyKey } from "../supervisor/private-supervisor-draft.mjs";

// Five connector tools that let ChatGPT, acting for the owner, run a reply to a client through InnerSignal's own independent review:
// read the case's draft state, submit one draft, follow its review, get the exact approved words, and note that a reply was sent.
//
// What they are not. They send nothing to anyone. They approve nothing themselves: the review runs under the backend's own
// authority in the access service (`supervisorDraftAccess`), with audit evidence built by the backend's model runtime, and none
// of these tools has an argument that could carry evidence, a finding, a verdict or an approval. They do not claim to control
// what the host does with the words after they are exported: the approval covers only the exact bytes InnerSignal stored.
//
// Everything that arrives here is an authenticated agent's. A report that a reply was sent is always an agent-relayed, unresolved
// report, never the owner's own, whatever a request says. There is no owner channel through this connector.
//
// Errors a model can act on come back as tool errors in fixed words that never repeat what the caller sent. A refusal to
// authorize is thrown, so the connector answers it with its usual sign-in challenge.

const CASE_ID_SCHEMA = Object.freeze({ type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,79}$" });
const ARTIFACT_ID_SCHEMA = Object.freeze({ type: "string", pattern: "^art_[a-f0-9]{40}$" });
const IDEMPOTENCY_KEY_SCHEMA = Object.freeze({ type: "string", pattern: "^[!-~]{1,200}$" });
const BASIS_SCHEMA = Object.freeze({ type: "string", pattern: "^[a-f0-9]{64}$" });
const DRAFT_TEXT_MAXIMUM = 100_000;
const AGENT_CHANNEL = "authenticated_agent";
const MAX_REPORTED_SCHEMA_ERRORS = 25;

const READ_ONLY = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const WRITES = Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });

export const SUPERVISOR_REPLY_TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: "get_reply_draft_context",
    title: "Get the state a reply to the client is drafted against",
    description: "Read-only. Returns the newest client message, the owner's recorded inputs, the review state of every reply draft, what the record can truthfully say about who has seen what, and basis.sha256, a fingerprint of the case as it stands now that submit_reply_draft can check. It records nothing and changes nothing. Everything arriving through this connector is an authenticated agent's, never the owner's own.",
    inputSchema: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: ["case_id"],
      properties: Object.freeze({ case_id: CASE_ID_SCHEMA })
    }),
    annotations: READ_ONLY
  }),
  Object.freeze({
    name: "submit_reply_draft",
    title: "Submit a reply draft to the client for InnerSignal's independent review",
    description: "Stores one reply draft and has InnerSignal review it independently. With source external_draft, text is stored exactly as sent, byte for byte, and its original writer is recorded as not attested. With source backend_produced, InnerSignal's own runtime writes the draft from the newest client message, and text is not sent. companion is an optional rendering for the supervisor only: it can never be sent to the client. Nothing is approved until the independent review passes the exact stored text; if the review has to repair it, the approved text is the repaired text and can differ from what was sent. A review can take minutes, so this call answers within about 25 seconds; if the review is not finished it answers reviewing, and get_reply_draft_status with the same idempotency_key follows it. A retry with the same idempotency_key and the same content is answered from the stored draft; the same key with different content is refused. basis_sha256, from get_reply_draft_context, makes the call refuse if the case has changed since. This sends nothing to anyone.",
    inputSchema: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: ["case_id", "source", "idempotency_key"],
      properties: Object.freeze({
        case_id: CASE_ID_SCHEMA,
        source: Object.freeze({ type: "string", enum: Object.freeze(["external_draft", "backend_produced"]) }),
        text: Object.freeze({ type: "string", minLength: 1, maxLength: DRAFT_TEXT_MAXIMUM }),
        companion: Object.freeze({
          type: "object",
          additionalProperties: false,
          required: Object.freeze(["language", "text"]),
          properties: Object.freeze({
            language: Object.freeze({ type: "string", pattern: "^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$" }),
            text: Object.freeze({ type: "string", minLength: 1, maxLength: DRAFT_TEXT_MAXIMUM })
          })
        }),
        basis_sha256: BASIS_SCHEMA,
        idempotency_key: IDEMPOTENCY_KEY_SCHEMA
      })
    }),
    annotations: WRITES
  }),
  Object.freeze({
    name: "get_reply_draft_status",
    title: "Follow the review of a submitted reply draft",
    description: "Where the independent review of a submitted reply draft stands, found by the artifact_id of any version of the draft or by the idempotency_key it was submitted with. If the review is unfinished it is continued, so call it again until the status is approved, blocked, superseded or committed. When approved, artifact.artifact_id is the handle export_approved_reply takes. Returns no client text.",
    inputSchema: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: ["case_id"],
      properties: Object.freeze({ case_id: CASE_ID_SCHEMA, artifact_id: ARTIFACT_ID_SCHEMA, idempotency_key: IDEMPOTENCY_KEY_SCHEMA }),
      oneOf: Object.freeze([
        Object.freeze({ required: Object.freeze(["artifact_id"]), properties: Object.freeze({ artifact_id: true }) }),
        Object.freeze({ required: Object.freeze(["idempotency_key"]), properties: Object.freeze({ idempotency_key: true }) })
      ])
    }),
    annotations: WRITES
  }),
  Object.freeze({
    name: "export_approved_reply",
    title: "Get the exact approved text of a reply draft",
    description: "Returns the exact client text of a reply draft whose independent review passed and which is still current, together with its companion if one was submitted (supervisor only, never for the client). The text is returned as an exact block: show or copy it to the owner unchanged, character for character. Text you change, shorten, translate or paraphrase has no approval and needs a new review through submit_reply_draft. Exporting is not sending: InnerSignal sends nothing and does not control what happens to the text afterwards. Refused when the draft is not approved, was replaced by a newer draft, or the case has changed since it was drafted.",
    inputSchema: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: ["case_id", "artifact_id"],
      properties: Object.freeze({ case_id: CASE_ID_SCHEMA, artifact_id: ARTIFACT_ID_SCHEMA })
    }),
    annotations: WRITES
  }),
  Object.freeze({
    name: "report_reply_sent",
    title: "Note that the owner says a reply was sent",
    description: "Call only when the owner has told you they sent a reply. It is recorded as a report relayed by an agent, which InnerSignal cannot verify as the owner's own, and never as the owner's own report; it sends nothing. Name the draft with artifact_id; with none named, a single exported draft that has not yet been reported is the target. sent_at stays unknown unless you give the time the owner stated. quote may hold the owner's words about it.",
    inputSchema: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: ["case_id"],
      properties: Object.freeze({
        case_id: CASE_ID_SCHEMA,
        artifact_id: ARTIFACT_ID_SCHEMA,
        sent_at: Object.freeze({ type: "string", minLength: 1, maxLength: 80 }),
        quote: Object.freeze({ type: "string", minLength: 1, maxLength: 2_000 }),
        source_ref: Object.freeze({ type: "string", pattern: "^[A-Za-z0-9:_-]{1,160}$" }),
        idempotency_key: IDEMPOTENCY_KEY_SCHEMA
      })
    }),
    annotations: WRITES
  })
]);

export const SUPERVISOR_REPLY_INSTRUCTIONS = "Reply-draft tools: submit_reply_draft stores one reply draft to a client and has InnerSignal review it independently; get_reply_draft_status follows a review that is still running; export_approved_reply returns the exact approved words, to be shown or copied unchanged, because an edited or paraphrased version has no approval and needs a new review; report_reply_sent notes, as a report relayed by an agent and never as the owner's own, that the owner says a reply was sent. get_reply_draft_context only reads. None of them sends anything to anyone, and InnerSignal does not control what happens to the words after they are exported.";

const toolError = (code, message, details = undefined) => ({ toolError: { code, message, ...(details ? { details } : {}) } });
const value = (result, text = undefined) => ({ value: result, ...(typeof text === "string" ? { text } : {}) });

// What a model is told for each refusal the draft service can raise. The words are fixed; nothing a caller sent is repeated.
const REFUSALS = Object.freeze({
  SUPERVISOR_ARTIFACT_NOT_FOUND: "There is no such reply draft in this case. Use the artifact_id or idempotency_key from the submit result.",
  SUPERVISOR_ARTIFACT_STALE: "This draft can no longer be exported: a newer draft replaced it or the case has changed since it was drafted. Read the case again and submit a new draft.",
  SUPERVISOR_ARTIFACT_NOT_APPROVED: "This draft is not approved, so nothing can be exported for it.",
  SUPERVISOR_IDEMPOTENCY_CONFLICT: "This idempotency_key was already used with different content. Use a new idempotency_key for a different draft.",
  SUPERVISOR_BASIS_CHANGED: "The case changed after the state this draft was written against. Call get_reply_draft_context again and submit against the new state.",
  SUPERVISOR_NO_PENDING_CLIENT_MESSAGE: "There is no unanswered client message for InnerSignal to write a reply to.",
  SUPERVISOR_NO_REPORTABLE_DRAFT: "No exported reply draft is waiting to be reported. Name the draft with artifact_id.",
  SUPERVISOR_REVIEW_UNAVAILABLE: "InnerSignal cannot review a draft right now. Nothing was approved.",
  SUPERVISOR_REVIEW_BUSY: "InnerSignal is reviewing other drafts right now. Nothing was approved; try again shortly.",
  VALIDATION_ERROR: "The request was rejected as invalid, for example because a text is blank."
});
const REASON_WORD = /^[a-z_]{1,60}$/u;

function refusalFor(error) {
  const message = Object.hasOwn(REFUSALS, error?.code) ? REFUSALS[error.code] : null;
  if (message === null) return null;
  const reasons = Array.isArray(error.details?.reasons) && error.details.reasons.every((reason) => typeof reason === "string" && REASON_WORD.test(reason))
    ? { reasons: [...error.details.reasons] }
    : undefined;
  return toolError(error.code === "VALIDATION_ERROR" ? "REPLY_DRAFT_REQUEST_INVALID" : error.code, message, reasons);
}

// Property segments are fixed tokens, never names the caller supplied; only array positions are kept.
function schemaErrorPath(instancePath, input) {
  let current = input;
  return instancePath ? instancePath.split("/").map((part, index) => {
    if (index === 0) return "";
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    const safe = Array.isArray(current) && /^(?:0|[1-9][0-9]*)$/u.test(key) ? key : "property";
    current = current?.[key];
    return safe;
  }).join("/") : "/";
}

// An exact block for the client text, so a model can see where the words begin and end. The structured result carries the same
// bytes in `client_text`, with their SHA-256.
function exportText(exported) {
  const lines = [
    `EXACT APPROVED TEXT for the client. Case ${exported.case_id}, draft ${exported.artifact_id}.`,
    "InnerSignal's independent review approved exactly the text between the markers below, and nothing else. Show it or copy it to the owner unchanged, character for character, with nothing added inside the markers.",
    "If you change, shorten, translate or paraphrase it, the approval no longer applies and the new text needs a new review through submit_reply_draft.",
    "This text has been released from InnerSignal. It has not been sent: InnerSignal sends nothing to anyone and does not control what happens to the text after this.",
    `<<<BEGIN approved client text sha256=${exported.client_text_sha256}>>>`,
    `${exported.client_text}`,
    "<<<END approved client text>>>"
  ];
  if (exported.companion) {
    lines.push(
      "",
      `FOR THE SUPERVISOR ONLY, never for the client (language ${exported.companion.language}; its meaning was not reviewed):`,
      `<<<BEGIN supervisor-only companion sha256=${exported.companion.text_sha256}>>>`,
      `${exported.companion.text}`,
      "<<<END supervisor-only companion>>>"
    );
  }
  return lines.join("\n");
}

// `draftAccess` is the access service's `supervisorDraftAccess`; `drafts` is a draft service built on its `source`. `runner` keeps
// a review going after the call that started it has been answered. With no `reviewAvailable`, nothing here can approve a draft:
// submitting says plainly that review is unavailable and stores nothing.
export function createSupervisorReplyTools({ draftAccess, drafts, runner, reviewAvailable = false } = {}) {
  if (!draftAccess || typeof draftAccess.authorize !== "function") throw new TypeError("draftAccess from the access service is required.");
  if (!drafts || typeof drafts.submitCandidateForReview !== "function" || typeof drafts.getReviewStatus !== "function") throw new TypeError("A supervisor draft service is required.");
  if (!runner || typeof runner.run !== "function" || typeof runner.watch !== "function") throw new TypeError("A supervisor review runner is required.");

  const validators = new Map();
  for (const definition of SUPERVISOR_REPLY_TOOL_DEFINITIONS) {
    validators.set(definition.name, new Ajv2020({ allErrors: true, strict: true }).compile(structuredClone(definition.inputSchema)));
  }
  const invalidArguments = (name, args) => {
    const validate = validators.get(name);
    if (validate(args)) return null;
    const errors = (validate.errors ?? []).slice(0, MAX_REPORTED_SCHEMA_ERRORS).map(({ instancePath, keyword }) => ({
      instance_path: schemaErrorPath(instancePath, args),
      keyword
    }));
    return toolError("REPLY_DRAFT_ARGUMENTS_INVALID", "The arguments do not satisfy the tool's input schema. Fix these problems and call again.", {
      errors,
      total_errors: validate.errors?.length ?? errors.length
    });
  };

  // Where a review stands for the caller: finished, or still going. A review the call did not see finish is read back from what is
  // stored, so the answer shows the draft once it exists.
  async function presentOutcome(outcome, { caseId, operationKey, idempotencyKey, ticket }) {
    if (outcome.state === "finished") return value(outcome.value);
    let stored = null;
    try { stored = await drafts.getReviewStatus({ caseId, operationKey, authContext: ticket }); }
    catch (error) { if (error?.code !== "SUPERVISOR_ARTIFACT_NOT_FOUND") throw error; }
    if (stored && stored.status !== "reviewing") return value(stored);
    return value({
      case_id: caseId,
      status: "reviewing",
      exportable: false,
      artifact: stored?.artifact ?? null,
      idempotency_key: idempotencyKey,
      notice: "The review is still running. Nothing is approved yet. Call get_reply_draft_status with this idempotency_key (or the artifact's artifact_id) in a minute or so."
    });
  }

  const handlers = {
    async get_reply_draft_context(args, authContext) {
      const snapshot = await drafts.prepareResponseContext({ caseId: args.case_id, inputs: [], authContext, channel: AGENT_CHANNEL });
      const { recorded_inputs: _noInputsAreRecorded, ...context } = snapshot;
      return value({
        ...context,
        connector: {
          channel: AGENT_CHANNEL,
          recorded: "nothing",
          note: "Read-only. Anything done through this connector is recorded as an authenticated agent's, never as the owner's own."
        }
      });
    },

    async submit_reply_draft(args, authContext) {
      const caseId = args.case_id;
      if (args.source === "external_draft") {
        if (typeof args.text !== "string" || !args.text.trim()) return toolError("REPLY_DRAFT_TEXT_REQUIRED", "An external_draft needs text that is not blank.");
      } else if (args.text !== undefined || args.companion !== undefined) {
        return toolError("REPLY_DRAFT_TEXT_NOT_ALLOWED", "A backend_produced draft is written by InnerSignal and takes no text or companion.");
      }
      if (args.companion !== undefined && !args.companion.text.trim()) return toolError("REPLY_DRAFT_REQUEST_INVALID", REFUSALS.VALIDATION_ERROR);
      const ticket = await draftAccess.authorize(caseId, authContext);
      if (!reviewAvailable) return toolError("SUPERVISOR_REVIEW_UNAVAILABLE", REFUSALS.SUPERVISOR_REVIEW_UNAVAILABLE);
      const operationKey = supervisorOperationKeyForIdempotencyKey(caseId, args.idempotency_key);
      // An identical request that arrives while its review runs joins it. Any difference makes a separate job, which the draft
      // service then compares with what the first one stored.
      const identity = `submit:${caseId}:${sha256Json({ source: args.source, text: args.text ?? null, companion: args.companion ?? null, basis: args.basis_sha256 ?? null, key: args.idempotency_key })}`;
      const outcome = await runner.run({
        caseId,
        lineage: operationKey,
        identity,
        work: () => drafts.submitCandidateForReview({
          caseId,
          source: args.source,
          text: args.text ?? null,
          companion: args.companion ?? null,
          basisSha256: args.basis_sha256 ?? null,
          idempotencyKey: args.idempotency_key,
          authContext: ticket,
          channel: AGENT_CHANNEL
        })
      });
      return presentOutcome(outcome, { caseId, operationKey, idempotencyKey: args.idempotency_key, ticket });
    },

    async get_reply_draft_status(args, authContext) {
      const caseId = args.case_id;
      const ticket = await draftAccess.authorize(caseId, authContext);
      const operationKey = args.idempotency_key !== undefined
        ? supervisorOperationKeyForIdempotencyKey(caseId, args.idempotency_key)
        : await drafts.findReviewLineage({ caseId, artifactId: args.artifact_id, authContext: ticket });
      const idempotencyKey = args.idempotency_key ?? null;
      const joined = runner.watch({ caseId, lineage: operationKey });
      if (joined) return presentOutcome(await joined, { caseId, operationKey, idempotencyKey, ticket });
      const stored = await drafts.getReviewStatus({ caseId, operationKey, authContext: ticket });
      if (stored.status !== "reviewing") return value(stored);
      if (!reviewAvailable) return toolError("SUPERVISOR_REVIEW_UNAVAILABLE", REFUSALS.SUPERVISOR_REVIEW_UNAVAILABLE);
      const outcome = await runner.run({
        caseId,
        lineage: operationKey,
        identity: `resume:${caseId}:${operationKey}`,
        work: () => drafts.resumeReview({ caseId, operationKey, authContext: ticket })
      });
      return presentOutcome(outcome, { caseId, operationKey, idempotencyKey, ticket });
    },

    async export_approved_reply(args, authContext) {
      // The caller's own bearer, authorized afresh in the same call as the write: revoking access stops the next export.
      const exported = await drafts.getApprovedResponseArtifact({ caseId: args.case_id, artifactId: args.artifact_id, authContext, channel: AGENT_CHANNEL });
      const result = {
        case_id: exported.case_id,
        artifact_id: exported.artifact_id,
        candidate_id: exported.candidate_id,
        candidate_version: exported.candidate_version,
        client_text: exported.client_text,
        client_text_sha256: exported.client_text_sha256,
        approval_audit_id: exported.approval_audit_id,
        checks: exported.checks,
        event: exported.event,
        replayed: exported.replayed,
        companion: exported.companion
          ? { companion_id: exported.companion.companion_id, language: exported.companion.language, text: exported.companion.text, text_sha256: exported.companion.text_sha256, audience: "supervisor", client_send_allowed: false }
          : null,
        sent_status: exported.sent_status,
        use: "Show or copy client_text to the owner unchanged. It is the exact approved text; changed, shortened, translated or paraphrased text has no approval and needs a new review. Exporting is not sending, and InnerSignal does not control what happens to the text afterwards.",
        notice: exported.notice
      };
      return value(result, exportText(result));
    },

    async report_reply_sent(args, authContext) {
      // The origin is not an argument: the access service records every report from here as relayed by an agent.
      const reported = await drafts.recordReportedDelivery({
        caseId: args.case_id,
        artifactId: args.artifact_id ?? null,
        sentAt: args.sent_at ?? null,
        quote: args.quote ?? null,
        sourceRef: args.source_ref ?? null,
        idempotencyKey: args.idempotency_key ?? null,
        authContext,
        channel: AGENT_CHANNEL
      });
      return value({
        case_id: reported.case_id,
        replayed: reported.replayed,
        event: reported.event,
        artifact: reported.artifact,
        notice: "Recorded as a report relayed by an agent, which InnerSignal cannot verify as the owner's own. Nothing was sent."
      });
    }
  };

  return Object.freeze({
    names: new Set(SUPERVISOR_REPLY_TOOL_DEFINITIONS.map((tool) => tool.name)),
    definitions: SUPERVISOR_REPLY_TOOL_DEFINITIONS,
    scopes: (name) => (Object.hasOwn(handlers, name) ? [PRIVATE_CASE_SCOPES.SUPERVISOR_DRAFT] : []),
    instructions: SUPERVISOR_REPLY_INSTRUCTIONS,
    reviewAvailable: reviewAvailable === true,
    async call(name, args, authContext) {
      if (!Object.hasOwn(handlers, name)) return toolError("MCP_TOOL_NOT_FOUND", "Unknown reply-draft tool.");
      const invalid = invalidArguments(name, args);
      if (invalid) return invalid;
      try {
        return await handlers[name](args, authContext);
      } catch (error) {
        const refusal = refusalFor(error);
        if (refusal) return refusal;
        throw error;
      }
    }
  });
}
