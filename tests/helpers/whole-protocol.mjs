// Loads the whole therapy protocol over MCP the way an app would since it comes in parts (owner answer i60a, 21 Nov 2026):
// the first answer, then every other part by name, as many per call as fit, following each answer's list of what is still
// to load. Returns the answers' texts joined; servedBlock, servedRules and servedFile read exact text back out of them.
import { loadTherapyProtocol, therapyProtocolDelivery } from "../../src/protocol/therapy-protocol.mjs";

export async function loadWholeProtocolOverMcp(url, protocol = loadTherapyProtocol()) {
  const call = async (args) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "load_therapy_protocol", arguments: args } })
    });
    const body = await response.json();
    if (body.result?.isError !== false) throw new Error(`load_therapy_protocol failed: ${JSON.stringify(body).slice(0, 300)}`);
    return body.result.content[0].text;
  };
  const delivery = therapyProtocolDelivery(protocol);
  const texts = [await call({})];
  let pending = delivery.all.map((part) => part.name).filter((name) => !delivery.firstNames.includes(name));
  while (pending.length > 0) {
    const asked = pending.slice(0, 40);
    const text = await call({ parts: asked, protocol_sha256: protocol.protocolSha256 });
    texts.push(text);
    const still = /^Still to load \(ask for these in another call\): (\[.*\])$/mu.exec(text);
    const left = still ? JSON.parse(still[1]) : [];
    if (left.length === asked.length) throw new Error(`No part of ${asked.join(", ")} came back.`);
    pending = [...left, ...pending.slice(asked.length)];
  }
  return texts.join("\n");
}

// The exact text of the block with this label, as many bytes as its BEGIN line says.
export function servedBlock(text, label) {
  const begin = new RegExp(`<<<BEGIN ${label.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&")} sha256=[0-9a-f]{64} bytes=(\\d+)>>>\\n`, "u").exec(text);
  if (!begin) return null;
  const start = Buffer.byteLength(text.slice(0, begin.index + begin[0].length), "utf8");
  return Buffer.from(text, "utf8").subarray(start, start + Number(begin[1])).toString("utf8");
}

export function servedRules(text, protocol = loadTherapyProtocol()) {
  return therapyProtocolDelivery(protocol).rules.map((part) => servedBlock(text, part.label)).join("");
}

export function servedFile(text, path, protocol = loadTherapyProtocol()) {
  const parts = therapyProtocolDelivery(protocol).references.filter((part) => part.source === path);
  return parts.length === 0 ? null : parts.map((part) => servedBlock(text, part.label)).join("");
}
