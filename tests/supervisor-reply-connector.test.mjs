import test from "node:test";
import assert from "node:assert/strict";
import { validatePrivateHandoffPacket } from "../src/storage/private-case-handoff.mjs";
import { validatePrivateCaseRecord } from "../src/storage/private-case-store.mjs";
import { supervisorArtifactId } from "../src/storage/private-case-supervisor.mjs";
import {
  CASE_ID,
  NEW_SCOPE,
  OTHER_CASE_ID,
  REPLY_TOOLS,
  between,
  makeReplyEnvironment,
  rpc,
  sha256
} from "./fixtures/supervisor-reply-environment.mjs";

// The reply-draft connector tools end to end: a real HTTP connector, the real access service, a real encrypted store, and the
// real private model runtime, with only the reviewing model's answers scripted. Synthetic cases only.

const kinds = (record) => record.communication_events.map((event) => event.kind);
const EXACT = "  Synthetic reply, exactly as written.\r\nSecond line with trailing spaces   \r\n\r\n— and a last line with no newline";

async function approved(env, text = EXACT, key = "key-1", extra = {}) {
  const submitted = await env.submit({ text, idempotency_key: key, ...extra });
  assert.equal(submitted.status, "approved");
  return submitted;
}

// --- what the connector offers ------------------------------------------------------------------------------------------

test("with the feature off the connector offers what it always did: no reply-draft tool, scope or instruction", async (t) => {
  const off = await makeReplyEnvironment(t, { withTools: false });
  const on = await makeReplyEnvironment(t);
  const offTools = await off.list();
  const onTools = await on.list();
  assert.deepEqual(offTools.filter((tool) => REPLY_TOOLS.includes(tool.name)), []);
  assert.deepEqual(onTools.filter((tool) => REPLY_TOOLS.includes(tool.name)).map((tool) => tool.name).sort(), [...REPLY_TOOLS].sort());
  // Turning the feature on adds tools and changes none of the existing ones.
  assert.deepEqual(onTools.filter((tool) => !REPLY_TOOLS.includes(tool.name)), offTools);
  const initialize = (env) => rpc(env.url, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "synthetic", version: "1" } });
  const offInstructions = (await initialize(off)).body.result.instructions;
  const onInstructions = (await initialize(on)).body.result.instructions;
  assert.doesNotMatch(offInstructions, /reply|draft/iu);
  assert.match(offInstructions, /The private case tools are read-only\. Authorization is transport-owned/u);
  assert.match(onInstructions, /except the reply-draft tools/u);
  assert.match(onInstructions, /exact approved words/u);
  // Calling a reply tool when the feature is off is an unknown tool, not an attempt at the feature.
  const before = await off.fingerprint();
  const answer = await off.call("submit_reply_draft", { case_id: CASE_ID, source: "external_draft", text: "Synthetic.", idempotency_key: "key-off" });
  assert.notEqual(answer.status, 200);
  assert.equal(await off.fingerprint(), before);
});

test("the reply-draft scope is advertised only with the tools, and only the reply-draft tools ask for it", async (t) => {
  const oauth = (scopesSupported) => ({ resource: "https://private-mcp.synthetic.example", authorizationServers: ["https://identity.synthetic.example"], scopesSupported });
  const on = await makeReplyEnvironment(t, { oauth: oauth(["case:read", "case:audit", NEW_SCOPE]) });
  const metadata = await (await fetch(on.url.replace(/\/mcp$/u, "/.well-known/oauth-protected-resource"))).json();
  assert.deepEqual(metadata.scopes_supported, ["case:read", "case:audit", NEW_SCOPE]);
  const tools = await on.list();
  for (const tool of tools) {
    const scopes = tool.securitySchemes[0].scopes ?? [];
    if (REPLY_TOOLS.includes(tool.name)) assert.deepEqual(scopes, [NEW_SCOPE], tool.name);
    else assert.equal(scopes.includes(NEW_SCOPE), false, tool.name);
  }
  // No token: an ordinary tool's challenge never asks for the reply-draft scope, a reply-draft tool's asks for that scope alone.
  const ordinary = await rpc(on.url, "tools/call", { name: "retrieve_case_evidence", arguments: { case_id: CASE_ID, query: "x" } });
  assert.equal(ordinary.status, 401);
  assert.doesNotMatch(ordinary.headers.get("www-authenticate"), /supervisor_draft/u);
  const reply = await rpc(on.url, "tools/call", { name: "get_reply_draft_context", arguments: { case_id: CASE_ID } });
  assert.equal(reply.status, 401);
  assert.match(reply.headers.get("www-authenticate"), /scope="case:supervisor_draft"/u);

  // The feature on without the scope in the list (the default list) leaves it unadvertised.
  const quiet = await makeReplyEnvironment(t, { oauth: oauth(undefined) });
  assert.deepEqual((await (await fetch(quiet.url.replace(/\/mcp$/u, "/.well-known/oauth-protected-resource"))).json()).scopes_supported, ["case:read", "case:audit"]);

  // The scope named while the tools are off is a mistake the connector refuses to start with.
  await assert.rejects(() => makeReplyEnvironment(t, { withTools: false, oauth: oauth(["case:read", NEW_SCOPE]) }), /reply-draft/u);
});

// --- the whole path for an external draft -------------------------------------------------------------------------------

test("an external draft is stored exactly, reviewed independently, exported as an exact block and never counted as sent", async (t) => {
  const env = await makeReplyEnvironment(t);
  const submitted = await approved(env);
  assert.equal(submitted.exportable, true);
  assert.equal(submitted.replayed, false);
  assert.equal(submitted.artifact.source, "external_draft");
  assert.equal(submitted.artifact.exposure.original_writer, "not_attested");
  assert.equal(submitted.artifact.exposure.exact_bytes, "received_and_stored");
  assert.equal(submitted.artifact.text_sha256, sha256(EXACT));
  assert.equal(JSON.stringify(submitted).includes("Second line"), false, "a submit result carries no client text");

  const record = await env.reload();
  const [candidate] = record.candidate_responses;
  assert.equal(candidate.exact_text, EXACT, "stored byte for byte");
  assert.equal(candidate.status, "approved_for_delivery");
  const [audit] = candidate.audit_history;
  assert.equal(audit.independent, true);
  assert.equal(audit.auditor_kind, "independent");
  assert.notEqual(audit.auditor_context_id, candidate.producer_context_id);
  assert.equal(audit.sufficient_for_approval, true);
  const receipt = record.supervisor_artifacts.find((entry) => entry.kind === "review_receipt");
  assert.equal(receipt.audit_id, audit.id);
  assert.equal(receipt.provider_receipt.model, "synthetic-reviewer-1");
  assert.equal(env.provider.counts.audit, 1);
  assert.equal(env.provider.calls[0].candidateText, EXACT, "the reviewing model was shown exactly the stored bytes");

  const artifactId = submitted.artifact.artifact_id;
  const exported = await env.call("export_approved_reply", { case_id: CASE_ID, artifact_id: artifactId });
  assert.equal(exported.isError, false);
  assert.equal(exported.structured.client_text, EXACT);
  assert.equal(exported.structured.client_text_sha256, sha256(EXACT));
  assert.deepEqual(exported.structured.checks, {
    bytes_match_audited_candidate: true,
    audit_passed: true,
    approved_for_delivery: true,
    current_candidate: true,
    case_unchanged_since_draft: true,
    authorization_current: true
  });
  assert.equal(exported.structured.sent_status, "not_sent");
  // The words a model reads: an exact block, the instruction to pass it on unchanged, and no claim of control or of sending.
  assert.equal(between(exported.text, "<<<BEGIN approved client text", "<<<END approved client text>>>"), EXACT);
  assert.match(exported.text, /EXACT APPROVED TEXT/u);
  assert.match(exported.text, /unchanged, character for character/u);
  assert.match(exported.text, /new review through submit_reply_draft/u);
  assert.match(exported.text, /has not been sent/u);
  assert.match(exported.text, /does not control what happens to the text/u);
  assert.doesNotMatch(exported.text, /\b(?:enforce|guarantee|ensure)\b/iu);

  let stored = await env.reload();
  assert.deepEqual(kinds(stored), ["exported"]);
  assert.equal(stored.communication_events[0].provenance.source_ref, "supervisor:export:authenticated_agent");
  assert.equal(stored.communication_events[0].provenance.origin, "application");

  // Exporting twice records one event, and neither is a send.
  const again = await env.call("export_approved_reply", { case_id: CASE_ID, artifact_id: artifactId });
  assert.equal(again.structured.replayed, true);
  assert.equal(again.structured.client_text, EXACT);
  stored = await env.reload();
  assert.deepEqual(kinds(stored), ["exported"]);
  const status = await env.ok("get_reply_draft_status", { case_id: CASE_ID, artifact_id: artifactId });
  assert.equal(status.artifact.delivery.exported.event_id, exported.structured.event.event_id);
  assert.equal(status.artifact.delivery.reported_sent, null);
  assert.equal(status.artifact.delivery.transport_or_recipient_acknowledged, false);
});

test("a companion is supervisor-only: never shown to the reviewing model, never inside the client block", async (t) => {
  const env = await makeReplyEnvironment(t);
  const companion = { language: "es", text: "Respuesta sintética solo para la supervisión." };
  const submitted = await approved(env, EXACT, "key-companion", { companion });
  assert.equal(submitted.artifact.companion.audience, "supervisor");
  assert.equal(submitted.artifact.companion.client_send_allowed, false);
  assert.equal(JSON.stringify(submitted).includes(companion.text), false);
  assert.equal(env.provider.calls.some((call) => call.shown.includes(companion.text)), false, "the reviewing model never sees the companion");

  const record = await env.reload();
  const stored = record.supervisor_artifacts.find((entry) => entry.kind === "companion");
  assert.equal(stored.text, companion.text);
  assert.equal(stored.audience, "supervisor");
  assert.equal(stored.client_send_allowed, false);
  assert.equal(stored.supplied_by.channel, "authenticated_agent");
  assert.equal(stored.meaning_review.status, "unreviewed");

  const exported = await env.call("export_approved_reply", { case_id: CASE_ID, artifact_id: submitted.artifact.artifact_id });
  assert.equal(exported.structured.companion.audience, "supervisor");
  assert.equal(exported.structured.companion.client_send_allowed, false);
  assert.equal(exported.structured.companion.text, companion.text);
  const clientBlock = between(exported.text, "<<<BEGIN approved client text", "<<<END approved client text>>>");
  assert.equal(clientBlock, EXACT);
  assert.equal(clientBlock.includes(companion.text), false);
  assert.match(exported.text, /FOR THE SUPERVISOR ONLY, never for the client/u);
  assert.equal(between(exported.text, "<<<BEGIN supervisor-only companion", "<<<END supervisor-only companion>>>"), companion.text);
  assert.ok(exported.text.indexOf(companion.text) > exported.text.indexOf("<<<END approved client text>>>"));
  const events = (await env.reload()).communication_events;
  assert.deepEqual(events.map((event) => `${event.audience}:${event.subject.kind}`), ["client:candidate", "supervisor:companion"]);

  // A blank or malformed companion is refused before anything is stored.
  const before = await env.fingerprint();
  assert.equal((await env.refused("submit_reply_draft", { case_id: CASE_ID, source: "external_draft", text: "Synthetic.", idempotency_key: "key-blank", companion: { language: "es", text: "   " } })).code, "REPLY_DRAFT_REQUEST_INVALID");
  assert.equal((await env.refused("submit_reply_draft", { case_id: CASE_ID, source: "external_draft", text: "Synthetic.", idempotency_key: "key-lang", companion: { language: "not a language", text: "x" } })).code, "REPLY_DRAFT_ARGUMENTS_INVALID");
  assert.equal(await env.fingerprint(), before);
});

test("a backend-produced draft is written by InnerSignal's runtime and reviewed by a different context", async (t) => {
  const env = await makeReplyEnvironment(t, { produced: "Synthetic backend reply.\r\n\r\nWhich signal changed first?" });
  const submitted = await env.ok("submit_reply_draft", { case_id: CASE_ID, source: "backend_produced", idempotency_key: "key-backend" });
  assert.equal(submitted.status, "approved");
  assert.equal(submitted.artifact.source, "backend_produced");
  assert.equal(submitted.artifact.exposure.exact_bytes, "produced_by_backend");
  assert.equal(env.runtime.producedCalls.length, 1);
  assert.equal(env.runtime.producedCalls[0].userTurnId, "E2-user");
  const [candidate] = (await env.reload()).candidate_responses;
  assert.equal(candidate.producer_context_id, "context:producer:backend");
  assert.notEqual(candidate.audit_history[0].auditor_context_id, candidate.producer_context_id);
  const exported = await env.call("export_approved_reply", { case_id: CASE_ID, artifact_id: submitted.artifact.artifact_id });
  assert.equal(exported.structured.client_text, "Synthetic backend reply.\r\n\r\nWhich signal changed first?");

  // The two sources take what they should: text is required for an external draft and not allowed for a backend one.
  const before = await env.fingerprint();
  assert.equal((await env.refused("submit_reply_draft", { case_id: CASE_ID, source: "backend_produced", text: "Synthetic.", idempotency_key: "key-backend-text" })).code, "REPLY_DRAFT_TEXT_NOT_ALLOWED");
  assert.equal((await env.refused("submit_reply_draft", { case_id: CASE_ID, source: "external_draft", idempotency_key: "key-no-text" })).code, "REPLY_DRAFT_TEXT_REQUIRED");
  assert.equal((await env.refused("submit_reply_draft", { case_id: CASE_ID, source: "external_draft", text: "  \n ", idempotency_key: "key-blank-text" })).code, "REPLY_DRAFT_TEXT_REQUIRED");
  assert.equal(await env.fingerprint(), before);
});

// --- repair, the repair limit, and edited text --------------------------------------------------------------------------

test("when the review repairs a draft, the approved text is the repaired text and the submitted version is not exportable", async (t) => {
  const env = await makeReplyEnvironment(t, { verdicts: ["fail", "pass"] });
  const submitted = await approved(env, "Synthetic outside reply.", "key-repair");
  assert.equal(submitted.artifact.source, "backend_repair");
  assert.equal(submitted.artifact.root_source, "external_draft");
  assert.equal(submitted.artifact.review.repair_cycle, 1);
  assert.notEqual(submitted.artifact.text_sha256, sha256("Synthetic outside reply."));
  assert.deepEqual(submitted.artifact.review.lineage.map((entry) => `v${entry.candidate_version}:${entry.status}`), ["v1:superseded", "v2:approved_for_delivery"]);
  assert.equal(env.provider.counts.audit, 2);
  assert.equal(env.provider.counts.repair, 1);

  const exported = await env.call("export_approved_reply", { case_id: CASE_ID, artifact_id: submitted.artifact.artifact_id });
  assert.equal(exported.structured.client_text, "Synthetic repaired reply 1.");
  assert.notEqual(exported.structured.client_text, "Synthetic outside reply.");

  // What the owner's assistant first wrote has no approval: its own artifact is refused.
  const record = await env.reload();
  const original = record.candidate_responses.find((candidate) => candidate.version === 1);
  const refusal = await env.refused("export_approved_reply", { case_id: CASE_ID, artifact_id: supervisorArtifactId(CASE_ID, original) });
  assert.match(refusal.code, /^SUPERVISOR_ARTIFACT_(?:STALE|NOT_APPROVED)$/u);

  // A retry of the same request returns the stored outcome without another review.
  const retried = await env.submit({ text: "Synthetic outside reply.", idempotency_key: "key-repair" });
  assert.equal(retried.replayed, true);
  assert.equal(retried.status, "approved");
  assert.equal(retried.artifact.artifact_id, submitted.artifact.artifact_id);
  assert.equal(env.provider.counts.audit, 2);
});

test("a draft the review keeps failing is blocked at the repair limit: nothing is approved and nothing can be exported", async (t) => {
  const env = await makeReplyEnvironment(t, { verdicts: ["fail"] });
  const blocked = await env.submit({ text: "Synthetic outside reply.", idempotency_key: "key-blocked" });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.exportable, false);
  assert.equal(blocked.artifact.approved, false);
  assert.equal(blocked.artifact.review.repair_cycle, 2);
  assert.match(blocked.notice, /repair limit/u);
  assert.equal(env.provider.counts.audit, 3);
  assert.equal(env.provider.counts.repair, 2);

  const record = await env.reload();
  assert.equal(record.candidate_responses.some((candidate) => candidate.status === "approved_for_delivery"), false);
  assert.equal(record.candidate_responses.every((candidate) => !candidate.audit_history.some((audit) => audit.sufficient_for_approval)), true);
  const refusal = await env.refused("export_approved_reply", { case_id: CASE_ID, artifact_id: blocked.artifact.artifact_id });
  assert.equal(refusal.code, "SUPERVISOR_ARTIFACT_NOT_APPROVED");
  assert.deepEqual(kinds(await env.reload()), []);

  // Asking again does not review again and does not approve.
  const again = await env.ok("get_reply_draft_status", { case_id: CASE_ID, idempotency_key: "key-blocked" });
  assert.equal(again.status, "blocked");
  const retried = await env.submit({ text: "Synthetic outside reply.", idempotency_key: "key-blocked" });
  assert.equal(retried.status, "blocked");
  assert.equal(env.provider.counts.audit, 3);
});

test("edited or paraphrased text inherits no approval: it is a new draft and a new review", async (t) => {
  const env = await makeReplyEnvironment(t, { verdicts: ["pass", "pass", "fail"] });
  const first = await approved(env, "Synthetic reply, first wording.", "key-a");
  assert.equal(env.provider.counts.audit, 1);

  // The same key with edited words is a conflict, not a new approval.
  const conflict = await env.refused("submit_reply_draft", { case_id: CASE_ID, source: "external_draft", text: "Synthetic reply, edited wording.", idempotency_key: "key-a" });
  assert.equal(conflict.code, "SUPERVISOR_IDEMPOTENCY_CONFLICT");
  assert.deepEqual(conflict.reasons, ["exact_text"]);
  assert.equal(env.provider.counts.audit, 1);

  // Edited words under a new key are reviewed from the start; the first draft is then no longer current.
  const second = await approved(env, "Synthetic reply, edited wording.", "key-b");
  assert.equal(env.provider.counts.audit, 2);
  assert.notEqual(second.artifact.artifact_id, first.artifact.artifact_id);
  assert.equal((await env.refused("export_approved_reply", { case_id: CASE_ID, artifact_id: first.artifact.artifact_id })).code, "SUPERVISOR_ARTIFACT_STALE");
  const exported = await env.call("export_approved_reply", { case_id: CASE_ID, artifact_id: second.artifact.artifact_id });
  assert.equal(exported.structured.client_text, "Synthetic reply, edited wording.");

  // A paraphrase the review does not pass is never approved, whatever its predecessor was.
  const third = await env.submit({ text: "Synthetic reply, paraphrased wording.", idempotency_key: "key-c" });
  assert.equal(third.status, "blocked");
  assert.equal((await env.refused("export_approved_reply", { case_id: CASE_ID, artifact_id: third.artifact.artifact_id })).code, "SUPERVISOR_ARTIFACT_NOT_APPROVED");
  assert.equal((await env.refused("export_approved_reply", { case_id: CASE_ID, artifact_id: second.artifact.artifact_id })).code, "SUPERVISOR_ARTIFACT_STALE");
  // And an artifact id that names nothing the case holds is simply not found.
  assert.equal((await env.refused("export_approved_reply", { case_id: CASE_ID, artifact_id: `art_${"0".repeat(40)}` })).code, "SUPERVISOR_ARTIFACT_NOT_FOUND");
});

// --- no review runtime --------------------------------------------------------------------------------------------------

test("with no model access the tools say so, store nothing and approve nothing", async (t) => {
  const env = await makeReplyEnvironment(t, { reviewAvailable: false });
  assert.equal(env.tools.reviewAvailable, false);
  const before = await env.fingerprint();
  for (const args of [
    { source: "external_draft", text: "Synthetic outside reply.", idempotency_key: "key-none" },
    { source: "backend_produced", idempotency_key: "key-none-backend" }
  ]) {
    const refusal = await env.refused("submit_reply_draft", { case_id: CASE_ID, ...args });
    assert.equal(refusal.code, "SUPERVISOR_REVIEW_UNAVAILABLE");
  }
  assert.equal(await env.fingerprint(), before, "nothing was stored, not even a pending draft");
  assert.equal(env.provider.counts.audit, 0);
  assert.equal((await env.refused("get_reply_draft_status", { case_id: CASE_ID, idempotency_key: "key-none" })).code, "SUPERVISOR_ARTIFACT_NOT_FOUND");
  // Reading is not reviewing.
  const context = await env.ok("get_reply_draft_context", { case_id: CASE_ID });
  assert.equal(context.case_id, CASE_ID);
  assert.equal(await env.fingerprint(), before);
});

test("after a restart without model access, a pending draft stays unapproved and an already approved one is still readable", async (t) => {
  const outage = { down: false };
  const first = await makeReplyEnvironment(t, {
    hooks: { beforeAudit: async () => { if (outage.down) throw Object.assign(new Error("synthetic provider outage"), { code: "SYNTHETIC_OUTAGE" }); } }
  });
  const done = await approved(first, "Synthetic reply, reviewed while the model was up.", "key-done");
  // The next draft's review fails inside the model call: the draft is stored but nothing is approved.
  outage.down = true;
  const interrupted = await first.refused("submit_reply_draft", { case_id: CASE_ID, source: "external_draft", text: "Synthetic reply, interrupted.", idempotency_key: "key-pending" });
  assert.equal(interrupted.code, "SUPERVISOR_REVIEW_UNAVAILABLE");
  const pendingRecord = await first.reload();
  assert.equal(pendingRecord.candidate_responses.find((candidate) => candidate.exact_text === "Synthetic reply, interrupted.").status, "pending_audit");

  const second = await makeReplyEnvironment(t, { rootDir: first.rootDir, reviewAvailable: false });
  const read = await second.ok("get_reply_draft_status", { case_id: CASE_ID, artifact_id: done.artifact.artifact_id });
  assert.equal(read.artifact.artifact_id, done.artifact.artifact_id);
  assert.equal((await second.refused("get_reply_draft_status", { case_id: CASE_ID, idempotency_key: "key-pending" })).code, "SUPERVISOR_REVIEW_UNAVAILABLE");
  const after = await second.reload();
  assert.equal(after.candidate_responses.find((candidate) => candidate.exact_text === "Synthetic reply, interrupted.").status, "pending_audit");
  assert.equal(second.provider.counts.audit, 0);
});

// --- retries, basis, freshness, revocation ------------------------------------------------------------------------------

test("retries are compared by part A: the same request is answered from storage, any difference is refused in fixed words", async (t) => {
  const env = await makeReplyEnvironment(t);
  const first = await approved(env, "Synthetic outside reply.", "key-same");
  const same = await env.submit({ text: "Synthetic outside reply.", idempotency_key: "key-same" });
  assert.equal(same.replayed, true);
  assert.equal(same.artifact.artifact_id, first.artifact.artifact_id);
  assert.equal(env.provider.counts.audit, 1, "a retry is not reviewed again");

  const before = await env.fingerprint();
  const reasonsFor = async (change) => {
    const refusal = await env.refused("submit_reply_draft", { case_id: CASE_ID, source: "external_draft", text: "Synthetic outside reply.", idempotency_key: "key-same", ...change });
    assert.equal(refusal.code, "SUPERVISOR_IDEMPOTENCY_CONFLICT");
    assert.ok(refusal.reasons.every((reason) => /^[a-z_]{1,60}$/u.test(reason)));
    return refusal.reasons;
  };
  assert.deepEqual(await reasonsFor({ text: "A different synthetic reply." }), ["exact_text"]);
  assert.deepEqual(await reasonsFor({ companion: { language: "es", text: "Respuesta sintética." } }), ["companion"]);
  assert.ok((await reasonsFor({ source: "backend_produced", text: undefined })).includes("source"));
  assert.deepEqual(await reasonsFor({ basis_sha256: "f".repeat(64) }), ["basis"]);
  assert.equal(await env.fingerprint(), before, "a refused retry changes nothing");
  assert.equal(env.provider.counts.audit, 1);

  // The same key means a different operation in a different case.
  const other = await env.submit({ case_id: OTHER_CASE_ID, text: "Synthetic outside reply.", idempotency_key: "key-same" });
  assert.equal(other.replayed, false);
  assert.equal(other.case_id, OTHER_CASE_ID);
  assert.equal(env.provider.counts.audit, 2);
});

test("a draft stated against an earlier state of the case is refused, and nothing is stored", async (t) => {
  const env = await makeReplyEnvironment(t);
  const context = await env.ok("get_reply_draft_context", { case_id: CASE_ID });
  const basis = context.basis.sha256;
  assert.match(basis, /^[a-f0-9]{64}$/u);
  const fresh = await approved(env, "Synthetic outside reply.", "key-basis", { basis_sha256: basis });
  assert.equal(fresh.artifact.basis_sha256, basis);

  await env.appendClientMessage();
  const before = await env.fingerprint();
  const refusal = await env.refused("submit_reply_draft", { case_id: CASE_ID, source: "external_draft", text: "Synthetic reply to the newer message.", idempotency_key: "key-basis-2", basis_sha256: basis });
  assert.equal(refusal.code, "SUPERVISOR_BASIS_CHANGED");
  assert.equal(await env.fingerprint(), before);
  assert.equal(env.provider.counts.audit, 1);
  const moved = await env.ok("get_reply_draft_context", { case_id: CASE_ID });
  assert.notEqual(moved.basis.sha256, basis);
  const second = await approved(env, "Synthetic reply to the newer message.", "key-basis-2", { basis_sha256: moved.basis.sha256 });
  assert.equal(second.artifact.basis_sha256, moved.basis.sha256);
});

test("an approved draft that the case has moved past is refused at export, and nothing is recorded", async (t) => {
  const env = await makeReplyEnvironment(t);
  const submitted = await approved(env);
  await env.appendClientMessage();
  const before = await env.fingerprint();
  const refusal = await env.refused("export_approved_reply", { case_id: CASE_ID, artifact_id: submitted.artifact.artifact_id });
  assert.equal(refusal.code, "SUPERVISOR_ARTIFACT_STALE");
  assert.equal(await env.fingerprint(), before);
  assert.deepEqual(kinds(await env.reload()), []);
  const status = await env.ok("get_reply_draft_status", { case_id: CASE_ID, artifact_id: submitted.artifact.artifact_id });
  assert.equal(status.exportable, false);
  assert.equal(status.artifact.fresh, false);
  assert.ok(status.artifact.stale_reasons.length > 0);
});

test("revoking the caller's access stops the next export, status and report at once", async (t) => {
  const env = await makeReplyEnvironment(t);
  const submitted = await approved(env);
  const artifactId = submitted.artifact.artifact_id;
  env.revoked.add("token-reply-only");
  const before = await env.fingerprint();
  for (const [name, args] of [
    ["export_approved_reply", { case_id: CASE_ID, artifact_id: artifactId }],
    ["report_reply_sent", { case_id: CASE_ID, artifact_id: artifactId }],
    ["get_reply_draft_status", { case_id: CASE_ID, artifact_id: artifactId }],
    ["get_reply_draft_context", { case_id: CASE_ID }],
    ["submit_reply_draft", { case_id: CASE_ID, source: "external_draft", text: "Synthetic.", idempotency_key: "key-after" }]
  ]) {
    const answer = await env.call(name, args);
    assert.equal(answer.status, 401, name);
    assert.match(answer.headers.get("www-authenticate"), /^Bearer/u);
    assert.equal(JSON.stringify(answer.body).includes("Second line"), false);
  }
  assert.equal(await env.fingerprint(), before, "a revoked caller changed nothing and released nothing");
  assert.deepEqual(kinds(await env.reload()), []);
  env.revoked.delete("token-reply-only");
  assert.equal((await env.call("export_approved_reply", { case_id: CASE_ID, artifact_id: artifactId })).isError, false);
});

// --- the report that a reply was sent -----------------------------------------------------------------------------------

test("a report that a reply was sent is always an agent-relayed, unresolved report, whatever the request says", async (t) => {
  const env = await makeReplyEnvironment(t);
  const submitted = await approved(env);
  const artifactId = submitted.artifact.artifact_id;

  // Nothing has been exported yet to report on, and a draft the owner never received cannot be named by guesswork.
  assert.equal((await env.refused("report_reply_sent", { case_id: CASE_ID })).code, "SUPERVISOR_NO_REPORTABLE_DRAFT");
  await env.call("export_approved_reply", { case_id: CASE_ID, artifact_id: artifactId });

  // A request cannot say who it is: there is no argument for it, and a claim is a schema error that changes nothing.
  const before = await env.fingerprint();
  for (const claim of [{ origin: "owner_action" }, { actor_resolution: "owner_verified" }, { channel: "owner_ui" }, { owner_channel: true }, { ownerChannel: true }, { provenance: { origin: "owner_action" } }]) {
    const refusal = await env.refused("report_reply_sent", { case_id: CASE_ID, artifact_id: artifactId, ...claim });
    assert.equal(refusal.code, "REPLY_DRAFT_ARGUMENTS_INVALID");
  }
  assert.equal(await env.fingerprint(), before);

  const reported = await env.ok("report_reply_sent", { case_id: CASE_ID, artifact_id: artifactId, sent_at: "2026-10-03T09:30:00.000Z", quote: "I sent it this morning.", source_ref: "chat:synthetic-1", idempotency_key: "key-report" });
  assert.equal(reported.event.kind, "reported_sent");
  assert.equal(reported.event.provenance.origin, "agent_relayed");
  assert.equal(reported.event.provenance.actor_resolution, "unresolved");
  assert.equal(reported.event.sent_at, "2026-10-03T09:30:00.000Z");
  assert.equal(reported.event.sent_at_status, "known");
  assert.equal(reported.artifact.delivery.reported_sent.origin, "agent_relayed");
  assert.equal(reported.artifact.delivery.reported_sent.actor_resolution, "unresolved");
  assert.equal(reported.artifact.delivery.transport_or_recipient_acknowledged, false);
  assert.match(reported.notice, /relayed by an agent/u);
  assert.match(reported.notice, /Nothing was sent/u);

  const record = await env.reload();
  assert.deepEqual(kinds(record), ["exported", "reported_sent"]);
  assert.equal(record.communication_events.every((event) => event.provenance.origin !== "owner_action"), true);
  assert.equal(record.communication_events.some((event) => event.provenance.actor_resolution === "owner_verified"), false);

  // A retry with the same key is the same report; the same key with different words is a conflict.
  const retried = await env.ok("report_reply_sent", { case_id: CASE_ID, artifact_id: artifactId, sent_at: "2026-10-03T09:30:00.000Z", quote: "I sent it this morning.", source_ref: "chat:synthetic-1", idempotency_key: "key-report" });
  assert.equal(retried.replayed, true);
  assert.equal((await env.reload()).communication_events.length, 2);
  const conflict = await env.refused("report_reply_sent", { case_id: CASE_ID, artifact_id: artifactId, quote: "A different quote.", idempotency_key: "key-report" });
  assert.equal(conflict.code, "SUPERVISOR_IDEMPOTENCY_CONFLICT");
  // An unknown send time stays unknown, and a malformed one is refused.
  assert.equal((await env.refused("report_reply_sent", { case_id: CASE_ID, artifact_id: artifactId, sent_at: "yesterday-ish", idempotency_key: "key-bad-time" })).code, "REPLY_DRAFT_REQUEST_INVALID");
});

test("the context tool reads the case and records nothing, not even the question", async (t) => {
  const env = await makeReplyEnvironment(t);
  const before = await env.fingerprint();
  const context = await env.ok("get_reply_draft_context", { case_id: CASE_ID });
  assert.equal(await env.fingerprint(), before);
  assert.equal(context.connector.recorded, "nothing");
  assert.equal(context.connector.channel, "authenticated_agent");
  assert.equal(context.latest_client_turn.text, "Synthetic newest client message waiting for a reply.");
  assert.equal("recorded_inputs" in context, false);
  assert.match(context.basis.sha256, /^[a-f0-9]{64}$/u);
  const drafted = await approved(env, "Synthetic outside reply.", "key-ctx");
  const later = await env.ok("get_reply_draft_context", { case_id: CASE_ID });
  assert.equal(later.artifacts.some((artifact) => artifact.artifact_id === drafted.artifact.artifact_id), true);
});

// --- records and handoffs from before the tools -------------------------------------------------------------------------

test("a case with a handoff from before the tools works through them; the handoff is left as it was, and the record and later handoffs still load", async (t) => {
  const env = await makeReplyEnvironment(t);
  const earlier = await env.store.createHandoff(CASE_ID, { handoffId: "handoff:00000000-0000-4000-8000-000000000201", runtimeVersion: "synthetic-runtime", auditVersion: "synthetic-audit" });
  const before = await env.store.loadHandoff(CASE_ID, earlier.handoff_id);
  const recordBefore = await env.reload();
  assert.doesNotThrow(() => validatePrivateCaseRecord(structuredClone(recordBefore)), "the case as it stood before the tools is a valid record");

  const context = await env.ok("get_reply_draft_context", { case_id: CASE_ID });
  assert.deepEqual(context.artifacts, []);
  const submitted = await approved(env, "Synthetic reply on a case that already has a handoff.", "key-old");
  await env.ok("export_approved_reply", { case_id: CASE_ID, artifact_id: submitted.artifact.artifact_id });

  assert.deepEqual(await env.store.loadHandoff(CASE_ID, earlier.handoff_id), before, "an earlier handoff is unchanged by the tools");
  const record = await env.reload();
  assert.doesNotThrow(() => validatePrivateCaseRecord(structuredClone(record)), "the record the tools wrote is a valid record");
  assert.equal(record.schema_version, 7, "no new record version");

  const later = await env.store.createHandoff(CASE_ID, { handoffId: "handoff:00000000-0000-4000-8000-000000000202", runtimeVersion: "synthetic-runtime", auditVersion: "synthetic-audit" });
  const { artifact_manifest: manifest, encrypted_round_trip_verified: verified, ...packet } = await env.store.loadHandoff(CASE_ID, later.handoff_id);
  assert.equal(verified, true);
  assert.ok(manifest.utf8_bytes > 0);
  assert.doesNotThrow(() => validatePrivateHandoffPacket(structuredClone(packet)), "a handoff written after an exported draft opens and validates");
});
