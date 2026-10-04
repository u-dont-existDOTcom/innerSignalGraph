import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ValidationError } from "../core/errors.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function invariant(condition, message, code = "CHATGPT_BROWSER_TRANSPORT_INVALID") {
  if (!condition) throw new ValidationError(message, { code });
}

function normalizeConversationUrl(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/c\/((?:WEB:)?[A-Za-z0-9_-]+)\/?$/);
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com" || !match) return null;
    return "https://chatgpt.com/c/" + match[1];
  } catch {
    return null;
  }
}

function visible(element) {
  if (!element || !element.getClientRects().length || getComputedStyle(element).visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
}

function accessibleLabel(element) {
  return String((element && (element.getAttribute("aria-label") || element.innerText || element.textContent)) || "").trim().replace(/\s+/g, " ");
}

function inspectPage() {
  const composer = document.querySelector("#prompt-textarea")
    || document.querySelector('[data-testid="prompt-textarea"]')
    || document.querySelector('textarea[aria-label="Chat with ChatGPT"]');
  const roleNodes = [...document.querySelectorAll("[data-message-author-role]")];
  const roleCounts = {};
  for (const node of roleNodes) {
    const role = node.getAttribute("data-message-author-role") || "unknown";
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  }
  const selectedAppChips = composer?.closest("form")
    ? [...composer.closest("form").querySelectorAll("button")].filter((button) => {
      const label = button.getAttribute("aria-label") || "";
      return label.endsWith(", click to remove");
    }).map((button) => button.getAttribute("aria-label"))
    : [];
  return {
    currentUrl: location.href,
    composerFound: Boolean(composer && visible(composer)),
    loginRequired: location.pathname.startsWith("/auth/")
      || Boolean(document.querySelector('a[href*="/auth/login"], button[data-testid="login-button"]')),
    roleCounts,
    selectedAppChipCount: selectedAppChips.length,
    selectedAppChipLabels: selectedAppChips
  };
}

function modelState() {
  const control = [...document.querySelectorAll('button[data-testid="model-switcher-dropdown-button"]')].filter(visible);
  const menuRoots = [...document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"]')].filter(visible);
  const selectable = menuRoots.flatMap((root) => [...root.querySelectorAll('button, [role="menuitem"], [role="menuitemradio"], [role="option"]')].filter(visible));
  const sliders = menuRoots.flatMap((root) => [...root.querySelectorAll('[role="slider"]')].filter(visible));
  return {
    controlCount: control.length,
    controlLabel: control.length === 1 ? accessibleLabel(control[0]) : null,
    controlExpanded: control.length === 1 && control[0].getAttribute("aria-expanded") === "true",
    optionLabels: selectable.map(accessibleLabel).filter(Boolean),
    sliderCount: sliders.length,
    effortLabel: sliders.length === 1 ? (sliders[0].getAttribute("aria-valuetext") || null) : null,
    sliderNow: sliders.length === 1 ? Number(sliders[0].getAttribute("aria-valuenow")) : null,
    sliderMin: sliders.length === 1 ? Number(sliders[0].getAttribute("aria-valuemin")) : null,
    sliderMax: sliders.length === 1 ? Number(sliders[0].getAttribute("aria-valuemax")) : null
  };
}

function clickExactModelOption(label) {
  const roots = [...document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"]')].filter(visible);
  const options = roots.flatMap((root) => [...root.querySelectorAll('button, [role="menuitem"], [role="menuitemradio"], [role="option"]')].filter(visible));
  const matches = options.filter((element) => accessibleLabel(element) === label);
  if (matches.length !== 1) return { ok: false, count: matches.length, labels: options.map(accessibleLabel).filter(Boolean) };
  matches[0].click();
  return { ok: true };
}

function focusOnlySlider() {
  const roots = [...document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"]')].filter(visible);
  const sliders = roots.flatMap((root) => [...root.querySelectorAll('[role="slider"]')].filter(visible));
  if (sliders.length !== 1) return { ok: false, count: sliders.length };
  sliders[0].focus();
  return {
    ok: document.activeElement === sliders[0],
    label: sliders[0].getAttribute("aria-valuetext"),
    now: Number(sliders[0].getAttribute("aria-valuenow")),
    min: Number(sliders[0].getAttribute("aria-valuemin")),
    max: Number(sliders[0].getAttribute("aria-valuemax"))
  };
}

function temporaryControlState(temporaryLabels, unpersonalizedLabels) {
  const candidates = [...document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"]')].filter(visible);
  const temporary = candidates.filter((element) => temporaryLabels.includes(accessibleLabel(element)));
  const unpersonalized = candidates.filter((element) => unpersonalizedLabels.includes(accessibleLabel(element)));
  const selected = unpersonalized.filter((element) => (
    element.getAttribute("aria-checked") === "true"
    || element.getAttribute("aria-selected") === "true"
    || element.getAttribute("data-state") === "checked"
    || Boolean(element.querySelector('[aria-checked="true"], [aria-selected="true"], [data-state="checked"]'))
  ));
  return {
    temporaryCount: temporary.length,
    temporaryLabelsObserved: temporary.map(accessibleLabel),
    unpersonalizedCount: unpersonalized.length,
    unpersonalizedSelectedCount: selected.length,
    unpersonalizedLabelsObserved: unpersonalized.map(accessibleLabel)
  };
}

function clickExactAccessible(labels) {
  const candidates = [...document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"]')].filter(visible);
  const matches = candidates.filter((element) => labels.includes(accessibleLabel(element)));
  if (matches.length !== 1) return { ok: false, count: matches.length, labels: candidates.map(accessibleLabel).filter(Boolean).slice(0, 200) };
  matches[0].click();
  return { ok: true, label: accessibleLabel(matches[0]) };
}

function composerState(expected) {
  const composers = [...document.querySelectorAll('#prompt-textarea, [data-testid="prompt-textarea"], textarea[aria-label="Chat with ChatGPT"]')].filter(visible);
  if (composers.length !== 1) return { ok: false, count: composers.length };
  const element = composers[0];
  let text = "";
  if (element.tagName === "TEXTAREA") {
    text = element.value || "";
  } else {
    text = element.innerText || element.textContent || "";
  }
  return { ok: true, exact: text === expected, empty: text.length === 0, length: text.length };
}

function focusComposer() {
  const composers = [...document.querySelectorAll('#prompt-textarea, [data-testid="prompt-textarea"], textarea[aria-label="Chat with ChatGPT"]')].filter(visible);
  if (composers.length !== 1) return { ok: false, count: composers.length };
  composers[0].focus();
  return { ok: document.activeElement === composers[0] };
}

function clickSend() {
  const selectors = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'button[data-testid="fruitjuice-send-button"]'
  ];
  const button = selectors.map((selector) => document.querySelector(selector)).find(visible);
  if (!button) return { ok: false, reason: "SEND_BUTTON_NOT_FOUND" };
  if (button.disabled || button.getAttribute("aria-disabled") === "true") return { ok: false, reason: "SEND_BUTTON_DISABLED" };
  button.click();
  return { ok: true };
}

function generationState() {
  const composer = document.querySelector("#prompt-textarea")
    || document.querySelector('[data-testid="prompt-textarea"]')
    || document.querySelector('textarea[aria-label="Chat with ChatGPT"]');
  const stop = document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"]');
  const stopVisible = visible(stop);
  const composerVisible = visible(composer);
  const composerDisabled = Boolean(composer && (composer.disabled || composer.getAttribute("aria-disabled") === "true" || composer.getAttribute("contenteditable") === "false"));
  const roleNodes = [...document.querySelectorAll("[data-message-author-role]")];
  const toolTurns = roleNodes.filter((node) => !["user", "assistant"].includes(node.getAttribute("data-message-author-role"))).length;
  return {
    currentUrl: location.href,
    conversationUrl: normalizeConversationUrl(location.href),
    stopVisible,
    composerVisible,
    composerDisabled,
    idleReady: !stopVisible && composerVisible && !composerDisabled,
    toolTurnCount: toolTurns
  };
}

function assistantResult() {
  const roleNodes = [...document.querySelectorAll("[data-message-author-role]")];
  const userNodes = roleNodes.filter((node) => node.getAttribute("data-message-author-role") === "user");
  const assistantNodes = roleNodes.filter((node) => node.getAttribute("data-message-author-role") === "assistant");
  const otherNodes = roleNodes.filter((node) => !["user", "assistant"].includes(node.getAttribute("data-message-author-role")));
  if (assistantNodes.length !== 1) return { ok: false, userCount: userNodes.length, assistantCount: assistantNodes.length, otherCount: otherNodes.length };
  const node = assistantNodes[0];
  const container = node.closest('article[data-testid^="conversation-turn-"], article[data-turn-id], [data-testid^="conversation-turn-"]') || node;
  const content = node.querySelector(".markdown") || node.querySelector('[class*="prose"]') || node;
  const text = String(content.innerText || content.textContent || "").trim();
  const turnId = node.getAttribute("data-message-id")
    || container.getAttribute("data-turn-id")
    || container.getAttribute("data-testid")
    || container.id
    || null;
  return {
    ok: Boolean(text && turnId),
    text,
    turnId,
    userCount: userNodes.length,
    assistantCount: assistantNodes.length,
    otherCount: otherNodes.length
  };
}

function clickComposerPlus() {
  const buttons = [...document.querySelectorAll('button[data-testid="composer-plus-btn"]')].filter(visible);
  if (buttons.length !== 1) return { ok: false, count: buttons.length };
  buttons[0].click();
  return { ok: true };
}

function uploadOptionState(uploadLabels) {
  const candidates = [...document.querySelectorAll('button, [role="menuitem"], [role="menuitemradio"], [role="option"]')].filter(visible);
  const matches = candidates.filter((element) => uploadLabels.includes(accessibleLabel(element)));
  return { count: matches.length, labels: candidates.map(accessibleLabel).filter(Boolean).slice(0, 160) };
}

function clickUploadOption(uploadLabels) {
  const candidates = [...document.querySelectorAll('button, [role="menuitem"], [role="menuitemradio"], [role="option"]')].filter(visible);
  const matches = candidates.filter((element) => uploadLabels.includes(accessibleLabel(element)));
  if (matches.length !== 1) return { ok: false, count: matches.length, labels: candidates.map(accessibleLabel).filter(Boolean).slice(0, 160) };
  matches[0].click();
  return { ok: true, label: accessibleLabel(matches[0]) };
}

function attachmentVisible(fileName) {
  const composer = document.querySelector("#prompt-textarea")
    || document.querySelector('[data-testid="prompt-textarea"]')
    || document.querySelector('textarea[aria-label="Chat with ChatGPT"]');
  const form = composer?.closest("form");
  if (!form) return { found: false };
  const text = String(form.innerText || form.textContent || "");
  const uploading = /uploading|téléchargement en cours/i.test(text);
  return { found: text.includes(fileName), uploading };
}

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const waiter = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message || "Chrome DevTools protocol error."));
        else waiter.resolve(message.result);
        return;
      }
      if (message.method && this.eventWaiters.has(message.method)) {
        const waiters = this.eventWaiters.get(message.method);
        this.eventWaiters.delete(message.method);
        for (const waiter of waiters) waiter.resolve(message.params || {});
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("Could not connect to Chrome DevTools.")), { once: true });
    });
    return new CdpConnection(socket);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(method, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject };
      const waiters = this.eventWaiters.get(method) || [];
      waiters.push(entry);
      this.eventWaiters.set(method, waiters);
      const timer = setTimeout(() => {
        const current = this.eventWaiters.get(method) || [];
        this.eventWaiters.set(method, current.filter((candidate) => candidate !== entry));
        reject(new Error("Timed out waiting for Chrome DevTools event " + method + "."));
      }, timeoutMs);
      entry.resolve = (value) => { clearTimeout(timer); resolve(value); };
    });
  }

  async call(fn, args = []) {
    const expression = "(" + fn.toString() + ").apply(null," + JSON.stringify(args) + ")";
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (result?.exceptionDetails) throw new Error("Browser DOM evaluation failed.");
    return result?.result?.value;
  }

  close() {
    try { this.socket.close(); } catch {}
  }
}

async function waitFor(check, timeoutMs, intervalMs, message) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const error = new Error(message);
  if (lastError) error.cause = lastError;
  throw error;
}

function extensionFor(mediaType) {
  if (mediaType === "image/png") return ".png";
  if (mediaType === "image/jpeg") return ".jpg";
  if (mediaType === "image/webp") return ".webp";
  return ".bin";
}

export class ChatGptSubscriptionCdpTransport {
  constructor({
    host = "127.0.0.1",
    port = 9223,
    temporaryLabels = ["Temporary", "Temporary Chat", "Temporaire", "Discussion temporaire", "Chat temporaire"],
    unpersonalizedLabels = ["Unpersonalized", "Non-personnalisé", "Non personnalisé"],
    uploadLabels = ["Add photos & files", "Upload from computer", "Ajouter des photos et des fichiers", "Ajouter des fichiers", "Fichiers"],
    pageReadyTimeoutMs = 90_000,
    generationTimeoutMs = 900_000,
    fetchImpl = fetch
  } = {}) {
    invariant(typeof host === "string" && host.length > 0, "CDP host is invalid.");
    invariant(Number.isSafeInteger(port) && port > 0 && port <= 65535, "CDP port is invalid.");
    this.baseUrl = "http://" + host + ":" + port;
    this.temporaryLabels = Object.freeze([...temporaryLabels]);
    this.unpersonalizedLabels = Object.freeze([...unpersonalizedLabels]);
    this.uploadLabels = Object.freeze([...uploadLabels]);
    this.pageReadyTimeoutMs = pageReadyTimeoutMs;
    this.generationTimeoutMs = generationTimeoutMs;
    this.fetchImpl = fetchImpl;
    this.ownedTargetId = null;
  }

  async json(endpoint, options = {}) {
    const response = await this.fetchImpl(this.baseUrl + endpoint, { ...options, signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    let value;
    try { value = JSON.parse(text); } catch { throw new Error("Chrome DevTools returned non-JSON."); }
    if (!response.ok) throw new Error("Chrome DevTools request failed with HTTP " + response.status + ".");
    return value;
  }

  async targets() {
    const list = await this.json("/json/list");
    invariant(Array.isArray(list), "Chrome DevTools target list is invalid.");
    return list.filter((target) => target.type === "page");
  }

  async ownedTarget() {
    const targets = await this.targets();
    if (this.ownedTargetId) {
      const target = targets.find((candidate) => candidate.id === this.ownedTargetId);
      invariant(target && target.webSocketDebuggerUrl, "Owned ChatGPT browser target disappeared.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
      return target;
    }
    const chatTargets = targets.filter((target) => {
      try { return new URL(target.url).hostname === "chatgpt.com"; } catch { return false; }
    });
    invariant(chatTargets.length === 1, "Dedicated journal inference browser must expose exactly one ChatGPT page target.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
    invariant(targets.length === 1, "Dedicated journal inference browser contains unrelated page targets.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
    invariant(typeof chatTargets[0].webSocketDebuggerUrl === "string", "ChatGPT page is not debuggable.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
    this.ownedTargetId = chatTargets[0].id;
    return chatTargets[0];
  }

  async withPage(callback) {
    const target = await this.ownedTarget();
    const client = await CdpConnection.connect(target.webSocketDebuggerUrl);
    try {
      await client.send("Runtime.enable");
      await client.send("Page.enable");
      return await callback(client, target);
    } finally {
      client.close();
    }
  }

  async navigateFresh(client) {
    const navigation = await client.send("Page.navigate", { url: "https://chatgpt.com/" });
    if (navigation?.errorText) throw new Error("ChatGPT navigation failed: " + navigation.errorText);
    return waitFor(async () => {
      const state = await client.call(inspectPage);
      if (state?.loginRequired) throw new ValidationError("ChatGPT login is required in the dedicated journal inference browser.", { code: "CHATGPT_SUBSCRIPTION_AUTHENTICATION_REQUIRED" });
      return state?.composerFound ? state : false;
    }, this.pageReadyTimeoutMs, 400, "ChatGPT composer did not become ready.");
  }

  async selectTemporaryUnpersonalized(client) {
    let state = await client.call(temporaryControlState, [this.temporaryLabels, this.unpersonalizedLabels]);
    if (state.unpersonalizedSelectedCount !== 1) {
      if (state.unpersonalizedCount === 0) {
        const clicked = await client.call(clickExactAccessible, [this.temporaryLabels]);
        invariant(clicked?.ok, "Temporary Chat control is unavailable or ambiguous.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
        state = await waitFor(async () => {
          const candidate = await client.call(temporaryControlState, [this.temporaryLabels, this.unpersonalizedLabels]);
          return candidate.unpersonalizedCount === 1 ? candidate : false;
        }, this.pageReadyTimeoutMs, 200, "Unpersonalized Temporary Chat option did not appear.");
      }
      const unpersonalized = await client.call(clickExactAccessible, [this.unpersonalizedLabels]);
      invariant(unpersonalized?.ok, "Unpersonalized Temporary Chat option is unavailable or ambiguous.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
      await sleep(250);
    }

    state = await client.call(temporaryControlState, [this.temporaryLabels, this.unpersonalizedLabels]);
    if (state.unpersonalizedSelectedCount !== 1) {
      const clicked = await client.call(clickExactAccessible, [this.temporaryLabels]);
      if (clicked?.ok) {
        state = await waitFor(async () => {
          const candidate = await client.call(temporaryControlState, [this.temporaryLabels, this.unpersonalizedLabels]);
          return candidate.unpersonalizedSelectedCount === 1 ? candidate : false;
        }, Math.min(this.pageReadyTimeoutMs, 10_000), 200, "Unpersonalized Temporary Chat selection could not be verified.");
        await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      }
    }
    invariant(state.unpersonalizedSelectedCount === 1, "Temporary Chat is not proven unpersonalized.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
    return state;
  }

  async openModelMenu(client) {
    const state = await client.call(modelState);
    invariant(state.controlCount === 1, "ChatGPT model control is unavailable or ambiguous.", "PRIVATE_INFERENCE_MODEL_MISMATCH");
    const clicked = await client.call(clickExactAccessible, [[state.controlLabel]]);
    invariant(clicked?.ok, "ChatGPT model control could not be opened.", "PRIVATE_INFERENCE_MODEL_MISMATCH");
    return waitFor(async () => {
      const candidate = await client.call(modelState);
      return candidate.optionLabels.length > 0 ? candidate : false;
    }, this.pageReadyTimeoutMs, 200, "ChatGPT model menu did not open.");
  }

  async ensureModelAndEffort(client, modelLabel, effortLabel) {
    let state = await client.call(modelState);
    invariant(state.controlCount === 1, "ChatGPT model control is unavailable or ambiguous.", "PRIVATE_INFERENCE_MODEL_MISMATCH");
    if (state.controlLabel !== modelLabel) {
      await this.openModelMenu(client);
      const chosen = await client.call(clickExactModelOption, [modelLabel]);
      invariant(chosen?.ok, "Configured ChatGPT model label is not available.", "PRIVATE_INFERENCE_MODEL_MISMATCH");
      await waitFor(async () => (await client.call(modelState)).controlLabel === modelLabel, this.pageReadyTimeoutMs, 200, "Configured ChatGPT model did not become selected.");
    }
    await this.openModelMenu(client);
    state = await client.call(modelState);
    invariant(state.sliderCount === 1, "ChatGPT thinking-effort control is unavailable or ambiguous.", "PRIVATE_INFERENCE_EFFORT_MISMATCH");
    let guard = 0;
    while (state.effortLabel !== effortLabel && guard < 12) {
      guard += 1;
      const focused = await client.call(focusOnlySlider);
      invariant(focused?.ok, "ChatGPT thinking-effort slider could not be focused.", "PRIVATE_INFERENCE_EFFORT_MISMATCH");
      const direction = focused.now < focused.max ? 1 : -1;
      const key = direction > 0 ? "ArrowRight" : "ArrowLeft";
      const code = direction > 0 ? 39 : 37;
      await client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      await sleep(150);
      state = await client.call(modelState);
      if (state.effortLabel === effortLabel) break;
      if (direction > 0 && state.sliderNow === state.sliderMax) {
        while (state.effortLabel !== effortLabel && state.sliderNow > state.sliderMin && guard < 24) {
          guard += 1;
          await client.call(focusOnlySlider);
          await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 });
          await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 });
          await sleep(150);
          state = await client.call(modelState);
        }
        break;
      }
    }
    invariant(state.effortLabel === effortLabel, "Configured ChatGPT effort label is not available.", "PRIVATE_INFERENCE_EFFORT_MISMATCH");
    await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    const verified = await client.call(modelState);
    invariant(verified.controlLabel === modelLabel, "ChatGPT model selection changed unexpectedly.", "PRIVATE_INFERENCE_MODEL_MISMATCH");
    return { modelLabel, effortLabel };
  }

  async uploadAttachment(client, attachment, tempRoot, index) {
    invariant(attachment?.kind === "image" && attachment.bytes instanceof Uint8Array, "Browser transport supports only validated image attachments.");
    const name = "journal-" + String(index + 1).padStart(2, "0") + "-" + attachment.sha256.slice(0, 16) + extensionFor(attachment.media_type);
    const filePath = path.join(tempRoot, name);
    await writeFile(filePath, attachment.bytes, { mode: 0o600 });

    const plus = await client.call(clickComposerPlus);
    invariant(plus?.ok, "ChatGPT attachment control is unavailable.", "PRIVATE_INFERENCE_VISUAL_UNAVAILABLE");
    await waitFor(async () => {
      const result = await client.call(uploadOptionState, [this.uploadLabels]);
      return result?.count === 1 ? result : false;
    }, this.pageReadyTimeoutMs, 200, "ChatGPT upload option is unavailable.");

    await client.send("Page.setInterceptFileChooserDialog", { enabled: true });
    const chooserPromise = client.waitForEvent("Page.fileChooserOpened", 10_000);
    const upload = await client.call(clickUploadOption, [this.uploadLabels]);
    invariant(upload?.ok, "ChatGPT upload option disappeared.", "PRIVATE_INFERENCE_VISUAL_UNAVAILABLE");
    const chooser = await chooserPromise;
    invariant(Number.isInteger(chooser.backendNodeId), "ChatGPT file chooser did not expose a target node.", "PRIVATE_INFERENCE_VISUAL_UNAVAILABLE");
    await client.send("DOM.setFileInputFiles", { files: [filePath], backendNodeId: chooser.backendNodeId });
    await client.send("Page.setInterceptFileChooserDialog", { enabled: false });
    await waitFor(async () => {
      const result = await client.call(attachmentVisible, [name]);
      return result?.found && !result.uploading ? result : false;
    }, this.pageReadyTimeoutMs, 250, "ChatGPT did not finish attaching the image.");
    return { name, filePath };
  }

  async insertPrompt(client, prompt) {
    const before = await client.call(composerState, [prompt]);
    invariant(before?.ok && before.empty, "ChatGPT composer is not empty before packet insertion.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
    const focused = await client.call(focusComposer);
    invariant(focused?.ok, "ChatGPT composer could not be focused.");
    await client.send("Input.insertText", { text: prompt });
    const verified = await client.call(composerState, [prompt]);
    invariant(verified?.ok && verified.exact, "ChatGPT composer exact-text verification failed.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
  }

  async runPacket({ prompt, promptSha256, attachments = [], modelVisibleLabel, effortVisibleLabel, timeoutMs } = {}) {
    invariant(typeof prompt === "string" && prompt.length > 0, "Packet prompt is required.");
    invariant(promptSha256 === sha256(Buffer.from(prompt, "utf8")), "Packet prompt digest is invalid.");
    invariant(Array.isArray(attachments), "Attachments must be an array.");
    const requestId = "chatgpt-subscription:" + randomUUID();
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-journal-upload-"));
    try {
      return await this.withPage(async (client) => {
        const fresh = await this.navigateFresh(client);
        invariant((fresh.roleCounts?.user || 0) === 0 && (fresh.roleCounts?.assistant || 0) === 0,
          "Fresh ChatGPT page already contains conversation turns.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
        invariant(fresh.selectedAppChipCount === 0, "Fresh ChatGPT composer contains a selected plugin/app.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");

        await this.selectTemporaryUnpersonalized(client);
        await this.ensureModelAndEffort(client, modelVisibleLabel, effortVisibleLabel);

        const preflight = await client.call(inspectPage);
        invariant((preflight.roleCounts?.user || 0) === 0 && (preflight.roleCounts?.assistant || 0) === 0,
          "ChatGPT conversation was not empty immediately before packet submission.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
        invariant(preflight.selectedAppChipCount === 0, "A plugin/app became selected before packet submission.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");

        for (let index = 0; index < attachments.length; index += 1) {
          await this.uploadAttachment(client, attachments[index], tempRoot, index);
        }
        await this.insertPrompt(client, prompt);
        const sent = await client.call(clickSend);
        invariant(sent?.ok, "ChatGPT send control is unavailable: " + (sent?.reason || "UNKNOWN"));

        const conversationUrl = await waitFor(async () => {
          const state = await client.call(generationState);
          return state?.conversationUrl || false;
        }, 30_000, 200, "ChatGPT did not assign a fresh conversation URL after submission.");

        let stableIdle = 0;
        const completed = await waitFor(async () => {
          const state = await client.call(generationState);
          if (state?.conversationUrl !== conversationUrl) throw new Error("ChatGPT conversation target changed during generation.");
          stableIdle = state.idleReady ? stableIdle + 1 : 0;
          return stableIdle >= 3 ? state : false;
        }, Math.min(timeoutMs || this.generationTimeoutMs, this.generationTimeoutMs), 500, "ChatGPT generation did not complete.");

        const assistant = await client.call(assistantResult);
        invariant(assistant?.ok && assistant.userCount === 1 && assistant.assistantCount === 1,
          "Fresh ChatGPT packet session did not contain exactly one user and one assistant turn.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
        invariant(completed.toolTurnCount === 0 && assistant.otherCount === 0,
          "ChatGPT packet session emitted a tool/plugin turn.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");

        return {
          text: assistant.text,
          receipt: {
            schema_version: 1,
            transport: "chatgpt-subscription-temporary-unpersonalized",
            request_id: requestId,
            assistant_turn_id: assistant.turnId,
            conversation_url: conversationUrl,
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
            model_visible_label: modelVisibleLabel,
            effort_visible_label: effortVisibleLabel,
            incremental_cost_usd: 0,
            usage: null,
            observed_at: new Date().toISOString()
          }
        };
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  async close() {}
}

export function createChatGptSubscriptionCdpTransport(options) {
  return new ChatGptSubscriptionCdpTransport(options);
}
