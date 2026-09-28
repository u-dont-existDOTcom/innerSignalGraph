import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createCorpusJournalJobLedger,
  createJournalImportController,
  createMemoryJournalJobLedger
} from "../src/journal-import/controller.mjs";
import {
  buildJournalRolePacket,
  createMockJournalInferencePort,
  createProviderJournalInferencePort,
  JournalInferencePortError
} from "../src/journal-import/provider-port.mjs";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";
import { loadJournalInferencePortFromEnvironment } from "../src/journal-import/provider-runtime.mjs";
import { createDurableJournalInferencePort } from "../src/journal-import/durable-inference.mjs";

const grant = Object.freeze({
  grant_id: "grant:synthetic",
  principal_id: "principal:synthetic",
  purpose: "organize_search",
  allowed_roles: ["extractor", "omission_checker", "reconciler"],
  revoked: false,
  expires_at: null
});

const completeExtraction = () => ({
  schema_version: "1.0",
  status: "complete",
  assertions: [],
  entities: [],
  episodes: [],
  coverage: [{ unit_id: "unit:synthetic", disposition: "no_assertion", assertion_local_ids: [], reason: null }],
  requested_context: []
});
const incompleteExtraction = () => ({
  schema_version: "1.0",
  status: "incomplete",
  assertions: [],
  entities: [],
  episodes: [],
  coverage: [{ unit_id: "unit:synthetic", disposition: "pending", assertion_local_ids: [], reason: "neighbor required" }],
  requested_context: [{ unit_id: "unit:synthetic", direction: "after", reason: "complete the invented sentence" }]
});
const omissionResult = () => ({
  schema_version: "1.0",
  target_generation: "generation:synthetic",
  review_role: "omission_checker",
  assessments: [],
  proposed_repairs: [],
  unassessed_ids: [],
  status: "sufficient_for_stated_scope"
});
const reconciliationResult = () => ({
  schema_version: "1.0",
  target_generation: "generation:synthetic",
  proposals: [],
  unresolved_ids: [],
  status: "proposals_complete"
});

function workDefinitions() {
  const identity = { source_representation: "representation:synthetic", core_range: { start_byte: 0, end_byte: 19 } };
  const assignment = { assigned_core_ids: ["unit:synthetic"], source_locators: [{ representation_id: "representation:synthetic", start_byte: 0, end_byte: 19 }] };
  return [
    {
      key: "extract",
      stage: "EXTRACT",
      role: "extractor",
      identity,
      ...assignment,
      packet_input: {
        core_units: [{ unit_id: "unit:synthetic", text: "invented source text" }],
        adjacent_context: { before: "", after: "" },
        visual_transcriptions: []
      }
    },
    {
      key: "omission",
      stage: "OMISSION_CHECK",
      role: "omission_checker",
      identity,
      ...assignment,
      packet_input: {
        core_units: [{ unit_id: "unit:synthetic", text: "invented source text" }],
        adjacent_context: { before: "", after: "" },
        candidate_extraction: { $work_output: "extract" },
        target_generation: "generation:synthetic"
      }
    },
    {
      key: "reconcile",
      stage: "RECONCILE",
      role: "reconciler",
      identity,
      ...assignment,
      packet_input: {
        candidates: { extraction: { $work_output: "extract" }, omission: { $work_output: "omission" } },
        neighborhood_evidence: [],
        target_generation: "generation:synthetic"
      }
    }
  ];
}

async function temporaryStore() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-controller-"));
  await fs.chmod(rootDir, 0o700);
  return createPrivateJournalCorpusStore({ rootDir, caseId: "synthetic-case", corpusId: "synthetic-corpus", corpusKey: Buffer.alloc(32, 41) });
}

function initialization() {
  return {
    jobId: "job:synthetic",
    caseId: "synthetic-case",
    corpusId: "synthetic-corpus",
    generation: "generation:synthetic",
    workDefinitions: workDefinitions(),
    completion: { archive_verified: "pass", raw_search_available: "pass" }
  };
}

test("role packet allowlists reject producer-context leakage and mock capability is spend-free", () => {
  assert.throws(() => buildJournalRolePacket("extractor", {
    protocol_version: "1.0",
    output_schema_id: "extraction-result",
    assigned_core_ids: [],
    source_locators: [],
    expected_generation: "generation:synthetic",
    controller_provenance_tag: "work:synthetic",
    grant_purpose: "organize_search",
    core_units: [],
    adjacent_context: {},
    visual_transcriptions: [],
    prior_case_formulation: "must not cross the role boundary"
  }), /JOURNAL_ROLE_PACKET_FIELD_NOT_ALLOWED/);
  const port = createMockJournalInferencePort({ handlers: { extractor: completeExtraction } });
  const capabilities = port.capabilities();
  assert.equal(capabilities.live_inference, false);
  assert.equal(capabilities.external_spend_authorized_usd, 0);
  assert.equal(capabilities.roles.extractor.available, true);
  assert.equal(capabilities.roles.reference_reader.available, false);
  port.close();
});

test("live journal inference accepts only packet-isolated fresh contexts with an evidenced allowance", async (t) => {
  let calls = 0;
  const provider = {
    model: "synthetic-live-model",
    privateInferenceIsolation: {
      packetOnly: true,
      freshContextPerGenerate: true,
      tools: false,
      filesystem: false,
      sessionPersistence: false,
      transport: "synthetic-isolated-provider"
    },
    async generate({ system, user, outputSchema, sealed, metadata }) {
      calls += 1;
      assert.match(system, /application reasoning role/);
      assert.equal(JSON.parse(user).controller_provenance_tag, "work:synthetic:live");
      assert.deepEqual(outputSchema.required, ["schema_version", "status", "assertions", "entities", "episodes", "coverage", "requested_context"]);
      assert.equal(sealed, true);
      assert.equal(metadata.routeRef, "route:synthetic:zero-cost");
      return {
        text: JSON.stringify(completeExtraction()),
        requestId: `request:synthetic:${calls}`,
        responseId: `context:synthetic:${calls}`,
        model: "synthetic-live-model",
        effort: "synthetic-high",
        usage: { input_tokens: 10, output_tokens: 5 },
        costUsd: 0
      };
    }
  };
  const options = {
    provider,
    receiptKey: Buffer.alloc(32, 81),
    routeRef: "route:synthetic:zero-cost",
    allowanceEvidence: { authorization_ref: "allowance:synthetic:zero-cost", maximum_incremental_cost_usd: 0 },
    maxExternalSpendUsd: 0,
    configuredModelProfile: "synthetic-live-model",
    configuredEffort: "synthetic-high"
  };
  const port = createProviderJournalInferencePort(options);
  t.after(() => port.close());
  const packet = buildJournalRolePacket("extractor", {
    protocol_version: "1.0",
    output_schema_id: "extraction-result",
    assigned_core_ids: ["unit:synthetic"],
    source_locators: [{ representation_id: "representation:synthetic", start_byte: 0, end_byte: 19 }],
    expected_generation: "generation:synthetic",
    controller_provenance_tag: "work:synthetic:live",
    grant_purpose: grant.purpose,
    core_units: [{ unit_id: "unit:synthetic", text: "invented source text" }],
    adjacent_context: { before: "", after: "" },
    visual_transcriptions: []
  });
  const input = { role: "extractor", packet, outputSchema: "extraction-result", operationKey: "operation:synthetic:live", grant };
  const first = await port.invoke(input);
  const replay = await port.invoke(input);
  assert.equal(first.output.status, "complete");
  assert.equal(first.receipt.request_context_id, "context:synthetic:1");
  assert.equal(first.receipt.cost_usd, 0);
  assert.equal(replay.receipt.replay, true);
  assert.equal(calls, 1);
  assert.equal(port.capabilities().packet_only, true);
  assert.throws(() => createProviderJournalInferencePort({ ...options, allowanceEvidence: null }), /INFERENCE_ALLOWANCE_UNVERIFIED/);
  assert.throws(() => createProviderJournalInferencePort({
    ...options,
    provider: { ...provider, privateInferenceIsolation: { ...provider.privateInferenceIsolation, filesystem: true } }
  }), /INFERENCE_FILESYSTEM_MUST_BE_DISABLED/);
});

test("inference runtime stays disabled without a route and binds only explicit provider credentials", (t) => {
  const disabled = loadJournalInferencePortFromEnvironment({});
  assert.equal(disabled.capabilities().enabled, false);
  let receivedOptions = null;
  const fakeProvider = {
    model: "synthetic-model",
    privateInferenceIsolation: {
      packetOnly: true,
      freshContextPerGenerate: true,
      tools: false,
      filesystem: false,
      sessionPersistence: false,
      transport: "synthetic-provider"
    },
    async generate() { throw new Error("not invoked by configuration test"); }
  };
  const configured = loadJournalInferencePortFromEnvironment({
    INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON: JSON.stringify({
      schema_version: 1,
      route_ref: "route:synthetic:configured",
      provider: "openai",
      model: "synthetic-model",
      effort: "synthetic-high",
      timeout_ms: 10_000,
      max_output_tokens: 2_000,
      max_external_spend_usd: 0,
      allowance_evidence: { authorization_ref: "allowance:synthetic:configured", maximum_incremental_cost_usd: 0 }
    }),
    INNER_SIGNAL_JOURNAL_INFERENCE_RECEIPT_KEY_BASE64: Buffer.alloc(32, 91).toString("base64"),
    OPENAI_API_KEY: "synthetic-not-a-live-key"
  }, {
    providerFactories: {
      openai(options) { receivedOptions = options; return fakeProvider; }
    }
  });
  t.after(() => configured.close());
  assert.equal(receivedOptions.apiKey, "synthetic-not-a-live-key");
  assert.equal(receivedOptions.model, "synthetic-model");
  assert.equal(configured.capabilities().route_ref, "route:synthetic:configured");
});

test("persisted intent survives a crash after submission and restart reuses exact completed output", async () => {
  const store = await temporaryStore();
  const counts = { extractor: 0, omission_checker: 0, reconciler: 0 };
  const port = createMockJournalInferencePort({ handlers: {
    extractor(packet) { counts.extractor += 1; assert.equal(packet.core_units[0].text, "invented source text"); return completeExtraction(); },
    omission_checker(packet) { counts.omission_checker += 1; assert.equal(packet.candidate_extraction.status, "complete"); return omissionResult(); },
    reconciler(packet) { counts.reconciler += 1; assert.equal(packet.candidates.omission.review_role, "omission_checker"); return reconciliationResult(); }
  } });
  const firstLedger = createCorpusJournalJobLedger({ corpusStore: store, jobId: "job:synthetic" });
  let crashed = false;
  const firstController = createJournalImportController({
    ledger: firstLedger,
    inferencePort: port,
    controllerSecret: Buffer.alloc(32, 43),
    grant,
    afterInvokeBeforeCheckpoint() {
      if (!crashed) { crashed = true; throw new Error("SIMULATED_PROCESS_CRASH"); }
    }
  });
  await firstController.initialize(initialization());
  await assert.rejects(() => firstController.step(), /SIMULATED_PROCESS_CRASH/);
  assert.equal((await firstController.status()).state, "running");
  firstController.close();

  const restartedLedger = createCorpusJournalJobLedger({ corpusStore: store, jobId: "job:synthetic" });
  const restarted = createJournalImportController({
    ledger: restartedLedger,
    inferencePort: port,
    controllerSecret: Buffer.alloc(32, 43),
    grant
  });
  const finished = await restarted.runUntilBlocked();
  assert.equal(finished.snapshot.checkpoint.stage, "GRAPH_VALIDATE");
  assert.equal(finished.snapshot.checkpoint.state, "ready");
  assert.equal(finished.snapshot.checkpoint.completed_work_ids.length, 3);
  assert.equal(finished.snapshot.checkpoint.private_receipt_refs.length, 3);
  assert.deepEqual(counts, { extractor: 1, omission_checker: 1, reconciler: 1 });
  assert.ok(finished.snapshot.work_items.every((work) => work.output && work.receipt && !Object.hasOwn(work.output, "request_context_id")));
  restarted.close();
  port.close();
  store.close();
});

test("an ambiguous submission is queried but never automatically resubmitted", async () => {
  let invokes = 0;
  const port = {
    capabilities: () => ({ mode: "synthetic-ambiguous" }),
    async invoke() { invokes += 1; throw new JournalInferencePortError("COMPLETION_UNKNOWN", { submissionStatus: "unknown" }); },
    async getCompletion() { return { status: "unknown" }; }
  };
  const ledger = createMemoryJournalJobLedger();
  const controller = createJournalImportController({ ledger, inferencePort: port, controllerSecret: Buffer.alloc(32, 45), grant });
  await controller.initialize({ ...initialization(), workDefinitions: [workDefinitions()[0]] });
  const first = await controller.step();
  assert.equal(first.snapshot.checkpoint.blocked_reason, "COMPLETION_UNKNOWN");
  const second = await controller.step();
  assert.equal(second.revision, first.revision);
  assert.equal(invokes, 1);
  controller.close();
});

test("incomplete output checkpoints exact result and resumes only after bounded context is supplied", async () => {
  let invokes = 0;
  const port = createMockJournalInferencePort({ handlers: {
    extractor(packet) {
      invokes += 1;
      return packet.adjacent_context.after ? completeExtraction() : incompleteExtraction();
    }
  } });
  const ledger = createMemoryJournalJobLedger();
  const controller = createJournalImportController({ ledger, inferencePort: port, controllerSecret: Buffer.alloc(32, 47), grant });
  await controller.initialize({ ...initialization(), workDefinitions: [workDefinitions()[0]] });
  const blocked = await controller.runUntilBlocked();
  assert.equal(blocked.snapshot.checkpoint.state, "needs_context");
  assert.equal(blocked.snapshot.work_items[0].output.status, "incomplete");
  assert.equal(invokes, 1);
  await controller.provideContext(blocked.snapshot.work_items[0].work_id, { adjacent_context: { before: "", after: "invented neighbor" } });
  const finished = await controller.runUntilBlocked();
  assert.equal(finished.snapshot.checkpoint.stage, "GRAPH_VALIDATE");
  assert.equal(finished.snapshot.work_items[0].prior_outputs[0].output.status, "incomplete");
  assert.equal(invokes, 2);
  controller.close();
  port.close();
});

test("known-unsent transport failure retries twice at most and malformed output gets one schema-bound reserialization", async (t) => {
  await t.test("confirmed unsent", async () => {
    let invokes = 0;
    const port = createMockJournalInferencePort({ handlers: {
      extractor() {
        invokes += 1;
        if (invokes === 1) throw new JournalInferencePortError("RETRYABLE_TRANSPORT", { submissionStatus: "not_submitted" });
        return completeExtraction();
      }
    } });
    const ledger = createMemoryJournalJobLedger();
    const controller = createJournalImportController({ ledger, inferencePort: port, controllerSecret: Buffer.alloc(32, 51), grant });
    await controller.initialize({ ...initialization(), jobId: "job:retryable", workDefinitions: [workDefinitions()[0]] });
    const finished = await controller.runUntilBlocked();
    assert.equal(finished.snapshot.work_items[0].status, "completed");
    assert.equal(finished.snapshot.work_items[0].attempts, 2);
    assert.equal(invokes, 2);
    controller.close();
    port.close();
  });

  await t.test("invalid structured output", async () => {
    let invokes = 0;
    const port = createMockJournalInferencePort({ handlers: {
      extractor() { invokes += 1; return invokes === 1 ? {} : completeExtraction(); }
    } });
    const ledger = createMemoryJournalJobLedger();
    const controller = createJournalImportController({ ledger, inferencePort: port, controllerSecret: Buffer.alloc(32, 53), grant });
    await controller.initialize({ ...initialization(), jobId: "job:reserialize", workDefinitions: [workDefinitions()[0]] });
    const finished = await controller.runUntilBlocked();
    assert.equal(finished.snapshot.work_items[0].status, "completed");
    assert.equal(finished.snapshot.work_items[0].attempts, 2);
    assert.equal(invokes, 2);
    controller.close();
    port.close();
  });

  await t.test("a delayed invalid second answer is terminal", async () => {
    let invokes = 0;
    let completionStatus = "unknown";
    const port = {
      capabilities: () => ({ mode: "synthetic-delayed-invalid", authoritative_completion: true }),
      async invoke() {
        invokes += 1;
        throw new JournalInferencePortError("COMPLETION_UNKNOWN", { submissionStatus: "unknown" });
      },
      async getCompletion() { return { status: completionStatus }; }
    };
    const ledger = createMemoryJournalJobLedger();
    const controller = createJournalImportController({ ledger, inferencePort: port, controllerSecret: Buffer.alloc(32, 55), grant });
    await controller.initialize({ ...initialization(), jobId: "job:delayed-invalid-final", workDefinitions: [workDefinitions()[0]] });

    let result = await controller.step();
    assert.equal(result.snapshot.work_items[0].status, "completion_unknown");
    completionStatus = "invalid_output";
    result = await controller.step();
    assert.equal(result.snapshot.work_items[0].status, "invalid_output");

    result = await controller.step();
    assert.equal(result.snapshot.work_items[0].attempts, 2);
    assert.equal(result.snapshot.work_items[0].status, "completion_unknown");
    completionStatus = "invalid_output";
    result = await controller.step();
    assert.equal(result.snapshot.work_items[0].status, "blocked_authority");
    assert.equal(result.snapshot.checkpoint.state, "blocked_authority");
    assert.equal(result.snapshot.checkpoint.blocked_reason, "INVALID_STRUCTURED_OUTPUT");
    assert.equal(invokes, 2);
    controller.close();
  });
});

test("a fresh run resets exhausted confirmed-unsent retries but never resends an unknown completion", async (t) => {
  await t.test("confirmed unsent resumes with a fresh budget", async () => {
    const ledger = createMemoryJournalJobLedger();
    let failedInvokes = 0;
    const failedPort = {
      capabilities: () => ({ mode: "synthetic-unsent" }),
      async invoke() { failedInvokes += 1; throw new JournalInferencePortError("RETRYABLE_TRANSPORT", { submissionStatus: "not_submitted" }); },
      async getCompletion() { return { status: "not_submitted" }; }
    };
    const first = createJournalImportController({ ledger, inferencePort: failedPort, controllerSecret: Buffer.alloc(32, 55), grant });
    await first.initialize({ ...initialization(), jobId: "job:fresh-run-unsent", workDefinitions: [workDefinitions()[0]] });
    const exhausted = await first.runUntilBlocked();
    assert.equal(exhausted.snapshot.work_items[0].status, "blocked_authority");
    assert.equal(failedInvokes, 2);
    first.close();

    let recoveredInvokes = 0;
    const recoveredPort = createMockJournalInferencePort({ handlers: { extractor() { recoveredInvokes += 1; return completeExtraction(); } } });
    const second = createJournalImportController({ ledger, inferencePort: recoveredPort, controllerSecret: Buffer.alloc(32, 55), grant });
    const completed = await second.runUntilBlocked();
    assert.equal(completed.snapshot.work_items[0].status, "completed");
    assert.equal(completed.snapshot.work_items[0].attempts, 1);
    assert.equal(recoveredInvokes, 1);
    second.close(); recoveredPort.close();
  });

  await t.test("unknown completion remains parked", async () => {
    const ledger = createMemoryJournalJobLedger();
    let invokes = 0;
    const port = {
      capabilities: () => ({ mode: "synthetic-unknown" }),
      async invoke() { invokes += 1; throw new JournalInferencePortError("COMPLETION_UNKNOWN", { submissionStatus: "unknown" }); },
      async getCompletion() { return { status: "unknown" }; }
    };
    const first = createJournalImportController({ ledger, inferencePort: port, controllerSecret: Buffer.alloc(32, 57), grant });
    await first.initialize({ ...initialization(), jobId: "job:fresh-run-unknown", workDefinitions: [workDefinitions()[0]] });
    await first.runUntilBlocked(); first.close();
    const second = createJournalImportController({ ledger, inferencePort: port, controllerSecret: Buffer.alloc(32, 57), grant });
    const parked = await second.runUntilBlocked();
    assert.equal(parked.snapshot.work_items[0].status, "completion_unknown");
    assert.equal(invokes, 1);
    second.close();
  });
});

test("each restarted confirmed-unsent budget uses fresh durable operation keys", async () => {
  const store = await temporaryStore();
  const ledger = () => createCorpusJournalJobLedger({ corpusStore: store, jobId: "job:retry-epochs" });
  const operationKeys = [];
  let available = false;
  const transport = {
    capabilities: () => ({ mode: "synthetic-authoritative", authoritative_completion: true }),
    async invoke(input) {
      operationKeys.push(input.operationKey);
      if (!available) throw new JournalInferencePortError("RETRYABLE_TRANSPORT", { submissionStatus: "not_submitted" });
      return { output: completeExtraction(), receipt: { receipt_id: "receipt:recovered" } };
    },
    async getCompletion() { return { status: "not_submitted" }; }
  };
  const open = () => createJournalImportController({
    ledger: ledger(),
    inferencePort: createDurableJournalInferencePort({ port: transport, corpusStore: store }),
    controllerSecret: Buffer.alloc(32, 59), grant
  });

  for (let run = 0; run < 3; run += 1) {
    const controller = open();
    if (run === 0) await controller.initialize({ ...initialization(), jobId: "job:retry-epochs", workDefinitions: [workDefinitions()[0]] });
    const blocked = await controller.runUntilBlocked();
    assert.equal(blocked.snapshot.work_items[0].status, "blocked_authority");
    controller.close();
  }
  available = true;
  const recovered = open();
  const completed = await recovered.runUntilBlocked();
  assert.equal(completed.snapshot.work_items[0].status, "completed");
  assert.equal(new Set(operationKeys).size, operationKeys.length);
  assert.equal(operationKeys.length, 7);
  recovered.close();
  store.close();
});

test("quota, revocation and missing fresh-context route block only the affected semantic work", async (t) => {
  for (const [code, expectedState] of [["QUOTA_PAUSED", "paused_quota"], ["GRANT_REVOKED", "revoked"], ["INFERENCE_ISOLATION_UNAVAILABLE", "blocked_authority"]]) {
    await t.test(code, async () => {
      const ledger = createMemoryJournalJobLedger();
      const port = {
        capabilities: () => ({ mode: "synthetic-failure" }),
        async invoke() { throw new JournalInferencePortError(code, { submissionStatus: "not_submitted" }); },
        async getCompletion() { return { status: "not_submitted" }; }
      };
      const controller = createJournalImportController({ ledger, inferencePort: port, controllerSecret: Buffer.alloc(32, 49), grant });
      await controller.initialize({ ...initialization(), jobId: `job:${code.toLowerCase()}`, workDefinitions: [workDefinitions()[0]] });
      const result = await controller.runUntilBlocked();
      assert.equal(result.snapshot.checkpoint.state, expectedState);
      assert.equal(result.snapshot.checkpoint.completion.archive_verified, "pass");
      assert.equal(result.snapshot.checkpoint.completion.raw_search_available, "pass");
      controller.close();
    });
  }
});

test("an authorization failure before a call spends no attempt and leaves nothing unknown", async () => {
  const store = await temporaryStore();
  let calls = 0;
  const handlers = { extractor: () => { calls += 1; return completeExtraction(); }, omission_checker: omissionResult, reconciler: reconciliationResult };
  const open = (deny) => {
    // A fresh process: the provider port's own memory is empty, as after a restart.
    const inferencePort = createDurableJournalInferencePort({ port: createMockJournalInferencePort({ handlers }), corpusStore: store });
    return createJournalImportController({
      ledger: createCorpusJournalJobLedger({ corpusStore: store, jobId: "job:synthetic" }),
      inferencePort, controllerSecret: Buffer.alloc(32, 43), grant,
      beforeInvoke: async () => { if (deny) throw Object.assign(new Error("synthetic expired authorization"), { code: "PRIVATE_CASE_ACCESS_DENIED" }); }
    });
  };
  const first = open(true);
  await first.initialize(initialization());
  await assert.rejects(first.runUntilBlocked(), { code: "PRIVATE_CASE_ACCESS_DENIED" });
  const stopped = await createCorpusJournalJobLedger({ corpusStore: store, jobId: "job:synthetic" }).load();
  assert.deepEqual(stopped.snapshot.work_items.map(({ status, attempts }) => [status, attempts]), [["planned", 0], ["planned", 0], ["planned", 0]]);
  assert.equal(calls, 0);
  first.close();
  const second = open(false);
  const done = await second.runUntilBlocked();
  assert.deepEqual(done.snapshot.work_items.map(({ status }) => status), ["completed", "completed", "completed"]);
  assert.equal(calls, 1);
  second.close();
  store.close();
});
