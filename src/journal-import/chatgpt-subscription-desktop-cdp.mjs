import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifySourceImageInspection } from "./source-image-inspection.mjs";
import { ValidationError } from "../core/errors.mjs";
import { captureNativeResponseSource, createNativeClipboard } from "./native-response-source.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function invariant(condition, message, code = "CHATGPT_DESKTOP_TRANSPORT_INVALID") {
  if (!condition) throw new ValidationError(message, { code });
}

function visible(element) {
  if (!element || !element.getClientRects().length || getComputedStyle(element).visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
}

function label(element) {
  return String((element && (element.getAttribute("aria-label") || element.innerText || element.textContent)) || "").trim().replace(/\s+/g, " ");
}

function chatSurfaceState() {
  const mode = [...document.querySelectorAll("button")].find((element) => visible(element) && (element.getAttribute("aria-label") || "").startsWith("Switch mode, current mode:"));
  const composer = [...document.querySelectorAll('[contenteditable="true"], [contenteditable="plaintext-only"], textarea')]
    .find((element) => visible(element) && (element.getAttribute("aria-label") || "").includes("Message ChatGPT"));
  return {
    modeLabel: mode ? String(mode.innerText || "").trim() : null,
    composerFound: Boolean(composer),
    bodyTail: String(document.body?.innerText || "").slice(-3000)
  };
}

function exactControl(kind, value) {
  const nodes = [...document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"]')].filter(visible);
  const matches = nodes.filter((element) => kind === "aria"
    ? (element.getAttribute("aria-label") || "") === value
    : String(element.innerText || "").trim().replace(/\s+/g, " ") === value);
  if (matches.length !== 1) return { ok: false, count: matches.length };
  const rect = matches[0].getBoundingClientRect();
  return {
    ok: true,
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    checked: matches[0].getAttribute("aria-checked"),
    state: matches[0].getAttribute("data-state"),
    text: String(matches[0].innerText || "").trim().replace(/\s+/g, " ")
  };
}

function modelMenuState(modelLabel) {
  const radios = [...document.querySelectorAll('[role="menuitemradio"]')].filter(visible);
  const exactModel = radios.filter((element) => String(element.innerText || "").trim() === modelLabel);
  const sliders = [...document.querySelectorAll('[role="slider"]')].filter(visible);
  const body = String(document.body?.innerText || "");
  return {
    modelMatchCount: exactModel.length,
    modelChecked: exactModel.length === 1 ? exactModel[0].getAttribute("aria-checked") === "true" : false,
    sliderCount: sliders.length,
    sliderNow: sliders.length === 1 ? Number(sliders[0].getAttribute("aria-valuenow")) : null,
    sliderMin: sliders.length === 1 ? Number(sliders[0].getAttribute("aria-valuemin")) : null,
    sliderMax: sliders.length === 1 ? Number(sliders[0].getAttribute("aria-valuemax")) : null,
    bodyTail: body.slice(-1800)
  };
}

function focusSlider() {
  const sliders = [...document.querySelectorAll('[role="slider"]')].filter(visible);
  if (sliders.length !== 1) return { ok: false, count: sliders.length };
  sliders[0].focus();
  return {
    ok: document.activeElement === sliders[0],
    now: Number(sliders[0].getAttribute("aria-valuenow")),
    min: Number(sliders[0].getAttribute("aria-valuemin")),
    max: Number(sliders[0].getAttribute("aria-valuemax"))
  };
}

function attachmentRemoveState() {
  const controls = [...document.querySelectorAll("button")].filter((element) =>
    visible(element) && (element.getAttribute("aria-label") || "").startsWith("Remove "));
  return {
    count: controls.length,
    first: controls.length ? (() => {
      const rect = controls[0].getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })() : null
  };
}

function selectedToolState() {
  const selected = [...document.querySelectorAll("button")].filter((element) => {
    if (!visible(element)) return false;
    const aria = element.getAttribute("aria-label") || "";
    return aria.endsWith(", click to remove");
  }).map((element) => element.getAttribute("aria-label"));
  return { selectedCount: selected.length, selectedLabels: selected };
}

export function desktopComposerPlainText(composer) {
  if (composer.tagName === "TEXTAREA") return composer.value || "";
  const blocks = new Set(["P", "DIV", "LI", "PRE", "BLOCKQUOTE"]);
  const read = (node) => {
    if (node.nodeType === 3) return node.nodeValue || "";
    if (node.tagName === "BR") return node.classList?.contains("ProseMirror-trailingBreak") ? "" : "\n";
    let result = "";
    let previous = null;
    for (const child of node.childNodes ?? []) {
      if (previous && (blocks.has(previous.tagName) || blocks.has(child.tagName))) result += "\n";
      result += read(child);
      previous = child;
    }
    return result;
  };
  return read(composer);
}

function composerState() {
  const composer = [...document.querySelectorAll('[contenteditable="true"], [contenteditable="plaintext-only"], textarea')]
    .find((element) => visible(element) && (element.getAttribute("aria-label") || "").includes("Message ChatGPT"));
  if (!composer) return { found: false };
  const text = desktopComposerPlainText(composer);
  return {
    found: true,
    text,
    disabled: Boolean(composer.disabled || composer.getAttribute("aria-disabled") === "true" || composer.getAttribute("contenteditable") === "false")
  };
}

function focusComposerAtEnd() {
  const composer = [...document.querySelectorAll('[contenteditable="true"], [contenteditable="plaintext-only"], textarea')]
    .find((element) => visible(element) && (element.getAttribute("aria-label") || "").includes("Message ChatGPT"));
  if (!composer) return { ok: false };
  composer.focus();
  if (composer.tagName !== "TEXTAREA") {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  } else {
    composer.selectionStart = composer.selectionEnd = composer.value.length;
  }
  return { ok: document.activeElement === composer };
}

function sendControlState() {
  const buttons = [...document.querySelectorAll("button")].filter((element) =>
    visible(element) && (element.getAttribute("aria-label") || "") === "Send");
  const body = String(document.body?.innerText || "");
  return {
    count: buttons.length,
    enabled: buttons.length === 1 && !buttons[0].disabled && buttons[0].getAttribute("aria-disabled") !== "true",
    uploadFailed: /Upload failed|Échec du téléchargement/i.test(body.slice(-2500))
  };
}

function clickSendControl() {
  const buttons = [...document.querySelectorAll("button")].filter((element) =>
    visible(element) && (element.getAttribute("aria-label") || "") === "Send");
  if (buttons.length !== 1) return { ok: false, count: buttons.length };
  if (buttons[0].disabled || buttons[0].getAttribute("aria-disabled") === "true") return { ok: false, disabled: true };
  buttons[0].click();
  return { ok: true };
}

export function responseState() {
  const userBubbles = [...document.querySelectorAll('[class*="bg-user-message"]')];
  const finalAssistantRoot = (element) => {
    if (element.closest('[class*="bg-user-message"]')) return false;
    let ancestor = element.parentElement;
    for (let depth = 0; ancestor && depth < 4; depth += 1, ancestor = ancestor.parentElement) {
      const labels = [...ancestor.children].filter((child) =>
        child.tagName === "H4" && String(child.className || "").includes("sr-only"));
      if (labels.some((child) => String(child.textContent || "").includes("ChatGPT"))) return true;
    }
    return false;
  };
  const assistantRoots = [...document.querySelectorAll('[class*="_MarkdownRoot_"]')].filter(finalAssistantRoot);
  const assistantTexts = assistantRoots.map((element) => String(element.innerText || element.textContent || "").trim()).filter(Boolean);
  const stop = [...document.querySelectorAll("button")].some((element) => visible(element)
    && /^(Stop|Stop generating|Stop streaming|Stop response)$/i.test(element.getAttribute("aria-label") || element.innerText || ""));
  const composer = composerState();
  const conversationRoot = userBubbles[0]?.closest("main");
  const body = String(conversationRoot?.innerText || conversationRoot?.textContent || "");
  const toolCue = /Searching the web|Sources\s*\d*|Used [A-Za-z].*tool|Running tool|Open browser/i.test(body.slice(-4000));
  const responseButtons = [...(conversationRoot ?? document).querySelectorAll("button")];
  const completedActionRow = responseButtons.some((element) => (element.getAttribute("aria-label") || "") === "Regenerate response")
    && responseButtons.some((element) => (element.getAttribute("aria-label") || "") === "Rate response");
  const finalAnswerReady = /ChatGPT can make mistakes\. Check important info\./i.test(body.slice(-4000))
    || completedActionRow;
  return {
    userCount: userBubbles.length,
    assistantCount: assistantTexts.length,
    assistantText: assistantTexts.at(-1) || "",
    assistantDomText: assistantRoots.at(-1)?.textContent ?? "",
    stop,
    composerFound: composer.found,
    workComposerFound: Boolean(document.querySelector('[aria-label="Work with ChatGPT"]')),
    composerDisabled: composer.disabled ?? true,
    toolCue,
    finalAnswerReady
  };
}

export function sourceToolState() {
  const headers = [...document.querySelectorAll('button[class*="activity-header"]')];
  const tools = headers.filter((node) => !/^(Thinking|Thought|Worked for)(\s|$)/i.test((node.innerText || node.textContent || "").trim()));
  const labels = tools.map((node) => {
    const text = (node.innerText || node.textContent || "").trim();
    if (/^(?:Analyzing\s*)+$/.test(text)) return "Analyzing";
    if (/^(?:Analyzed\s*)+$/.test(text)) return "Analyzed";
    if (/^(?:(?:Analyzing|Analyzed)\s*)+$/.test(text)) return "Analyzing";
    if (/^(?:Analysis errored\s*)+$/.test(text)) return "AnalysisErrored";
    return text;
  });
  const external = labels.some((text) => /search|brows|connector|plugin|web/i.test(text));
  // Empty headers and mixed animation labels are unfinished UI state. They
  // cannot satisfy complete, and never serve as proof of a permitted tool.
  // A terminal analysis error is accepted only when a later source-tool row
  // completed, proving that the model recovered before producing its answer.
  const unclassified = labels.some((text) => text.length > 0 && !/^(Analyzed|Analyzing|AnalysisErrored)$/.test(text));
  const terminalErrorIndexes = labels.flatMap((text, index) => text === "AnalysisErrored" ? [index] : []);
  const recoveredFromTerminalError = terminalErrorIndexes.length > 0
    && terminalErrorIndexes.every((index) => labels.slice(index + 1).includes("Analyzed"));
  for (const node of tools) if (node.getAttribute("aria-expanded") === "false") node.click();
  const codes = tools.map((node) => [...node.parentElement.querySelectorAll('code[class*="_CodeContent_"]')]
    .map((code) => code.textContent || "").join("\n"));
  return { count: tools.length, codes, statuses: labels, external, unclassified,
    terminalErrorCount: terminalErrorIndexes.length, recoveredFromTerminalError,
    complete: labels.every((text) => /^(Analyzed|AnalysisErrored)$/.test(text))
      && (terminalErrorIndexes.length === 0 || recoveredFromTerminalError)
      && codes.every(Boolean) };
}

function attachmentState(fileName) {
  const body = String(document.body?.innerText || "");
  const imagePresent = [...document.querySelectorAll("img")].some((image) => image.getClientRects().length && image.alt === fileName);
  const removeControlPresent = [...document.querySelectorAll("button")].some((button) =>
    button.getClientRects().length && (button.getAttribute("aria-label") || "") === `Remove ${fileName}`);
  return {
    visible: imagePresent || removeControlPresent || body.includes(fileName),
    uploading: /uploading|téléchargement en cours/i.test(body.slice(-2500))
  };
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
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Chrome DevTools request timed out."));
      }, 15_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
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
    const expression = `(() => {
      const visible = ${visible.toString()};
      const label = ${label.toString()};
      const desktopComposerPlainText = ${desktopComposerPlainText.toString()};
      const composerState = ${composerState.toString()};
      const target = ${fn.toString()};
      return target.apply(null, ${JSON.stringify(args)});
    })()`;
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result?.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "unknown";
      throw new Error("Desktop ChatGPT DOM evaluation failed: " + detail);
    }
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

export class ChatGptSubscriptionDesktopCdpTransport {
  constructor({
    host = "127.0.0.1",
    port = 9223,
    pageReadyTimeoutMs = 60_000,
    generationTimeoutMs = 900_000,
    fetchImpl = fetch,
    targetId = null,
    returnTargetId = null,
    checkpoint = async () => {},
    clipboard = createNativeClipboard()
  } = {}) {
    invariant(typeof host === "string" && host.length > 0, "CDP host is invalid.");
    invariant(Number.isSafeInteger(port) && port > 0 && port <= 65535, "CDP port is invalid.");
    this.baseUrl = "http://" + host + ":" + port;
    this.pageReadyTimeoutMs = pageReadyTimeoutMs;
    this.generationTimeoutMs = generationTimeoutMs;
    this.fetchImpl = fetchImpl;
    this.targetId = targetId;
    this.returnTargetId = returnTargetId;
    invariant(typeof checkpoint === "function", "Transport checkpoint sink is invalid.");
    this.checkpoint = checkpoint;
    this.clipboard = clipboard;
    this.privateInferenceIsolation = Object.freeze({
      packetOnly: true,
      freshContextPerGenerate: true,
      tools: "not_selected_prompt_prohibited_postflight_checked",
      filesystem: false,
      sessionPersistence: false,
      transport: "chatgpt-subscription-desktop-temporary-unpersonalized"
    });
  }

  async json(endpoint) {
    const response = await this.fetchImpl(this.baseUrl + endpoint, { signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    let value;
    try { value = JSON.parse(text); } catch { throw new Error("Chrome DevTools returned non-JSON."); }
    if (!response.ok) throw new Error("Chrome DevTools request failed with HTTP " + response.status + ".");
    return value;
  }

  async appTarget() {
    const targets = (await this.json("/json/list")).filter((target) => target.type === "page" && target.url === "app://-/index.html" && (this.targetId === null || target.id === this.targetId));
    invariant(targets.length === 1 && typeof targets[0].webSocketDebuggerUrl === "string",
      "Dedicated ChatGPT desktop app target is unavailable or ambiguous.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
    return targets[0];
  }

  async withPage(callback) {
    const target = await this.appTarget();
    const client = await CdpConnection.connect(target.webSocketDebuggerUrl);
    try {
      await client.send("Runtime.enable");
      await client.send("Page.enable");
      return await callback(client);
    } finally {
      client.close();
    }
  }

  async pointerClick(client, kind, value) {
    const rect = await client.call(exactControl, [kind, value]);
    invariant(rect?.ok, "Required ChatGPT desktop control is unavailable or ambiguous: " + value, "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y, button: "none", clickCount: 0 });
    for (const type of ["mousePressed", "mouseReleased"]) {
      await client.send("Input.dispatchMouseEvent", { type, x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    }
    await sleep(180);
  }

  async ensureChatMode(client) {
    let state = await waitFor(async () => {
      const current = await client.call(chatSurfaceState);
      return current.modeLabel ? current : false;
    }, this.pageReadyTimeoutMs, 200, "ChatGPT desktop mode selector did not become ready.");
    if (state.modeLabel === "ChatGPT" && !state.composerFound) {
      // ChatGPT's main pane may still be on the Work tab.
      const chatTab = await client.call(exactControl, ["text", "Chat"]);
      if (!chatTab?.ok) await this.pointerClick(client, "text", "New chat");
      await this.pointerClick(client, "text", "Chat");
      state = await waitFor(async () => {
        const candidate = await client.call(chatSurfaceState);
        return candidate.composerFound ? candidate : false;
      }, this.pageReadyTimeoutMs, 200, "ChatGPT chat composer did not become ready.");
    }
    if (state.modeLabel === "ChatGPT") return;
    invariant(["Codex", "Work"].includes(state.modeLabel), "ChatGPT desktop mode selector is unavailable.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
    await this.pointerClick(client, "aria", `Switch mode, current mode: ${state.modeLabel}`);
    await this.pointerClick(client, "text", "ChatGPT");
    state = await waitFor(async () => {
      const candidate = await client.call(chatSurfaceState);
      return candidate.modeLabel === "ChatGPT" && candidate.composerFound ? candidate : false;
    }, this.pageReadyTimeoutMs, 200, "ChatGPT mode did not become ready.");
    invariant(state.modeLabel === "ChatGPT", "ChatGPT mode verification failed.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
  }

  async clearComposerDraft(client) {
    let guard = 0;
    while (guard < 16) {
      guard += 1;
      const attachments = await client.call(attachmentRemoveState);
      if (!attachments?.count) break;
      invariant(attachments.first, "Attached-file removal control is unavailable.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
      await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: attachments.first.x, y: attachments.first.y, button: "none", clickCount: 0 });
      for (const type of ["mousePressed", "mouseReleased"]) {
        await client.send("Input.dispatchMouseEvent", { type, x: attachments.first.x, y: attachments.first.y, button: "left", clickCount: 1 });
      }
      await sleep(120);
    }
    const remaining = await client.call(attachmentRemoveState);
    invariant(remaining?.count === 0, "Fresh packet composer retained stale attachments.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");

    let composer = await client.call(composerState);
    invariant(composer?.found, "ChatGPT desktop composer is unavailable.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
    if (composer.text) {
      const focused = await client.call(focusComposerAtEnd);
      invariant(focused?.ok, "ChatGPT desktop composer could not be focused.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
      await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
      await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
      await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
      await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
      await sleep(120);
      composer = await client.call(composerState);
    }
    invariant(composer?.found && !composer.text, "Fresh packet composer retained stale text.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
  }

  async startFreshUnpersonalizedTemporaryChat(client) {
    await this.pointerClick(client, "text", "New chat");
    // New chat can restore the product's Work tab even in ChatGPT mode.
    // Recheck the application surface before treating it as an empty Chat.
    await this.ensureChatMode(client);
    // New chat may restore a long unsent draft that hides isolation labels
    // beyond bodyTail. Clear and verify that draft before reading the labels.
    await this.clearComposerDraft(client);
    await waitFor(async () => {
      const state = await client.call(chatSurfaceState);
      return state.composerFound && !/You said:|ChatGPT said:/.test(state.bodyTail) ? state : false;
    }, this.pageReadyTimeoutMs, 200, "Fresh ChatGPT conversation did not become empty.");

    const tempOn = await client.call(exactControl, ["aria", "Turn off temporary chat"]);
    if (!tempOn?.ok) await this.pointerClick(client, "aria", "Temporary chat");

    await waitFor(async () => {
      const state = await client.call(chatSurfaceState);
      return /Temporary chat/.test(state.bodyTail) ? state : false;
    }, this.pageReadyTimeoutMs, 200, "Temporary Chat did not activate.");

    let unpersonalized = await client.call(exactControl, ["text", "Unpersonalized"]);
    if (!unpersonalized?.ok) {
      await this.pointerClick(client, "text", "Personalized");
      await this.pointerClick(client, "text", "Unpersonalized");
      unpersonalized = await client.call(exactControl, ["text", "Unpersonalized"]);
    }
    invariant(unpersonalized?.ok, "Unpersonalized Temporary Chat did not activate.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");

    const body = (await client.call(chatSurfaceState)).bodyTail;
    invariant(body.includes("This chat will ignore memory, plugins, and custom instructions"),
      "Unpersonalized isolation disclosure was not observed.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
    invariant(!/You said:|ChatGPT said:/.test(body), "Fresh Temporary Chat already contains turns.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
    await sleep(500);
    await this.clearComposerDraft(client);
    await sleep(250);
    await this.clearComposerDraft(client);
    const finalBody = (await client.call(chatSurfaceState)).bodyTail;
    invariant(finalBody.includes("This chat will ignore memory, plugins, and custom instructions"),
      "Unpersonalized isolation was lost while clearing the composer.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
  }

  async ensureModelAndEffort(client, modelLabel, effortLabel) {
    await this.pointerClick(client, "aria", "Select ChatGPT model");
    const readyMenu = () => waitFor(async () => {
      const candidate = await client.call(modelMenuState, [modelLabel]);
      return candidate.modelMatchCount === 1 && candidate.sliderCount === 1 ? candidate : false;
    }, this.pageReadyTimeoutMs, 100, "ChatGPT model/effort menu did not become ready.");
    let menu = await readyMenu();
    invariant(menu.modelMatchCount === 1, "Configured ChatGPT model is unavailable.", "PRIVATE_INFERENCE_MODEL_MISMATCH");
    if (!menu.modelChecked) {
      await this.pointerClick(client, "text", modelLabel);
      await this.pointerClick(client, "aria", "Select ChatGPT model");
      menu = await readyMenu();
      invariant(menu.modelChecked, "Configured ChatGPT model did not become selected.", "PRIVATE_INFERENCE_MODEL_MISMATCH");
    }

    invariant(menu.sliderCount === 1 && Number.isInteger(menu.sliderNow) && Number.isInteger(menu.sliderMax),
      "ChatGPT reasoning-effort slider is unavailable.", "PRIVATE_INFERENCE_EFFORT_MISMATCH");

    const target = effortLabel === "Pro" ? menu.sliderMax : null;
    invariant(target !== null, "Unsupported desktop ChatGPT effort label.", "PRIVATE_INFERENCE_EFFORT_MISMATCH");
    let guard = 0;
    while (menu.sliderNow !== target && guard < 12) {
      guard += 1;
      const focused = await client.call(focusSlider);
      invariant(focused?.ok, "ChatGPT reasoning-effort slider could not be focused.", "PRIVATE_INFERENCE_EFFORT_MISMATCH");
      const key = menu.sliderNow < target ? "ArrowRight" : "ArrowLeft";
      const code = key === "ArrowRight" ? 39 : 37;
      await client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      await sleep(120);
      menu = await client.call(modelMenuState, [modelLabel]);
    }
    invariant(menu.sliderNow === target && menu.modelChecked, "Configured ChatGPT model/effort could not be verified.", "PRIVATE_INFERENCE_EFFORT_MISMATCH");
    invariant(menu.bodyTail.includes("Pro, 5 of 5.") || menu.bodyTail.includes("5.6 Pro"),
      "Visible ChatGPT Pro effort label was not observed.", "PRIVATE_INFERENCE_EFFORT_MISMATCH");
    await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  }

  async uploadImage(client, attachment, tempRoot, index) {
    invariant(attachment?.kind === "image" && attachment.bytes instanceof Uint8Array, "Desktop transport supports only validated image attachments.");
    const fileName = "journal-image-" + String(index + 1).padStart(2, "0") + "-" + attachment.sha256.slice(0, 16) + extensionFor(attachment.media_type);
    const filePath = path.join(tempRoot, fileName);
    await writeFile(filePath, attachment.bytes, { mode: 0o600 });

    await this.pointerClick(client, "aria", "Add files and more");
    await client.send("Page.setInterceptFileChooserDialog", { enabled: true });
    const chooserPromise = client.waitForEvent("Page.fileChooserOpened", 10_000);
    await this.pointerClick(client, "text", "Add photos & files");
    const chooser = await chooserPromise;
    invariant(Number.isInteger(chooser.backendNodeId), "Desktop ChatGPT file chooser did not expose a target.", "PRIVATE_INFERENCE_VISUAL_UNAVAILABLE");
    await client.send("DOM.setFileInputFiles", { files: [filePath], backendNodeId: chooser.backendNodeId });
    await client.send("Page.setInterceptFileChooserDialog", { enabled: false });

    await waitFor(async () => {
      const state = await client.call(attachmentState, [fileName]);
      return state.visible && !state.uploading ? state : false;
    }, this.pageReadyTimeoutMs, 250, "Desktop ChatGPT did not finish attaching the image.");
    return fileName;
  }

  async insertPrompt(client, prompt) {
    let state = await client.call(composerState);
    invariant(state?.found && !state.disabled, "ChatGPT desktop composer is unavailable.");
    invariant(state.text === "", "Packet composer contains unexpected text.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
    // Keep CDP edits bounded without changing or truncating the packet. Never
    // split a surrogate pair, and prove each accumulated prefix before advancing.
    const chunkCodeUnits = 8192;
    let offset = 0;
    while (offset < prompt.length) {
      let end = Math.min(offset + chunkCodeUnits, prompt.length);
      // Contenteditable can replace a temporarily trailing ASCII space with
      // NBSP. Move the boundary, never normalize or alter the source text.
      if (end < prompt.length) {
        while (end > offset && prompt[end - 1] === " ") end -= 1;
        invariant(end > offset, "No bounded non-space packet insertion boundary.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
      }
      if (end < prompt.length && /[\uD800-\uDBFF]/.test(prompt[end - 1]) && /[\uDC00-\uDFFF]/.test(prompt[end])) end -= 1;
      const expected = prompt.slice(0, end);
      const focused = await client.call(focusComposerAtEnd);
      invariant(focused?.ok, "ChatGPT desktop composer could not be focused.");
      let timedOut = false;
      try {
        await client.send("Input.insertText", { text: prompt.slice(offset, end) });
      } catch (error) {
        if (error?.message !== "Chrome DevTools request timed out.") throw error;
        // A timed-out edit may already have landed. Read it back; never resend.
        timedOut = true;
      }
      state = await waitFor(async () => {
        const candidate = await client.call(composerState);
        invariant(candidate?.found && typeof candidate.text === "string"
          && candidate.text.length >= offset && expected.startsWith(candidate.text),
        "ChatGPT desktop composer diverged during packet insertion.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
        return candidate.text === expected ? candidate : false;
      }, Math.min(this.pageReadyTimeoutMs, 10_000), 100, timedOut
        ? "Timed-out ChatGPT desktop insertion could not be reconciled by exact readback."
        : "ChatGPT desktop composer exact packet verification did not settle.");
      offset = end;
    }
    invariant(state.text === prompt, "ChatGPT desktop composer exact packet verification failed.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
  }

  async runPacket({ prompt, promptSha256, operationKey = null, attachments = [], modelVisibleLabel, effortVisibleLabel, timeoutMs, sourceBoundVisualToolsPermitted = false } = {}) {
    invariant(typeof prompt === "string" && prompt.length > 0, "Packet prompt is required.");
    invariant(promptSha256 === sha256(Buffer.from(prompt, "utf8")), "Packet prompt digest is invalid.");
    invariant(Array.isArray(attachments), "Attachments must be an array.");
    const requestId = "chatgpt-subscription:" + randomUUID();
    const surfaceSessionId = "desktop-temp:" + randomUUID();
    let submissionStatus = "not_submitted";
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "inner-signal-journal-upload-"));
    try {
      return await this.withPage(async (client) => {
        // Native pointer navigation needs the owned window, not the return window, focused.
        await client.send("Page.bringToFront");
        await this.ensureChatMode(client);
        await this.startFreshUnpersonalizedTemporaryChat(client);
        await this.ensureModelAndEffort(client, modelVisibleLabel, effortVisibleLabel);
        const selectedTools = await client.call(selectedToolState);
        invariant(selectedTools.selectedCount === 0,
          "A ChatGPT tool/plugin mode is selected in the fresh packet composer.", "PRIVATE_INFERENCE_TOOL_MODE_SELECTED");

        const attachedFiles = {};
        for (let index = 0; index < attachments.length; index += 1) {
          const name = await this.uploadImage(client, attachments[index], tempRoot, index);
          attachedFiles[name] = attachments[index].sha256;
        }
        const attached = await client.call(attachmentRemoveState);
        invariant(attached.count === attachments.length,
          "Desktop ChatGPT attachment count does not match the packet.", "PRIVATE_INFERENCE_VISUAL_UNAVAILABLE");
        await this.insertPrompt(client, prompt);

        await waitFor(async () => {
          const state = await client.call(sendControlState);
          if (state?.uploadFailed) {
            throw new ValidationError("Desktop ChatGPT attachment upload failed.", { code: "PRIVATE_INFERENCE_VISUAL_UNAVAILABLE" });
          }
          return state?.count === 1 && state.enabled ? state : false;
        }, this.pageReadyTimeoutMs, 150, "Desktop ChatGPT send control did not become ready.");
        const before = await client.call(responseState);
        invariant(before.userCount === 0 && before.assistantCount === 0,
          "Fresh desktop Temporary Chat was not empty immediately before packet submission.", "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE");
        const context = { request_id: requestId, surface_session_id: surfaceSessionId,
          operation_key: operationKey, prompt_sha256: promptSha256,
          model_visible_label: modelVisibleLabel, effort_visible_label: effortVisibleLabel,
          attached_files: attachedFiles, authenticated: true, fresh_conversation: true,
          temporary_chat: true, unpersonalized: true, memory_disabled: true,
          custom_instructions_disabled: true, plugins_disabled: true, tools_selected: false,
          prior_user_turn_count: 0, prior_assistant_turn_count: 0 };
        await this.checkpoint({ phase: "preflight", context, observed_at: new Date().toISOString() });
        submissionStatus = "unknown";
        const sent = await client.call(clickSendControl);
        invariant(sent?.ok, "Desktop ChatGPT send control could not be activated: " + JSON.stringify(sent), "PRIVATE_INFERENCE_SUBMISSION_FAILED");

        await this.checkpoint({ phase: "submitted", context, observed_at: new Date().toISOString() });
        if (this.returnTargetId && this.returnTargetId !== this.targetId) {
          const workWindow = new ChatGptSubscriptionDesktopCdpTransport({
            host: new URL(this.baseUrl).hostname, port: Number(new URL(this.baseUrl).port),
            targetId: this.returnTargetId, fetchImpl: this.fetchImpl
          });
          await workWindow.withPage(workClient => workClient.send("Page.bringToFront"));
        }
        let stable = 0;
        let prior = "";
        let toolObservation = { count: 0, codes: [], complete: true, external: false, unclassified: false };
        let maximumToolCount = 0;
        const final = await waitFor(async () => {
          const state = await client.call(responseState);
          invariant(!state.workComposerFound, "Application chat surface changed during inference.", "PRIVATE_INFERENCE_SURFACE_CHANGED");
          toolObservation = await client.call(sourceToolState);
          maximumToolCount = Math.max(maximumToolCount, toolObservation.count);
          if (toolObservation.external || toolObservation.unclassified
              || (!sourceBoundVisualToolsPermitted && (state.toolCue || toolObservation.count))) {
            throw new ValidationError("ChatGPT desktop packet exposed prohibited or unclassified tool use.", { code: "PRIVATE_INFERENCE_TOOL_USE_OBSERVED" });
          }
          if (toolObservation.count !== maximumToolCount || !toolObservation.complete) return false;
          if (state.userCount !== 1 || state.assistantCount !== 1 || state.stop || !state.finalAnswerReady || !state.composerFound || state.composerDisabled || !state.assistantText) {
            stable = 0;
            prior = state.assistantText || "";
            return false;
          }
          stable = state.assistantText === prior ? stable + 1 : 0;
          prior = state.assistantText;
          return stable >= 3 ? state : false;
        }, Math.min(timeoutMs || this.generationTimeoutMs, this.generationTimeoutMs), 500, "Desktop ChatGPT generation did not complete.");

        const inspection = toolObservation.count ? await verifySourceImageInspection({ codes: toolObservation.codes, statuses: toolObservation.statuses, attachedFiles }) : null;
        invariant(!toolObservation.count || inspection?.verified === true,
          "Image tool code could not be bound exclusively to attached source inspection.", "PRIVATE_INFERENCE_TOOL_USE_UNVERIFIED");
        const captured = await captureNativeResponseSource({
          client, expectedFinal: final, readResponseState: () => client.call(responseState),
          clipboard: this.clipboard
        });
        const assistantTurnId = "assistant:" + sha256(Buffer.from(requestId + "\0" + captured.text, "utf8")).slice(0, 40);
        const response = {
          text: captured.text,
          receipt: {
            schema_version: 1,
            transport: "chatgpt-subscription-desktop-temporary-unpersonalized",
            request_id: requestId,
            assistant_turn_id: assistantTurnId,
            source_capture: captured.capture,
            surface_session_id: surfaceSessionId,
            conversation_url: null,
            prompt_sha256: promptSha256,
            authenticated: true,
            fresh_conversation: true,
            temporary_chat: true,
            unpersonalized: true,
            memory_disabled: true,
            custom_instructions_disabled: true,
            plugins_disabled: true,
            tools_disabled: false,
            tools_selected: false,
            tool_use_prohibited: !sourceBoundVisualToolsPermitted,
            source_bound_visual_tools_permitted: sourceBoundVisualToolsPermitted,
            source_bound_image_inspection_observed: toolObservation.count > 0,
            source_bound_image_inspection_verified: inspection?.verified ?? false,
            source_bound_tool_terminal_error_count: toolObservation.terminalErrorCount ?? 0,
            source_bound_tool_error_recovered: toolObservation.recoveredFromTerminalError ?? false,
            inspected_attachment_sha256s: inspection?.inspected_attachment_sha256s ?? [],
            image_inspection_audit: inspection ? {
              validator: "source-image-syntax-v1", input_sha256: sha256(JSON.stringify(toolObservation.codes)),
              calls: toolObservation.count, operations: inspection.operations
            } : null,
            external_tool_use_observed: false,
            unclassified_tool_use_observed: false,
            tool_use_observed: toolObservation.count > 0,
            prior_user_turn_count: 0,
            prior_assistant_turn_count: 0,
            model_visible_label: modelVisibleLabel,
            effort_visible_label: effortVisibleLabel,
            incremental_cost_usd: 0,
            usage: null,
            observed_at: new Date().toISOString()
          }
        };
        await this.checkpoint({ phase: "completed", context, response, observed_at: new Date().toISOString() });
        return response;
      });
    } catch (error) {
      error.submissionStatus = submissionStatus;
      throw error;
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  async close() {}
}

export function createChatGptSubscriptionDesktopCdpTransport(options) {
  return new ChatGptSubscriptionDesktopCdpTransport(options);
}
