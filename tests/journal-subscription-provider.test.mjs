import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildJournalRolePacket,
  createProviderJournalInferencePort
} from "../src/journal-import/provider-port.mjs";
import { createChatGptSubscriptionBrowserProvider } from "../src/providers/chatgpt-subscription-browser.mjs";
import { loadJournalInferencePortFromEnvironment } from "../src/journal-import/provider-runtime.mjs";
import { createDurableJournalInferencePort } from "../src/journal-import/durable-inference.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function memoryStore() {
  const data = new Map();
  return {
    async readJsonObject({ objectId }) {
      if (!data.has(objectId)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return structuredClone(data.get(objectId));
    },
    async writeJsonObject({ objectId, value }) {
      assert.equal(data.has(objectId), false, "durable records are immutable");
      data.set(objectId, structuredClone(value));
    }
  };
}

const grant = Object.freeze({
  grant_id: "grant:synthetic-subscription",
  principal_id: "principal:synthetic-subscription",
  purpose: "organize_search",
  allowed_roles: ["visual_reader", "extractor"],
  revoked: false,
  expires_at: null
});

function visualResult() {
  return {
    schema_version: "1.0",
    source_page_id: "page:synthetic",
    regions: [{
      region_id: "region:1",
      bbox: [0, 0, 100, 100],
      kind: "text",
      transcription: "synthetic visible text",
      non_graphic_description: null,
      interpretation_status: "readable",
      speaker_or_document_label: null,
      table_cells: []
    }],
    page_complete: true,
    missing_or_uncertain_regions: []
  };
}

function isolationReceipt({ promptSha256, overrides = {} } = {}) {
  return {
    schema_version: 1,
    transport: "chatgpt-subscription-temporary-unpersonalized",
    request_id: "request:synthetic-subscription",
    assistant_turn_id: "turn:assistant:synthetic",
    conversation_url: "https://chatgpt.com/c/synthetic-fresh",
    prompt_sha256: promptSha256,
    authenticated: true,
    fresh_conversation: true,
    temporary_chat: true,
    unpersonalized: true,
    memory_disabled: true,
    custom_instructions_disabled: true,
    plugins_disabled: true,
    tools_disabled: true,
    prior_user_turn_count: 0,
    prior_assistant_turn_count: 0,
    model_visible_label: "GPT-5.6 Sol",
    effort_visible_label: "Extra High",
    incremental_cost_usd: 0,
    usage: null,
    observed_at: "2026-09-22T23:00:00.000Z",
    ...overrides
  };
}

test("subscription provider accepts only a fresh unpersonalized temporary zero-spend packet session", async () => {
  let observed = null;
  const transport = {
    async runPacket(input) {
      observed = input;
      return {
        text: JSON.stringify(visualResult()),
        receipt: isolationReceipt({ promptSha256: input.promptSha256 })
      };
    }
  };
  const provider = createChatGptSubscriptionBrowserProvider({
    model: "GPT-5.6 Sol",
    effort: "Extra High",
    routeRef: "route:subscription:synthetic",
    transport
  });
  const result = await provider.generate({
    system: "You are an application reasoning role. Read only the supplied source.",
    user: JSON.stringify({ protocol_version: "1.0", data: "synthetic" }),
    attachments: [],
    outputSchema: { type: "object" },
    metadata: { stage: "journal:visual_reader" },
    sealed: true
  });
  assert.equal(result.costUsd, 0);
  assert.equal(result.model, "GPT-5.6 Sol");
  assert.equal(result.effort, "Extra High");
  assert.match(result.responseId, /^chatgpt-turn:/);
  assert.equal(observed.modelVisibleLabel, "GPT-5.6 Sol");
  assert.equal(observed.effortVisibleLabel, "Extra High");
  assert.match(observed.prompt, /SINGLE PACKET ONLY/);
  assert.match(observed.prompt, /Use no outside memory/);
  assert.match(observed.prompt, /JSON syntax is mandatory/);
  assert.match(observed.prompt, /entire response parses as one JSON value/);
});

test("subscription provider fails closed when temporary unpersonalized isolation is not proven", async () => {
  const transport = {
    async runPacket(input) {
      return {
        text: "{}",
        receipt: isolationReceipt({
          promptSha256: input.promptSha256,
          overrides: { unpersonalized: false }
        })
      };
    }
  };
  const provider = createChatGptSubscriptionBrowserProvider({
    model: "GPT-5.6 Sol",
    effort: "Extra High",
    routeRef: "route:subscription:synthetic",
    transport
  });
  await assert.rejects(
    () => provider.generate({
      system: "role",
      user: "{}",
      outputSchema: { type: "object" },
      metadata: {},
      sealed: true
    }),
    (error) => error?.code === "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE"
  );
});

test("visual reader sends image bytes as transport attachment and redacts base64 from the model packet", async (t) => {
  const imageBytes = Buffer.from("synthetic-image-bytes", "utf8");
  let generated = null;
  const provider = {
    model: "synthetic-vision",
    privateInferenceIsolation: {
      packetOnly: true,
      freshContextPerGenerate: true,
      tools: false,
      filesystem: false,
      sessionPersistence: false,
      transport: "synthetic-vision-transport"
    },
    async generate(input) {
      generated = input;
      const userPacket = JSON.parse(input.user);
      assert.equal(userPacket.page_image_ref.kind, "attached_image");
      assert.equal(Object.hasOwn(userPacket.page_image_ref, "data_base64"), false);
      assert.equal(input.attachments.length, 1);
      assert.deepEqual(Buffer.from(input.attachments[0].bytes), imageBytes);
      assert.equal(input.attachments[0].sha256, sha256(imageBytes));
      return {
        text: JSON.stringify(visualResult()),
        requestId: "request:visual:1",
        responseId: "context:visual:1",
        model: "synthetic-vision",
        effort: "synthetic-high",
        usage: null,
        costUsd: 0,
        subscriptionRouteReceipt: { route: "synthetic" }
      };
    }
  };
  const port = createProviderJournalInferencePort({
    provider,
    receiptKey: Buffer.alloc(32, 77),
    routeRef: "route:visual:synthetic",
    allowanceEvidence: { authorization_ref: "allowance:synthetic:zero", maximum_incremental_cost_usd: 0 },
    maxExternalSpendUsd: 0,
    configuredModelProfile: "synthetic-vision",
    configuredEffort: "synthetic-high"
  });
  t.after(() => port.close());
  const packet = buildJournalRolePacket("visual_reader", {
    protocol_version: "1.0",
    output_schema_id: "visual-result",
    assigned_core_ids: ["page:synthetic"],
    source_locators: [{ representation_id: "representation:synthetic", page_index: 0 }],
    expected_generation: "generation:synthetic",
    controller_provenance_tag: "work:visual:synthetic",
    grant_purpose: "organize_search",
    page_image_ref: {
      kind: "inline_image",
      media_type: "image/png",
      data_base64: imageBytes.toString("base64"),
      sha256: sha256(imageBytes),
      label: "synthetic page"
    },
    page_geometry: { width: 100, height: 100 },
    native_text_rendering: null,
    neighbor_pages: []
  });
  const result = await port.invoke({
    role: "visual_reader",
    packet,
    outputSchema: "visual-result",
    operationKey: "operation:visual:synthetic",
    grant
  });
  assert.equal(result.output.page_complete, true);
  assert.deepEqual(result.receipt.provider_route_receipt, { route: "synthetic" });
  assert.ok(generated);
});

test("visual reader rejects mismatched image digests before provider submission", async () => {
  let calls = 0;
  const provider = {
    model: "synthetic-vision",
    privateInferenceIsolation: {
      packetOnly: true,
      freshContextPerGenerate: true,
      tools: false,
      filesystem: false,
      sessionPersistence: false,
      transport: "synthetic-vision-transport"
    },
    async generate() { calls += 1; throw new Error("must not be called"); }
  };
  const port = createProviderJournalInferencePort({
    provider,
    receiptKey: Buffer.alloc(32, 77),
    routeRef: "route:visual:synthetic",
    allowanceEvidence: { authorization_ref: "allowance:synthetic:zero", maximum_incremental_cost_usd: 0 },
    maxExternalSpendUsd: 0,
    configuredModelProfile: "synthetic-vision",
    configuredEffort: "synthetic-high"
  });
  const imageBytes = Buffer.from("synthetic-image-bytes", "utf8");
  const packet = buildJournalRolePacket("visual_reader", {
    protocol_version: "1.0",
    output_schema_id: "visual-result",
    assigned_core_ids: ["page:synthetic"],
    source_locators: [],
    expected_generation: "generation:synthetic",
    controller_provenance_tag: "work:visual:synthetic",
    grant_purpose: "organize_search",
    page_image_ref: {
      kind: "inline_image",
      media_type: "image/png",
      data_base64: imageBytes.toString("base64"),
      sha256: "0".repeat(64)
    },
    page_geometry: { width: 100, height: 100 },
    native_text_rendering: null,
    neighbor_pages: []
  });
  await assert.rejects(
    () => port.invoke({ role: "visual_reader", packet, outputSchema: "visual-result", operationKey: "operation:visual:bad", grant }),
    /VISUAL_IMAGE_DIGEST_MISMATCH/
  );
  assert.equal(calls, 0);
  port.close();
});

test("runtime binds subscription browser without API credentials and hard-requires zero incremental spend", (t) => {
  let options = null;
  const fakeProvider = {
    model: "GPT-5.6 Sol",
    privateInferenceIsolation: {
      packetOnly: true,
      freshContextPerGenerate: true,
      tools: false,
      filesystem: false,
      sessionPersistence: false,
      transport: "chatgpt-subscription-temporary-unpersonalized"
    },
    async generate() { throw new Error("configuration-only test"); }
  };
  const route = {
    schema_version: 1,
    route_ref: "route:subscription:synthetic",
    provider: "chatgpt_subscription_browser",
    model: "GPT-5.6 Sol",
    effort: "Extra High",
    timeout_ms: 300_000,
    max_output_tokens: 20_000,
    max_external_spend_usd: 0,
    allowance_evidence: {
      authorization_ref: "allowance:subscription:zero-incremental-usd",
      maximum_incremental_cost_usd: 0
    },
    browser: {
      cdp_host: "127.0.0.1",
      cdp_port: 9223
    }
  };
  const port = loadJournalInferencePortFromEnvironment({
    INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON: JSON.stringify(route),
    INNER_SIGNAL_JOURNAL_INFERENCE_RECEIPT_KEY_BASE64: Buffer.alloc(32, 93).toString("base64")
  }, {
    providerFactories: {
      chatgpt_subscription_browser(received) {
        options = received;
        return fakeProvider;
      }
    }
  });
  t.after(() => port.close());
  assert.equal(options.apiKey, undefined);
  assert.equal(options.model, "GPT-5.6 Sol");
  assert.equal(options.effort, "Extra High");
  assert.equal(options.browser.host, "127.0.0.1");
  assert.equal(options.browser.port, 9223);
  assert.equal(port.capabilities().external_spend_authorized_usd, 0);

  const combined = loadJournalInferencePortFromEnvironment({
    INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON: JSON.stringify(route),
    INNER_SIGNAL_JOURNAL_INFERENCE_RECEIPT_KEY_BASE64: Buffer.alloc(32, 93).toString("base64"),
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: "/tmp/synthetic-journal-hardest-exchange",
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64: Buffer.alloc(32, 94).toString("base64")
  }, {
    caseId: "synthetic-case",
    hardestLane: { enabled: true, model: "claude-opus-5-5", effort: "max" },
    providerFactories: { chatgpt_subscription_browser() { return fakeProvider; } }
  });
  assert.equal(combined.capabilities().roles.visual_reader.available, true);
  combined.close();

  assert.throws(() => loadJournalInferencePortFromEnvironment({
    INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON: JSON.stringify({
      ...route,
      max_external_spend_usd: 1,
      allowance_evidence: {
        authorization_ref: "bad",
        maximum_incremental_cost_usd: 1
      }
    }),
    INNER_SIGNAL_JOURNAL_INFERENCE_RECEIPT_KEY_BASE64: Buffer.alloc(32, 93).toString("base64")
  }, { providerFactories: { chatgpt_subscription_browser() { return fakeProvider; } } }), /SUBSCRIPTION_ROUTE_REQUIRES_ZERO_EXTERNAL_SPEND/);
});

test("a restarted composite route does not treat a browser operation as authoritatively unsent", async (t) => {
  const exchangeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "journal-composite-authority-"));
  t.after(() => fs.rm(exchangeRoot, { recursive: true, force: true }));
  let browserCalls = 0;
  const provider = {
    model: "GPT-5.6 Sol",
    privateInferenceIsolation: {
      packetOnly: true,
      freshContextPerGenerate: true,
      tools: false,
      filesystem: false,
      sessionPersistence: false,
      transport: "chatgpt-subscription-temporary-unpersonalized"
    },
    async generate() {
      browserCalls += 1;
      throw new Error("synthetic completion ambiguity");
    }
  };
  const route = {
    schema_version: 1,
    route_ref: "route:subscription:synthetic",
    provider: "chatgpt_subscription_browser",
    model: "GPT-5.6 Sol",
    effort: "Extra High",
    timeout_ms: 300_000,
    max_output_tokens: 20_000,
    max_external_spend_usd: 0,
    allowance_evidence: { authorization_ref: "allowance:synthetic", maximum_incremental_cost_usd: 0 },
    browser: { cdp_host: "127.0.0.1", cdp_port: 9223 }
  };
  const environment = {
    INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON: JSON.stringify(route),
    INNER_SIGNAL_JOURNAL_INFERENCE_RECEIPT_KEY_BASE64: Buffer.alloc(32, 95).toString("base64"),
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: exchangeRoot,
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64: Buffer.alloc(32, 96).toString("base64")
  };
  const makePort = () => loadJournalInferencePortFromEnvironment(environment, {
    caseId: "synthetic-case",
    hardestLane: { enabled: true },
    providerFactories: { chatgpt_subscription_browser: () => provider }
  });
  const input = {
    role: "extractor",
    packet: buildJournalRolePacket("extractor", {
      protocol_version: "1.0",
      output_schema_id: "extraction-result",
      assigned_core_ids: ["unit:synthetic"],
      source_locators: [{ representation_id: "representation:synthetic", start_byte: 0, end_byte: 19 }],
      expected_generation: "generation:synthetic",
      controller_provenance_tag: "work:synthetic",
      grant_purpose: "organize_search",
      core_units: [{ unit_id: "unit:synthetic", text: "invented source text" }],
      adjacent_context: { before: "", after: "" },
      visual_transcriptions: []
    }),
    outputSchema: "extraction-result",
    operationKey: "operation:browser:completion-unknown",
    grant
  };
  const store = memoryStore();
  const firstPort = makePort();
  assert.equal(firstPort.capabilities().authoritative_completion, undefined);
  await assert.rejects(
    createDurableJournalInferencePort({ port: firstPort, corpusStore: store }).invoke(input),
    { code: "COMPLETION_UNKNOWN" }
  );
  firstPort.close();

  const restartedPort = makePort();
  t.after(() => restartedPort.close());
  await assert.rejects(
    createDurableJournalInferencePort({ port: restartedPort, corpusStore: store }).invoke(input),
    { code: "COMPLETION_UNKNOWN" }
  );
  assert.equal(browserCalls, 1, "the restart must not send the ambiguous browser call again");
});

test("subscription provider accepts a desktop Temporary Chat receipt with a private surface locator and no selected tool mode", async () => {
  const transport = {
    privateInferenceIsolation: {
      packetOnly: true,
      freshContextPerGenerate: true,
      tools: "not_selected_prompt_prohibited_postflight_checked",
      filesystem: false,
      sessionPersistence: false,
      transport: "chatgpt-subscription-desktop-temporary-unpersonalized"
    },
    async runPacket(input) {
      return {
        text: JSON.stringify(visualResult()),
        receipt: isolationReceipt({
          promptSha256: input.promptSha256,
          overrides: {
            transport: "chatgpt-subscription-desktop-temporary-unpersonalized",
            conversation_url: null,
            surface_session_id: "desktop-temp:synthetic",
            tools_disabled: false,
            tools_selected: false,
            tool_use_prohibited: true,
            tool_use_observed: false,
            effort_visible_label: "Pro"
          }
        })
      };
    }
  };
  const provider = createChatGptSubscriptionBrowserProvider({
    model: "GPT-5.6 Sol",
    effort: "Pro",
    routeRef: "route:subscription:desktop-synthetic",
    transport
  });
  const result = await provider.generate({
    system: "role",
    user: "{}",
    outputSchema: { type: "object" },
    metadata: {},
    sealed: true
  });
  assert.equal(result.costUsd, 0);
  assert.equal(result.model, "GPT-5.6 Sol");
  assert.equal(result.effort, "Pro");
  assert.match(result.responseId, /^chatgpt-turn:/);
});

test("subscription provider rejects a desktop receipt when tool use was observed", async () => {
  const transport = {
    privateInferenceIsolation: {
      packetOnly: true,
      freshContextPerGenerate: true,
      tools: "not_selected_prompt_prohibited_postflight_checked",
      filesystem: false,
      sessionPersistence: false,
      transport: "chatgpt-subscription-desktop-temporary-unpersonalized"
    },
    async runPacket(input) {
      return {
        text: "{}",
        receipt: isolationReceipt({
          promptSha256: input.promptSha256,
          overrides: {
            conversation_url: null,
            surface_session_id: "desktop-temp:synthetic",
            tools_disabled: false,
            tools_selected: false,
            tool_use_prohibited: true,
            tool_use_observed: true,
            effort_visible_label: "Pro"
          }
        })
      };
    }
  };
  const provider = createChatGptSubscriptionBrowserProvider({
    model: "GPT-5.6 Sol",
    effort: "Pro",
    routeRef: "route:subscription:desktop-synthetic",
    transport
  });
  await assert.rejects(
    () => provider.generate({
      system: "role",
      user: "{}",
      outputSchema: { type: "object" },
      metadata: {},
      sealed: true
    }),
    (error) => error?.code === "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE"
  );
});
