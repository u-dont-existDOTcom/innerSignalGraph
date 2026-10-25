import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sourceImageValidatorAvailable, verifySourceImageInspection } from
  "../src/journal-import/source-image-inspection.mjs";
import { ChatGptSubscriptionDesktopCdpTransport } from
  "../src/journal-import/chatgpt-subscription-desktop-cdp.mjs";

const digest = createHash("sha256").update("invented-source-image").digest("hex");
const filename = "journal-image-01-" + digest.slice(0, 16) + ".png";
const attachedFiles = { [filename]: digest };
const open = "from PIL import Image\nim=Image.open('/mnt/data/" + filename + "')";
const inspect = "display(im.crop((2,3,120,140)).resize((480,560)))";
const verify = (codes, statuses = codes.map(() => "Analyzed"), files = attachedFiles) =>
  verifySourceImageInspection({ codes, statuses, attachedFiles: files });

test("reviewed source image validator is available and bound to the release source", async () => {
  assert.equal(sourceImageValidatorAvailable(), true);
  assert.equal((await verify([open, inspect])).verified, true);
});

test("source-attached image and crop display are admitted without executing model code", async () => {
  const result = await verify([open, inspect]);
  assert.deepEqual(result.inspected_attachment_sha256s, [digest]);
  assert.deepEqual(result.operations, ["open_attached_image", "crop", "resize", "display_source_image"]);
});

test("page dimensions, strict numeric coordinates and approved filters remain source-bound", async () => {
  const result = await verify([
    open + "\nw,h=im.size\nscale=0.5",
    "display(im.crop((0,0,w*scale,h/2)).resize((200,200),Image.Resampling.LANCZOS))"
  ]);
  assert.equal(result.verified, false, "no unpacking of user code is allowed by strict policy");
  const supported = await verify([
    open + "\nw=im.width\nscale=0.5",
    "display(im.crop((0,0,w*scale,200)).resize((200,200),Image.Resampling.LANCZOS))"
  ]);
  assert.equal(supported.verified, true);
  assert.ok(supported.operations.includes("resize"));
});

test("unknown image names, directories, digests and prohibited network/filesystem operations reject", async () => {
  const variants = [
    "Image.open('/etc/passwd')",
    "Image.open('/mnt/data/../" + filename + "')",
    "Image.open('/mnt/data/other.png')",
    "Image.open('/mnt/data/" + filename + "').save('/tmp/a.png')",
    "open('/mnt/data/" + filename + "')",
    "__import__('os')",
    "from PIL import ImageFile",
    "import os",
    "import urllib.request",
    "import subprocess",
    "eval('1+1')",
    "getattr(im,'save')('out.png')",
    "im.__class__",
    "import json\nprint(json.dumps({'a':1}))",
    "import numpy as np",
    "import matplotlib.pyplot as plt",
    "import PIL.Image as image",
    "display(Image.new('RGB',(200,200),(255,255,255)))",
    "im.rotate(90,expand=True)",
    "display(other)"
  ];
  for (const code of variants) {
    const result = await verify([open, code]);
    assert.equal(result.verified, false, code);
  }
  assert.equal((await verify([open, inspect], undefined, { [filename]: "f".repeat(64) })).verified, false);
});

test("unbounded code, loops, comprehensions, lambdas and result serializing are prohibited", async () => {
  const variants = [
    "for x in range(4):\n    display(im)",
    "[display(im) for i in range(4)]",
    "x=lambda a: a",
    "def helper():\n    display(im)",
    "while True:\n    display(im)",
    "if True:\n    display(im)",
    "print('synthetic transcription')",
    "print({'bbox':[0,1,2,3]})",
    `'{"transcription":"invented"}'`,
    `label = '{"transcription":"invented"}'`,
    `im.size; '{"transcription":"invented"}'`,
    "display(im)" + " ".repeat(401),
    "Image.open('/mnt/data/" + filename + "')\nimport os"
  ];
  for (const code of variants) assert.equal((await verify([open, code])).verified, false, code);
});

test("results require a source-bound successful display, not merely open or errored tool calls", async () => {
  assert.equal((await verify([open])).verified, false);
  assert.equal((await verify([open], ["AnalysisErrored"])).verified, false);
  assert.equal((await verify([open, inspect], ["Analyzed", "AnalysisErrored"])).verified, false);
  assert.equal((await verify([open, inspect], ["Analyzed", "Unknown"])).verified, false);
  assert.equal((await verify([open, inspect], ["AnalysisErrored", "Analyzed"])).verified, false,
    "a failed image-open cannot create trusted persistent image provenance");
  const beforeError = open + "\ndisplay(im)";
  const typeError = "im=1\nprint(1/0)";
  assert.equal((await verify([beforeError,typeError,"display(im)"],
    ["Analyzed","AnalysisErrored","Analyzed"])).verified,false,
    "errored call may overwrite an image before raising; stale bindings must not validate");
  assert.equal((await verify([beforeError,typeError,beforeError],
    ["Analyzed","AnalysisErrored","Analyzed"])).verified,true,
    "a subsequent successful fresh source-open and display can reestablish trusted provenance");
  assert.equal((await verify([open, inspect], ["Analyzed"])).verified, false);
  assert.equal((await verify([])).verified, false);
  assert.equal((await verify([open, inspect, open], ["Analyzed", "AnalysisErrored", "Analyzed"])).verified, false);
});

test("desktop transport can preflight a reviewed validator without contacting external ChatGPT", async () => {
  const transport = new ChatGptSubscriptionDesktopCdpTransport({
    host: "127.0.0.1", port: 65534,
    fetchImpl: () => { throw new Error("Unexpected network transport"); }
  });
  const prompt = "Synthetic in-memory only";
  // This rejects after the trusted script preflight but before a network call;
  // no actual CDP endpoint is provided.
  await assert.rejects(transport.runPacket({
    prompt, promptSha256: createHash("sha256").update(prompt).digest("hex"),
    sourceBoundVisualToolsPermitted: true, attachments: []
  }), /fetch failed|Could not connect|network transport|Unexpected network transport|unexpected/i);
});
