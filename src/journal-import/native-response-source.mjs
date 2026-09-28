import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
const hash = value => createHash("sha256").update(value).digest("hex");
const fail = code => { throw new ValidationError(code, { code }); };

// DOM text is an identity witness only, never the structured response source.
export function inspectFinalResponseSource() {
  const roots = [...document.querySelectorAll('[class*="_MarkdownRoot_"]')].filter(element => {
    if (element.closest('[class*="bg-user-message"]')) return false;
    let parent = element.parentElement;
    for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
      if ([...parent.children].some(child => child.tagName === "H4"
        && String(child.className).includes("sr-only")
        && String(child.textContent).includes("ChatGPT"))) return true;
    }
    return false;
  });
  const copies = [...document.querySelectorAll('button[aria-label="Copy"]')];
  return { roots: roots.length, copy_controls: copies.length,
    user_turns: document.querySelectorAll('[class*="bg-user-message"]').length,
    dom_text: roots.length === 1 ? roots[0].textContent : null };
}
export function clickFinalResponseCopy() {
  const copies = [...document.querySelectorAll('button[aria-label="Copy"]')];
  if (copies.length !== 1) return false;
  copies[0].click();
  return true;
}

export function createNativeClipboard(environment = process.env) {
  return {
    write(value) {
      if (!environment.DISPLAY) fail("NATIVE_RESPONSE_DISPLAY_UNAVAILABLE");
      execFileSync("xclip", ["-selection", "clipboard", "-i"], {
        input: value, env: environment, timeout: 3000,
        stdio: ["pipe", "ignore", "ignore"]
      });
    },
    read() {
      return execFileSync("xclip", ["-selection", "clipboard", "-o"], {
        env: environment, timeout: 3000, maxBuffer: 2 * 1024 * 1024
      }).toString("utf8");
    }
  };
}
function isTerminal(state) {
  return state?.userCount === 1 && state.assistantCount === 1
    && state.finalAnswerReady && !state.stop && !state.workComposerFound
    && state.composerFound && !state.composerDisabled;
}
function sameSource(snapshot, expectedDomText) {
  return snapshot?.roots === 1
    && snapshot.user_turns === 1 && snapshot.dom_text === expectedDomText;
}

export async function captureNativeResponseSource({ client, expectedFinal,
  readResponseState, clipboard = createNativeClipboard(),
  readAttempts = 20, retryDelayMs = 75 }) {
  if (!isTerminal(expectedFinal) || typeof expectedFinal.assistantDomText !== "string") {
    fail("NATIVE_RESPONSE_NOT_TERMINAL");
  }
  const dom = expectedFinal.assistantDomText;
  if (!sameSource(await client.call(inspectFinalResponseSource), dom)) {
    fail("NATIVE_RESPONSE_SOURCE_MISMATCH");
  }
  let original = null;
  for (let copy = 0; copy < 2; copy++) {
    // Copy feedback temporarily changes the button label; source text must not change.
    let ready = false;
    for (let poll = 0; poll < 50; poll++) {
      const snapshot = await client.call(inspectFinalResponseSource);
      if (!sameSource(snapshot, dom)) fail("NATIVE_RESPONSE_SOURCE_MISMATCH");
      if (snapshot.copy_controls > 1) fail("NATIVE_RESPONSE_COPY_AMBIGUOUS");
      if (snapshot.copy_controls === 1) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) fail("NATIVE_RESPONSE_COPY_UNAVAILABLE");
    const sentinel = "native-response-copy:" + randomUUID();
    await clipboard.write(sentinel);
    if (!(await client.call(clickFinalResponseCopy))) fail("NATIVE_RESPONSE_COPY_UNAVAILABLE");
    let captured = null;
    for (let attempt = 0; attempt < readAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      const value = await clipboard.read();
      if (typeof value === "string" && value !== sentinel) { captured = value; break; }
    }
    if (captured === null || !captured.length) fail("NATIVE_RESPONSE_COPY_UNAVAILABLE");
    if (original !== null && original !== captured) fail("NATIVE_RESPONSE_COPY_UNSTABLE");
    original = captured;
    if (!sameSource(await client.call(inspectFinalResponseSource), dom)
      || !isTerminal(await readResponseState())) fail("NATIVE_RESPONSE_CHANGED_DURING_COPY");
  }
  // No parsing, trimming, escape reconstruction, fence stripping, or semantic repair.
  return { text: original, capture: {
    method: "native-assistant-copy-v1", copy_count: 2,
    original_text_sha256: hash(original), original_bytes: Buffer.byteLength(original),
    rendered_dom_text_sha256: hash(dom), rendered_bytes: Buffer.byteLength(dom),
    source_dom_unchanged: true, original_bytes_modified: false,
    captured_at: new Date().toISOString()
  } };
}
