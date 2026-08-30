import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the ordinary InnerSignal launcher starts the separate loopback Commons service without merging private state", async () => {
  const source = await fs.readFile(path.join(root, "src/cli/serve.mjs"), "utf8");
  assert.match(source, /listenInnerSignalCommunity/);
  assert.match(source, /path\.join\(config\.autopilotStateDir, "community-learning"\)/);
  assert.match(source, /host: "127\.0\.0\.1"/);
  assert.match(source, /requireInviteCode: false/);
  assert.match(source, /InnerSignal Commons listening/);
  assert.doesNotMatch(source, /browserState|therapyMessages|hypnosisHistory/);
  const html = await fs.readFile(path.join(root, "apps/web/index.html"), "utf8");
  assert.match(html, /href="http:\/\/localhost:8790"/);
  assert.match(html, />InnerSignal Commons<\/a>/);
});
